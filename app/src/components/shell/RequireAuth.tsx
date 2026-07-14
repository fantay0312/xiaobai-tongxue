/**
 * 使用类路由守卫(备课/讲解舱):未登录仅可查看,进入"使用"页面须先登录。
 * standalone 仅用于明确的本地演示；生产认证不可用时保持关闭并允许重试。
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const emailBindingRequired = useAuthStore((s) => s.emailBindingRequired);
  const init = useAuthStore((s) => s.init);
  const { pathname, search } = useLocation();
  if (status === 'unknown') {
    return <div className="route-loader" role="status" aria-live="polite">正在确认登录状态…</div>;
  }
  if (status === 'unavailable') {
    return (
      <div className="route-loader" role="alert">
        <div>
          <p>认证服务暂时无法连接，已为你保留当前页面。</p>
          <button type="button" onClick={() => void init()}>重新连接</button>
        </div>
      </div>
    );
  }
  if (status === 'anon' || (status === 'authed' && emailBindingRequired)) {
    return <Navigate to={`/login?next=${encodeURIComponent(`${pathname}${search}`)}`} replace />;
  }
  return <>{children}</>;
}
