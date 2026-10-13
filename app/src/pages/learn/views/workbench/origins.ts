/**
 * 工作台条目的「来源」：一条内容是从哪儿变过来的（对话里的回答、AI 课的一幕、另一篇笔记……）。
 * 条目本身的类型不动，来源单独记在这里：键是成果登记键（note:<id>、deck:<id>…），按账号保存在当前浏览器。
 * 不依赖 React 组件，跨板块动作（lib/crossActions）和工作台界面都从这里读写。
 */
import { useSyncExternalStore } from 'react';
import type { ArtifactOrigin } from '../../../../lib/artifacts';

export type ItemKind = 'note' | 'mindmap' | 'quiz' | 'deck' | 'todo-list' | 'writing';
export const itemKey = (kind: ItemKind, id: string) => `${kind}:${id}`;

type OriginMap = Record<string, ArtifactOrigin>;
const CAP = 400;
const storageKey = (owner: string | null) => `xiaobai-workbench-origins-v1:${encodeURIComponent(owner ?? 'local')}`;
const cache = new Map<string, OriginMap>();
const listeners = new Set<() => void>();

function read(owner: string | null): OriginMap {
  const key = storageKey(owner);
  const cached = cache.get(key);
  if (cached) return cached;
  let map: OriginMap = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) map = raw as OriginMap;
  } catch { /* 损坏或不可用时当作没有 */ }
  cache.set(key, map);
  return map;
}

function write(owner: string | null, map: OriginMap) {
  const key = storageKey(owner);
  cache.set(key, map);
  try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* 存不下就只留在内存里 */ }
  listeners.forEach((listener) => listener());
}

/** 只留契约里的字段，长度收一收 */
function tidy(origin: ArtifactOrigin): ArtifactOrigin {
  const open = origin.open && typeof origin.open.view === 'string'
    ? {
      view: origin.open.view.slice(0, 40),
      ...(origin.open.params ? { params: Object.fromEntries(Object.entries(origin.open.params).slice(0, 8).map(([name, value]) => [name.slice(0, 40), String(value).slice(0, 200)])) } : {}),
      ...(origin.open.topicId ? { topicId: origin.open.topicId.slice(0, 120) } : {}),
    }
    : undefined;
  return { section: origin.section, ...(origin.label ? { label: origin.label.trim().slice(0, 80) } : {}), ...(open ? { open } : {}) };
}

export function setItemOrigin(owner: string | null, key: string, origin: ArtifactOrigin): void {
  const entries = Object.entries({ ...read(owner), [key]: tidy(origin) });
  write(owner, Object.fromEntries(entries.slice(-CAP)));
}

export function getItemOrigin(owner: string | null, key: string): ArtifactOrigin | undefined {
  return read(owner)[key];
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** 订阅某个条目的来源 */
export function useItemOrigin(owner: string | null, key: string | null): ArtifactOrigin | undefined {
  return useSyncExternalStore(subscribe, () => (key ? read(owner)[key] : undefined), () => undefined);
}

export const ORIGIN_SECTION_LABELS: Record<ArtifactOrigin['section'], string> = {
  chat: '对话', workbench: '工作台', lesson: 'AI 课堂', agent: '助理任务', research: '科研台', teach: '给小白上课',
};
