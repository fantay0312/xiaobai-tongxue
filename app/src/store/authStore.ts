/** 服务器驱动的认证状态；会话凭证仅存在 HttpOnly Cookie。 */
import { create } from 'zustand';
import { advanceAuthEpoch, API_BASE, currentAuthEpoch, gatewayFetch, setGatewayIdentity } from '../lib/api';
import { broadcastAuthChange } from '../lib/authChannel';
import { clearCoachThreads } from '../engine/coach';

export type AuthStatus = 'unknown' | 'standalone' | 'anon' | 'authed' | 'unavailable';
export type AuthField = 'email' | 'code' | 'username' | 'password' | 'currentPassword'
  | 'newPassword' | 'confirmPassword' | 'invite' | 'form';
export type EmailCodePurpose = 'login' | 'register';

export interface AuthResult {
  ok: boolean;
  message?: string;
  field?: AuthField;
  retryAfter?: number;
}

export interface RegistrationInput {
  username: string;
  password: string;
  email: string;
  code: string;
  invite?: string;
}

interface AuthState {
  status: AuthStatus;
  user: string | null;
  emailMasked: string | null;
  emailBindingRequired: boolean;
  emailAuthAvailable: boolean;
  registrationAvailable: boolean;
  inviteRequired: boolean;
  init: () => Promise<void>;
  refreshSession: (failClosed?: boolean) => Promise<void>;
  requestEmailCode: (email: string, purpose: EmailCodePurpose, invite?: string) => Promise<AuthResult>;
  requestEmailBindingCode: (email: string, currentPassword: string) => Promise<AuthResult>;
  bindEmail: (email: string, code: string, currentPassword: string) => Promise<AuthResult>;
  requestEmailChangeCode: (email: string, currentPassword: string) => Promise<AuthResult>;
  changeEmail: (email: string, code: string, currentPassword: string) => Promise<AuthResult>;
  requestPasswordResetCode: (email: string) => Promise<AuthResult>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<AuthResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthResult>;
  login: (identifier: string, password: string) => Promise<AuthResult>;
  loginWithEmailCode: (email: string, code: string) => Promise<AuthResult>;
  register: (input: RegistrationInput) => Promise<AuthResult>;
  logout: () => Promise<AuthResult>;
}

let authMutationsInFlight = 0;
let queuedRefresh: boolean | null = null;

function beginAuthMutation(): number {
  authMutationsInFlight += 1;
  return advanceAuthEpoch();
}

function finishAuthMutation(getState: () => AuthState): void {
  authMutationsInFlight = Math.max(0, authMutationsInFlight - 1);
  if (authMutationsInFlight > 0 || queuedRefresh === null) return;
  const failClosed = queuedRefresh;
  queuedRefresh = null;
  queueMicrotask(() => void getState().refreshSession(failClosed));
}

type ErrorInfo = { message: string; field?: AuthField };
const API_ERRORS: Record<string, ErrorInfo> = {
  'invalid-email': { message: '邮箱格式不正确，请核对后再试', field: 'email' },
  'bad-email': { message: '邮箱格式不正确，请核对后再试', field: 'email' },
  'invalid-code': { message: '验证码不正确或已失效，请重新获取', field: 'code' },
  'invalid-or-expired-code': { message: '验证码不正确或已失效，请重新获取', field: 'code' },
  'bad-code': { message: '验证码不正确或已失效，请重新获取', field: 'code' },
  'code-expired': { message: '验证码已失效，请重新获取', field: 'code' },
  'expired-code': { message: '验证码已失效，请重新获取', field: 'code' },
  'email-taken': { message: '这个邮箱已注册，请直接登录', field: 'email' },
  'name-taken': { message: '这个账号名已有人使用，请换一个', field: 'username' },
  'bad-name': { message: '账号名需 2–20 字，可用汉字、字母、数字、_ 或 -', field: 'username' },
  'weak-password': { message: '密码至少需要 8 位', field: 'password' },
  'password-too-long': { message: '密码不能超过 128 位', field: 'password' },
  'invalid-credentials': { message: '当前密码不正确，请重新输入', field: 'currentPassword' },
  'password-unchanged': { message: '新密码不能与当前密码相同', field: 'newPassword' },
  'invalid-invite': { message: '邀请码不正确，请核对后再试', field: 'invite' },
  'invite-required': { message: '请输入管理员发放的邀请码', field: 'invite' },
  'email-auth-disabled': { message: '邮箱验证码服务暂不可用，请使用账号密码登录' },
  'email-auth-unavailable': { message: '邮箱验证码服务暂不可用，请使用账号密码登录' },
  'email-unavailable': { message: '该邮箱暂时无法接收验证码，请更换邮箱或稍后再试', field: 'email' },
  'registration-disabled': { message: '注册暂未开放，请联系管理员' },
  'registry-full': { message: '注册名额已满，请联系管理员' },
  'too-many-attempts': { message: '尝试过于频繁，请稍后再试' },
  'send-too-frequent': { message: '验证码发送太频繁，请稍后再试' },
  'email-auth-busy': { message: '验证码服务繁忙，请稍后再试' },
  'email-verification-required': { message: '请先完成邮箱验证后再继续' },
  'mail-send-failed': { message: '验证码暂时无法发送，请稍后再试' },
  'persist-failed': { message: '账号暂时无法保存，请稍后再试' },
  'https-required': { message: '为保护账号安全，请通过 HTTPS 访问后再试' },
};

const AUTH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function gatewayFetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  expectedUnauthorized = false,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    return await gatewayFetch(input, { ...init, signal: controller.signal }, {
      expectedUnauthorizedErrors: expectedUnauthorized ? ['invalid-credentials'] : undefined,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function networkFailure(error: unknown): AuthResult {
  const timedOut = error instanceof DOMException && error.name === 'AbortError';
  return {
    ok: false,
    message: timedOut ? '服务器响应超时，请稍后重试' : '无法连接服务器，请检查网络后重试',
    field: 'form',
  };
}

function supersededAuthResult(): AuthResult {
  queuedRefresh = true;
  return { ok: false, message: '登录状态已发生变化，请重新操作', field: 'form' };
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === 'object' ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function retrySeconds(response: Response, payload: Record<string, unknown>, fallback = 0): number {
  const value = Number(payload.retryAfter ?? response.headers.get('Retry-After') ?? fallback);
  return Number.isFinite(value) ? Math.min(3600, Math.max(0, Math.ceil(value))) : fallback;
}

async function apiFailure(response: Response, fallback: string): Promise<AuthResult> {
  const payload = await readPayload(response);
  const code = String(payload.error ?? '');
  const mapped = API_ERRORS[code];
  const retryAfter = retrySeconds(response, payload);
  return {
    ok: false,
    message: mapped?.message ?? fallback,
    field: mapped?.field ?? 'form',
    ...(retryAfter > 0 ? { retryAfter } : {}),
  };
}

const PRIVATE_EMAIL_ERRORS = new Set([
  'email-taken', 'email-in-use', 'email-exists', 'email-already-bound', 'email-unavailable',
]);

/** 换绑场景不区分“邮箱已占用”和其他不可用原因，避免借错误文案枚举邮箱归属。 */
async function emailChangeFailure(response: Response, fallback: string): Promise<AuthResult> {
  const payload = await readPayload(response);
  const code = String(payload.error ?? '');
  const retryAfter = retrySeconds(response, payload);
  if (PRIVATE_EMAIL_ERRORS.has(code)) {
    return {
      ok: false,
      message: '暂时无法使用该邮箱，请更换邮箱或稍后再试',
      field: 'email',
      ...(retryAfter > 0 ? { retryAfter } : {}),
    };
  }
  if (code === 'email-auth-disabled' || code === 'email-auth-unavailable') {
    return {
      ok: false,
      message: '邮箱验证码服务暂不可用，请稍后再试',
      field: 'form',
      ...(retryAfter > 0 ? { retryAfter } : {}),
    };
  }
  const mapped = API_ERRORS[code];
  return {
    ok: false,
    message: mapped?.message ?? fallback,
    field: mapped?.field ?? 'form',
    ...(retryAfter > 0 ? { retryAfter } : {}),
  };
}

function userName(payload: Record<string, unknown>, fallback: string): string {
  const user = payload.user;
  if (!user || typeof user !== 'object') return fallback;
  const name = (user as Record<string, unknown>).name;
  return typeof name === 'string' && name ? name : fallback;
}

function needsEmailBinding(payload: Record<string, unknown>): boolean {
  return payload.emailBindingRequired === true;
}

function maskedEmail(payload: Record<string, unknown>): string | null {
  const value = payload.emailMasked;
  return typeof value === 'string' && value.length <= 254 && value.includes('*') ? value : null;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'unknown',
  user: null,
  emailMasked: null,
  emailBindingRequired: false,
  emailAuthAvailable: false,
  registrationAvailable: false,
  inviteRequired: false,

  init: async () => {
    const generation = currentAuthEpoch();
    if (get().status !== 'authed') set({ status: 'unknown' });
    let receivedHttpResponse = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(`${API_BASE}/me`, { signal: controller.signal });
        receivedHttpResponse = true;
        if (response.ok) {
          const data = await readPayload(response);
          if (generation !== currentAuthEpoch()) return;
          const capabilities = {
            emailAuthAvailable: data.emailAuthAvailable === true,
            registrationAvailable: data.registrationAvailable === true,
            inviteRequired: data.inviteRequired === true,
          };
          if (data.authRequired === false) {
            if (get().user) clearCoachThreads();
            setGatewayIdentity(null);
            set({
              status: 'standalone', user: null, emailMasked: null,
              emailBindingRequired: false, ...capabilities,
            });
          } else {
            const name = userName(data, '');
            const previousUser = get().user;
            if (previousUser && previousUser.toLowerCase() !== name.toLowerCase()) {
              clearCoachThreads();
            }
            setGatewayIdentity(name || null);
            set(name ? {
              status: 'authed', user: name, emailMasked: maskedEmail(data),
              emailBindingRequired: needsEmailBinding(data), ...capabilities,
            } : {
              status: 'anon', user: null, emailMasked: null,
              emailBindingRequired: false, ...capabilities,
            });
          }
          return;
        }
      } catch {
        // 网络错误与超时统一重试；生产环境最终保持关闭态。
      } finally {
        window.clearTimeout(timer);
      }
      if (generation !== currentAuthEpoch()) return;
      await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
    }
    if (generation !== currentAuthEpoch()) return;
    const status: AuthStatus = import.meta.env.DEV && !receivedHttpResponse ? 'standalone' : 'unavailable';
    setGatewayIdentity(null);
    set({
      status, user: null, emailMasked: null, emailBindingRequired: false,
      emailAuthAvailable: false, registrationAvailable: false, inviteRequired: false,
    });
  },

  refreshSession: async (failClosed = true) => {
    if (authMutationsInFlight > 0) {
      queuedRefresh = queuedRefresh === true || failClosed;
      return;
    }
    advanceAuthEpoch();
    if (failClosed) {
      clearCoachThreads();
      setGatewayIdentity(null);
      set({ status: 'unknown', user: null, emailMasked: null, emailBindingRequired: false });
    }
    await get().init();
  },

  requestEmailCode: async (email, purpose, invite) => {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/auth/email-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose, ...(invite ? { invite } : {}) }),
      });
      if (!response.ok) return await apiFailure(response, `验证码发送失败（${response.status}）`);
      const payload = await readPayload(response);
      return { ok: true, retryAfter: retrySeconds(response, payload, 60) };
    } catch (error) {
      return networkFailure(error);
    }
  },

  requestEmailBindingCode: async (email, currentPassword) => {
    try {
      const response = await gatewayFetchWithTimeout(`${API_BASE}/account/email-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword }),
      }, true);
      if (!response.ok) return await apiFailure(response, `验证码发送失败（${response.status}）`);
      const payload = await readPayload(response);
      return { ok: true, retryAfter: retrySeconds(response, payload, 60) };
    } catch (error) {
      return networkFailure(error);
    }
  },

  bindEmail: async (email, code, currentPassword) => {
    const generation = beginAuthMutation();
    try {
      const response = await gatewayFetchWithTimeout(`${API_BASE}/account/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, currentPassword }),
      }, true);
      if (!response.ok) {
        if (response.status >= 500) queuedRefresh = true;
        return await apiFailure(response, `邮箱绑定失败（${response.status}）`);
      }
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, get().user ?? '');
      if (!user) {
        queuedRefresh = true;
        return { ok: false, message: '登录状态已变化，请重新操作', field: 'form' };
      }
      setGatewayIdentity(user);
      set({ status: 'authed', user, emailMasked: maskedEmail(payload), emailBindingRequired: false });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  requestEmailChangeCode: async (email, currentPassword) => {
    try {
      const response = await gatewayFetchWithTimeout(`${API_BASE}/account/email-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword }),
      }, true);
      if (!response.ok) return await emailChangeFailure(response, `验证码发送失败（${response.status}）`);
      const payload = await readPayload(response);
      return { ok: true, retryAfter: retrySeconds(response, payload, 60) };
    } catch (error) {
      return networkFailure(error);
    }
  },

  changeEmail: async (email, code, currentPassword) => {
    const generation = beginAuthMutation();
    try {
      const response = await gatewayFetchWithTimeout(`${API_BASE}/account/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, currentPassword }),
      }, true);
      if (!response.ok) {
        if (response.status >= 500 && queuedRefresh === null) queuedRefresh = false;
        return await emailChangeFailure(response, `邮箱更换失败（${response.status}）`);
      }
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, '');
      const nextEmailMasked = maskedEmail(payload);
      if (!user || !nextEmailMasked || payload.emailBindingRequired !== false) {
        if (queuedRefresh === null) queuedRefresh = false;
        return { ok: false, message: '邮箱状态未能确认，请重新打开个人中心查看', field: 'form' };
      }
      setGatewayIdentity(user);
      set({ status: 'authed', user, emailMasked: nextEmailMasked, emailBindingRequired: false });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      // 请求结果不确定时后台回读 /me，但不先清空仍有效的当前会话与个人中心表单。
      if (queuedRefresh === null) queuedRefresh = false;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  requestPasswordResetCode: async (email) => {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/auth/password-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) return await apiFailure(response, `验证码发送失败（${response.status}）`);
      const payload = await readPayload(response);
      return { ok: true, retryAfter: retrySeconds(response, payload, 60) };
    } catch (error) {
      return networkFailure(error);
    }
  },

  resetPassword: async (email, code, newPassword) => {
    const generation = beginAuthMutation();
    try {
      const response = await fetchWithTimeout(`${API_BASE}/auth/password-reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (!response.ok) return await apiFailure(response, `密码重设失败（${response.status}）`);
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, '');
      if (!user) {
        queuedRefresh = true;
        return { ok: false, message: '登录状态未能确认，请使用新密码重新登录', field: 'form' };
      }
      setGatewayIdentity(user);
      set({
        status: 'authed', user, emailMasked: maskedEmail(payload),
        emailBindingRequired: needsEmailBinding(payload),
      });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const generation = beginAuthMutation();
    try {
      const response = await gatewayFetchWithTimeout(`${API_BASE}/account/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      }, true);
      if (!response.ok) return await apiFailure(response, `密码更改失败（${response.status}）`);
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, get().user ?? '');
      if (user) {
        setGatewayIdentity(user);
        set({
          status: 'authed', user,
          emailMasked: maskedEmail(payload) ?? get().emailMasked,
          emailBindingRequired: payload.emailBindingRequired === undefined
            ? get().emailBindingRequired : needsEmailBinding(payload),
        });
      }
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      if (queuedRefresh === null) queuedRefresh = false;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  login: async (identifier, password) => {
    const generation = beginAuthMutation();
    try {
      const response = await fetchWithTimeout(`${API_BASE}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (response.status === 401) {
        return { ok: false, message: '邮箱、账号或密码不正确', field: 'form' };
      }
      if (!response.ok) return await apiFailure(response, `登录失败（${response.status}）`);
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, identifier);
      setGatewayIdentity(user);
      set({
        status: 'authed', user, emailMasked: maskedEmail(payload),
        emailBindingRequired: needsEmailBinding(payload),
      });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  loginWithEmailCode: async (email, code) => {
    const generation = beginAuthMutation();
    try {
      const response = await fetchWithTimeout(`${API_BASE}/login/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!response.ok) return await apiFailure(response, '邮箱或验证码不正确');
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, email);
      setGatewayIdentity(user);
      set({
        status: 'authed', user, emailMasked: maskedEmail(payload),
        emailBindingRequired: needsEmailBinding(payload),
      });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  register: async (input) => {
    const generation = beginAuthMutation();
    try {
      const response = await fetchWithTimeout(`${API_BASE}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) return await apiFailure(response, `注册失败（${response.status}）`);
      const payload = await readPayload(response);
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      const user = userName(payload, input.username);
      setGatewayIdentity(user);
      set({
        status: 'authed', user, emailMasked: maskedEmail(payload),
        emailBindingRequired: needsEmailBinding(payload),
      });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },

  logout: async () => {
    const generation = beginAuthMutation();
    setGatewayIdentity(null);
    set({ status: 'unknown', user: null, emailMasked: null, emailBindingRequired: false });
    try {
      const response = await fetchWithTimeout(`${API_BASE}/logout`, { method: 'POST' });
      if (!response.ok) {
        const failure = await apiFailure(response, `退出失败（${response.status}）`);
        // 反代 5xx 也无法证明上游未删会话；与网络异常一样交给 /me 判定。
        queuedRefresh = true;
        return failure;
      }
      if (generation !== currentAuthEpoch()) return supersededAuthResult();
      clearCoachThreads();
      set({ status: 'anon', user: null, emailMasked: null, emailBindingRequired: false });
      broadcastAuthChange();
      return { ok: true };
    } catch (error) {
      // 请求超时/断网时无法判断服务端是否已删会话，排队 /me 做权威收敛。
      queuedRefresh = true;
      return networkFailure(error);
    } finally {
      finishAuthMutation(get);
    }
  },
}));
