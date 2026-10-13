/**
 * 使用类路由守卫(备课/讲解舱):未登录仅可查看,进入"使用"页面须先登录。
 * standalone 仅用于明确的本地演示；生产认证不可用时保持关闭并允许重试。
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { WifiOff } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { Button, Empty, Shimmer } from '../ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const emailBindingRequired = useAuthStore((s) => s.emailBindingRequired);
  const phoneBindingRequired = useAuthStore((s) => s.phoneBindingRequired);
  const init = useAuthStore((s) => s.init);
  const { pathname, search } = useLocation();
  if (status === 'unknown') {
    return <div className="route-loader" role="status" aria-live="polite"><Shimmer>正在确认登录状态…</Shimmer></div>;
  }
  if (status === 'unavailable') {
    return (
      <div className="route-loader" role="alert">
        <Empty
          icon={<WifiOff size={20} strokeWidth={1.75} />}
          title="暂时连不上账号服务"
          description="当前页面已为你保留，网络恢复后点一下重新连接。"
          action={<Button variant="solid" onClick={() => void init()}>重新连接</Button>}
        />
      </div>
    );
  }
  if (status === 'anon'
    || (status === 'authed' && (emailBindingRequired || phoneBindingRequired))) {
    return <Navigate to={`/login?next=${encodeURIComponent(`${pathname}${search}`)}`} replace />;
  }
  return <>{children}</>;
}
