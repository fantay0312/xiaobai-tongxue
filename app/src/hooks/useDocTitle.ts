/**
 * 逐路由标签页标题 —— 浏览器标签/历史记录/录屏切窗时能认出自己在哪一章。
 * 约定:「{章名} · {课名} — 小白同学」;不传 title 时回落站名(与 index.html 一致)。
 * 只在挂载的页面组件顶部调用一次;卸载时不还原(下一页会立刻设自己的标题,
 * 还原只会在路由切换瞬间闪一下旧站名)。
 */
import { useEffect } from 'react';

const BASE = '小白同学 · 教然后知困';

export function useDocTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — 小白同学` : BASE;
  }, [title]);
}
