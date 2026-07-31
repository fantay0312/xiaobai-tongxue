import assert from 'node:assert/strict'
import { adminApi } from '../src/lib/api'
import { ApiError, request } from '../src/lib/api-client'
import { useAuthStore } from '../src/store/auth'

const originalFetch = globalThis.fetch
const originalMe = adminApi.auth.me

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('request signal missing'))
      return
    }
    const rejectAbort = () => reject(new Error('request aborted'))
    if (signal.aborted) {
      rejectAbort()
      return
    }
    signal.addEventListener('abort', rejectAbort, { once: true })
  })
}

async function expectTimeout(task: Promise<unknown>): Promise<ApiError> {
  try {
    await task
    assert.fail('request should time out')
  } catch (error) {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'REQUEST_TIMEOUT')
    assert.match(error.message, /响应超时/)
    return error
  }
}

async function expectCancelled(task: Promise<unknown>): Promise<void> {
  try {
    await task
    assert.fail('request should be cancelled')
  } catch (error) {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'REQUEST_ABORTED')
  }
}

try {
  globalThis.fetch = async (_input, init) => rejectWhenAborted(init?.signal)

  await expectTimeout(request('/auth/me', {}, 0))
  const unsafeTimeout = await expectTimeout(request('/users/user-1/status', {
    method: 'POST',
  }, 0))
  assert.match(unsafeTimeout.message, /操作结果尚未确认/)

  const caller = new AbortController()
  const cancelledRequest = request('/auth/me', { signal: caller.signal })
  caller.abort()
  await expectCancelled(cancelledRequest)

  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal
    return {
      ok: true,
      status: 200,
      json: () => rejectWhenAborted(signal),
    } as Response
  }
  await expectTimeout(request('/auth/me', {}, 0))

  globalThis.fetch = async (_input, init) => rejectWhenAborted(init?.signal)
  adminApi.auth.me = async () => {
    await request('/auth/me', {}, 0)
    throw new Error('timed-out request unexpectedly completed')
  }
  useAuthStore.setState({ phase: 'idle', session: null, failure: undefined })
  await useAuthStore.getState().bootstrap(true)
  const authState = useAuthStore.getState()
  assert.equal(authState.phase, 'ready')
  assert.equal(authState.session, null)
  assert.match(authState.failure ?? '', /响应超时/)
} finally {
  globalThis.fetch = originalFetch
  adminApi.auth.me = originalMe
  useAuthStore.setState({ phase: 'idle', session: null, failure: undefined })
}

console.log('admin request timeout: ok')
