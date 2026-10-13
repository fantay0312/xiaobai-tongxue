import { useCallback, useEffect, useState } from 'react';
import { probeStatus, type WorkbenchStatus } from '../../../../engine/research';
import { useAuthStore } from '../../../../store/authStore';

/** 模型、文献连接器、Python、文件存储此刻是否可用；挂载、回到页面、登录状态变化时重新探测 */
export function useWorkbenchStatus(): { status: WorkbenchStatus | null; refresh: () => void } {
  const authKey = useAuthStore((state) => `${state.status}:${state.user ?? ''}`);
  const [status, setStatus] = useState<WorkbenchStatus | null>(null);

  const refresh = useCallback((force = true) => {
    void probeStatus(force).then(setStatus);
  }, []);

  useEffect(() => {
    let alive = true;
    void probeStatus(true).then((value) => { if (alive) setStatus(value); });
    const onFocus = () => { void probeStatus().then((value) => { if (alive) setStatus(value); }); };
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.removeEventListener('focus', onFocus); };
  }, [authKey]);

  return { status, refresh: () => refresh(true) };
}
