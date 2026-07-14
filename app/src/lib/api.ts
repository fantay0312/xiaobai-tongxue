/**
 * 同源网关 API 根路径。
 * 跟随构建 base(XB_BASE):根部署 → /api;路径前缀部署(如 /xiaobai/) → /xiaobai/api。
 * node 环境(simulate/livetest 经由 engine 间接引入)没有 import.meta.env,回退 '/'。
 */
const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const API_BASE = `${base.replace(/\/+$/, '')}/api`;

/** 同源网关确认会话失效时通知应用壳；登录表单的预期 401 不走此封装。 */
export const AUTH_EXPIRED_EVENT = 'xiaobai:auth-expired';
/** 网关明确拒绝未补录邮箱的旧账号时，交给认证层回读 /me 并进入补绑页。 */
export const EMAIL_BINDING_REQUIRED_EVENT = 'xiaobai:email-binding-required';

let authEpoch = 0;
let gatewayIdentity: string | null = null;

/** 每次登录、注册、登出或会话失效都推进世代，隔离此前已发出的异步请求。 */
export function advanceAuthEpoch(): number {
  authEpoch += 1;
  return authEpoch;
}

export function currentAuthEpoch(): number {
  return authEpoch;
}

/** 仅保存在当前标签页内，用于阻止共享 Cookie 切号后把旧标签页数据写给新账号。 */
export function setGatewayIdentity(user: string | null): void {
  gatewayIdentity = user;
}

async function responseRequiresEmailBinding(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const payload: unknown = await response.clone().json();
    return !!payload && typeof payload === 'object'
      && (payload as { error?: unknown }).error === 'email-verification-required';
  } catch {
    return false;
  }
}

interface GatewayFetchOptions {
  /** 只有这些业务错误可占用 401；login-required 等仍按会话失效处理。 */
  expectedUnauthorizedErrors?: readonly string[];
}

async function hasExpectedUnauthorizedError(
  response: Response,
  expectedErrors: readonly string[] | undefined,
): Promise<boolean> {
  if (response.status !== 401 || !expectedErrors?.length) return false;
  try {
    const payload: unknown = await response.clone().json();
    return !!payload && typeof payload === 'object'
      && expectedErrors.includes(String((payload as { error?: unknown }).error ?? ''));
  } catch {
    return false;
  }
}

export async function gatewayFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: GatewayFetchOptions,
): Promise<Response> {
  const requestEpoch = authEpoch;
  const headers = new Headers(init?.headers);
  if (gatewayIdentity) headers.set('X-Xiaobai-User', encodeURIComponent(gatewayIdentity));
  const response = await fetch(input, { ...init, headers });
  const expectedUnauthorized = await hasExpectedUnauthorizedError(
    response,
    options?.expectedUnauthorizedErrors,
  );
  if (response.status === 401 && !expectedUnauthorized
    && requestEpoch === authEpoch && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (requestEpoch === authEpoch && typeof window !== 'undefined'
    && await responseRequiresEmailBinding(response) && requestEpoch === authEpoch) {
    window.dispatchEvent(new Event(EMAIL_BINDING_REQUIRED_EVENT));
  }
  return response;
}
