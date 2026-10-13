import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';

export const TOOL_IDS = ['notes', 'mindmap', 'quiz', 'flashcards', 'todos', 'writing'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

const isTool = (value: string | null): value is ToolId => TOOL_IDS.includes(value as ToolId);

/** 工作台的地址状态：?view=workbench&tool=<工具>&id=<条目> */
export function useWorkbenchNav() {
  const [params, setParams] = useSearchParams();
  const rawTool = params.get('tool');
  const tool = isTool(rawTool) ? rawTool : null;
  const id = params.get('id');

  const go = useCallback((nextTool: ToolId | null, nextId?: string | null, replace = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', 'workbench');
      if (nextTool) next.set('tool', nextTool); else next.delete('tool');
      if (nextTool && nextId) next.set('id', nextId); else next.delete('id');
      return next;
    }, { replace });
  }, [setParams]);

  return useMemo(() => ({ tool, id, go }), [tool, id, go]);
}

/* ── 日期 ── */
const pad = (value: number) => String(value).padStart(2, '0');
export const dayKey = (date: Date | string | number = new Date()) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const addDays = (days: number, from: Date = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
};
/** 待办的 due 可能是 YYYY-MM-DD，也可能是完整时间；统一成本地日期键 */
export function dueDay(due?: string): string | null {
  if (!due) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const time = Date.parse(due);
  return Number.isNaN(time) ? null : dayKey(time);
}
const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const dayDiff = (key: string, from: string = dayKey()) => Math.round((parseDay(key).getTime() - parseDay(from).getTime()) / 86_400_000);
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const weekday = (key: string) => WEEK[parseDay(key).getDay()];
export function dayLabel(key: string): string {
  const diff = dayDiff(key);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  if (diff > 1 && diff < 7) return weekday(key);
  const d = parseDay(key);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
export function ago(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24 && dayKey(time) === dayKey()) return `${Math.floor(minutes / 60)} 小时前`;
  return dayLabel(dayKey(time));
}
/** 间隔的口语说法：给闪卡评分按钮与「下次到期」用 */
export function spanLabel(ms: number): string {
  if (ms <= 0) return '现在';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天`;
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}

/* ── 文件 ── */
export const safeName = (title: string) => title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || '未命名';
export function download(filename: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── 文本 ── */
export const matches = (query: string, ...fields: (string | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some((field) => field?.toLowerCase().includes(q));
};
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** 字数：汉字按字，拉丁文按词 */
export function countWords(text: string): number {
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0;
  const latin = text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0;
  return cjk + latin;
}

/**
 * 延迟保存：dirty 时停顿 delay 毫秒后写入；切换条目或离开页面时把未保存的内容立即写入。
 * save 里自行判断条目是否还在（已删除的不应被写回）。
 */
export function useAutosave<T>(value: T, dirty: boolean, save: (value: T) => void, delay = 500) {
  const latest = useRef({ value, dirty, save });
  useEffect(() => { latest.current = { value, dirty, save }; });
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => latest.current.save(value), delay);
    return () => clearTimeout(timer);
  }, [value, dirty, delay]);
  useEffect(() => () => {
    if (latest.current.dirty) latest.current.save(latest.current.value);
  }, []);
}

/** 不在输入框里时才响应的全局快捷键 */
export function useHotkeys(handler: (event: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (target?.closest('[role="dialog"], [role="menu"]')) return;
      ref.current(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** 手机宽度。只用在必须换结构的地方（视图选项、条目里元素的位置），样式仍交给 CSS */
export function useNarrow(query = '(max-width: 760px)') {
  // 没有 matchMedia 的环境（测试、服务端）一律按宽屏
  const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);
  return useSyncExternalStore(
    (notify) => {
      const list = media();
      list?.addEventListener('change', notify);
      return () => list?.removeEventListener('change', notify);
    },
    () => media()?.matches ?? false,
    () => false,
  );
}
