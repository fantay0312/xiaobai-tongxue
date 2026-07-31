import { isRecord, sessionFrom } from './normalizers'

export const ADMIN_API_ROOT = '/api/admin/v1'

interface ErrorPayload {
  code?: string
  message?: string
  error?: string | { code?: string; message?: string }
  requestId?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string

  constructor(message: string, status: number, code = 'REQUEST_FAILED', requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

let csrfToken = ''
const ADMIN_REQUEST_TIMEOUT_MS = 10_000

function timeoutMessage(unsafe: boolean): string {
  if (unsafe) {
    return '管理服务响应超时，操作结果尚未确认。请刷新核对后再决定是否重试。'
  }
  return '管理服务响应超时，请稍后重试。'
}

function transportFailureMessage(message: string, unsafe: boolean): string {
  if (!unsafe) return message
  return `${message}操作结果尚未确认，请刷新核对后再决定是否重试。`
}

interface RequestDeadline {
  signal: AbortSignal
  didTimeout: () => boolean
  callerAborted: () => boolean
  dispose: () => void
}

function createRequestDeadline(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): RequestDeadline {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) {
    abortFromCaller()
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    callerAborted: () => callerSignal?.aborted === true,
    dispose: () => {
      globalThis.clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

async function fetchJsonWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  unsafe: boolean,
): Promise<{ response: Response; payload: unknown }> {
  const deadline = createRequestDeadline(init.signal, timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: deadline.signal })
    let payload: unknown
    if (response.status !== 204) {
      try {
        payload = await response.json()
      } catch (error) {
        if (deadline.signal.aborted) throw error
        if (response.ok) {
          throw new ApiError('管理服务返回了无法解析的响应。', response.status, 'INVALID_RESPONSE')
        }
      }
    }
    return { response, payload }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (deadline.didTimeout()) {
      throw new ApiError(timeoutMessage(unsafe), 0, 'REQUEST_TIMEOUT')
    }
    if (deadline.callerAborted()) {
      throw new ApiError(
        transportFailureMessage('管理服务请求已取消。', unsafe),
        0,
        'REQUEST_ABORTED',
      )
    }
    throw new ApiError(
      transportFailureMessage('无法连接管理服务，请检查网络或稍后重试。', unsafe),
      0,
      'NETWORK_ERROR',
    )
  } finally {
    deadline.dispose()
  }
}

export function queryString(
  values: Record<string, string | number | boolean | undefined>,
): string {
  const query = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

export function body(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) }
}

export async function request(
  path: string,
  init: RequestInit = {},
  timeoutMs = ADMIN_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const method = (init.method ?? 'GET').toUpperCase()
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  const { response, payload } = await fetchJsonWithDeadline(
    `${ADMIN_API_ROOT}${path}`,
    {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(unsafe && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...init.headers,
      },
    },
    timeoutMs,
    unsafe,
  )

  if (!response.ok) {
    const error = isRecord(payload) ? (payload as ErrorPayload) : {}
    const nested = typeof error.error === 'object' ? error.error : undefined
    const code = nested?.code ?? error.code ??
      (typeof error.error === 'string' ? error.error : 'REQUEST_FAILED')
    const message = nested?.message ?? error.message ??
      (typeof error.error === 'string' ? error.error : `请求失败（${response.status}）`)
    throw new ApiError(message, response.status, code, error.requestId)
  }
  return payload
}

export async function authenticated(payload: Promise<unknown>) {
  const result = sessionFrom(await payload)
  csrfToken = result.csrfToken
  return result.session
}

export function clearCsrf(): void {
  csrfToken = ''
}
