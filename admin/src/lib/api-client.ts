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

export async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response
  const method = (init.method ?? 'GET').toUpperCase()
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  try {
    response = await fetch(`${ADMIN_API_ROOT}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(unsafe && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('无法连接管理服务，请检查网络或稍后重试。', 0, 'NETWORK_ERROR')
  }

  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined)
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
