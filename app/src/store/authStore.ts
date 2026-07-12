/**
 * 认证状态 —— 服务器驱动的登录门槛。
 * standalone:探测不到网关(本地开发/离线演示/vite preview),不强制登录,一切照旧;
 * anon:网关在但未登录 —— 仅可查看,备课/讲解入口被路由守卫拦截;
 * authed:已登录,完整可用。会话凭证是 HttpOnly Cookie,前端不接触 token。
 */
import { create } from 'zustand';
import { API_BASE } from '../lib/api';
import { clearCoachThreads } from '../engine/coach';

export type AuthStatus = 'unknown' | 'standalone' | 'anon' | 'authed';

interface AuthState {
  status: AuthStatus;
  user: string | null;
  init: () => Promise<void>;
  /** 返回 null 表示成功,否则为可展示的错误消息 */
  login: (username: string, password: string) => Promise<string | null>;
  /** 凭邀请码注册,成功即已登录;返回 null 表示成功,否则为可展示的错误消息 */
  register: (username: string, password: string, invite: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

/** 注册接口错误码 → 用户可读文案(未知码回退通用提示) */
const REGISTER_ERRORS: Record<string, string> = {
  'invalid-invite': '邀请码不对,请核对后再试',
  'name-taken': '这个账号名已有人用,换一个吧',
  'bad-name': '账号名需 2–20 字,可用汉字、字母、数字、_ 或 -',
  'weak-password': '密码至少要 8 位',
  'password-too-long': '密码太长了(最多 128 位)',
  'registration-disabled': '注册暂未开放,请联系管理员',
  'registry-full': '注册名额已满,请联系管理员',
  'too-many-attempts': '尝试太频繁,请稍后再试',
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'unknown',
  user: null,

  // 判定规则:拿到 HTTP 响应即定论(2xx=按内容,其余=无网关→standalone);
  // 网络层瞬断/超时重试 3 次再落 standalone,避免慢网首屏把登录墙误关一整个会话。
  // init 永不把已登录状态降级(与 login 并发时以 login 为准)。
  init: async () => {
    const applyGuarded = (next: { status: AuthStatus; user: string | null }) =>
      set((s) => (s.status === 'authed' ? s : next));
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch(`${API_BASE}/me`, { signal: ctrl.signal });
        if (!res.ok) {
          applyGuarded({ status: 'standalone', user: null });
          return;
        }
        const data = await res.json();
        applyGuarded(data?.user?.name
          ? { status: 'authed', user: String(data.user.name) }
          : { status: 'anon', user: null });
        return;
      } catch {
        // 网络层失败:退避后重试
      } finally {
        clearTimeout(timer);
      }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      if (get().status === 'authed') return;
    }
    applyGuarded({ status: 'standalone', user: null });
  },

  login: async (username, password) => {
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 401) return '账号或密码不对';
      if (res.status === 429) return '尝试太频繁,请稍后再试';
      if (!res.ok) return `登录失败(${res.status})`;
      const data = await res.json();
      set({ status: 'authed', user: String(data?.user?.name ?? username) });
      return null;
    } catch {
      return '连不上服务器,请检查网络';
    }
  },

  register: async (username, password, invite) => {
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, invite }),
      });
      if (!res.ok) {
        let code = '';
        try { code = String((await res.json())?.error ?? ''); } catch { /* 非 JSON 响应走回退文案 */ }
        return REGISTER_ERRORS[code] ?? `注册失败(${res.status})`;
      }
      const data = await res.json();
      // 服务端注册成功即发会话 Cookie,这里直接进登录态
      set({ status: 'authed', user: String(data?.user?.name ?? username) });
      return null;
    } catch {
      return '连不上服务器,请检查网络';
    }
  },

  logout: async () => {
    try { await fetch(`${API_BASE}/logout`, { method: 'POST' }); } catch { /* 离线登出也放行 */ }
    // 登出是 SPA 内切换,不清的话换账号会看见上一位老师的备课答疑草稿
    clearCoachThreads();
    set({ status: 'anon', user: null });
  },
}));
