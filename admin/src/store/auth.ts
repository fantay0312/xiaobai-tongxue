import { create } from 'zustand'
import { ApiError, adminApi } from '../lib/api'
import type { AdminSession } from '../types/admin'

type AuthPhase = 'idle' | 'loading' | 'ready'

interface AuthState {
  phase: AuthPhase
  session: AdminSession | null
  failure?: string
  bootstrap: (force?: boolean) => Promise<void>
  setSession: (session: AdminSession) => void
  signOut: () => Promise<boolean>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'idle',
  session: null,
  async bootstrap(force = false) {
    if (!force && get().phase !== 'idle') return
    set({ phase: 'loading', failure: undefined })
    try {
      const session = await adminApi.auth.me()
      set({ phase: 'ready', session, failure: undefined })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ phase: 'ready', session: null, failure: undefined })
        return
      }
      set({
        phase: 'ready',
        session: null,
        failure: error instanceof Error ? error.message : '无法验证管理会话',
      })
    }
  },
  setSession(session) {
    set({ phase: 'ready', session, failure: undefined })
  },
  async signOut() {
    try {
      await adminApi.auth.logout()
      set({ phase: 'ready', session: null, failure: undefined })
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : '管理服务未确认注销'
      set({
        phase: 'ready',
        failure: `退出未完成，服务器会话仍可能有效。请保持此页面打开并重试；共享设备上不要直接交给下一位使用者。${detail}`,
      })
      return false
    }
  },
}))
