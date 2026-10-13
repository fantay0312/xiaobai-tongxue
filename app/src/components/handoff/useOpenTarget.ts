import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** 终端里的一个位置：视图 + 参数，可指定课程 */
export interface OpenTarget {
  view: string;
  params?: Record<string, string>;
  topicId?: string;
}

/** 把终端位置拼成路由地址。不指定课程时留在当前课程（或回到 /learn）。 */
export function targetPath(target: OpenTarget, currentPath = '/learn'): string {
  const base = target.topicId
    ? `/prep/${encodeURIComponent(target.topicId)}`
    : currentPath.startsWith('/prep/') ? currentPath : '/learn';
  const query = new URLSearchParams({ ...(target.view && target.view !== 'ask' ? { view: target.view } : {}), ...target.params });
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/** 跳到成果或它的来源所在的终端位置 */
export function useOpenTarget(): (target: OpenTarget) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback((target: OpenTarget) => {
    // 对话产物属于某个工作区：没带课程的回到无课程的终端，而不是留在当前课程里找不到它
    const keepCourse = target.view !== 'studio' && target.view !== 'ask';
    navigate(targetPath(target, keepCourse ? pathname : '/learn'));
  }, [navigate, pathname]);
}
