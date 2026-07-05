/**
 * 使用类路由守卫(备课/讲解舱):未登录仅可查看,进入"使用"页面须先登录。
 * standalone(无网关)不设门槛 —— 离线演示保稳不受影响。
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const { pathname } = useLocation();
  if (status === 'unknown') return null; // /api/me 探测瞬间,避免闪跳
  if (status === 'anon') {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
  }
  return <>{children}</>;
}
