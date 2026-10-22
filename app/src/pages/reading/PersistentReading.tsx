import { lazy, Suspense, useEffect, useState } from 'react';
import { retryModule } from '../../lib/moduleRecovery';

const loadReading = () => retryModule(() => import('./ReadingTerminal'));
const ReadingTerminal = lazy(loadReading);

/** One reader per verified account. Route switches preserve its document and reading position. */
export function PersistentReading({ active, enabled, owner }: { active: boolean; enabled: boolean; owner: string | null }) {
  const [prepared, setPrepared] = useState(false);
  useEffect(() => {
    if (!enabled || prepared) return;
    const prepare = () => { void loadReading().catch(() => {}); setPrepared(true); };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prepare, { timeout: 1200 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prepare, 250);
    return () => clearTimeout(id);
  }, [enabled, prepared]);
  if (!enabled || (!active && !prepared)) return null;
  return <div aria-hidden={!active} inert={!active} data-reading-surface data-active={active || undefined}
    style={{ position: 'fixed', inset: 0, zIndex: active ? 2 : -1, display: 'flex', flexDirection: 'column',
      visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none' }}>
    <Suspense fallback={active ? <div className="route-loader" role="status">正在打开阅读…</div> : null}>
      <ReadingTerminal key={owner} active={active} />
    </Suspense>
  </div>;
}
