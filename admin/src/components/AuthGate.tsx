import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import type { Permission } from '../types/admin'
import { can, canAny } from '../lib/permissions'
import { useAuthStore } from '../store/auth'
import { Button, Feedback } from './ui'
import shellStyles from '../styles/Shell.module.css'

export function RequireSession() {
  const phase = useAuthStore((state) => state.phase)
  const session = useAuthStore((state) => state.session)
  const failure = useAuthStore((state) => state.failure)
  const bootstrap = useAuthStore((state) => state.bootstrap)
  const location = useLocation()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className={shellStyles.bootstrap}>
        <Feedback kind="loading" detail="正在验证独立管理会话，请稍候。" />
      </div>
    )
  }
  if (failure) {
    return (
      <div className={shellStyles.bootstrap}>
        <Feedback kind="error" detail={failure} onRetry={() => void bootstrap(true)} />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const session = useAuthStore((state) => state.session)
  if (!can(session, permission)) {
    return (
      <Feedback
        kind="denied"
        detail={`需要权限：${permission}。如属工作职责，请联系最高管理员调整角色。`}
      />
    )
  }
  return <Outlet />
}

export function RequireAnyPermission({ permissions }: { permissions: Permission[] }) {
  const session = useAuthStore((state) => state.session)
  if (!canAny(session, permissions)) {
    return (
      <Feedback
        kind="denied"
        detail={`需要以下任一权限：${permissions.join(' / ')}。请联系最高管理员调整角色。`}
      />
    )
  }
  return <Outlet />
}

export function SessionErrorAction() {
  const bootstrap = useAuthStore((state) => state.bootstrap)
  return <Button onClick={() => void bootstrap(true)}>重新验证</Button>
}
