import { useCallback, useMemo } from 'react';
import { ASSET_BASE } from './bridge';
export const routePath = () => location.hash.slice(1).split('?')[0] || '/library';
export const routeSearch = () => location.hash.split('?')[1] || location.search.slice(1);
export const routeHref = (path: string) => `${ASSET_BASE}#${path}`;
export function useRouter() {
  const push = useCallback((path: string) => { location.hash = path; window.scrollTo(0, 0); }, []);
  return useMemo(() => ({ push, replace: (path: string) => { history.replaceState(null, '', routeHref(path)); dispatchEvent(new HashChangeEvent('hashchange')); }, back: () => history.back() }), [push]);
}
