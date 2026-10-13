/**
 * 做梦：两套记忆的离线整理。
 * 白天只是把事情记下来；「做梦」是在空闲时把近期的记忆和经历回放一遍——合并重复、从反复出现的事里提炼出更高层的认识、
 * 让久未提起的淡下去，并留下一段梦境记录。小砚整理的是「她记得的你」，小白整理的是「你教过他的课」。
 *
 * 小砚的梦会改动她的记忆（engine/tutorMemory.applyTutorDream，守着置顶与手写条目不动的线）；
 * 小白的梦只读课堂数据（appStore 的事件、掌握度、误区状态），不往里写，只留下梦境记录。
 * 有模型时由模型整理和叙述，所有输出逐项校验；没有模型时走本地规则，叙述只用真正发生的改动拼成。
 * 梦境按账号保存在当前浏览器。
 */
import { useSyncExternalStore } from 'react';
import { getTopic } from '../data';
import { completeJson } from '../lib/modelGateway';
import { useAppStore } from '../store/appStore';
import type { LearnEvent, Topic, TopicState } from '../types';
import { leakageCheck } from './leakage';
import { computeMastery, decayedMastery } from './memory';
import { demonName } from './story';
import {
  TUTOR_MEMORY_KINDS, applyTutorDream, isSensitiveMemoryText, loadTutorMemory, loadTutorTurnLog, tutorTextSimilarity,
} from './tutorMemory';
import type { TutorDreamOps, TutorDreamResult, TutorMemoryItem, TutorMemoryKind, TutorTurnDigest } from './tutorMemory';

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

// ───────────────────────── 小砚的梦：整理「她记得的你」 ─────────────────────────

const KIND_LABEL = Object.fromEntries(TUTOR_MEMORY_KINDS.map((entry) => [entry.kind, entry.label])) as Record<TutorMemoryKind, string>;
const isKind = (value: unknown): value is TutorMemoryKind => TUTOR_MEMORY_KINDS.some((entry) => entry.kind === value);
const isProtected = (item: TutorMemoryItem) => Boolean(item.pinned) || item.source === 'user' || Boolean(item.edited);
const LOCAL_MERGE_AT = 0.5;
const LOCAL_FADE_DAYS = 30;
const MODEL_FADE_DAYS = 14;

interface XiaoyanMaterial { items: TutorMemoryItem[]; changed: TutorMemoryItem[]; turns: TutorTurnDigest[]; paused: boolean }

function xiaoyanMaterial(owner: string | null): XiaoyanMaterial {
  const { consumedAt } = readStore(owner).xiaoyan;
  const state = loadTutorMemory(owner);
  return {
    items: state.items,
    changed: state.items.filter((item) => !consumedAt || item.updatedAt > consumedAt),
    turns: loadTutorTurnLog(owner).filter((turn) => !consumedAt || turn.at > consumedAt),
    paused: state.paused,
  };
}

/** 一条薄弱点说的是哪个概念：优先取引号里的词 */
function conceptOf(text: string): string {
  const quoted = /[「“"《]([^」”"》]{2,20})[」”"》]/.exec(text);
  if (quoted) return quoted[1];
  return text.replace(/^(?:总是|老是|一直|经常|每次都?|还是|始终|反复问到|同一个问题问过不止一次[:：]?)/, '').replace(/^(?:搞不清楚?|分不清楚?|弄不懂|搞不懂|不理解|记不住|容易混)/, '').slice(0, 14);
}

interface XiaoyanPlan { ops: TutorDreamOps; question: string }

/** 本地规则：合并近似重复、把同一门课反复出现的薄弱点归拢成一条、放下 30 天没提起的自动记录 */
function planXiaoyanLocal(material: XiaoyanMaterial, consumedAt: string | null): XiaoyanPlan {
  const { items, turns } = material;
  const sameScope = (a: TutorMemoryItem, b: TutorMemoryItem) => (a.topicId ?? '') === (b.topicId ?? '');

  // 合并：同类、同范围、说法相近；或者两条薄弱点指向同一个概念
  const parent = new Map<string, string>(items.map((item) => [item.id, item.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.kind !== b.kind || !sameScope(a, b)) continue;
      const exact = tutorTextSimilarity(a.text, b.text) === 1;
      if (!exact && (isProtected(a) || isProtected(b) || a.dream || b.dream)) continue;
      const sameConcept = a.kind === 'weakness' && tutorTextSimilarity(conceptOf(a.text), conceptOf(b.text)) >= 0.8;
      if (exact || sameConcept || tutorTextSimilarity(a.text, b.text) >= LOCAL_MERGE_AT) parent.set(root(a.id), root(b.id));
    }
  }
  const clusters = new Map<string, TutorMemoryItem[]>();
  for (const item of items) clusters.set(root(item.id), [...(clusters.get(root(item.id)) ?? []), item]);
  const merges: NonNullable<TutorDreamOps['merges']> = [];
  const absorbed = new Set<string>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    // 留学习者自己的原话，不留「反复问到……」这种模板句
    const own = members.filter((item) => !/^(?:反复问到|同一个问题问过)/.test(item.text));
    const text = (own.length ? own : members).reduce((best, item) => (item.text.length > best.text.length ? item : best)).text;
    merges.push({ ids: members.map((item) => item.id), text });
    for (const item of members.slice(1)) absorbed.add(item.id);
  }

  // 提炼：同一门课里有两处以上薄弱点 → 归拢成一条更高一层的认识
  const promotions: NonNullable<TutorDreamOps['promotions']> = [];
  const weakByTopic = new Map<string, TutorMemoryItem[]>();
  for (const item of items) {
    if (item.kind !== 'weakness' || !item.topicId || item.dream || absorbed.has(item.id)) continue;
    weakByTopic.set(item.topicId, [...(weakByTopic.get(item.topicId) ?? []), item]);
  }
  for (const [topicId, weak] of weakByTopic) {
    if (weak.length < 2) continue;
    const title = weak.find((item) => item.topicTitle)?.topicTitle ?? '这门课';
    const concepts = [...new Set(weak.map((item) => conceptOf(item.text)).filter(Boolean))].slice(0, 3);
    promotions.push({
      kind: 'weakness',
      text: clip(`《${clip(title, 14)}》里卡住的不止一处：${concepts.join('、')}`, 60),
      support: weak.map((item) => item.text),
      topicId,
      topicTitle: title,
    });
  }
  // 提炼：最近的提问集中在同一门课
  const asked = new Map<string, TutorTurnDigest[]>();
  for (const turn of turns) if (turn.topicId) asked.set(turn.topicId, [...(asked.get(turn.topicId) ?? []), turn]);
  const busiest = [...asked.values()].sort((a, b) => b.length - a.length)[0];
  if (busiest && busiest.length >= 4 && busiest[0].topicTitle) {
    promotions.push({
      kind: 'fact',
      text: `最近问得最多的是《${clip(busiest[0].topicTitle, 18)}》`,
      support: busiest.map((turn) => `《${turn.topicTitle}》${turn.question}`),
    });
  }

  const now = Date.now();
  const fades = items
    .filter((item) => !isProtected(item) && now - Date.parse(item.updatedAt) >= LOCAL_FADE_DAYS * DAY_MS)
    .map((item) => item.id);
  // 加深：上次整理之后又被提起过的
  const keeps = items
    .filter((item) => !absorbed.has(item.id) && (item.seen ?? 1) >= 2 && (!consumedAt || item.updatedAt > consumedAt))
    .slice(0, 4)
    .map((item) => item.id);

  return { ops: { merges, promotions, fades, keeps, fadeAfterDays: LOCAL_FADE_DAYS }, question: xiaoyanQuestion(items) };
}

/** 下次想确认的一件事：从最近的薄弱点或目标里取，不凭空造 */
function xiaoyanQuestion(items: TutorMemoryItem[]): string {
  const recent = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const weak = recent.find((item) => item.kind === 'weakness' && !item.dream);
  if (weak) return clip(`「${clip(conceptOf(weak.text), 20)}」现在弄明白了吗？下次我想先问一句。`, 60);
  const goal = recent.find((item) => item.kind === 'goal');
  if (goal) return clip(`「${clip(goal.text, 24)}」现在进展到哪一步了？`, 60);
  return '';
}

const XIAOYAN_SYSTEM = [
  '你是学习助教「小砚」。现在是夜里，你在整理白天记下的、关于这位学习者的记忆。只依据下面给出的记忆条目和最近的提问来整理，不编造其中没有的事。',
  '只输出一个 JSON 对象：',
  '{"merge":[{"ids":["m1","m2"],"text":"合并后的一句话"}],"promote":[{"kind":"weakness","text":"一条更高层的认识","from":["m3","t1"]}],"fade":["m4"],"keep":["m5"],"narrative":"……","question":"……","title":"……"}',
  '规则：',
  '- merge：只合并说同一件事的条目，每组至少两条；text 用学习者原话里的词，不超过 40 字。',
  '- promote：最多 2 条，是从反复出现的事里看出的规律；kind 取 preference / goal / weakness / strength / habit / fact；text 不超过 40 字，尽量沿用原话里的词；from 至少列出两个它依据的编号（m 开头是记忆，t 开头是提问）。',
  '- fade：只选很久没再提起、现在已经不重要的条目。keep：只选被反复印证的条目。',
  '- 标了「置顶」或「我写的」的条目不要合并、不要淡忘。',
  '- narrative：2–4 句，第一人称，语气平静，只说今晚你整理了什么，不许出现编号。question：下次想向学习者确认的一件事，不超过 40 字，没有就给空字符串。title：不超过 12 字。',
  '- 不要写入密码、密钥、手机号、邮箱、住址等隐私。没有可做的就给空数组。',
].join('\n');

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY_MS);
  return days <= 0 ? '今天' : `${days}天前`;
}

interface XiaoyanModelPlan extends XiaoyanPlan { narrative: string; title: string }

async function planXiaoyanModel(material: XiaoyanMaterial): Promise<XiaoyanModelPlan> {
  // 新近变动的排前面，条目多时只带最相关的 60 条
  const changed = new Set(material.changed.map((item) => item.id));
  const listed = [...material.items]
    .sort((a, b) => Number(changed.has(b.id)) - Number(changed.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 60);
  const turns = material.turns.slice(0, 20);
  const itemByAlias = new Map(listed.map((item, index) => [`m${index + 1}`, item]));
  const turnByAlias = new Map(turns.map((turn, index) => [`t${index + 1}`, turn]));
  const itemLines = [...itemByAlias].map(([alias, item]) => [
    alias, KIND_LABEL[item.kind], item.text,
    item.topicTitle ? `课程：${clip(item.topicTitle, 16)}` : '',
    `更新于${daysAgo(item.updatedAt)}`,
    (item.seen ?? 1) > 1 ? `提到${item.seen}次` : '',
    item.pinned ? '置顶' : '',
    item.source === 'user' || item.edited ? '我写的' : '',
  ].filter(Boolean).join('｜'));
  const turnLines = [...turnByAlias].map(([alias, turn]) => `${alias}｜${turn.topicTitle ? `《${clip(turn.topicTitle, 16)}》` : ''}${turn.question}｜${daysAgo(turn.at)}`);

  const raw = await completeJson<Record<string, unknown>>({
    messages: [
      { role: 'system', content: XIAOYAN_SYSTEM },
      { role: 'user', content: `记忆条目：\n${itemLines.join('\n') || '（没有）'}\n\n最近的提问：\n${turnLines.join('\n') || '（没有）'}` },
    ],
    effort: 'low',
    maxTokens: 1400,
    temperature: 0.3,
  });

  const aliases = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  const itemIds = (value: unknown) => aliases(value).flatMap((alias) => (itemByAlias.get(alias) ? [itemByAlias.get(alias)!.id] : []));
  const merges: NonNullable<TutorDreamOps['merges']> = [];
  for (const group of Array.isArray(raw.merge) ? raw.merge.slice(0, 8) : []) {
    if (!group || typeof group !== 'object') continue;
    const ids = itemIds((group as Record<string, unknown>).ids);
    if (ids.length >= 2) merges.push({ ids, text: tidy((group as Record<string, unknown>).text, 60) });
  }
  const promotions: NonNullable<TutorDreamOps['promotions']> = [];
  for (const promo of Array.isArray(raw.promote) ? raw.promote.slice(0, 4) : []) {
    if (!promo || typeof promo !== 'object') continue;
    const { kind, text, from } = promo as Record<string, unknown>;
    if (!isKind(kind)) continue;
    const cited = aliases(from);
    const sourceItems = cited.flatMap((alias) => (itemByAlias.get(alias) ? [itemByAlias.get(alias)!] : []));
    const support = [
      ...sourceItems.map((item) => item.text),
      ...cited.flatMap((alias) => (turnByAlias.get(alias) ? [turnByAlias.get(alias)!.question] : [])),
    ];
    // 依据都来自同一门课时，这条认识也挂在那门课下
    const topicIds = new Set(sourceItems.map((item) => item.topicId ?? ''));
    const scoped = topicIds.size === 1 && sourceItems[0]?.topicId ? sourceItems[0] : null;
    promotions.push({
      kind, text: tidy(text, 60), support,
      ...(scoped?.topicId ? { topicId: scoped.topicId, topicTitle: scoped.topicTitle } : {}),
    });
  }
  const narrative = tidy(raw.narrative, 320);
  const question = tidy(raw.question, 60);
  return {
    ops: { merges, promotions, fades: itemIds(raw.fade), keeps: itemIds(raw.keep), fadeAfterDays: MODEL_FADE_DAYS },
    narrative: narrative.length >= 12 && !isSensitiveMemoryText(narrative) && !/\b[mt]\d+\b/.test(narrative) ? narrative : '',
    question: question.length >= 4 && !isSensitiveMemoryText(question) ? question : '',
    title: tidy(raw.title, 16),
  };
}

/** 只用真正发生的改动拼出的叙述 */
function narrateXiaoyan(result: TutorDreamResult, material: XiaoyanMaterial, total: number): string {
  const lines = [total > 0
    ? `夜里我把记着的 ${total} 条翻了一遍${material.turns.length ? `，也把最近的 ${material.turns.length} 次提问回想了一下` : ''}。`
    : `夜里我把最近的 ${material.turns.length} 次提问回想了一下。`];
  if (result.merged.length) lines.push(`有 ${result.merged.length} 处说的其实是同一件事，我把它们并成了一条。`);
  if (result.promoted.length) lines.push(`从反复出现的事里，我看出了一点：${result.promoted[0].text}。`);
  if (result.faded.length) lines.push(`有 ${result.faded.length} 条很久没再提起，我就让${result.faded.length > 1 ? '它们' : '它'}淡了。`);
  if (lines.length === 1) {
    lines.push(total === 0
      ? '还没有哪件事值得单独记一笔，先放着。'
      : material.changed.length
        ? `没有重复的，也没有该放下的，新记下的 ${material.changed.length} 条都原样留着。`
        : '没有重复的，也没有该放下的，都原样留着。');
  }
  return lines.join('');
}

function xiaoyanTitle(result: TutorDreamResult): string {
  if (result.promoted.length) return '想明白了一件事';
  if (result.merged.length) return '把重复的并在了一起';
  if (result.faded.length) return '放下了几件旧事';
  return '翻了一遍，原样留着';
}

async function dreamXiaoyan(owner: string | null, manual: boolean): Promise<DreamEntry | null> {
  const material = xiaoyanMaterial(owner);
  const enough = manual
    ? material.changed.length >= 1 || material.turns.length >= 1
    : material.changed.length >= 1 || material.turns.length >= 3;
  if (material.paused || !enough || (!material.items.length && !material.turns.length)) return null;

  const total = material.items.length;
  let method: DreamEntry['method'] = 'model';
  let plan: XiaoyanPlan & { narrative?: string; title?: string };
  try {
    plan = await planXiaoyanModel(material);
  } catch {
    // 没有模型（ModelUnavailableError），或模型这次没给出合规结果：改用本地规则
    method = 'local';
    plan = planXiaoyanLocal(material, readStore(owner).xiaoyan.consumedAt);
  }
  // 等模型的这段时间里记忆可能被暂停
  if (loadTutorMemory(owner).paused) return null;

  const result = applyTutorDream(owner, plan.ops);
  const changes: DreamChange[] = [
    ...result.merged.map((merge) => ({ kind: 'merged' as const, text: clip(`把 ${merge.from.length} 条并成一条：${merge.text}`, 110) })),
    ...result.promoted.map((item) => ({ kind: 'promoted' as const, text: `${KIND_LABEL[item.kind]}：${item.text}`, ...(item.topicId ? { topicId: item.topicId } : {}) })),
    ...result.faded.map((item) => ({ kind: 'faded' as const, text: clip(`${item.text}（${daysAgo(item.updatedAt)}起没再提）`, 110) })),
    ...result.kept.slice(0, 4).map((item) => ({ kind: 'kept' as const, text: item.text })),
  ];
  // 什么都没动时，把这次新记下的列为「留着」，让记录说得清翻过了什么
  if (!changes.length) {
    for (const item of material.changed.slice(0, 3)) changes.push({ kind: 'kept', text: item.text });
  }
  const question = plan.question || (method === 'model' ? xiaoyanQuestion(loadTutorMemory(owner).items) : '');
  if (question) changes.push({ kind: 'question', text: clip(question, 60) });

  const entry: DreamEntry = {
    id: newId(),
    who: 'xiaoyan',
    at: nowIso(),
    title: plan.title || xiaoyanTitle(result),
    narrative: plan.narrative || narrateXiaoyan(result, material, total),
    changes,
    method,
  };
  saveDream(owner, entry);
  return entry;
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
  const world = readXiaobaiWorld(readStore(owner).xiaobai.consumedAt);
  // 新材料只认新上的课；光是旧课在起雾，不单独做一场梦
  if (world.paused || world.lessons.length === 0) return null;

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
  const entry: DreamEntry = {
    id: newId(),
    who: 'xiaobai',
    at: nowIso(),
    title: (method === 'model' && story.title) || `梦见先生讲《${clip(world.lessons[0].topic.title, 12)}》`,
    narrative: story.narrative || narrateXiaobai(world),
    changes: [...xiaobaiChanges(world).slice(0, 12), ...(question ? [question] : [])],
    method,
  };
  saveDream(owner, entry);
  return entry;
}

// ───────────────────────── 何时做梦 ─────────────────────────

export interface DreamStatus {
  lastDreamAt: string | null;
  /** 自动整理最早什么时候可以再来；null 表示时间上已经可以 */
  nextAutoAt: string | null;
  /** 上次整理之后攒下的新内容：小砚是新增或变动的记忆条数与提问次数，小白是新上的课数 */
  freshItems: number;
  freshTurns: number;
  freshLessons: number;
  /** 现在点「现在整理」会不会真的整理 */
  canDreamNow: boolean;
  /** 这份记忆被暂停了，暂停期间不做梦 */
  paused: boolean;
}

/** 给界面用：上次什么时候整理过、下次什么时候、现在有没有新内容 */
export function dreamStatus(owner: string | null, who: Dreamer): DreamStatus {
  const state = readStore(owner)[who];
  const last = state.lastDreamAt ? Date.parse(state.lastDreamAt) : null;
  const nextAutoAt = last !== null && Date.now() - last < DREAM_INTERVAL_MS ? new Date(last + DREAM_INTERVAL_MS).toISOString() : null;
  if (who === 'xiaoyan') {
    const material = xiaoyanMaterial(owner);
    return {
      lastDreamAt: state.lastDreamAt, nextAutoAt, freshItems: material.changed.length, freshTurns: material.turns.length, freshLessons: 0,
      canDreamNow: !material.paused && (material.changed.length >= 1 || material.turns.length >= 1),
      paused: material.paused,
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
  return { lastDreamAt: state.lastDreamAt, nextAutoAt, freshItems: 0, freshTurns: 0, freshLessons: lessons, canDreamNow: !paused && lessons > 0, paused };
}

function runDream(owner: string | null, who: Dreamer, manual: boolean): Promise<DreamEntry | null> {
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
  if (who === 'xiaobai') return true; // 有没有新课由 dreamXiaobai 自己判断
  const material = xiaoyanMaterial(owner);
  return !material.paused && (material.changed.length >= 1 || material.turns.length >= 3);
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
    const recent = readStore(owner).dreams.filter((dream) => dream.who === 'xiaobai' && Date.now() - Date.parse(dream.at) < 14 * DAY_MS);
    for (const dream of recent) {
      const question = dream.changes.find((change) => change.kind === 'question' && change.topicId === topicId);
      if (!question) continue;
      // 做完梦之后这门课又上过，那句话就算问过了
      const taughtSince = useAppStore.getState().events.some((event) => event.topicId === topicId && event.sessionId && event.t > dream.at);
      return taughtSince ? null : clip(question.text, 60);
    }
    return null;
  } catch {
    return null;
  }
}
