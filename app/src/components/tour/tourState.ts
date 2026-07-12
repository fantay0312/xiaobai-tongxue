/**
 * 「小白引路」进度落盘 —— 每处引路只自动开一次(localStorage),
 * 设置抽屉「重新引路」清痕后广播,由订阅方(当前页挂着的 Tour)立即重开。
 * 与 zustand 学习存档分离:引路是 UI 痕迹不是学习履历,
 * 成长页「演示重置」(resetAll)不清它,反过来「重新引路」也不碰学习数据。
 */
const KEY = 'xiaobai-tours-v1';

export type TourKey = 'home' | 'prep' | 'teach';

/** 拜师帖弹层的开合广播:门厅引路听它礼让(帖开着不上前,帖收了再引路) */
export const LETTER_OPEN_EVENT = 'xiaobai:letter-open';
export const LETTER_CLOSED_EVENT = 'xiaobai:letter-closed';

type DoneMap = Partial<Record<TourKey, true>>;

function read(): DoneMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as DoneMap) : {};
  } catch {
    return {};
  }
}

function write(map: DoneMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等存不进:引路退化为每次访问都开,可接受 */
  }
}

/** 内存镜像:localStorage 被禁(隐私模式/配额)时 write 静默失败,
    没有这层镜像,同一次访问里跳过的引路会在事件礼让路径上再弹回来 */
const memDone = new Set<TourKey>();

export function isTourDone(key: TourKey): boolean {
  return memDone.has(key) || read()[key] === true;
}

export function markTourDone(key: TourKey): void {
  memDone.add(key);
  write({ ...read(), [key]: true });
}

const listeners = new Set<() => void>();

export function subscribeTours(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 清空全部引路痕迹并广播 —— 当前页若挂着引路会立即重开 */
export function resetTours(): void {
  memDone.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同 write:存储不可用时本来就每次都开 */
  }
  listeners.forEach((fn) => fn());
}
