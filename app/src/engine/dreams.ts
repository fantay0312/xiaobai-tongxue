/**
 * 做梦：两个记忆库的离线整理。
 * 白天只是把事情记下来；「做梦」是在空闲时把近期的记忆和经历回放一遍——从各种学习行为里反复出现的事中提炼出新的认识、
 * 合并重复、把很久没提起的归档、对照出处和日期解决互相矛盾的说法（并把排除掉的记一笔）、让入口文件 MEMORY.md 保持简短。
 * 一场梦的全部改动是记忆库里的一次提交，看得到逐文件的差异，也能撤销。
 *
 * 小砚整理的是「她记得的你」（小砚的记忆库）；小白回放的是「你教过他的课」——课堂数据只读，他的梦只往自己的记忆库里写。
 * 有模型时由模型整理和叙述，所有输出逐项校验；没有模型时走本地规则，叙述只用真正发生的改动拼成。
 * 可以选「做梦后直接生效」或「先给我看再生效」：后者把改动存成待确认的提议，逐条采纳或丢弃。
 * 置顶的、我写的、我改过的条目，除了一字不差的重复之外一概不动。
 */
import { useSyncExternalStore } from 'react';
import { getTopic } from '../data';
import { completeJson } from '../lib/modelGateway';
import { useAppStore } from '../store/appStore';
import type { LearnEvent, Topic, TopicState } from '../types';
import { ACTIVITY_LABELS, recentActivities } from './activityLog';
import type { Activity } from './activityLog';
import { leakageCheck } from './leakage';
import { computeMastery, decayedMastery } from './memory';
import { classroomReadyFor, syncXiaobaiRepo } from './memory-repo/xiaobai';
import {
  PASSIVE_FILES, allEntries, applyProposalChange, commitRepo, coursePath, fileInfo, isProtectedEntry, isSensitiveMemoryText, lessonPath, loadRepo,
  newRepoId, repoOps, supportedBy, textSimilarity, topicIdOfPath,
} from './memoryRepo';
import type { ProposalChange, ProposalKind, RepoEntry, RepoId, RepoState } from './memoryRepo';
import { memoryRetention } from './memoryRetention';
import { demonName } from './story';
import { TUTOR_MEMORY_KINDS, loadTutorTurnLog, placeTutorKind, syncTutorRepo } from './tutorMemory';
import type { TutorMemoryKind, TutorTurnDigest } from './tutorMemory';

export type Dreamer = 'xiaoyan' | 'xiaobai';

export interface DreamChange {
  /** merged=合并了重复的 promoted=提炼出新的认识 faded=淡忘了 kept=加深了 question=醒来还想问的 */
  kind: 'merged' | 'promoted' | 'faded' | 'kept' | 'question';
  text: string;
  /** 这一条关于哪门课（小白醒来想问的那句用它对上课程） */
  topicId?: string;
}

export interface DreamEntry {
  id: string;
  who: Dreamer;
  at: string;
  title: string;
  /** 第一人称的梦境叙述，2–4 句 */
  narrative: string;
  changes: DreamChange[];
  /** model=模型整理 local=本地规则整理 */
  method: 'model' | 'local';
  /** 「先给我看再生效」时：pending=改动还等我确认 applied=已采纳 discarded=没采纳 */
  review?: 'pending' | 'applied' | 'discarded';
}

/** 两场自动的梦之间至少隔这么久 */
export const DREAM_INTERVAL_HOURS = 18;
const DREAM_INTERVAL_MS = DREAM_INTERVAL_HOURS * 3_600_000;
const DREAMS_PER_DREAMER = 20;
const STORAGE_PREFIX = 'xiaobai-dreams-v1:';
const CHANGE_KINDS: readonly DreamChange['kind'][] = ['merged', 'promoted', 'faded', 'kept', 'question'];
const DAY_MS = 86_400_000;

// ───────────────────────── 存取与订阅 ─────────────────────────

/** 每个做梦者记着上次做梦的时间，和已经整理到哪个时刻（之前的材料不再重复整理） */
interface DreamerState { lastDreamAt: string | null; consumedAt: string | null }
interface DreamStore { dreams: DreamEntry[]; xiaoyan: DreamerState; xiaobai: DreamerState }

const EMPTY_DREAMS: DreamEntry[] = [];
const cache = new Map<string, DreamStore>();
const listeners = new Set<() => void>();
const running = new Map<string, Promise<DreamEntry | null>>();
const scheduled = new Set<string>();

const ownerKey = (owner: string | null) => (typeof owner === 'string' && owner.trim() ? owner.trim() : 'local');
const nowIso = () => new Date().toISOString();
const newId = () => globalThis.crypto?.randomUUID?.() ?? `dream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const isIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const tidy = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const percent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitizeDream(value: unknown): DreamEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const narrative = tidy(raw.narrative, 400);
  if ((raw.who !== 'xiaoyan' && raw.who !== 'xiaobai') || !isIso(raw.at) || !narrative) return null;
  const changes: DreamChange[] = [];
  for (const candidate of Array.isArray(raw.changes) ? raw.changes : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const change = candidate as Record<string, unknown>;
    const text = tidy(change.text, 120);
    if (!text || !CHANGE_KINDS.includes(change.kind as DreamChange['kind'])) continue;
    changes.push({
      kind: change.kind as DreamChange['kind'],
      text,
      ...(typeof change.topicId === 'string' && change.topicId ? { topicId: change.topicId } : {}),
    });
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    who: raw.who,
    at: raw.at,
    title: tidy(raw.title, 40) || '一场梦',
    narrative,
    changes: changes.slice(0, 16),
    method: raw.method === 'model' ? 'model' : 'local',
    ...(raw.review === 'pending' || raw.review === 'applied' || raw.review === 'discarded' ? { review: raw.review } : {}),
  };
}

function sanitizeDreamer(value: unknown): DreamerState {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { lastDreamAt: isIso(raw.lastDreamAt) ? raw.lastDreamAt : null, consumedAt: isIso(raw.consumedAt) ? raw.consumedAt : null };
}

function capDreams(dreams: DreamEntry[]): DreamEntry[] {
  const count: Record<Dreamer, number> = { xiaoyan: 0, xiaobai: 0 };
  return [...dreams]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((dream) => (count[dream.who] += 1) <= DREAMS_PER_DREAMER);
}

function readStore(owner: string | null): DreamStore {
  const key = ownerKey(owner);
  const cached = cache.get(key);
  if (cached) return cached;
  let store: DreamStore = { dreams: EMPTY_DREAMS, xiaoyan: sanitizeDreamer(null), xiaobai: sanitizeDreamer(null) };
  try {
    const text = browserStorage()?.getItem(STORAGE_PREFIX + key);
    if (text) {
      const raw = JSON.parse(text) as Record<string, unknown>;
      const dreams = (Array.isArray(raw.dreams) ? raw.dreams : []).map(sanitizeDream).filter((dream): dream is DreamEntry => dream !== null);
      store = { dreams: capDreams(dreams), xiaoyan: sanitizeDreamer(raw.xiaoyan), xiaobai: sanitizeDreamer(raw.xiaobai) };
    }
  } catch {
    // 存档损坏时按没有梦处理
  }
  cache.set(key, store);
  return store;
}

function writeStore(owner: string | null, store: DreamStore) {
  const key = ownerKey(owner);
  cache.set(key, store);
  try {
    browserStorage()?.setItem(STORAGE_PREFIX + key, JSON.stringify({ v: 1, ...store }));
  } catch {
    // 存储已满或被禁用：本次会话内仍然可看
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 单个订阅者出错不影响其余订阅者
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) return;
    cache.delete(event.key.slice(STORAGE_PREFIX.length));
    for (const listener of [...listeners]) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function loadDreams(owner: string | null): DreamEntry[] {
  try {
    return readStore(owner).dreams;
  } catch {
    return EMPTY_DREAMS;
  }
}

/** 订阅当前账号的梦境记录（新的在前） */
export function useDreams(owner: string | null): DreamEntry[] {
  return useSyncExternalStore(subscribe, () => loadDreams(owner), () => EMPTY_DREAMS);
}

/** 从梦境记录里删掉一场梦（只删记录，不撤销当时对记忆做的整理） */
export function removeDream(owner: string | null, id: string): void {
  const store = readStore(owner);
  if (store.dreams.some((dream) => dream.id === id)) writeStore(owner, { ...store, dreams: store.dreams.filter((dream) => dream.id !== id) });
}

function saveDream(owner: string | null, entry: DreamEntry) {
  const store = readStore(owner);
  writeStore(owner, {
    ...store,
    dreams: capDreams([entry, ...store.dreams]),
    [entry.who]: { lastDreamAt: entry.at, consumedAt: nowIso() },
  });
}


// ───────────────────────── 整理计划：一场梦要做的改动 ─────────────────────────

const LOCAL_MERGE_AT = 0.5;
const LOCAL_FADE_DAYS = 30;
const MODEL_FADE_DAYS = 14;
const ENTRY_BUDGET = 6;
const CHAR_BUDGET = 600;
const day = (iso: string) => iso.slice(0, 10);

interface Located { path: string; entry: RepoEntry }
/** 在记忆库的一份副本上排演改动：每一步都记成一条可单独采纳的提议，同时留一行给梦境记录 */
interface Planner {
  repo: RepoState;
  live: Map<string, Located>;
  changes: ProposalChange[];
  lines: DreamChange[];
  touched: Set<string>;
  list: () => Located[];
  remove: (id: string, kind: ProposalKind, note: string) => void;
  rewrite: (id: string, next: RepoEntry, kind: ProposalKind, note: string) => void;
  add: (path: string, entry: RepoEntry, kind: ProposalKind, note: string) => void;
  relocate: (id: string, toPath: string, after: RepoEntry, kind: ProposalKind, note: string) => void;
  line: (kind: DreamChange['kind'], text: string, topicId?: string) => void;
}

function makePlanner(repo: RepoState): Planner {
  const live = new Map<string, Located>(allEntries(repo).map((located) => [located.entry.id, located]));
  const changes: ProposalChange[] = [];
  const lines: DreamChange[] = [];
  const touched = new Set<string>();
  const push = (change: Omit<ProposalChange, 'id'>) => changes.push({ ...change, id: newRepoId() });
  return {
    repo, live, changes, lines, touched,
    list: () => [...live.values()].filter(({ path }) => !PASSIVE_FILES.includes(path)),
    remove: (id, kind, note) => {
      const hit = live.get(id);
      if (!hit) return;
      push({ path: hit.path, before: hit.entry, after: null, kind, note });
      live.delete(id);
      touched.add(id);
    },
    rewrite: (id, next, kind, note) => {
      const hit = live.get(id);
      if (!hit) return;
      push({ path: hit.path, before: hit.entry, after: next, kind, note });
      live.set(id, { path: hit.path, entry: next });
      touched.add(id);
    },
    add: (path, entry, kind, note) => {
      push({ path, before: null, after: entry, kind, note });
      live.set(entry.id, { path, entry });
      touched.add(entry.id);
    },
    relocate: (id, toPath, after, kind, note) => {
      const hit = live.get(id);
      if (!hit) return;
      push({ path: hit.path, before: hit.entry, after, toPath, kind, note });
      live.delete(id);
      live.set(after.id, { path: toPath, entry: after });
      touched.add(id);
      touched.add(after.id);
    },
    // 梦境记录是给人读的：文件链接的记号不带进去
    line: (kind, text, topicId) => { lines.push({ kind, text: clip(text.replace(/[，,]?\s*详见\s*\[\[[^\]]*\]\]/g, '').replace(/\[\[([^\]]*)\]\]/g, '$1'), 118), ...(topicId ? { topicId } : {}) }); },
  };
}

const dreamEntry = (text: string, label: string, extra: Partial<RepoEntry> = {}): RepoEntry => {
  const at = nowIso();
  return { id: newRepoId(), text, source: { type: 'dream', label }, addedAt: at, updatedAt: at, author: 'dream', ...extra };
};

function needsRetentionWork(repo: RepoState): boolean {
  return allEntries(repo).some(({path,entry}) => {
    if (PASSIVE_FILES.includes(path)) return false;
    const retention=memoryRetention(entry,path);
    return !retention.active || (retention.layer === 'long' && !entry.retention && !isProtectedEntry(entry));
  });
}

/** 三层记忆自动流转：近期/短期到期归档，跨天多次确认的信息沉淀为长期。 */
function passRetention(plan: Planner) {
  for (const {path,entry} of plan.list()) {
    const retention=memoryRetention(entry,path);
    if (!retention.active) {
      plan.relocate(entry.id,'archive.md',entry,'faded','近期或短期记忆到期，自动归档');
      plan.line('faded',entry.text,entry.source.topicId);
    } else if (retention.layer === 'long' && !entry.retention && !isProtectedEntry(entry)) {
      plan.rewrite(entry.id,{...entry,retention:'long'},'promoted','跨天反复确认，自动沉淀为长期记忆');
      plan.line('promoted',entry.text,entry.source.topicId);
    }
  }
}
const STRUGGLE_SECTIONS = new Set(['stuck', 'wrong', 'lapsed']);
const isStruggle = ({ path, entry }: Located) => path === 'weak-points.md' || (path.startsWith('courses/') && STRUGGLE_SECTIONS.has(entry.section ?? ''));
const isMastered = ({ path, entry }: Located) => path === 'mastered.md' || (path.startsWith('courses/') && entry.section === 'mastered');

/** 一条记录说的是哪个概念：优先取引号里的词，其次取「：」后面的细节（书名号里是课程名，不算概念） */
function conceptOf(text: string): string {
  const quoted = /[「“"]([^」”"]{2,20})[」”"]/.exec(text);
  if (quoted) return quoted[1];
  const detail = /[:：]\s*([^:：]{2,})$/.exec(text);
  if (detail) return detail[1].slice(0, 24);
  return text
    .replace(/^(?:总是|老是|一直|经常|每次都?|还是|始终|反复问到|同一个问题问过不止一次[:：]?|弄懂了|已经|早就|基本)/, '')
    .replace(/^(?:搞不清楚?|分不清楚?|弄不懂|搞不懂|不理解|记不住|容易混|掌握了?|熟悉)/, '')
    .slice(0, 14);
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS);
  return days <= 0 ? '今天' : `${days}天前`;
}

/** 合并：同一个文件同一小节里说法相近的，或指向同一个概念的卡点。受保护的条目只在一字不差时合并。 */
function passMerge(plan: Planner) {
  const items = plan.list();
  const parent = new Map<string, string>(items.map(({ entry }) => [entry.id, entry.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.path !== b.path || (a.entry.section ?? '') !== (b.entry.section ?? '')) continue;
      const exact = textSimilarity(a.entry.text, b.entry.text) === 1;
      // 「题目集做错 2 题：某某」这类记录开头都一样，要比的是冒号后面的细节
      const detailA = /[:：]\s*([^:：]{2,})$/.exec(a.entry.text)?.[1];
      const detailB = /[:：]\s*([^:：]{2,})$/.exec(b.entry.text)?.[1];
      const score = detailA && detailB ? Math.min(textSimilarity(detailA, detailB) + 0.1, textSimilarity(a.entry.text, b.entry.text) + 0.2) : textSimilarity(a.entry.text, b.entry.text);
      if (!exact && (isProtectedEntry(a.entry) || isProtectedEntry(b.entry) || a.entry.author === 'dream' || b.entry.author === 'dream')) continue;
      const sameConcept = isStruggle(a) && textSimilarity(conceptOf(a.entry.text), conceptOf(b.entry.text)) >= 0.8;
      if (exact || sameConcept || score >= LOCAL_MERGE_AT) parent.set(root(a.entry.id), root(b.entry.id));
    }
  }
  const clusters = new Map<string, Located[]>();
  for (const item of items) clusters.set(root(item.entry.id), [...(clusters.get(root(item.entry.id)) ?? []), item]);
  for (const members of clusters.values()) if (members.length >= 2) mergeGroup(plan, members);
}

function mergeGroup(plan: Planner, members: Located[], proposed?: string) {
  const rank = ({ entry }: Located) => (entry.pinned ? 2 : isProtectedEntry(entry) ? 1 : 0);
  const survivor = [...members].sort((a, b) => rank(b) - rank(a) || b.entry.updatedAt.localeCompare(a.entry.updatedAt))[0];
  const texts = members.map(({ entry }) => entry.text);
  let text = survivor.entry.text;
  if (!isProtectedEntry(survivor.entry)) {
    // 留学习者自己的原话，不留「反复问到……」这种模板句
    const own = texts.filter((line) => !/^(?:反复问到|同一个问题问过)/.test(line));
    const longest = (own.length ? own : texts).reduce((best, line) => (line.length > best.length ? line : best));
    const suggestion = tidy(proposed, 80);
    text = suggestion.length >= 2 && !isSensitiveMemoryText(suggestion) && supportedBy(suggestion, texts) >= 0.6 ? suggestion : longest;
  }
  const seen = Math.min(99, members.reduce((sum, { entry }) => sum + (entry.seen ?? 1), 0));
  for (const member of members) {
    if (member.entry.id !== survivor.entry.id) plan.remove(member.entry.id, 'merged', `和「${clip(text, 30)}」说的是同一件事，并进去`);
  }
  plan.rewrite(survivor.entry.id, { ...survivor.entry, text, seen, updatedAt: nowIso() }, 'merged', `${members.length} 条并成这一条`);
  plan.line('merged', `把 ${members.length} 条并成一条：${text}`, topicIdOfPath(survivor.path) ?? undefined);
}

/**
 * 矛盾：同一个概念既记成「卡住」又记成「已掌握」。对照出处和日期——置顶的、我写的优先，其次看谁更新、谁被印证得多。
 * 输的那条不直接抹掉，改记到「排除掉的」，写明为什么不再这么认为。
 */
function passContradictions(plan: Planner) {
  const weak = plan.list().filter(isStruggle);
  const strong = plan.list().filter(isMastered);
  for (const w of weak) {
    for (const m of strong) {
      if (!plan.live.has(w.entry.id) || !plan.live.has(m.entry.id)) continue;
      const scopeW = topicIdOfPath(w.path);
      const scopeM = topicIdOfPath(m.path);
      if (scopeW && scopeM && scopeW !== scopeM) continue;
      const same = textSimilarity(conceptOf(w.entry.text), conceptOf(m.entry.text)) >= 0.7 || textSimilarity(w.entry.text, m.entry.text) >= 0.6;
      if (!same) continue;
      const weight = ({ entry }: Located) => (isProtectedEntry(entry) ? 1 : 0);
      const masteredWins = weight(m) !== weight(w)
        ? weight(m) > weight(w)
        : m.entry.updatedAt !== w.entry.updatedAt ? m.entry.updatedAt > w.entry.updatedAt : (m.entry.seen ?? 1) >= (w.entry.seen ?? 1);
      const [winner, loser] = masteredWins ? [m, w] : [w, m];
      if (isProtectedEntry(loser.entry)) continue;
      const reason = masteredWins ? '后来的记录显示已经弄懂' : '后来又在这里卡住了';
      const note = dreamEntry(
        clip(`不再记「${clip(loser.entry.text, 40)}」：${reason}（${day(winner.entry.updatedAt)}，${winner.entry.source.label}）`, 118),
        `做梦整理 · 原出处：${clip(loser.entry.source.label, 24)}`,
      );
      plan.relocate(loser.entry.id, 'ruled-out.md', note, 'ruled', `和「${clip(winner.entry.text, 30)}」相反，${reason}`);
      plan.line('faded', `排除了「${clip(loser.entry.text, 36)}」：${reason}`, topicIdOfPath(loser.path) ?? undefined);
    }
  }
}

interface DreamContext { activities: Activity[]; turns: TutorTurnDigest[] }

/** 提炼：从各种学习行为里反复出现的事，归拢出更高一层的认识 */
function passPromote(plan: Planner, context: DreamContext) {
  // 1. 同一门课里卡住不止一处（不管来自做题、闪卡还是提问）→ 在薄弱点里记一条，并链到课程文件
  const byCourse = new Map<string, Located[]>();
  for (const item of plan.list()) {
    if (item.path.startsWith('courses/') && STRUGGLE_SECTIONS.has(item.entry.section ?? '')) byCourse.set(item.path, [...(byCourse.get(item.path) ?? []), item]);
  }
  for (const [path, weak] of byCourse) {
    if (weak.length < 3 || new Set(weak.map(({entry})=>entry.addedAt.slice(0,10))).size < 2) continue;
    const title = fileInfo('xiaoyan', path, plan.repo.titles).title;
    const concepts = [...new Set(weak.map(({ entry }) => conceptOf(entry.text)).filter(Boolean))].slice(0, 3).map((concept) => clip(concept, 20));
    const from = [...new Set(weak.map(({ entry }) => entry.source.label.split(' · ')[0]))].slice(0, 3);
    const text = clip(`《${clip(title, 14)}》里卡住的不止一处（${from.join('、')}）：${concepts.join('、')}，详见 [[${path}]]`, 118);
    const existing = plan.list().find((item) => item.path === 'weak-points.md' && item.entry.text.includes(`[[${path}]]`));
    const topicId = topicIdOfPath(path) ?? undefined;
    if (existing) {
      if (!isProtectedEntry(existing.entry) && existing.entry.text !== text) {
        plan.rewrite(existing.entry.id, { ...existing.entry, text, updatedAt: nowIso() }, 'promoted', '这门课的卡点有变化，更新这条归纳');
        plan.line('promoted', `薄弱点：${text}`, topicId);
      }
      continue;
    }
    plan.add('weak-points.md', dreamEntry(text, `做梦整理 · 依据 ${weak.length} 条卡点`, topicId ? { source: { type: 'dream', label: `做梦整理 · 依据 ${weak.length} 条卡点`, topicId, ref: { kind: 'topic', id: topicId, title } } } : {}), 'promoted', `从 ${weak.length} 条卡点里归纳`);
    plan.line('promoted', `薄弱点：${text}`, topicId);
  }

  // 2. 最近常用哪种学习方式（对话之外的行为）→ 习惯
  const counts = new Map<Activity['source'], number>();
  for (const activity of context.activities) if (activity.source !== 'chat') counts.set(activity.source, (counts.get(activity.source) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 4 && new Set(context.activities.filter(a=>a.source===top[0]).map(a=>a.at.slice(0,10))).size >= 2) {
    const head = `最近常用「${ACTIVITY_LABELS[top[0]]}」学习`;
    upsertPattern(plan, 'habits.md', head, `${head}（近 7 天 ${top[1]} 次）`, `做梦整理 · 依据 ${top[1]} 次${ACTIVITY_LABELS[top[0]]}`);
  }

  // 3. 提问集中在同一门课 → 习惯
  const asked = new Map<string, TutorTurnDigest[]>();
  for (const turn of context.turns) if (turn.topicId) asked.set(turn.topicId, [...(asked.get(turn.topicId) ?? []), turn]);
  const busiest = [...asked.values()].sort((a, b) => b.length - a.length)[0];
  if (busiest && busiest.length >= 4 && busiest[0].topicTitle && new Set(busiest.map(turn=>turn.at.slice(0,10))).size >= 2) {
    upsertPattern(plan, 'habits.md', '最近问得最多的是', `最近问得最多的是《${clip(busiest[0].topicTitle, 18)}》`, `做梦整理 · 依据 ${busiest.length} 次提问`);
  }
}

/** 归纳类的条目只留一条最新的：已有同一句开头的就改写，没有才新增 */
function upsertPattern(plan: Planner, path: string, head: string, text: string, label: string) {
  const existing = plan.list().find((item) => item.path === path && item.entry.author === 'dream' && item.entry.text.startsWith(head));
  if (existing) {
    if (existing.entry.text === text || isProtectedEntry(existing.entry)) return;
    plan.rewrite(existing.entry.id, { ...existing.entry, text, updatedAt: nowIso(), source: { type: 'dream', label } }, 'promoted', '更新这条归纳');
  } else {
    if (plan.list().some((item) => item.path === path && textSimilarity(item.entry.text, text) >= 0.72)) return;
    plan.add(path, dreamEntry(text, label), 'promoted', '从最近的学习行为里归纳');
  }
  plan.line('promoted', `${fileInfo('xiaoyan', path).title}：${text}`);
}

/** 过时：很久没再提起的自动记录挪进归档（不删，想留可以改回去） */
function passArchive(plan: Planner, days: number, only?: Set<string>) {
  const now = Date.now();
  for (const { path, entry } of plan.list()) {
    if (only && !only.has(entry.id)) continue;
    if (isProtectedEntry(entry) || now - Date.parse(entry.updatedAt) < days * DAY_MS) continue;
    const { section: _section, ...rest } = entry;
    plan.relocate(entry.id, 'archive.md', rest, 'faded', `${daysAgo(entry.updatedAt)}起没再提起，归档`);
    plan.line('faded', `${entry.text}（${daysAgo(entry.updatedAt)}起没再提，已归档）`, topicIdOfPath(path) ?? undefined);
  }
}

/** 入口文件要短：超出预算时，把最早的自动记录挪到「背景细节」，索引会自动带上链接 */
function passBudget(plan: Planner) {
  const inEntry = () => plan.list().filter(({ path }) => path === 'MEMORY.md');
  const over = () => inEntry().length > ENTRY_BUDGET || inEntry().reduce((sum, { entry }) => sum + entry.text.length, 0) > CHAR_BUDGET;
  let moved = 0;
  while (over()) {
    const oldest = inEntry().filter(({ entry }) => !isProtectedEntry(entry)).sort((a, b) => a.entry.updatedAt.localeCompare(b.entry.updatedAt))[0];
    if (!oldest || inEntry().length <= 3) break;
    plan.relocate(oldest.entry.id, 'profile.md', { ...oldest.entry }, 'moved', '入口文件太长，挪到 [[profile.md]]');
    moved += 1;
  }
  if (moved) plan.line('kept', `入口文件太长，把 ${moved} 条背景细节挪到了 [[profile.md]]`);
}

/** 下次想确认的一件事：从最近的卡点或目标里取，不凭空造 */
function xiaoyanQuestion(plan: Planner): string {
  const recent = plan.list().sort((a, b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  const weak = recent.find((item) => isStruggle(item) && item.entry.author !== 'dream');
  if (weak) return clip(`「${clip(conceptOf(weak.entry.text), 20)}」现在弄明白了吗？下次我想先问一句。`, 60);
  const goal = recent.find(({ path }) => path === 'goals.md');
  if (goal) return clip(`「${clip(goal.entry.text, 24)}」现在进展到哪一步了？`, 60);
  return '';
}

// ───────────────────────── 小砚的梦：整理「她记得的你」 ─────────────────────────

const KIND_LABEL = Object.fromEntries(TUTOR_MEMORY_KINDS.map((entry) => [entry.kind, entry.label])) as Record<TutorMemoryKind, string>;
const isKind = (value: unknown): value is TutorMemoryKind => TUTOR_MEMORY_KINDS.some((entry) => entry.kind === value);

interface XiaoyanMaterial { repo: RepoState; changed: Located[]; turns: TutorTurnDigest[]; activities: Activity[]; week: Activity[] }

function xiaoyanMaterial(owner: string | null): XiaoyanMaterial {
  const { consumedAt } = readStore(owner).xiaoyan;
  const repo = loadRepo(owner, 'xiaoyan');
  return {
    repo,
    changed: allEntries(repo).filter(({ path, entry }) => !PASSIVE_FILES.includes(path) && (!consumedAt || entry.updatedAt > consumedAt)),
    turns: loadTutorTurnLog(owner).filter((turn) => !consumedAt || turn.at > consumedAt),
    activities: recentActivities(owner, consumedAt ? { since: consumedAt } : { limit: 60 }),
    week: recentActivities(owner, { since: new Date(Date.now() - 7 * DAY_MS).toISOString() }),
  };
}

const XIAOYAN_SYSTEM = [
  '你是学习助教「小砚」。现在是夜里，你在整理记忆库里关于这位学习者的记录。材料有三样：记忆条目（m 开头）、最近的学习行为（a 开头：做题、闪卡、笔记、上课、资料等）、最近的提问（t 开头）。只依据这些材料，不编造其中没有的事。',
  '只输出一个 JSON 对象：',
  '{"merge":[{"ids":["m1","m2"],"text":"合并后的一句话"}],"promote":[{"kind":"weakness","text":"一条更高层的认识","from":["m3","a1"]}],"fade":["m4"],"keep":["m5"],"narrative":"……","question":"……","title":"……"}',
  '规则：',
  '- merge：只合并同一个文件里说同一件事的条目，每组至少两条；text 用学习者原话里的词，不超过 40 字。',
  '- promote：最多 2 条，是从反复出现的事里看出的规律，尤其留意对话之外的学习行为；kind 取 preference / goal / weakness / strength / habit / fact；text 不超过 40 字，尽量沿用材料里的词；from 至少列出两个它依据的编号。',
  '- 不做过度推断：至少三个独立记录、跨两个日期才提炼规律；一次问错、答对、阅读或上传不代表长期能力或兴趣。近期事实留在短期记忆，不强行上升为长期偏好。',
  '- fade：只选很久没再提起、现在已经不重要的条目。keep：只选被反复印证的条目。',
  '- 标了「置顶」或「我写的」的条目不要合并、不要淡忘。',
  '- narrative：2–4 句，第一人称，语气平静，只说今晚你整理了什么，不许出现编号。question：下次想向学习者确认的一件事，不超过 40 字，没有就给空字符串。title：不超过 12 字。',
  '- 不要写入密码、密钥、手机号、邮箱、住址等隐私。没有可做的就给空数组。',
].join('\n');

interface DreamStory { narrative: string; question: string; title: string }

/** 模型给出的整理意见逐项校验后排进计划；不合规的那一项丢掉 */
async function planXiaoyanModel(plan: Planner, material: XiaoyanMaterial): Promise<DreamStory> {
  const changed = new Set(material.changed.map(({ entry }) => entry.id));
  const listed = plan.list()
    .sort((a, b) => Number(changed.has(b.entry.id)) - Number(changed.has(a.entry.id)) || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
    .slice(0, 60);
  const activities = material.activities.slice(-15);
  const turns = material.turns.slice(0, 12);
  const itemByAlias = new Map(listed.map((item, index) => [`m${index + 1}`, item]));
  const itemLines = [...itemByAlias].map(([alias, { path, entry }]) => {
    const info = fileInfo('xiaoyan', path, plan.repo.titles);
    const section = info.sections?.find((candidate) => candidate.id === entry.section)?.label;
    return [
      alias, `${info.folder === 'courses' ? `课程《${clip(info.title, 14)}》` : info.title}${section ? ` / ${section}` : ''}`, entry.text,
      `出处：${clip(entry.source.label, 20)}`, `更新于${daysAgo(entry.updatedAt)}`,
      (entry.seen ?? 1) > 1 ? `提到${entry.seen}次` : '', entry.pinned ? '置顶' : '', entry.author === 'user' || entry.edited ? '我写的' : '',
    ].filter(Boolean).join('｜');
  });
  const activityLines = activities.map((activity, index) => `a${index + 1}｜${ACTIVITY_LABELS[activity.source]}${activity.topicTitle ? `《${clip(activity.topicTitle, 16)}》` : ''}｜${clip(activity.summary, 70)}${activity.detail ? `｜${clip(activity.detail, 80)}` : ''}｜${daysAgo(activity.at)}`);
  const turnLines = turns.map((turn, index) => `t${index + 1}｜${turn.topicTitle ? `《${clip(turn.topicTitle, 16)}》` : ''}${turn.question}｜${daysAgo(turn.at)}`);

  const raw = await completeJson<Record<string, unknown>>({
    messages: [
      { role: 'system', content: XIAOYAN_SYSTEM },
      { role: 'user', content: `记忆条目：\n${itemLines.join('\n') || '（没有）'}\n\n最近的学习行为：\n${activityLines.join('\n') || '（没有）'}\n\n最近的提问：\n${turnLines.join('\n') || '（没有）'}` },
    ],
    effort: 'low',
    maxTokens: 1400,
    temperature: 0.3,
  });

  const aliases = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  const located = (value: unknown) => [...new Set(aliases(value))].flatMap((alias) => {
    const item = itemByAlias.get(alias);
    return item && plan.live.has(item.entry.id) ? [plan.live.get(item.entry.id)!] : [];
  });

  for (const group of Array.isArray(raw.merge) ? raw.merge.slice(0, 8) : []) {
    if (!group || typeof group !== 'object') continue;
    let members = located((group as Record<string, unknown>).ids);
    if (members.length < 2 || members.some((member) => member.path !== members[0].path)) continue;
    const exact = members.every((member) => textSimilarity(member.entry.text, members[0].entry.text) === 1);
    if (!exact) members = members.filter((member) => !isProtectedEntry(member.entry));
    if (members.length >= 2) mergeGroup(plan, members, tidy((group as Record<string, unknown>).text, 80));
  }

  let promoted = 0;
  for (const promo of Array.isArray(raw.promote) ? raw.promote.slice(0, 4) : []) {
    if (promoted >= 2 || !promo || typeof promo !== 'object') continue;
    const { kind, text: rawText, from } = promo as Record<string, unknown>;
    const text = tidy(rawText, 60);
    if (!isKind(kind) || text.length < 4 || isSensitiveMemoryText(text)) continue;
    const cited = aliases(from);
    const sourceItems = cited.flatMap((alias) => (itemByAlias.get(alias) ? [itemByAlias.get(alias)!] : []));
    const sourceActs = cited.flatMap((alias) => { const index = Number(/^a(\d+)$/.exec(alias)?.[1] ?? 0); return activities[index - 1] ? [activities[index - 1]] : []; });
    const sourceTurns = cited.flatMap((alias) => { const index = Number(/^t(\d+)$/.exec(alias)?.[1] ?? 0); return turns[index - 1] ? [turns[index - 1]] : []; });
    const support = [...sourceItems.map(({ entry }) => entry.text), ...sourceActs.map((activity) => `${activity.summary} ${activity.detail ?? ''}`), ...sourceTurns.map((turn) => turn.question)];
    // 必须有至少两处出处，而且说法能在出处里找到影子
    const dates=new Set([...sourceItems.map(({entry})=>entry.addedAt.slice(0,10)),...sourceActs.map(a=>a.at.slice(0,10)),...sourceTurns.map(t=>t.at.slice(0,10))]);
    if (support.length < 3 || dates.size < 2 || supportedBy(text, support) < 0.15) continue;
    // 依据都来自同一门课时，这条认识也记在那门课下
    const topics = new Set([...sourceItems.map(({ path }) => topicIdOfPath(path) ?? ''), ...sourceActs.map((activity) => activity.topicId ?? ''), ...sourceTurns.map((turn) => turn.topicId ?? '')]);
    const topicId = topics.size === 1 ? [...topics][0] : '';
    const topicTitle = topicId ? sourceActs.find((activity) => activity.topicTitle)?.topicTitle ?? sourceTurns.find((turn) => turn.topicTitle)?.topicTitle ?? fileInfo('xiaoyan', coursePath(topicId), plan.repo.titles).title : undefined;
    const place = placeTutorKind(kind, topicId ? { topicId, topicTitle } : {});
    const sources = new Set(sourceItems.map(({ entry }) => entry.id));
    if (plan.list().some((item) => item.path === place.path && !sources.has(item.entry.id) && textSimilarity(item.entry.text, text) >= 0.72)) continue;
    const label = `做梦整理 · 依据 ${support.length} 处记录`;
    plan.add(place.path, dreamEntry(text, label, {
      retention: ['preference','habit','fact'].includes(kind) ? 'long' : 'short',
      ...(place.section ? { section: place.section } : {}),
      ...(topicId ? { source: { type: 'dream', label, topicId, ref: { kind: 'topic', id: topicId, ...(topicTitle ? { title: topicTitle } : {}) } } } : {}),
    }), 'promoted', `从 ${support.length} 处记录里归纳`);
    plan.line('promoted', `${KIND_LABEL[kind]}：${text}`, topicId || undefined);
    promoted += 1;
  }

  passArchive(plan, MODEL_FADE_DAYS, new Set(located(raw.fade).map(({ entry }) => entry.id)));
  for (const { entry } of located(raw.keep).slice(0, 4)) {
    if (!plan.touched.has(entry.id)) plan.line('kept', entry.text);
  }

  const narrative = tidy(raw.narrative, 320);
  const question = tidy(raw.question, 60);
  return {
    narrative: narrative.length >= 12 && !isSensitiveMemoryText(narrative) && !/\b[mat]\d+\b/.test(narrative) ? narrative : '',
    question: question.length >= 4 && !isSensitiveMemoryText(question) ? question : '',
    title: tidy(raw.title, 16),
  };
}

/** 只用真正排进计划的改动拼出的叙述 */
function narrateXiaoyan(plan: Planner, material: XiaoyanMaterial): string {
  const count = (kind: ProposalKind) => plan.changes.filter((change) => change.kind === kind).length;
  const total = allEntries(material.repo).filter(({ path }) => !PASSIVE_FILES.includes(path)).length;
  const others = material.activities.filter((activity) => activity.source !== 'chat').length;
  const replay = [material.turns.length ? ` ${material.turns.length} 次提问` : '', others ? ` ${others} 次对话之外的学习行为` : ''].filter(Boolean).join('和');
  const lines = [total > 0
    ? `夜里我把记忆库里的 ${total} 条翻了一遍${replay ? `，也把最近的${replay}回想了一下` : ''}。`
    : `夜里我把最近的${replay || '事'}回想了一下。`];
  const merged = plan.lines.filter((line) => line.kind === 'merged').length;
  const promoted = plan.lines.find((line) => line.kind === 'promoted');
  if (merged) lines.push(`有 ${merged} 处说的其实是同一件事，我把它们并成了一条。`);
  if (promoted) lines.push(`从反复出现的事里，我看出了一点：${promoted.text.replace(/^[^：]{1,6}：/, '').replace(/，?详见 \[\[[^\]]*\]\]/, '')}。`);
  if (count('ruled')) lines.push(`有 ${count('ruled')} 处前后说法相反，我对了对出处和日期，把不成立的记进了「排除掉的」。`);
  if (count('faded')) lines.push(`有 ${count('faded')} 条很久没再提起，我把${count('faded') > 1 ? '它们' : '它'}归了档。`);
  if (lines.length === 1) {
    lines.push(total === 0
      ? '还没有哪件事值得单独记一笔，先放着。'
      : material.changed.length
        ? `没有重复的，也没有该放下的，新记下的 ${material.changed.length} 条都原样留着。`
        : '没有重复的，也没有该放下的，都原样留着。');
  }
  return lines.slice(0, 4).join('');
}

function xiaoyanTitle(plan: Planner): string {
  const has = (kind: ProposalKind) => plan.changes.some((change) => change.kind === kind);
  if (has('promoted')) return '想明白了一件事';
  if (has('ruled')) return '把相反的说法理清了';
  if (has('merged')) return '把重复的并在了一起';
  if (has('faded')) return '放下了几件旧事';
  return '翻了一遍，原样留着';
}

/** 一场梦收尾：改动直接提交，或存成待确认的提议；再留下梦境记录 */
function finishDream(owner: string | null, repo: RepoId, plan: Planner, entry: Omit<DreamEntry, 'review'>): DreamEntry | null {
  const current = loadRepo(owner, repo);
  if (current.workGeneration !== plan.repo.workGeneration || current.paused || (repo === 'xiaobai' && (!classroomReadyFor(owner) || useAppStore.getState().memory.paused))) return null;
  if (plan.changes.length) {
    commitRepo(owner, repo, 'dream', `做梦整理：${entry.title}`, (draft) => {
      for (const change of plan.changes) applyProposalChange(draft, change);
    });
  }
  const saved: DreamEntry = {...entry,review:'applied'};
  saveDream(owner, saved);
  return saved;
}

async function dreamXiaoyan(owner: string | null, manual: boolean): Promise<DreamEntry | null> {
  syncTutorRepo(owner);
  const material = xiaoyanMaterial(owner);
  const fresh = material.changed.length + material.turns.length + material.activities.length;
  const enough = needsRetentionWork(material.repo) || (manual ? fresh >= 1 : material.changed.length >= 1 || material.turns.length >= 3 || material.activities.length >= 3);
  if (material.repo.paused || !enough) return null;

  const context: DreamContext = { activities: material.week, turns: material.turns };
  let method: DreamEntry['method'] = 'model';
  let story: DreamStory = { narrative: '', question: '', title: '' };
  let plan = makePlanner(material.repo);
  passRetention(plan);
  try {
    if (plan.list().length || material.turns.length || material.activities.length) story = await planXiaoyanModel(plan, material);
    else method = 'local';
  } catch {
    // 没有模型（ModelUnavailableError），或模型这次没给出合规结果：改用本地规则重新排一遍
    method = 'local';
    plan = makePlanner(material.repo);
    passRetention(plan);
    passMerge(plan);
    passPromote(plan, context);
    passArchive(plan, LOCAL_FADE_DAYS);
  }
  // 等模型的这段时间里记忆库可能被暂停或被我改过
  const latest = loadRepo(owner, 'xiaoyan');
  if (latest.paused) return null;
  if (latest !== material.repo) {
    const stale = plan.changes.some((change) => change.before && !allEntries(latest).some(({ entry }) => entry.id === change.before!.id && entry.text === change.before!.text));
    if (stale) return null;
  }
  // 这两步是确定性的：矛盾按出处和日期裁决，入口文件保持简短
  passContradictions(plan);
  passBudget(plan);
  passRetention(plan);

  const lines = [...plan.lines];
  if (method === 'local') {
    const { consumedAt } = readStore(owner).xiaoyan;
    for (const { entry } of plan.list().filter(({ entry: candidate }) => !plan.touched.has(candidate.id) && (candidate.seen ?? 1) >= 2 && (!consumedAt || candidate.updatedAt > consumedAt)).slice(0, 3)) {
      lines.push({ kind: 'kept', text: entry.text });
    }
  }
  // 什么都没动时，把这次新记下的列为「留着」，让记录说得清翻过了什么
  if (!lines.length) for (const { entry } of material.changed.slice(0, 3)) lines.push({ kind: 'kept', text: entry.text });
  const question = story.question || xiaoyanQuestion(plan);
  if (question) lines.push({ kind: 'question', text: clip(question, 60) });

  return finishDream(owner, 'xiaoyan', plan, {
    id: newId(),
    who: 'xiaoyan',
    at: nowIso(),
    title: story.title || xiaoyanTitle(plan),
    narrative: story.narrative || narrateXiaoyan(plan, material),
    changes: lines.slice(0, 16),
    method,
  });
}

// ───────────────────────── 小白的梦：回放「你教过他的课」 ─────────────────────────

interface LessonFact {
  topic: Topic;
  sessions: number;
  /** 这段时间新记牢的要点名（先生讲明白过的） */
  points: string[];
  quotes: string[];
  cleared: string[];
  /** 还没想通的地方：小白自己在课上说过的那句 */
  open: string[];
  mastered: boolean;
}
interface FadingFact { topic: Topic; base: number; current: number; point: string | null }
interface XiaobaiWorld { lessons: LessonFact[]; fading: FadingFact[]; paused: boolean; states: Record<string, TopicState>; quotesByTopic: Map<string, string[]> }

/** 只读课堂数据：上次做梦之后上过的课，和正在起雾的出师课 */
function readXiaobaiWorld(consumedAt: string | null): XiaobaiWorld {
  const { events, topicStates, memory, global } = useAppStore.getState();
  const fresh = events.filter((event) => event.sessionId && (!consumedAt || event.t > consumedAt));
  const byTopic = new Map<string, LearnEvent[]>();
  for (const event of fresh) byTopic.set(event.topicId, [...(byTopic.get(event.topicId) ?? []), event]);

  const quotesByTopic = new Map<string, string[]>();
  for (const quote of global.goldenAnalogies) quotesByTopic.set(quote.topicId, [...(quotesByTopic.get(quote.topicId) ?? []), quote.text]);

  const lessons: LessonFact[] = [];
  for (const [topicId, own] of byTopic) {
    const topic = getTopic(topicId);
    if (!topic) continue;
    const state = topicStates[topicId];
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
    const mcOf = (event: LearnEvent) => topic.misconceptions.find((mc) => mc.mcId === String(event.payload.mcId ?? ''));
    const cleared = unique(own.filter((event) => event.type === 'misconception_corrected').map((event) => {
      const mc = mcOf(event);
      return mc ? demonName(mc) : '';
    }));
    const open = topic.misconceptions
      .filter((mc) => state?.mcStates?.[mc.mcId] === '已注入' || state?.mcStates?.[mc.mcId] === '被带偏')
      .map((mc) => mc.triggerLine);
    lessons.push({
      topic,
      sessions: new Set(own.map((event) => event.sessionId)).size,
      points: unique(own.filter((event) => event.type === 'checklist_hit').map((event) => {
        const id = String(event.payload.checklistId ?? '');
        return topic.checklist.find((item) => item.id === id)?.point ?? '';
      })).slice(0, 4),
      quotes: unique(own.filter((event) => event.type === 'golden_analogy_saved').map((event) => String(event.payload.text ?? '').trim())).slice(0, 2),
      cleared: cleared.slice(0, 3),
      open: unique(open).slice(0, 2),
      mastered: own.some((event) => event.type === 'topic_mastered'),
    });
  }
  // 最近上的课排前面，一场梦最多回放四门
  const lastAt = (fact: LessonFact) => (byTopic.get(fact.topic.topicId) ?? []).reduce((latest, event) => (event.t > latest ? event.t : latest), '');
  lessons.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));

  const now = new Date();
  const fading: FadingFact[] = [];
  for (const [topicId, state] of Object.entries(topicStates)) {
    if (state.knowledgeState !== '出师') continue;
    const topic = getTopic(topicId);
    if (!topic) continue;
    const base = computeMastery(state, topic, events.filter((event) => event.topicId === topicId));
    const current = decayedMastery(base, state.lastVerified, now);
    const overdue = !!state.reviewDue && now.toISOString() > state.reviewDue;
    if (base - current < 0.08 && !overdue && !state.forgotten) continue;
    const point = topic.checklist.find((item) => state.hitChecklist.includes(item.id))?.point ?? null;
    fading.push({ topic, base, current, point });
  }
  fading.sort((a, b) => (b.base - b.current) - (a.base - a.current));

  return { lessons: lessons.slice(0, 4), fading: fading.slice(0, 2), paused: memory.paused, states: topicStates, quotesByTopic };
}

function xiaobaiChanges(world: XiaobaiWorld): DreamChange[] {
  const changes: DreamChange[] = [];
  for (const lesson of world.lessons) {
    const title = clip(lesson.topic.title, 16);
    const topicId = lesson.topic.topicId;
    if (lesson.sessions >= 2) changes.push({ kind: 'merged', text: `《${title}》上了 ${lesson.sessions} 堂，我把它们合成一页记`, topicId });
    if (lesson.points.length) changes.push({ kind: 'kept', text: clip(`《${title}》记牢了${lesson.points.slice(0, 3).map((point) => `「${point}」`).join('')}`, 110), topicId });
    if (lesson.mastered) changes.push({ kind: 'promoted', text: `《${title}》出师了`, topicId });
    for (const demon of lesson.cleared) changes.push({ kind: 'promoted', text: `《${title}》想通了一处：${demon}`, topicId });
    for (const quote of lesson.quotes) changes.push({ kind: 'promoted', text: clip(`先生的比方抄进了小本子：「${clip(quote, 40)}」`, 110), topicId });
  }
  for (const fact of world.fading) {
    changes.push({
      kind: 'faded',
      text: `《${clip(fact.topic.title, 16)}》有点起雾：出师时 ${percent(fact.base)}%，现在 ${percent(fact.current)}%`,
      topicId: fact.topic.topicId,
    });
  }
  return changes;
}

/** 醒来还想问的一句：只用课名、他自己说过的话、先生讲明白过的要点名 */
function xiaobaiQuestion(world: XiaobaiWorld): DreamChange | null {
  const withOpen = world.lessons.find((lesson) => lesson.open.length > 0);
  if (withOpen) {
    const title = clip(withOpen.topic.title, 12);
    const line = withOpen.open[0].replace(/[。？！?!\s]+$/, '');
    return { kind: 'question', topicId: withOpen.topic.topicId, text: clip(`《${title}》里我说过「${clip(line, 22)}」，先生，是这样吗？`, 60) };
  }
  const fading = world.fading[0];
  if (fading) {
    const title = clip(fading.topic.title, 12);
    return {
      kind: 'question', topicId: fading.topic.topicId,
      text: clip(fading.point ? `《${title}》我有点记不清了，「${clip(fading.point, 14)}」能再讲一遍吗？` : `《${title}》我有点记不清了，先生能再带我过一遍吗？`, 60),
    };
  }
  const unfinished = world.lessons.find((lesson) => world.states[lesson.topic.topicId]?.knowledgeState !== '出师');
  if (unfinished) return { kind: 'question', topicId: unfinished.topic.topicId, text: clip(`《${clip(unfinished.topic.title, 14)}》我还没学完，下一堂先生接着讲哪儿？`, 60) };
  const quoted = world.lessons.find((lesson) => lesson.quotes.length > 0);
  if (quoted) return { kind: 'question', topicId: quoted.topic.topicId, text: clip(`《${clip(quoted.topic.title, 14)}》里先生打的那个比方，还能再打一个吗？`, 60) };
  return null;
}

function narrateXiaobai(world: XiaobaiWorld): string {
  const lines: string[] = [];
  const [first, second] = world.lessons;
  if (first) {
    lines.push(`我梦见先生又在讲《${clip(first.topic.title, 16)}》${second ? `，讲完又接着讲《${clip(second.topic.title, 16)}》` : ''}。`);
    const lessonWithPoints = world.lessons.find((lesson) => lesson.points.length > 0);
    if (lessonWithPoints) lines.push(`梦里我把${lessonWithPoints.points.slice(0, 2).map((point) => `「${point}」`).join('')}背了一遍，居然没背错。`);
    const lessonWithQuote = world.lessons.find((lesson) => lesson.quotes.length > 0);
    if (lessonWithQuote) lines.push(`先生那句「${clip(lessonWithQuote.quotes[0], 30)}」，我在梦里念了好几遍。`);
    const lessonCleared = world.lessons.find((lesson) => lesson.cleared.length > 0);
    if (lessonCleared && lines.length < 4) lines.push(`以前想岔的那处（${lessonCleared.cleared[0]}），这回没再绕进去。`);
  }
  if (world.fading[0] && lines.length < 4) {
    lines.push(`${first ? '不过' : '我梦见自己在翻小本子，'}《${clip(world.fading[0].topic.title, 16)}》有点起雾了，醒来得再看看。`);
  }
  if (world.lessons.some((lesson) => lesson.open.length > 0) && lines.length < 4) lines.push('还有一处我没想通，下回得问先生。');
  return lines.join('');
}

/** 小白不能说先生没讲过的词：对涉及的每门课跑一遍课堂用的泄漏检查 */
function leaksUntaught(text: string, world: XiaobaiWorld): boolean {
  const topics = new Map<string, Topic>();
  for (const lesson of world.lessons) topics.set(lesson.topic.topicId, lesson.topic);
  for (const fact of world.fading) topics.set(fact.topic.topicId, fact.topic);
  for (const topic of topics.values()) {
    const quotes = world.quotesByTopic.get(topic.topicId) ?? [];
    // 先生原话（金句）里出现过的术语算讲过
    const teacherTerms = topic.checklist.flatMap((item) => item.terms).filter((term) => quotes.some((quote) => quote.includes(term)));
    const banned = leakageCheck({ reply: text, topic, whitelistChecklist: world.states[topic.topicId]?.hitChecklist ?? [], teacherTerms });
    if (banned.length) return true;
  }
  return false;
}

const XIAOBAI_SYSTEM = [
  '你是「小白」，一个刚开始学习的学生，用户是教你的「先生」。现在你在做梦，梦里回放先生最近教你的课。',
  '只依据下面的事实写，不添加事实里没有的内容。你是初学者：除了事实里原样出现的词，不要使用任何别的专业术语。',
  '只输出一个 JSON 对象：{"title":"不超过 12 字","narrative":"2–4 句，第一人称，好奇、有一点好笑，称呼对方为先生","question":"醒来还想问先生的一句话，不超过 40 字，关于下面某一门课","lesson":1}',
  'lesson 是 question 所问那门课的序号。',
].join('\n');

interface XiaobaiModelStory { title: string; narrative: string; question: DreamChange | null }

async function storyXiaobaiModel(world: XiaobaiWorld): Promise<XiaobaiModelStory> {
  const topics = [...world.lessons.map((lesson) => lesson.topic), ...world.fading.map((fact) => fact.topic)]
    .filter((topic, index, list) => list.findIndex((other) => other.topicId === topic.topicId) === index);
  const sheet: string[] = [];
  topics.forEach((topic, index) => {
    const lesson = world.lessons.find((entry) => entry.topic.topicId === topic.topicId);
    const fading = world.fading.find((entry) => entry.topic.topicId === topic.topicId);
    const parts = [`${index + 1}. 《${topic.title}》`];
    if (lesson) {
      parts.push(`最近上了 ${lesson.sessions} 堂`);
      if (lesson.points.length) parts.push(`记牢的要点：${lesson.points.join('、')}`);
      if (lesson.quotes.length) parts.push(`先生的原话：${lesson.quotes.map((quote) => `「${clip(quote, 60)}」`).join('')}`);
      if (lesson.cleared.length) parts.push(`想通了以前想岔的 ${lesson.cleared.length} 处`);
      if (lesson.open.length) parts.push(`还没想通，我在课上说过：「${clip(lesson.open[0], 50)}」`);
      if (lesson.mastered) parts.push('这门课出师了');
    }
    if (fading) parts.push(`有点忘了：出师时记得 ${percent(fading.base)}%，现在 ${percent(fading.current)}%`);
    sheet.push(parts.join('；'));
  });

  const raw = await completeJson<Record<string, unknown>>({
    messages: [
      { role: 'system', content: XIAOBAI_SYSTEM },
      { role: 'user', content: `事实：\n${sheet.join('\n')}` },
    ],
    effort: 'low',
    maxTokens: 900,
    temperature: 0.7,
  });
  const narrative = tidy(raw.narrative, 320);
  const question = tidy(raw.question, 60);
  const asked = topics[(typeof raw.lesson === 'number' ? Math.floor(raw.lesson) : 0) - 1];
  const fine = (text: string) => !isSensitiveMemoryText(text) && !leaksUntaught(text, world);
  return {
    title: fine(tidy(raw.title, 16)) ? tidy(raw.title, 16) : '',
    narrative: narrative.length >= 16 && fine(narrative) ? narrative : '',
    question: asked && question.length >= 4 && fine(question) ? { kind: 'question', text: question, topicId: asked.topicId } : null,
  };
}


async function dreamXiaobai(owner: string | null): Promise<DreamEntry | null> {
  syncXiaobaiRepo(owner);
  const repo = loadRepo(owner, 'xiaobai');
  const world = readXiaobaiWorld(readStore(owner).xiaobai.consumedAt);
  // 新材料只认新上的课；光是旧课在起雾，不单独做一场梦
  if (world.paused) return null;
  if (world.lessons.length === 0) {
    if (!needsRetentionWork(repo)) return null;
    const plan=makePlanner(repo);passRetention(plan);
    return finishDream(owner,'xiaobai',plan,{id:newId(),who:'xiaobai',at:nowIso(),title:'整理三层记忆',narrative:'把到期的临时记忆归档，把反复确认的信息留作长期记忆。',changes:plan.lines,method:'local'});
  }

  let story: XiaobaiModelStory = { title: '', narrative: '', question: null };
  let method: DreamEntry['method'] = 'model';
  try {
    story = await storyXiaobaiModel(world);
  } catch {
    method = 'local';
  }
  // 模型写的叙述没过校验时退回模板，方法也如实记为本地
  if (!story.narrative) method = 'local';
  const question = story.question ?? xiaobaiQuestion(world);

  // 他的梦只往自己的记忆库里写：还想问的记进 questions.md，开始模糊的记进那门课的文件
  const plan = makePlanner(loadRepo(owner, 'xiaobai'));
  passRetention(plan);
  if (question?.topicId) {
    const topic = getTopic(question.topicId);
    const asked = plan.list().some(({ path, entry }) => path === 'questions.md' && textSimilarity(entry.text, question.text) >= 0.72);
    if (!asked) {
      const label = `梦醒后${topic ? ` · ${clip(topic.title, 16)}` : ''}`;
      plan.add('questions.md', dreamEntry(question.text, label, {
        source: { type: 'dream', label, topicId: question.topicId, ref: { kind: 'topic', id: question.topicId, ...(topic ? { title: topic.title } : {}) } },
      }), 'question', '醒来还想问先生的一句');
    }
  }
  for (const fact of world.fading) {
    const id = `xb:${fact.topic.topicId}:fading`;
    const text = `出师时记得 ${percent(fact.base)}%，现在 ${percent(fact.current)}%，有点起雾了`;
    const existing = plan.live.get(id);
    const label = `梦里回放 · ${clip(fact.topic.title, 16)}`;
    if (existing) {
      if (existing.entry.text !== text && !existing.entry.edited) plan.rewrite(id, { ...existing.entry, text, updatedAt: nowIso() }, 'faded', '记得的又少了一点');
    } else {
      plan.add(lessonPath(fact.topic.topicId), dreamEntry(text, label, {
        id, section: 'fading',
        source: { type: 'dream', label, topicId: fact.topic.topicId, ref: { kind: 'topic', id: fact.topic.topicId, title: fact.topic.title } },
      }), 'faded', '这门课开始模糊了');
    }
  }

  return finishDream(owner, 'xiaobai', plan, {
    id: newId(),
    who: 'xiaobai',
    at: nowIso(),
    title: (method === 'model' && story.title) || `梦见先生讲《${clip(world.lessons[0].topic.title, 12)}》`,
    narrative: story.narrative || narrateXiaobai(world),
    changes: [...xiaobaiChanges(world).slice(0, 12), ...(question ? [question] : [])],
    method,
  });
}

// ───────────────────────── 审阅：先给我看再生效 ─────────────────────────

function markReview(owner: string | null, id: string, review: NonNullable<DreamEntry['review']>) {
  const store = readStore(owner);
  if (store.dreams.some((dream) => dream.id === id && dream.review !== review)) {
    writeStore(owner, { ...store, dreams: store.dreams.map((dream) => (dream.id === id ? { ...dream, review } : dream)) });
  }
}

/** 「做梦后直接生效」（默认）或「先给我看再生效」 */
export function setDreamReview(owner: string | null, who: Dreamer, review: boolean): void {
  repoOps.setReview(owner, who, review);
}

/** 兼容旧版待确认记录：自动应用仍匹配的部分，过时部分跳过；不再打断学习者确认。 */
export function settleAutomaticDreams(owner: string | null, who: Dreamer): void {
  const repo=loadRepo(owner,who);
  if (repo.paused) return;
  if (repo.review) repoOps.setReview(owner,who,false);
  if (repo.pending) {
    const applied=repoOps.applyProposal(owner,who);
    repoOps.discardProposal(owner,who);
    markReview(owner,repo.pending.id,applied?'applied':'discarded');
  }
}

/** 采纳一场梦提出的改动；不给 ids 就是全部。全部处理完后，梦境记录标成已采纳。 */
export function applyDreamProposal(owner: string | null, who: Dreamer, ids?: string[]): void {
  const pending = loadRepo(owner, who).pending;
  if (!pending) return;
  repoOps.applyProposal(owner, who, ids);
  if (!loadRepo(owner, who).pending) markReview(owner, pending.id, 'applied');
}

/** 丢弃提出的改动；一条都没采纳就全丢时，梦境记录标成没采纳。 */
export function discardDreamProposal(owner: string | null, who: Dreamer, ids?: string[]): void {
  const pending = loadRepo(owner, who).pending;
  if (!pending) return;
  const untouched = !loadRepo(owner, who).commits.some((commit) => commit.author === 'dream' && commit.at >= pending.at);
  repoOps.discardProposal(owner, who, ids);
  if (!loadRepo(owner, who).pending) markReview(owner, pending.id, untouched ? 'discarded' : 'applied');
}

// ───────────────────────── 何时做梦 ─────────────────────────

export interface DreamStatus {
  lastDreamAt: string | null;
  /** 自动整理最早什么时候可以再来；null 表示时间上已经可以 */
  nextAutoAt: string | null;
  /** 上次整理之后攒下的新内容：新增或变动的记忆条数、提问次数、对话之外的学习行为次数；小白是新上的课数 */
  freshItems: number;
  freshTurns: number;
  freshActivities: number;
  freshLessons: number;
  /** 现在点「现在整理」会不会真的整理 */
  canDreamNow: boolean;
  /** 这份记忆被暂停了，暂停期间不做梦 */
  paused: boolean;
  /** 先给我看再生效 */
  review: boolean;
  /** 还等我确认的改动数；有的话要先处理完才会做下一场梦 */
  pendingChanges: number;
}

/** 给界面用：上次什么时候整理过、下次什么时候、现在有没有新内容 */
export function dreamStatus(owner: string | null, who: Dreamer): DreamStatus {
  const state = readStore(owner)[who];
  const repo = loadRepo(owner, who);
  const last = state.lastDreamAt ? Date.parse(state.lastDreamAt) : null;
  const nextAutoAt = last !== null && Date.now() - last < DREAM_INTERVAL_MS ? new Date(last + DREAM_INTERVAL_MS).toISOString() : null;
  const retentionWork=needsRetentionWork(repo);
  const base = { lastDreamAt: state.lastDreamAt, nextAutoAt, review: false, pendingChanges: 0 };
  if (who === 'xiaoyan') {
    const material = xiaoyanMaterial(owner);
    const others = material.activities.filter((activity) => activity.source !== 'chat').length;
    return {
      ...base, freshItems: material.changed.length, freshTurns: material.turns.length, freshActivities: others, freshLessons: 0,
      canDreamNow: !repo.paused && (retentionWork || material.changed.length + material.turns.length + material.activities.length >= 1),
      paused: repo.paused,
    };
  }
  let lessons = 0;
  let paused = false;
  try {
    const world = readXiaobaiWorld(state.consumedAt);
    lessons = world.lessons.length;
    paused = world.paused;
  } catch {
    // 课堂数据读不到时按没有新课处理
  }
  return { ...base, freshItems: 0, freshTurns: 0, freshActivities: 0, freshLessons: lessons, canDreamNow: !paused && (lessons > 0 || retentionWork), paused };
}

function runDream(owner: string | null, who: Dreamer, manual: boolean): Promise<DreamEntry | null> {
  if (who === 'xiaobai' && !classroomReadyFor(owner)) return Promise.resolve(null);
  settleAutomaticDreams(owner,who);
  if (!loadRepo(owner,who).paused) repoOps.deduplicate(owner,who,true);
  const key = `${ownerKey(owner)}:${who}`;
  const active = running.get(key);
  if (active) return active;
  const task = (async () => {
    try {
      return who === 'xiaoyan' ? await dreamXiaoyan(owner, manual) : await dreamXiaobai(owner);
    } catch {
      return null;
    } finally {
      running.delete(key);
    }
  })();
  running.set(key, task);
  return task;
}

function autoEligible(owner: string | null, who: Dreamer): boolean {
  const state = readStore(owner)[who];
  if (state.lastDreamAt && Date.now() - Date.parse(state.lastDreamAt) < DREAM_INTERVAL_MS) return false;
  // 有没有新材料由各自的做梦函数判断；这里只挡住还有改动等我确认的情况
  return !loadRepo(owner, who).paused;
}

/** 应用打开或空闲时调用：距上次做梦够久且有新材料才会做，一次最多各做一场。不抛错、不阻塞界面。 */
export function maybeDream(owner: string | null): void {
  try {
    const key = ownerKey(owner);
    if (scheduled.has(key)) return;
    scheduled.add(key);
    const run = () => {
      scheduled.delete(key);
      void (async () => {
        // 先让两个记忆库跟上：读入新的学习行为，对账课堂记录
        syncTutorRepo(owner);
        syncXiaobaiRepo(owner);
        for (const who of ['xiaoyan', 'xiaobai'] as const) {
          try {
            if (autoEligible(owner, who)) await runDream(owner, who, false);
          } catch {
            // 一场梦没做成不影响另一场
          }
        }
      })();
    };
    const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    // 先让页面安顿下来，再挑空闲的时候做
    setTimeout(() => {
      try {
        if (idle) idle(run, { timeout: 8000 });
        else run();
      } catch {
        scheduled.delete(key);
      }
    }, 4000);
  } catch {
    // 做梦是可有可无的后台整理，出错就算了
  }
}

/** 立即做一场梦（界面上的「现在整理」）。没有可整理的材料时返回 null。 */
export async function dreamNow(owner: string | null, who: Dreamer): Promise<DreamEntry | null> {
  try {
    return await runDream(owner, who, true);
  } catch {
    return null;
  }
}

/** 小白最近一场梦里、关于这门课还想问的一句话；课堂开场可以带上。没有则为 null。 */
export function xiaobaiDreamHint(owner: string | null, topicId: string): string | null {
  try {
    if (!classroomReadyFor(owner) || useAppStore.getState().memory.paused) return null;
    const recent = (loadRepo(owner, 'xiaobai').files['questions.md'] ?? [])
      .filter((entry) => entry.source.topicId === topicId && memoryRetention(entry, 'questions.md').active && memoryRetention(entry, 'questions.md').layer !== 'recent')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const question of recent) {
      // 做完梦之后这门课又上过，那句话就算问过了
      const taughtSince = useAppStore.getState().events.some((event) => event.topicId === topicId && event.sessionId && event.t > question.updatedAt);
      return taughtSince ? null : clip(question.text, 60);
    }
    return null;
  } catch {
    return null;
  }
}
