/**
 * 学习行为日志 —— 记忆的原料不只来自对话。
 * 各板块在用户做了一件有学习含义的事时记一条：读讲义、做题、翻闪卡、写笔记、上 AI 课、交办任务、上传资料、做科研课题……
 * 小砚的记忆提炼与做梦都从这里取材。按账号保存在当前浏览器，只留最近一段。
 */
import { useSyncExternalStore } from 'react';

export type ActivitySource =
  | 'chat' | 'reading' | 'guided' | 'practice'
  | 'note' | 'mindmap' | 'quiz' | 'flashcards' | 'todo' | 'writing'
  | 'lesson' | 'agent' | 'library' | 'research' | 'teach' | 'exam';

export const ACTIVITY_LABELS: Record<ActivitySource, string> = {
  chat: '对话', reading: '读讲义', guided: '带我学', practice: '练一练',
  note: '笔记', mindmap: '思维导图', quiz: '题目集', flashcards: '闪卡', todo: '待办', writing: '作文与翻译',
  lesson: 'AI 课堂', agent: '助理任务', library: '资料库', research: '科研台', teach: '给小白上课', exam: '小白赴考',
};

/** 这件事透露了什么：卡住、学会、感兴趣、定了目标，或只是做了 */
export type ActivitySignal = 'struggle' | 'success' | 'interest' | 'goal' | 'neutral';

export interface Activity {
  id: string;
  at: string;
  source: ActivitySource;
  /** 一句人能读懂的话，如「闪卡《梯度下降》复习 12 张，3 张选了重来」 */
  summary: string;
  signal: ActivitySignal;
  topicId?: string;
  topicTitle?: string;
  /** 补充细节：卡住的题干、选错的知识点、目标原话等，≤ 300 字 */
  detail?: string;
  /** 指回产生它的东西，供记忆标注出处并跳回去 */
  ref?: { kind: string; id: string; title?: string };
}

export type ActivityInput = Omit<Activity, 'id' | 'at' | 'signal'> & { signal?: ActivitySignal; at?: string };

const CAP = 400;
const DEDUPE_MS = 10 * 60_000;
const key = (owner: string | null) => `xiaobai-activity-v1:${encodeURIComponent(owner ?? 'local')}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Activity[]>();

function read(owner: string | null): Activity[] {
  const storageKey = key(owner);
  const cached = cache.get(storageKey);
  if (cached) return cached;
  let items: Activity[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(raw)) {
      items = raw.filter((item): item is Activity => !!item && typeof item.id === 'string' && typeof item.at === 'string'
        && typeof item.summary === 'string' && typeof item.source === 'string' && item.source in ACTIVITY_LABELS).slice(-CAP);
    }
  } catch { /* 损坏或不可用时当作没有 */ }
  cache.set(storageKey, items);
  return items;
}

/** 记一条学习行为。不抛错；十分钟内同来源同一句话不重复记。 */
export function logActivity(owner: string | null, input: ActivityInput): void {
  try {
    const summary = input.summary.trim().slice(0, 160);
    if (!summary) return;
    const now = Date.now();
    // 写之前重读一遍：别的标签页可能刚记过，不能拿本页的旧缓存整份覆盖
    cache.delete(key(owner));
    const items = read(owner);
    if (items.some((item) => item.source === input.source && item.summary === summary && now - Date.parse(item.at) < DEDUPE_MS)) return;
    const entry: Activity = {
      id: globalThis.crypto?.randomUUID?.() ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: input.at ?? new Date(now).toISOString(),
      source: input.source,
      summary,
      signal: input.signal ?? 'neutral',
      ...(input.topicId ? { topicId: input.topicId.slice(0, 120) } : {}),
      ...(input.topicTitle ? { topicTitle: input.topicTitle.slice(0, 80) } : {}),
      ...(input.detail ? { detail: input.detail.trim().slice(0, 300) } : {}),
      ...(input.ref ? { ref: { kind: input.ref.kind.slice(0, 40), id: input.ref.id.slice(0, 120), ...(input.ref.title ? { title: input.ref.title.slice(0, 80) } : {}) } } : {}),
    };
    const next = [...items, entry].slice(-CAP);
    const storageKey = key(owner);
    cache.set(storageKey, next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 存不下就只留在内存里 */ }
    listeners.forEach((listener) => listener());
  } catch { /* 日志失败不影响正在做的事 */ }
}

/** 取最近的行为，新的在后。 */
export function recentActivities(owner: string | null, options: { since?: string; limit?: number; source?: ActivitySource; topicId?: string } = {}): Activity[] {
  const since = options.since ? Date.parse(options.since) : 0;
  const filtered = read(owner).filter((item) => (!since || Date.parse(item.at) > since)
    && (!options.source || item.source === options.source) && (!options.topicId || item.topicId === options.topicId));
  return options.limit ? filtered.slice(-options.limit) : filtered;
}

export function clearActivities(owner: string | null): void {
  const storageKey = key(owner);
  cache.set(storageKey, []);
  try { localStorage.removeItem(storageKey); } catch { /* 忽略 */ }
  listeners.forEach((listener) => listener());
}

// 别的标签页写入后，本页缓存作废并通知订阅者
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key && !event.key.startsWith('xiaobai-activity-v1:')) return;
    if (event.key) cache.delete(event.key); else cache.clear();
    listeners.forEach((listener) => listener());
  });
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** 订阅当前账号的行为日志 */
export function useActivities(owner: string | null): Activity[] {
  return useSyncExternalStore(subscribe, () => read(owner), () => read(owner));
}
