import { useEffect, useState } from 'react';
import { loadModelCatalog, type ModelCatalog } from '../../../lib/modelGateway';
import { useAuthStore } from '../../../store/authStore';

/** 模型目录：挂载时读取，登录状态变化后重读；enabled 为 false（本地演示）时不请求。 */
export function useModelCatalog(enabled: boolean): ModelCatalog | null {
  const authKey = useAuthStore((state) => `${state.status}:${state.user ?? ''}`);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);

  useEffect(() => {
    if (!enabled) { setCatalog(null); return; }
    const controller = new AbortController();
    loadModelCatalog(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setCatalog(next); })
      .catch(() => { if (!controller.signal.aborted) setCatalog(null); });
    return () => controller.abort();
  }, [enabled, authKey]);

  return catalog;
}
