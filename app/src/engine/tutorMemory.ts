/**
 * 小砚的记忆 —— 学习终端里助教对「我」的长期记忆：偏好、目标、薄弱点、已掌握内容、习惯、背景事实。
 * 与「小白的记忆」（appStore.memory，课堂上小白记住的先生）是两套，互不混写。
 *
 * 存储：按账号保存在当前浏览器（localStorage `xiaobai-tutor-memory-v1:<owner>`），上限 120 条。
 * 写入两层：
 *   1. 即时规则 —— 从提问里认出明确表态（专业、目标、讲法偏好、反复问的概念、「懂了」）；
 *   2. 模型提炼 —— 每隔几轮用模型网关整理 0–3 条耐久记忆；没有模型时静默跳过。
 * 两层结果按文本相似度合并去重；暂停后不再自动记下，也不进入提示词。
 */
import { useSyncExternalStore } from 'react';
import { completeJson, ModelUnavailableError } from '../lib/modelGateway';

export type TutorMemoryKind = 'preference' | 'goal' | 'weakness' | 'strength' | 'habit' | 'fact';
export interface TutorMemoryItem {
  id: string; kind: TutorMemoryKind; text: string; topicId?: string; topicTitle?: string;
  source: 'auto' | 'user'; pinned?: boolean; createdAt: string; updatedAt: string;
  /** 自动记下后被我改过 */
  edited?: boolean;
  /** 同一件事被再次观察到的次数 */
  seen?: number;
  /** 这条是做梦整理时提炼出来的（engine/dreams） */
  dream?: boolean;
}
export interface TutorMemoryState { items: TutorMemoryItem[]; paused: boolean }
/** 最近提问的摘要：做梦整理时用来回放近期经历 */
export interface TutorTurnDigest { at: string; question: string; topicId?: string; topicTitle?: string }

export interface TutorTurnInput { topicId?: string; topicTitle?: string; question: string; answer: string }

export const TUTOR_MEMORY_CAP = 120;
export const TUTOR_MEMORY_TEXT_MAX = 80;

/** 展示顺序与中文名；界面分组和提示词前缀共用 */
export const TUTOR_MEMORY_KINDS: readonly { kind: TutorMemoryKind; label: string; hint: string }[] = [
  { kind: 'preference', label: '偏好', hint: '你喜欢怎样的讲法' },
  { kind: 'goal', label: '目标', hint: '你在为什么而学' },
  { kind: 'weakness', label: '薄弱点', hint: '反复卡住的地方' },
  { kind: 'strength', label: '已掌握', hint: '已经弄懂的内容' },
  { kind: 'habit', label: '习惯', hint: '你平时怎么学' },
  { kind: 'fact', label: '事实', hint: '专业、年级等背景' },
];

const KIND_LABEL = Object.fromEntries(TUTOR_MEMORY_KINDS.map((entry) => [entry.kind, entry.label])) as Record<TutorMemoryKind, string>;
const STORAGE_PREFIX = 'xiaobai-tutor-memory-v1:';
const DUPLICATE_AT = 0.72;
const CONCEPT_CAP = 60;
const FORGOTTEN_CAP = 40;
const TURN_LOG_CAP = 30;
const TURN_DIGEST_MAX = 120;
const EMPTY_STATE: TutorMemoryState = { items: [], paused: false };

/** 被问到的概念计数：同一概念反复问到即记为薄弱点 */
interface ConceptTrace { key: string; label: string; count: number; confused: number; topicId?: string; topicTitle?: string; at: string }
interface Entry {
  state: TutorMemoryState;
  concepts: ConceptTrace[];
  /** 我删掉的自动记忆（归一化文本）：之后不再自动记回来 */
  forgotten: string[];
  /** 最近提问的摘要，新的在前 */
  turns: TutorTurnDigest[];
}
interface Draft {
  kind: TutorMemoryKind; text: string; topicId?: string; topicTitle?: string; source: 'auto' | 'user';
  /** 这条「已掌握」对应的概念：写入时撤掉同一概念的自动薄弱点 */
  resolves?: string;
}
interface Turn { topicId?: string; topicTitle?: string; question: string; answer: string }

// ───────────────────────── 存取与订阅 ─────────────────────────

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

const ownerKey = (owner: string | null) => (typeof owner === 'string' && owner.trim() ? owner.trim() : 'local');
const nowIso = () => new Date().toISOString();
const newId = () => globalThis.crypto?.randomUUID?.() ?? `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const isKind = (value: unknown): value is TutorMemoryKind => TUTOR_MEMORY_KINDS.some((entry) => entry.kind === value);
const isIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max = TUTOR_MEMORY_TEXT_MAX): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').replace(/^[\s，。、；：:,.;!！?？~～\-—]+|[\s，。、；：:,.;!！~～\-—]+$/g, '').slice(0, max).trim();
}

function sanitizeItem(value: unknown): TutorMemoryItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = cleanText(raw.text);
  if (!text || !isKind(raw.kind) || isSensitiveMemoryText(text)) return null;
  const createdAt = isIso(raw.createdAt) ? raw.createdAt : nowIso();
  const item: TutorMemoryItem = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    kind: raw.kind,
    text,
    source: raw.source === 'user' ? 'user' : 'auto',
    createdAt,
    updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
  if (typeof raw.topicId === 'string' && raw.topicId) item.topicId = raw.topicId;
  if (typeof raw.topicTitle === 'string' && raw.topicTitle.trim()) item.topicTitle = raw.topicTitle.trim().slice(0, 60);
  if (raw.pinned === true) item.pinned = true;
  if (raw.edited === true) item.edited = true;
  if (typeof raw.seen === 'number' && Number.isFinite(raw.seen) && raw.seen > 1) item.seen = Math.min(99, Math.floor(raw.seen));
  if (raw.dream === true) item.dream = true;
  return item;
}

function sanitizeEntry(value: unknown): Entry {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const items: TutorMemoryItem[] = [];
  for (const candidate of Array.isArray(raw.items) ? raw.items : []) {
    const item = sanitizeItem(candidate);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push(item);
  }
  const concepts: ConceptTrace[] = [];
  for (const candidate of Array.isArray(raw.concepts) ? raw.concepts : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const trace = candidate as Record<string, unknown>;
    if (typeof trace.key !== 'string' || typeof trace.label !== 'string' || !trace.key) continue;
    concepts.push({
      key: trace.key.slice(0, 40),
      label: trace.label.slice(0, 30),
      count: typeof trace.count === 'number' && trace.count > 0 ? Math.floor(trace.count) : 1,
      confused: typeof trace.confused === 'number' && trace.confused > 0 ? Math.floor(trace.confused) : 0,
      at: isIso(trace.at) ? trace.at : nowIso(),
      ...(typeof trace.topicId === 'string' && trace.topicId ? { topicId: trace.topicId } : {}),
      ...(typeof trace.topicTitle === 'string' && trace.topicTitle ? { topicTitle: trace.topicTitle.slice(0, 60) } : {}),
    });
  }
  const forgotten = (Array.isArray(raw.forgotten) ? raw.forgotten : [])
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .slice(0, FORGOTTEN_CAP);
  const turns: TutorTurnDigest[] = [];
  for (const candidate of Array.isArray(raw.turns) ? raw.turns : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const turn = candidate as Record<string, unknown>;
    const question = cleanText(turn.question, TURN_DIGEST_MAX);
    if (!question || !isIso(turn.at) || isSensitiveMemoryText(question)) continue;
    turns.push({
      at: turn.at,
      question,
      ...(typeof turn.topicId === 'string' && turn.topicId ? { topicId: turn.topicId } : {}),
      ...(typeof turn.topicTitle === 'string' && turn.topicTitle ? { topicTitle: turn.topicTitle.slice(0, 60) } : {}),
    });
  }
  return {
    state: { items: capItems(items), paused: raw.paused === true },
    concepts: concepts.slice(0, CONCEPT_CAP),
    forgotten,
    turns: turns.slice(0, TURN_LOG_CAP),
  };
}

function readEntry(owner: string | null): Entry {
  const key = ownerKey(owner);
  const cached = cache.get(key);
  if (cached) return cached;
  let entry: Entry = { state: EMPTY_STATE, concepts: [], forgotten: [], turns: [] };
  try {
    const raw = browserStorage()?.getItem(STORAGE_PREFIX + key);
    if (raw) entry = sanitizeEntry(JSON.parse(raw));
  } catch {
    // 存档损坏时按空记忆处理，不影响对话
  }
  cache.set(key, entry);
  return entry;
}

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 单个订阅者出错不影响其余订阅者
    }
  }
}

function writeEntry(owner: string | null, entry: Entry) {
  const key = ownerKey(owner);
  cache.set(key, entry);
  try {
    browserStorage()?.setItem(STORAGE_PREFIX + key, JSON.stringify({
      v: 1, items: entry.state.items, paused: entry.state.paused, concepts: entry.concepts, forgotten: entry.forgotten, turns: entry.turns,
    }));
  } catch {
    // 存储已满或被禁用：本次会话内仍然可用
  }
  emit();
}

function updateState(owner: string | null, update: (entry: Entry) => Entry | null) {
  const next = update(readEntry(owner));
  if (next) writeEntry(owner, next);
}

// 其他标签页改了同一账号的记忆时，丢掉缓存重新读取
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) return;
    cache.delete(event.key.slice(STORAGE_PREFIX.length));
    emit();
  });
}

export function subscribeTutorMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 读取当前账号的记忆。返回值是只读快照，改动请走 tutorMemory.* */
export function loadTutorMemory(owner: string | null): TutorMemoryState {
  try {
    return readEntry(owner).state;
  } catch {
    return EMPTY_STATE;
  }
}

/** 订阅当前账号的记忆，对话里新记下的内容会立即出现 */
export function useTutorMemory(owner: string | null): TutorMemoryState {
  return useSyncExternalStore(subscribeTutorMemory, () => loadTutorMemory(owner), () => EMPTY_STATE);
}

const NO_TURNS: TutorTurnDigest[] = [];
/** 最近提问的摘要（新的在前，最多 30 条）。只读，供做梦整理回放。 */
export function loadTutorTurnLog(owner: string | null): TutorTurnDigest[] {
  try {
    return readEntry(owner).turns;
  } catch {
    return NO_TURNS;
  }
}

// ───────────────────────── 隐私过滤、相似度、合并 ─────────────────────────

const SENSITIVE_WORDS = /(密码|口令|密钥|验证码|pass(?:word|wd)?|api[\s_-]?key|secret)\s*(?:是|为|[:：=])|身份证号?|银行卡|支付密码|手机号|电话号码|微信号|qq\s*号|邮箱|家庭住址|住址|门牌号|(?:access|api|auth|bearer|refresh)[\s_-]?token/i;
const SENSITIVE_SHAPES = /1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w.-]+|\d{7,}|https?:\/\/|\bsk-[a-z0-9_-]{8,}/i;

/** 密码、密钥、联系方式一类内容不进记忆 */
export function isSensitiveMemoryText(text: string): boolean {
  return SENSITIVE_WORDS.test(text) || SENSITIVE_SHAPES.test(text);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').replace(/^(?:我们?|你|用户|学习者|该?同学)+/, '');
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  if (text.length < 2) {
    grams.set(text, 1);
    return grams;
  }
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** 归一化后的二元组 Dice 系数；一方完整包含另一方也视为同一件事 */
function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.includes(short)) return 0.9;
  const left = bigrams(x);
  const right = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const [gram, count] of left) {
    overlap += Math.min(count, right.get(gram) ?? 0);
    total += count;
  }
  for (const count of right.values()) total += count;
  return total ? (2 * overlap) / total : 0;
}

function capItems(items: TutorMemoryItem[]): TutorMemoryItem[] {
  if (items.length <= TUTOR_MEMORY_CAP) return items;
  // 超额时先丢最旧的自动条目；置顶和我添加的尽量留下
  const rank = (item: TutorMemoryItem) => (item.pinned ? 2 : item.source === 'user' || item.edited ? 1 : 0);
  const kept = new Set(
    [...items]
      .sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, TUTOR_MEMORY_CAP)
      .map((item) => item.id),
  );
  return items.filter((item) => kept.has(item.id));
}

function findDuplicate(items: TutorMemoryItem[], draft: Draft): TutorMemoryItem | undefined {
  let best: TutorMemoryItem | undefined;
  let bestScore = 0;
  for (const item of items) {
    const score = similarity(item.text, draft.text);
    const threshold = item.kind === draft.kind ? DUPLICATE_AT : 0.9;
    if (score >= threshold && score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function mergeDrafts(items: TutorMemoryItem[], drafts: Draft[], at: string): { items: TutorMemoryItem[]; added: TutorMemoryItem[]; changed: boolean } {
  let next = items;
  const added: TutorMemoryItem[] = [];
  let changed = false;
  for (const input of drafts) {
    const text = cleanText(input.text);
    if (text.length < 2 || isSensitiveMemoryText(text)) continue;
    const draft = { ...input, text };
    const existing = findDuplicate(next, draft);
    if (existing) {
      const refreshed: TutorMemoryItem = { ...existing, updatedAt: at, seen: Math.min(99, (existing.seen ?? 1) + 1) };
      if (draft.source === 'user') {
        refreshed.source = 'user';
        refreshed.text = text;
        refreshed.kind = draft.kind;
      } else if (existing.source === 'auto' && !existing.edited && text.length > existing.text.length && normalize(text).includes(normalize(existing.text))) {
        // 新说法更具体时，用新说法替换旧的自动记录
        refreshed.text = text;
      }
      if (!refreshed.topicId && draft.topicId) {
        refreshed.topicId = draft.topicId;
        if (draft.topicTitle) refreshed.topicTitle = draft.topicTitle;
      }
      next = next.map((item) => (item.id === existing.id ? refreshed : item));
      changed = true;
      continue;
    }
    const item: TutorMemoryItem = { id: newId(), kind: draft.kind, text, source: draft.source, createdAt: at, updatedAt: at };
    if (draft.topicId) {
      item.topicId = draft.topicId;
      if (draft.topicTitle) item.topicTitle = draft.topicTitle.slice(0, 60);
    }
    next = [item, ...next];
    added.push(item);
    changed = true;
  }
  return { items: changed ? capItems(next) : items, added, changed };
}

// ───────────────────────── 手动管理（记忆视图用） ─────────────────────────

const KIND_GUESS: readonly [TutorMemoryKind, RegExp][] = [
  ['weakness', /搞不清|分不清|弄不懂|搞不懂|不理解|不太懂|不明白|记不住|薄弱|弱项|短板|容易混|搞混|总忘|老忘|不熟|不擅长|学不会|基础差|卡住|反复问/],
  ['preference', /喜欢|偏好|希望|请用|不要|别用|讲得|说得|例子|类比|比喻|方式|风格|语气|先讲|先给|结论|通俗|简洁|详细|大白话/],
  ['goal', /目标|考研|保研|考公|考试|期末|期中|四级|六级|雅思|托福|面试|实习|秋招|春招|绩点|上岸|备考|冲刺|答辩|论文|毕设|想|打算|计划|准备/],
  ['habit', /习惯|一般|通常|平时|每天|每晚|每周|早上|晚上|周末|睡前|课后|课前/],
  ['strength', /掌握|擅长|熟悉|懂了|学会|会了|弄懂|搞懂|拿手/],
];

/** 按措辞猜一条记忆属于哪一类；猜不出归为「事实」 */
export function guessTutorMemoryKind(text: string): TutorMemoryKind {
  if (DEADLINE.test(text)) return 'goal';
  for (const [kind, pattern] of KIND_GUESS) if (pattern.test(text)) return kind;
  return 'fact';
}

export const tutorMemory = {
  /** 我亲手添加的一条；暂停时也能添加。含隐私内容或为空时返回 null */
  add(owner: string | null, input: { text: string; kind?: TutorMemoryKind; topicId?: string; topicTitle?: string }): TutorMemoryItem | null {
    const text = cleanText(input.text);
    if (text.length < 2 || isSensitiveMemoryText(text)) return null;
    const kind = input.kind ?? guessTutorMemoryKind(text);
    let saved: TutorMemoryItem | null = null;
    updateState(owner, (entry) => {
      const draft: Draft = { kind, text, source: 'user', ...(input.topicId ? { topicId: input.topicId, topicTitle: input.topicTitle } : {}) };
      const duplicate = findDuplicate(entry.state.items, draft);
      const merged = mergeDrafts(entry.state.items, [draft], nowIso());
      saved = merged.added[0] ?? merged.items.find((item) => item.id === duplicate?.id) ?? null;
      const key = normalize(text);
      return { ...entry, state: { ...entry.state, items: merged.items }, forgotten: entry.forgotten.filter((old) => old !== key) };
    });
    return saved;
  },

  /** 改文字或分类。改过的自动记忆会标记为「已修改」，之后不会被自动覆盖 */
  edit(owner: string | null, id: string, patch: { text?: string; kind?: TutorMemoryKind }): boolean {
    const text = patch.text === undefined ? undefined : cleanText(patch.text);
    if (text !== undefined && (text.length < 2 || isSensitiveMemoryText(text))) return false;
    let done = false;
    updateState(owner, (entry) => {
      const target = entry.state.items.find((item) => item.id === id);
      if (!target) return null;
      const nextText = text ?? target.text;
      const nextKind = patch.kind ?? target.kind;
      if (nextText === target.text && nextKind === target.kind) {
        done = true;
        return null;
      }
      done = true;
      const edited: TutorMemoryItem = { ...target, text: nextText, kind: nextKind, updatedAt: nowIso(), ...(target.source === 'auto' ? { edited: true } : {}) };
      return { ...entry, state: { ...entry.state, items: entry.state.items.map((item) => (item.id === id ? edited : item)) } };
    });
    return done;
  },

  pin(owner: string | null, id: string, pinned: boolean) {
    updateState(owner, (entry) => {
      if (!entry.state.items.some((item) => item.id === id)) return null;
      const items = entry.state.items.map((item) => {
        if (item.id !== id) return item;
        const { pinned: _old, ...rest } = item;
        return pinned ? { ...rest, pinned: true } : rest;
      });
      return { ...entry, state: { ...entry.state, items } };
    });
  },

  /** 删除一条并返回它（供撤销）。删掉的自动记忆之后不会再被自动记回来 */
  remove(owner: string | null, id: string): TutorMemoryItem | null {
    let removed: TutorMemoryItem | null = null;
    updateState(owner, (entry) => {
      const index = entry.state.items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const target = entry.state.items[index];
      removed = target;
      const key = normalize(target.text);
      const forgotten = target.source === 'auto'
        ? [key, ...entry.forgotten.filter((old) => old !== key)].slice(0, FORGOTTEN_CAP)
        : entry.forgotten;
      return { ...entry, state: { ...entry.state, items: entry.state.items.filter((item) => item.id !== id) }, forgotten };
    });
    return removed;
  },

  /** 撤销删除或清空：把条目原样放回 */
  restore(owner: string | null, items: TutorMemoryItem | TutorMemoryItem[]) {
    const incoming = (Array.isArray(items) ? items : [items]).map(sanitizeItem).filter((item): item is TutorMemoryItem => item !== null);
    if (!incoming.length) return;
    updateState(owner, (entry) => {
      const present = new Set(entry.state.items.map((item) => item.id));
      const back = incoming.filter((item) => !present.has(item.id));
      if (!back.length) return null;
      const keys = new Set(back.map((item) => normalize(item.text)));
      const merged = [...entry.state.items, ...back].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ...entry, state: { ...entry.state, items: capItems(merged) }, forgotten: entry.forgotten.filter((old) => !keys.has(old)) };
    });
  },

  /** 暂停后不再自动记下，也不把记忆交给小砚；已有内容原样保留 */
  setPaused(owner: string | null, paused: boolean) {
    updateState(owner, (entry) => (entry.state.paused === paused ? null : { ...entry, state: { ...entry.state, paused } }));
    if (paused) pendingByOwner.delete(ownerKey(owner));
  },

  /** 清空全部记忆并返回被清掉的条目（供撤销）；暂停状态不变 */
  clear(owner: string | null): TutorMemoryItem[] {
    const removed = readEntry(owner).state.items;
    pendingByOwner.delete(ownerKey(owner));
    recentByOwner.delete(ownerKey(owner));
    updateState(owner, (entry) => ({ state: { items: [], paused: entry.state.paused }, concepts: [], forgotten: [], turns: [] }));
    return removed;
  },
};

/** 由记忆派生的学习者画像摘要（记忆视图顶部用） */
export interface TutorProfileSummary {
  total: number; pinned: number; goals: string[]; weaknesses: string[]; preferences: string[]; strengths: number; updatedAt: string | null;
}

export function summarizeTutorMemory(state: TutorMemoryState): TutorProfileSummary {
  const ordered = [...state.items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
  const pick = (kind: TutorMemoryKind, limit: number) => ordered.filter((item) => item.kind === kind).slice(0, limit).map((item) => item.text);
  return {
    total: state.items.length,
    pinned: state.items.filter((item) => item.pinned).length,
    goals: pick('goal', 2),
    weaknesses: pick('weakness', 3),
    preferences: pick('preference', 2),
    strengths: state.items.filter((item) => item.kind === 'strength').length,
    updatedAt: state.items.reduce<string | null>((latest, item) => (!latest || item.updatedAt > latest ? item.updatedAt : latest), null),
  };
}

// ───────────────────────── 做梦整理（engine/dreams 调用） ─────────────────────────

/** 两句话说的是不是同一件事：0..1，做梦整理时找重复用 */
export function tutorTextSimilarity(a: string, b: string): number {
  return similarity(a, b);
}

/** text 里有多少内容能在 sources 里找到出处（按二元组算，0..1） */
function supportedBy(text: string, sources: string[]): number {
  const grams = bigrams(normalize(text));
  const pool = new Set<string>();
  for (const source of sources) for (const gram of bigrams(normalize(source)).keys()) pool.add(gram);
  let hit = 0;
  let total = 0;
  for (const [gram, count] of grams) {
    total += count;
    if (pool.has(gram)) hit += count;
  }
  return total ? hit / total : 0;
}

export interface TutorDreamOps {
  /** 说同一件事的几条并成一条；text 省略时保留其中最完整的一句 */
  merges?: { ids: string[]; text?: string }[];
  /** 从反复出现的事里提炼出的新认识；support 是它依据的原话（至少两句） */
  promotions?: { kind: TutorMemoryKind; text: string; support: string[]; topicId?: string; topicTitle?: string }[];
  fades?: string[];
  keeps?: string[];
  /** 多少天没再提起才允许淡忘，最少 7 天 */
  fadeAfterDays?: number;
}
export interface TutorDreamResult {
  merged: { text: string; from: string[] }[];
  promoted: TutorMemoryItem[];
  faded: TutorMemoryItem[];
  kept: TutorMemoryItem[];
}

const isProtected = (item: TutorMemoryItem) => Boolean(item.pinned) || item.source === 'user' || Boolean(item.edited);
const uniqueIds = (ids: unknown): string[] => [...new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])];

/**
 * 把一场梦的整理结果落到记忆上，返回真正发生的改动（梦境记录只写这些）。
 * 守的线：置顶的、我写的、我改过的条目不改不删，只在一字不差的重复之间合并；
 * 提炼必须有至少两句出处；淡忘只动很久没提起的自动记录；隐私内容不写入。暂停时什么都不做。
 */
export function applyTutorDream(owner: string | null, ops: TutorDreamOps): TutorDreamResult {
  const result: TutorDreamResult = { merged: [], promoted: [], faded: [], kept: [] };
  try {
    updateState(owner, (entry) => {
      if (entry.state.paused) return null;
      const at = nowIso();
      const now = Date.now();
      let items = entry.state.items;
      const gone = new Set<string>();
      const find = (id: string) => (gone.has(id) ? undefined : items.find((item) => item.id === id));

      for (const group of (ops.merges ?? []).slice(0, 8)) {
        let members = uniqueIds(group.ids).map(find).filter((item): item is TutorMemoryItem => !!item);
        if (members.length < 2) continue;
        const first = normalize(members[0].text);
        const exact = members.every((item) => normalize(item.text) === first);
        if (!exact) members = members.filter((item) => !isProtected(item));
        if (members.length < 2) continue;
        const rank = (item: TutorMemoryItem) => (item.pinned ? 2 : isProtected(item) ? 1 : 0);
        const survivor = [...members].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt))[0];
        let text = survivor.text;
        if (!isProtected(survivor)) {
          const texts = members.map((item) => item.text);
          const proposed = cleanText(group.text, 60);
          const longest = texts.reduce((best, candidate) => (candidate.length > best.length ? candidate : best));
          text = proposed.length >= 2 && !isSensitiveMemoryText(proposed) && supportedBy(proposed, texts) >= 0.6 ? proposed : longest;
        }
        const scoped = members.find((item) => item.topicId);
        const merged: TutorMemoryItem = {
          ...survivor,
          text,
          updatedAt: at,
          createdAt: members.reduce((earliest, item) => (item.createdAt < earliest ? item.createdAt : earliest), survivor.createdAt),
          seen: Math.min(99, members.reduce((sum, item) => sum + (item.seen ?? 1), 0)),
          ...(members.some((item) => item.pinned) ? { pinned: true } : {}),
          ...(!survivor.topicId && scoped?.topicId ? { topicId: scoped.topicId, ...(scoped.topicTitle ? { topicTitle: scoped.topicTitle } : {}) } : {}),
        };
        const dropped = new Set(members.filter((item) => item.id !== survivor.id).map((item) => item.id));
        items = items.filter((item) => !dropped.has(item.id)).map((item) => (item.id === survivor.id ? merged : item));
        for (const id of dropped) gone.add(id);
        result.merged.push({ text, from: members.map((item) => item.text) });
      }

      let accepted = 0;
      for (const promo of (ops.promotions ?? []).slice(0, 6)) {
        if (accepted >= 2) break;
        const text = cleanText(promo.text, 60);
        const support = Array.isArray(promo.support) ? promo.support.filter((line) => typeof line === 'string' && line.trim()) : [];
        if (!isKind(promo.kind) || text.length < 4 || isSensitiveMemoryText(text)) continue;
        if (support.length < 2 || supportedBy(text, support) < 0.15) continue;
        const draft: Draft = { kind: promo.kind, text, source: 'auto', ...(promo.topicId ? { topicId: promo.topicId, topicTitle: promo.topicTitle } : {}) };
        // 新认识和它的出处天然相像，查重时不拿出处来比
        const sources = new Set(support.map(normalize));
        const duplicate = findDuplicate(items.filter((item) => !sources.has(normalize(item.text))), draft);
        if (duplicate) {
          if (isProtected(duplicate)) continue;
          accepted += 1;
          // 已有同样的认识：梦里提炼过的换成新说法，其余只算再印证一次
          const refreshed: TutorMemoryItem = {
            ...duplicate, updatedAt: at, seen: Math.min(99, (duplicate.seen ?? 1) + 1), ...(duplicate.dream ? { text } : {}),
          };
          items = items.map((item) => (item.id === duplicate.id ? refreshed : item));
          if (duplicate.dream && duplicate.text !== text) result.promoted.push(refreshed);
          else result.kept.push(refreshed);
          continue;
        }
        const item: TutorMemoryItem = { id: newId(), kind: promo.kind, text, source: 'auto', dream: true, createdAt: at, updatedAt: at };
        if (promo.topicId) {
          item.topicId = promo.topicId;
          if (promo.topicTitle) item.topicTitle = promo.topicTitle.slice(0, 60);
        }
        items = [item, ...items];
        result.promoted.push(item);
        accepted += 1;
      }

      const fadeAfterMs = Math.max(7, ops.fadeAfterDays ?? 30) * 86_400_000;
      for (const id of uniqueIds(ops.fades).slice(0, 8)) {
        const item = find(id);
        if (!item || isProtected(item) || result.promoted.some((fresh) => fresh.id === id)) continue;
        if (now - Date.parse(item.updatedAt) < fadeAfterMs) continue;
        items = items.filter((candidate) => candidate.id !== id);
        gone.add(id);
        result.faded.push(item);
      }

      for (const id of uniqueIds(ops.keeps).slice(0, 8)) {
        const item = find(id);
        if (!item || result.kept.some((kept) => kept.id === id) || result.promoted.some((fresh) => fresh.id === id)) continue;
        if (isProtected(item)) {
          result.kept.push(item);
          continue;
        }
        const stronger: TutorMemoryItem = { ...item, updatedAt: at, seen: Math.min(99, (item.seen ?? 1) + 1) };
        items = items.map((candidate) => (candidate.id === id ? stronger : candidate));
        result.kept.push(stronger);
      }

      if (items === entry.state.items) return null;
      return { ...entry, state: { ...entry.state, items: capItems(items) } };
    });
  } catch {
    // 整理失败时保持记忆原样
  }
  return result;
}

// ───────────────────────── 提示词要点 ─────────────────────────

function hintLine(item: TutorMemoryItem): string {
  const scoped = item.topicTitle && (item.kind === 'weakness' || item.kind === 'strength') ? `（${clip(item.topicTitle, 18)}）` : '';
  return clip(`${KIND_LABEL[item.kind]}${scoped}：${item.text}`, 120);
}

const HINT_KIND_ORDER: readonly TutorMemoryKind[] = ['preference', 'goal', 'weakness', 'fact', 'habit', 'strength'];

/** 各类轮流取最近的一条：早先说过的讲法偏好不会被后来的零碎记忆挤出提示词 */
function spreadByKind(items: TutorMemoryItem[]): TutorMemoryItem[] {
  const queues = HINT_KIND_ORDER.map((kind) => items.filter((item) => item.kind === kind));
  const spread: TutorMemoryItem[] = [];
  for (let round = 0; spread.length < items.length; round += 1) {
    for (const queue of queues) if (queue[round]) spread.push(queue[round]);
  }
  return spread;
}

/** 注入提示词的记忆要点（每条一句话），按相关度取前 limit 条；暂停时返回空数组。 */
export function tutorMemoryHints(owner: string | null, topicId?: string, limit = 6): string[] {
  try {
    const { items, paused } = readEntry(owner).state;
    if (paused || limit <= 0 || !items.length) return [];
    // 置顶 → 这门课的 → 不分课程的 → 其他课程的；同档按最近更新
    const recent = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const pinned = recent.filter((item) => item.pinned);
    const rest = recent.filter((item) => !item.pinned);
    const ordered = [
      ...pinned,
      ...rest.filter((item) => topicId && item.topicId === topicId),
      ...spreadByKind(rest.filter((item) => !item.topicId)),
      ...rest.filter((item) => item.topicId && item.topicId !== topicId),
    ];
    return ordered.slice(0, Math.floor(limit)).map(hintLine);
  } catch {
    return [];
  }
}

// ───────────────────────── 第一层：即时规则 ─────────────────────────

// 考试、升学、求职是明确的目标；「学会、掌握」只在整句都在说目标时才算
const GOAL_EVENT = /考研|保研|考公|考编|期末|期中|四级|六级|雅思|托福|GRE|面试|实习|找工作|秋招|春招|绩点|GPA|奖学金|毕业设计|毕设|论文|答辩|上岸|转专业|复试|初试|408|考试|补考|不挂科|过线|\d{2,3}\s*分|备考|冲刺/i;
const GOAL_SKILL = /学会|学完|学好|掌握|入门|精通|刷完|读完/;
const GOAL_LEAD = /^(?:我们?)?(?:的?目标(?:是|为)?|想要?|要|打算|准备|计划|希望能?|正在准备|在准备|正在备考|在备考|备考)/;
const ASK_LEAD = /^(?:我们?)?(?:想|要|能|可以|希望)?(?:问|请问|知道|了解|请教|确认|看看|看一下|听|请你|让你|你|麻烦|搞清楚|弄清楚|搞明白|弄明白|搞懂|弄懂)/;
const DEADLINE = /(?:下周[一二三四五六日天]?|下个?月|明天|后天|这周[一二三四五六日天]?|本周[一二三四五六日天]?|周[一二三四五六日天]|月底|\d{1,2}月(?:\d{1,2}[日号])?|还有\s*\d+\s*(?:天|周|个月))[^，。？！]{0,14}(?:考试|期末|期中|面试|答辩|要考|就考|考|截止)/;
const WEAK_STRONG = /搞不清楚?|分不清楚?|弄不清楚?|弄不懂|搞不懂|搞不明白|记不住|记不牢|老是?忘|总是?忘|容易忘|容易混|搞混|弄混|学不会|听不懂|不熟悉|不擅长|不太熟|没掌握|没学好|没学懂/;
const WEAK_NAMED = /(?:弱项|短板|薄弱点|弱点)(?:是|在)|是我的(?:弱项|短板|弱点)|基础(?:很|比较|太|有点)?(?:差|弱|薄弱|不好)|(?:学|掌握)得(?:很|比较|太)?(?:差|不好|不扎实)/;
const WEAK_SOFT = /不理解|不太懂|不懂|不明白|看不懂|没懂|没看懂|没听懂|还是不会|不太会|想不通|绕不过来/;
const STYLE_WORDS = /(?:方式|方法|风格|语气|口吻|例子|比喻|类比|图解?|表格|代码|步骤|大白话|白话|语言|中文|英文|故事|口语|公式|推导)$/;
const ASK_WORDS = /怎么|如何|什么|为什么|吗|哪/;
const PREF_WITH = /用(.{1,20}?)(?:来|去)?(讲解|讲|解释|说明|回答|教我)/;
const PREF_TONE = /(?:讲|说|回答|解释|写)得?再?(?:慢|简单|简洁|简短|详细|通俗|具体|直接|细|短|口语)一?(?:点|些)/;
const PREF_AVOID = /(?:不要|别|不用|少)(?:用|讲|说|给|写|列|堆)[^，。？！]{0,8}?(?:术语|公式|英文|中文|代码|比喻|类比|废话|长篇|套话|表情|表格|列表|总结|客套|专业名词)/;
const PREF_MORE = /[多少](?:举|给|用|讲|来)(?:一?[点些]|几个)?(?:例子|比喻|类比|图|代码|题|练习|公式|推导)/;
const PREF_FIRST = /先(?:讲|说|给|看)(?:结论|答案|例子|思路|原理|定义|直觉)/;
const PREF_LIKE = /^(?:我们?)?(?:更|比较|最)?(喜欢|习惯|偏好|倾向于?)(.{2,28})/;
const LIKE_WORDS = /讲|例子|图|代码|步骤|结论|类比|推导|视频|文字|看|听|读|练|做题|刷题|笔记|总结/;
const HABIT = /^(?:我们?)?(?:一般|通常|平时|每天|每晚|每周|早上|晚上|周末|睡前|课后|课前)(.{2,30})/;
const HABIT_WORDS = /学|复习|预习|看书|看视频|刷题|做题|背|笔记|听课|练|上课|自习|整理|总结|错题/;
const GRADE = '大[一二三四五]|研[一二三]|博[一二三四]|高[一二三]';
const FACT_MAJOR = new RegExp(`^我(?:读的是|学的是|是|读|学|念|在读|就读于?)(.{2,14}?(?:专业|学院|系)(?:的?(?:${GRADE}|本科生?|研究生|学生|新生)(?:学生)?|的)?)$`);
const FACT_GRADE = new RegExp(`^我(?:今年|现在|目前)?(?:是|读|上)?((?:${GRADE})(?:的?学生|在读)?)了?$`);
const FACT_BACKGROUND = /^我(?:是|算是)?(零基础|初学者|新手|转专业|跨考|二战|在职|非科班|文科生|理科生|工科生)/;
const FACT_LEARNED = /^我((?:以前|之前|已经)?(?:学过|没学过|没有学过|没接触过).{2,20})/;
const STRENGTH_CLAIM = /^我((?:已经|早就|基本)?(?:掌握了?|熟悉|擅长|很熟|比较熟).{2,24})/;
const GOT_IT = /^(?:哦+|噢|啊|嗯+|好的?)?[，,\s]*(?:原来如此|原来是这样|懂了|我懂了|明白了|我明白了|理解了|搞懂了|弄懂了|学会了|清楚了|豁然开朗|终于懂了|这下懂了)/;
// 只认句首的「记住……」，避免把「怎么记住这些公式」当成要求
const REMEMBER = /(?:^|[，。！？!?\n,;；])\s*(?:小砚|老师)?[，,\s]*(?:(?:请|帮我|麻烦你?|你要|你得|你)?(?:记住|记一下|记下来?|别忘了)(?!了)|(?:请|你要|你得)记得)[：:，,\s]*([^，,。；;！？!?\n]{3,60})/;
const FILLER = /^(?:那|嗯|哦|对了|另外|还有|然后|其实|不过|但是?|可是|因为|所以|老师|小砚|请问|顺便说一下|顺便)+[，,\s]*/;
const ASK_TAIL = /(?:应该|该|要|需要|得)?(?:怎么|如何|怎样|看什么|学什么|做什么|有什么|什么|哪些|哪个|哪里|多少|是不是|是否|能不能|可不可以|吗|呢|[?？]).*$/;
const REMEMBER_WORD = /记住|记一下|记下|别忘了|记得/;

const CONCEPT_PATTERNS: readonly RegExp[] = [
  /[「“"《`]([^」”"》`]{2,24})[」”"》`]/,
  /(?:什么是|什么叫|何为|解释一下|解释下|讲讲|讲一下|说说|介绍一下|再讲一遍|再讲讲|再说说)\s*([^，。？！?!,\s]{2,24})/,
  /(?:搞不清楚?|分不清楚?|弄不懂|搞不懂|不理解|不太懂|不明白|记不住|看不懂|没懂)\s*([^，。？！?!,]{2,24})/,
  /([^，。？！?!,\s]{2,24}?)(?:是什么|是啥|什么意思|指的是什么|怎么理解|如何理解|怎么算|怎么求|怎么做|怎么用|的区别|有什么区别|有啥区别|有什么不同)/,
  /(?:为什么|为啥)\s*([^，。？！?!,]{2,24})/,
];

const recentByOwner = new Map<string, { questions: string[]; lastConcept: { label: string; topicId?: string; topicTitle?: string } | null }>();

function clauses(question: string): string[] {
  return question
    .split(/[，。；！？!?;\n]+|,\s*/)
    .map((part) => part.trim().replace(FILLER, ''))
    .filter((part) => part.length >= 3 && part.length <= 60);
}

const dropSubject = (text: string) => text.replace(/^(?:为什么|为啥|怎么办?)?(?:我们?|本人)(?:是|就是)?/, '');
const cutAsk = (text: string) => text.replace(ASK_TAIL, '').replace(/(?:的时候|的话)$/, '');

function extractConcept(question: string): string | null {
  for (const pattern of CONCEPT_PATTERNS) {
    const match = pattern.exec(question);
    const label = match?.[1]
      ?.replace(/^(?:一下|下|这个|那个|那|关于|我|你|请问|老师|到底|究竟|的)+/, '')
      .replace(/^(?:要用?|需要|会|不能|可以|说)(?=.{2,})/, '')
      .replace(/(?:的区别|的不同|是什么|是啥|怎么.*|的|了|呢|吗|啊|呀|到底|究竟)+$/, '')
      .trim();
    if (label && label.length >= 2 && label.length <= 24) return label;
  }
  return null;
}

function topicScope(turn: Turn): Pick<Draft, 'topicId' | 'topicTitle'> {
  return turn.topicId ? { topicId: turn.topicId, ...(turn.topicTitle ? { topicTitle: turn.topicTitle } : {}) } : {};
}

/** 从一句提问里认出明确表态。只看学习者自己说的话，不看回答。 */
function observeQuestion(owner: string | null, entry: Entry, turn: Turn): { drafts: Draft[]; concepts: ConceptTrace[] } {
  const drafts: Draft[] = [];
  const push = (kind: TutorMemoryKind, text: string, scoped = false) => {
    const cleaned = cleanText(kind === 'fact' ? text.replace(/的$/, '') : text, 60);
    if (cleaned.length >= 2) drafts.push({ kind, text: cleaned, source: 'auto', ...(scoped ? topicScope(turn) : {}) });
  };
  const question = turn.question;
  const key = ownerKey(owner);
  const recent = recentByOwner.get(key) ?? { questions: [], lastConcept: null };
  recentByOwner.set(key, recent);

  // 「记住……」：学习者明确要求记下
  const remember = REMEMBER.exec(question);
  const remembered = remember ? cleanText(dropSubject(cleanText(remember[1], 60)), 60) : '';
  if (remembered) push(guessTutorMemoryKind(remembered), remembered);

  let confused = false;
  for (const clause of clauses(question)) {
    // 「记住……」那一句已经整句记下，不再拆开重复识别
    if (remembered && REMEMBER_WORD.test(clause)) continue;
    if (WEAK_STRONG.test(clause) || WEAK_NAMED.test(clause)) {
      confused = true;
      const text = cutAsk(dropSubject(clause));
      if (text.length >= 4) push('weakness', text, true);
      continue;
    }
    if (WEAK_SOFT.test(clause)) confused = true;

    const major = FACT_MAJOR.exec(clause) ?? FACT_GRADE.exec(clause) ?? FACT_BACKGROUND.exec(clause) ?? FACT_LEARNED.exec(clause);
    if (major?.[1] && major[1].length >= 2) {
      push('fact', cutAsk(major[1]));
      continue;
    }
    if (DEADLINE.test(clause)) {
      push('goal', cutAsk(dropSubject(clause)));
      continue;
    }
    if (GOAL_LEAD.test(clause) && !ASK_LEAD.test(clause)) {
      const whole = dropSubject(clause);
      const text = cutAsk(whole);
      if (text.length >= 3 && (GOAL_EVENT.test(text) || (GOAL_SKILL.test(text) && text === whole && text.length >= 6))) {
        push('goal', text);
        continue;
      }
    }
    const withStyle = PREF_WITH.exec(clause);
    if (withStyle && STYLE_WORDS.test(withStyle[1]) && !ASK_WORDS.test(withStyle[1])) {
      push('preference', `希望用${withStyle[1]}${withStyle[2]}`);
      continue;
    }
    const styled = PREF_TONE.exec(clause) ?? PREF_MORE.exec(clause) ?? PREF_FIRST.exec(clause);
    if (styled) {
      push('preference', `希望${styled[0]}`);
      continue;
    }
    const avoid = PREF_AVOID.exec(clause);
    if (avoid) {
      push('preference', avoid[0]);
      continue;
    }
    const like = PREF_LIKE.exec(clause);
    if (like && LIKE_WORDS.test(like[2])) {
      push(like[1] === '习惯' ? 'habit' : 'preference', cutAsk(dropSubject(clause)));
      continue;
    }
    const habit = HABIT.exec(clause);
    if (habit && HABIT_WORDS.test(habit[1])) {
      push('habit', cutAsk(dropSubject(clause)));
      continue;
    }
    const claim = STRENGTH_CLAIM.exec(clause);
    if (claim) push('strength', cutAsk(claim[1]), true);
  }

  // 「懂了」：上一问的概念记为已掌握
  if (GOT_IT.test(question.trim()) && question.trim().length <= 40 && recent.lastConcept) {
    const last = recent.lastConcept;
    drafts.push({
      kind: 'strength', text: `弄懂了「${last.label}」`, source: 'auto', resolves: last.label,
      ...(last.topicId ? { topicId: last.topicId, ...(last.topicTitle ? { topicTitle: last.topicTitle } : {}) } : {}),
    });
  }

  // 同一概念反复问到 → 薄弱点
  let concepts = entry.concepts;
  const label = extractConcept(question);
  const normalizedQuestion = normalize(question).slice(0, 80);
  if (label) {
    const conceptKey = normalize(label);
    const at = nowIso();
    const previous = concepts.find((trace) => trace.key === conceptKey || similarity(trace.label, label) >= 0.8);
    const trace: ConceptTrace = previous
      ? { ...previous, count: previous.count + 1, confused: previous.confused + (confused ? 1 : 0), at }
      : { key: conceptKey, label, count: 1, confused: confused ? 1 : 0, at, ...topicScope(turn) };
    concepts = [trace, ...concepts.filter((old) => old !== previous)].slice(0, CONCEPT_CAP);
    if (trace.count >= 3 || (trace.count >= 2 && trace.confused >= 1)) {
      drafts.push({
        kind: 'weakness', text: `反复问到「${trace.label}」，还没完全弄懂`, source: 'auto',
        ...(trace.topicId ? { topicId: trace.topicId, ...(trace.topicTitle ? { topicTitle: trace.topicTitle } : {}) } : topicScope(turn)),
      });
    }
    recent.lastConcept = { label, ...topicScope(turn) };
  } else if (normalizedQuestion.length >= 6 && recent.questions.some((old) => similarity(old, normalizedQuestion) >= 0.66)) {
    drafts.push({ kind: 'weakness', text: `同一个问题问过不止一次：${clip(cleanText(question, 60), 30)}`, source: 'auto', ...topicScope(turn) });
  }
  if (normalizedQuestion.length >= 6) recent.questions = [normalizedQuestion, ...recent.questions].slice(0, 12);

  return { drafts: drafts.slice(0, 4), concepts };
}

/** 写入自动提炼的草稿：尊重暂停，跳过我删过的内容 */
function commitAuto(owner: string | null, drafts: Draft[], concepts?: ConceptTrace[], digest?: TutorTurnDigest) {
  updateState(owner, (current) => {
    if (current.state.paused) return null;
    const entry = digest ? { ...current, turns: [digest, ...current.turns].slice(0, TURN_LOG_CAP) } : current;
    const allowed = drafts.filter((draft) => {
      const key = normalize(cleanText(draft.text));
      return key && !entry.forgotten.some((old) => old === key || similarity(old, key) >= DUPLICATE_AT);
    });
    const merged = mergeDrafts(entry.state.items, allowed, nowIso());
    if (!merged.changed && (!concepts || concepts === entry.concepts)) return digest ? entry : null;
    // 说了「懂了」的概念：撤掉自动记下的「反复问到」，计数也清零
    const resolved = allowed.flatMap((draft) => (draft.resolves ? [draft.resolves] : []));
    const outdated = (item: TutorMemoryItem) => item.kind === 'weakness' && item.source === 'auto' && !item.pinned && !item.edited
      && resolved.some((label) => item.text.startsWith(`反复问到「${label}」`));
    const resolvedKeys = new Set(resolved.map(normalize));
    return {
      ...entry,
      state: { ...entry.state, items: resolved.length ? merged.items.filter((item) => !outdated(item)) : merged.items },
      concepts: (concepts ?? entry.concepts).filter((trace) => !resolvedKeys.has(trace.key)),
    };
  });
}

// ───────────────────────── 第二层：模型提炼（防抖，每隔几轮一次） ─────────────────────────

const EXTRACT_EVERY = 2;
const EXTRACT_DELAY_MS = 1600;
const UNAVAILABLE_COOLDOWN_MS = 5 * 60_000;
interface PendingSlot { turns: Turn[]; timer: ReturnType<typeof setTimeout> | null; running: boolean; runs: number; blockedUntil: number }
const pendingByOwner = new Map<string, PendingSlot>();

const EXTRACT_SYSTEM = [
  '你是学习助教「小砚」的记忆整理员。读下面几轮问答，提炼 0–3 条值得长期记住的、关于这位学习者本人的信息。',
  'kind 只能取：preference（喜欢的讲解方式）、goal（学习目标或考试安排）、weakness（反复卡住的知识点）、strength（已经掌握的内容）、habit（学习习惯）、fact（专业、年级等背景）。',
  '每条 text 是一句不超过 40 字的中文陈述，不带「用户」「学习者」这类主语。',
  '只记以后的对话还用得上的稳定信息；忽略一次性的题目细节、寒暄和助教自己说的话；已经记住的不要重复。',
  '不要记录密码、密钥、手机号、邮箱、住址、证件号等隐私或联系方式。没有值得记的就返回空数组。',
  '只输出 JSON：{"memories":[{"kind":"goal","text":"……"}]}',
].join('\n');

function parseExtraction(result: unknown, turn: Turn): Draft[] {
  const source = Array.isArray(result) ? result : (result as { memories?: unknown; items?: unknown } | null)?.memories
    ?? (result as { items?: unknown } | null)?.items;
  if (!Array.isArray(source)) return [];
  const drafts: Draft[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    const text = cleanText(typeof raw.text === 'string' ? raw.text.replace(/^(?:用户|学习者|该?同学|学生|他|她|你|我)(?:是|的)?/, '') : '', 60);
    if (!isKind(raw.kind) || text.length < 2) continue;
    const scoped = raw.kind === 'weakness' || raw.kind === 'strength';
    drafts.push({ kind: raw.kind, text, source: 'auto', ...(scoped ? topicScope(turn) : {}) });
    if (drafts.length >= 3) break;
  }
  return drafts;
}

async function runExtraction(owner: string | null, slot: PendingSlot) {
  if (slot.running || !slot.turns.length) return;
  const turns = slot.turns.splice(0);
  slot.running = true;
  slot.runs += 1;
  try {
    const { items, paused } = readEntry(owner).state;
    if (paused) return;
    const known = items.slice(0, 14).map((item) => `- ${KIND_LABEL[item.kind]}：${item.text}`).join('\n') || '（还没有）';
    const dialogue = turns
      .map((turn, index) => `【第 ${index + 1} 轮${turn.topicTitle ? ` · ${clip(turn.topicTitle, 24)}` : ''}】\n学习者：${clip(turn.question, 420)}\n小砚：${clip(turn.answer, 360)}`)
      .join('\n\n');
    const result = await completeJson<unknown>({
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `已经记住的：\n${known}\n\n最近的问答：\n${dialogue}` },
      ],
      // 后台整理不占用学习者选的深度档位
      effort: 'low',
      maxTokens: 900,
      temperature: 0.2,
    });
    const drafts = parseExtraction(result, turns[turns.length - 1]);
    if (drafts.length) commitAuto(owner, drafts);
  } catch (error) {
    // 没有可用模型时歇一阵再试；其余错误（超时、JSON 不合规）丢弃这一批
    if (error instanceof ModelUnavailableError) slot.blockedUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
  } finally {
    slot.running = false;
    if (slot.turns.length >= EXTRACT_EVERY) scheduleExtraction(owner, slot);
  }
}

function scheduleExtraction(owner: string | null, slot: PendingSlot) {
  if (slot.running || Date.now() < slot.blockedUntil) return;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void runExtraction(owner, slot).catch(() => undefined);
  }, EXTRACT_DELAY_MS);
}

function queueExtraction(owner: string | null, turn: Turn) {
  const key = ownerKey(owner);
  const slot = pendingByOwner.get(key) ?? { turns: [], timer: null, running: false, runs: 0, blockedUntil: 0 };
  pendingByOwner.set(key, slot);
  slot.turns = [...slot.turns, turn].slice(-4);
  // 头两次每轮都整理，让新用户很快看到记忆；之后每隔几轮一次
  if (slot.turns.length >= (slot.runs < 2 ? 1 : EXTRACT_EVERY)) scheduleExtraction(owner, slot);
}

/** 一轮答疑结束后调用：从问答里提炼值得长期记住的内容。不抛错、不阻塞界面。 */
export function recordTutorTurn(owner: string | null, input: TutorTurnInput): void {
  try {
    const question = typeof input?.question === 'string' ? input.question.trim().slice(0, 1200) : '';
    if (question.length < 2) return;
    const turn: Turn = {
      question,
      answer: typeof input.answer === 'string' ? input.answer.trim().slice(0, 1600) : '',
      ...(typeof input.topicId === 'string' && input.topicId ? { topicId: input.topicId } : {}),
      ...(typeof input.topicTitle === 'string' && input.topicTitle.trim() ? { topicTitle: input.topicTitle.trim().slice(0, 60) } : {}),
    };
    // 放到下一个任务里做，调用方的渲染不等它
    setTimeout(() => {
      try {
        const entry = readEntry(owner);
        if (entry.state.paused) return;
        const { drafts, concepts } = observeQuestion(owner, entry, turn);
        // 提问摘要留给做梦整理回放；含隐私的提问不留
        const question = cleanText(turn.question, TURN_DIGEST_MAX);
        const digest: TutorTurnDigest | undefined = question && !isSensitiveMemoryText(turn.question)
          ? { at: nowIso(), question, ...(turn.topicId ? { topicId: turn.topicId } : {}), ...(turn.topicTitle ? { topicTitle: turn.topicTitle } : {}) }
          : undefined;
        commitAuto(owner, drafts, concepts, digest);
        queueExtraction(owner, turn);
      } catch {
        // 记忆整理失败不影响对话
      }
    }, 0);
  } catch {
    // 同上
  }
}
