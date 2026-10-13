/**
 * 小砚的记忆 —— 学习终端里助教对「我」的长期记忆：偏好、目标、薄弱点、已掌握内容、习惯、背景，以及每门课里学过什么、卡在哪。
 * 与「小白的记忆」（课堂上小白记住的先生）是两套，互不混写。
 *
 * 记忆本身存在「小砚的记忆库」里（engine/memoryRepo：一棵 Markdown 文件树，每次写入都是一次提交）。
 * 这个文件负责把学习过程变成记忆：
 *   1. 对话里的明确表态 —— 即时规则（专业、目标、讲法偏好、反复问的概念、「懂了」）；
 *   2. 对话之外的全部学习行为 —— 读 engine/activityLog：做题、闪卡、笔记、AI 课堂、资料库、助理任务、科研台……
 *      卡住的进课程文件和薄弱点，学会的进已掌握，目标与兴趣各归其位；只是「做了」的噪声不记；
 *   3. 不那么明显的 —— 攒几条后交给模型提炼（completeJson，没有模型时静默跳过）。
 * 暂停后不再记入，也不交给模型。旧版按条目存的记忆第一次读取时迁入记忆库。
 */
import { useSyncExternalStore } from 'react';
import { completeJson, ModelUnavailableError } from '../lib/modelGateway';
import { ACTIVITY_LABELS, recentActivities } from './activityLog';
import type { Activity } from './activityLog';
import {
  ENTRY_TEXT_MAX, PASSIVE_FILES, addEntries, allEntries, cleanText, commitRepo, coursePath, fileInfo, isProtectedEntry, isSensitiveMemoryText,
  loadRepo, newRepoId, normalizeText, nowIso, projectPath, repoOps, subscribeRepo, textSimilarity, topicIdOfPath,
} from './memoryRepo';
import type { EntrySource, NewEntry, RepoEntry, RepoState } from './memoryRepo';

export { isSensitiveMemoryText } from './memoryRepo';

export type TutorMemoryKind = 'preference' | 'goal' | 'weakness' | 'strength' | 'habit' | 'fact';
/** 记忆库条目按六类投影出的旧形状；新代码请直接用 engine/memoryRepo */
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

export const TUTOR_MEMORY_CAP = 400;
export const TUTOR_MEMORY_TEXT_MAX = ENTRY_TEXT_MAX;

/** 六类记忆的中文名；提示词前缀与界面共用 */
export const TUTOR_MEMORY_KINDS: readonly { kind: TutorMemoryKind; label: string; hint: string }[] = [
  { kind: 'preference', label: '偏好', hint: '你喜欢怎样的讲法' },
  { kind: 'goal', label: '目标', hint: '你在为什么而学' },
  { kind: 'weakness', label: '薄弱点', hint: '反复卡住的地方' },
  { kind: 'strength', label: '已掌握', hint: '已经弄懂的内容' },
  { kind: 'habit', label: '习惯', hint: '你平时怎么学' },
  { kind: 'fact', label: '事实', hint: '专业、年级等背景' },
];

const KIND_LABEL = Object.fromEntries(TUTOR_MEMORY_KINDS.map((entry) => [entry.kind, entry.label])) as Record<TutorMemoryKind, string>;
const AUX_PREFIX = 'xiaobai-tutor-memory-v1:';
const CONCEPT_CAP = 60;
const TURN_LOG_CAP = 30;
const TURN_DIGEST_MAX = 120;
const EMPTY_STATE: TutorMemoryState = { items: [], paused: false };
const REPO = 'xiaoyan' as const;

/** 被问到的概念计数：同一概念反复问到即记为薄弱点 */
interface ConceptTrace { key: string; label: string; count: number; confused: number; topicId?: string; topicTitle?: string; at: string }
/** 记忆库之外的辅助状态：概念计数与最近提问。旧版条目也留在同一个键里，迁入记忆库后只读不写。 */
interface Entry { concepts: ConceptTrace[]; turns: TutorTurnDigest[]; legacy: Record<string, unknown> }
interface Draft {
  kind: TutorMemoryKind; text: string; topicId?: string; topicTitle?: string; source: 'auto' | 'user';
  /** 这条「已掌握」对应的概念：写入时撤掉同一概念的自动薄弱点 */
  resolves?: string;
  /** 出处；省略时记为对话 */
  origin?: EntrySource;
}
interface Turn { topicId?: string; topicTitle?: string; question: string; answer: string }

const ownerKey = (owner: string | null) => (typeof owner === 'string' && owner.trim() ? owner.trim() : 'local');
const isKind = (value: unknown): value is TutorMemoryKind => TUTOR_MEMORY_KINDS.some((entry) => entry.kind === value);
const isIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const normalize = normalizeText;
const similarity = textSimilarity;

// ───────────────────────── 辅助状态：概念计数、最近提问 ─────────────────────────

const auxCache = new Map<string, Entry>();

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readEntry(owner: string | null): Entry {
  const key = ownerKey(owner);
  const cached = auxCache.get(key);
  if (cached) return cached;
  const entry: Entry = { concepts: [], turns: [], legacy: {} };
  try {
    const text = browserStorage()?.getItem(AUX_PREFIX + key);
    const raw = text ? JSON.parse(text) as Record<string, unknown> : null;
    if (raw && typeof raw === 'object') {
      entry.legacy = raw;
      for (const candidate of Array.isArray(raw.concepts) ? raw.concepts : []) {
        if (!candidate || typeof candidate !== 'object') continue;
        const trace = candidate as Record<string, unknown>;
        if (typeof trace.key !== 'string' || typeof trace.label !== 'string' || !trace.key) continue;
        entry.concepts.push({
          key: trace.key.slice(0, 40),
          label: trace.label.slice(0, 30),
          count: typeof trace.count === 'number' && trace.count > 0 ? Math.floor(trace.count) : 1,
          confused: typeof trace.confused === 'number' && trace.confused > 0 ? Math.floor(trace.confused) : 0,
          at: isIso(trace.at) ? trace.at : nowIso(),
          ...(typeof trace.topicId === 'string' && trace.topicId ? { topicId: trace.topicId } : {}),
          ...(typeof trace.topicTitle === 'string' && trace.topicTitle ? { topicTitle: trace.topicTitle.slice(0, 60) } : {}),
        });
      }
      for (const candidate of Array.isArray(raw.turns) ? raw.turns : []) {
        if (!candidate || typeof candidate !== 'object') continue;
        const turn = candidate as Record<string, unknown>;
        const question = cleanText(turn.question, TURN_DIGEST_MAX);
        if (!question || !isIso(turn.at) || isSensitiveMemoryText(question)) continue;
        entry.turns.push({
          at: turn.at,
          question,
          ...(typeof turn.topicId === 'string' && turn.topicId ? { topicId: turn.topicId } : {}),
          ...(typeof turn.topicTitle === 'string' && turn.topicTitle ? { topicTitle: turn.topicTitle.slice(0, 60) } : {}),
        });
      }
      entry.concepts = entry.concepts.slice(0, CONCEPT_CAP);
      entry.turns = entry.turns.slice(0, TURN_LOG_CAP);
    }
  } catch {
    // 存档损坏时按空处理，不影响对话
  }
  auxCache.set(key, entry);
  return entry;
}

function writeEntry(owner: string | null, entry: Entry) {
  const key = ownerKey(owner);
  auxCache.set(key, entry);
  try {
    browserStorage()?.setItem(AUX_PREFIX + key, JSON.stringify({ ...entry.legacy, v: 1, concepts: entry.concepts, turns: entry.turns }));
  } catch {
    // 存储已满或被禁用：本次会话内仍然可用
  }
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

/** 清空记忆库时一并清掉概念计数和提问摘要 */
export function resetTutorTraces(owner: string | null): void {
  const entry = readEntry(owner);
  writeEntry(owner, { ...entry, concepts: [], turns: [] });
  recentByOwner.delete(ownerKey(owner));
  pendingByOwner.delete(ownerKey(owner));
}

// ───────────────────────── 六类 ↔ 记忆库里的位置 ─────────────────────────

/** 一类记忆该写进哪个文件：分课程的薄弱点和已掌握进课程文件，其余各归其位 */
function placeKind(kind: TutorMemoryKind, scope: { topicId?: string; topicTitle?: string } = {}): Pick<NewEntry, 'path' | 'section' | 'fileTitle'> {
  const course = scope.topicId ? { path: coursePath(scope.topicId), fileTitle: scope.topicTitle ?? scope.topicId } : null;
  if (kind === 'weakness') return course ? { ...course, section: 'stuck' } : { path: 'weak-points.md' };
  if (kind === 'strength') return course ? { ...course, section: 'mastered' } : { path: 'mastered.md' };
  if (kind === 'preference') return { path: 'preferences.md', section: 'style' };
  if (kind === 'goal') return { path: 'goals.md' };
  if (kind === 'habit') return { path: 'habits.md' };
  return { path: 'MEMORY.md' };
}

/** 做梦整理提炼出新认识时，也按同一套规则落位 */
export const placeTutorKind = placeKind;

function kindOf(path: string, entry: RepoEntry): TutorMemoryKind | null {
  if (path === 'MEMORY.md') return 'fact';
  if (path === 'preferences.md') return 'preference';
  if (path === 'goals.md') return 'goal';
  if (path === 'weak-points.md') return 'weakness';
  if (path === 'mastered.md') return 'strength';
  if (path === 'habits.md') return 'habit';
  if (path.startsWith('courses/')) {
    if (entry.section === 'mastered') return 'strength';
    if (entry.section === 'stuck' || entry.section === 'wrong' || entry.section === 'lapsed') return 'weakness';
  }
  return null;
}

const projections = new WeakMap<RepoState, TutorMemoryState>();
function project(repo: RepoState): TutorMemoryState {
  const cached = projections.get(repo);
  if (cached) return cached;
  const items: TutorMemoryItem[] = [];
  for (const { path, entry } of allEntries(repo)) {
    const kind = kindOf(path, entry);
    if (!kind) continue;
    const topicId = topicIdOfPath(path);
    items.push({
      id: entry.id, kind, text: entry.text, source: entry.author === 'user' ? 'user' : 'auto', createdAt: entry.addedAt, updatedAt: entry.updatedAt,
      ...(topicId ? { topicId, topicTitle: fileInfo(REPO, path, repo.titles).title } : {}),
      ...(entry.pinned ? { pinned: true } : {}),
      ...(entry.edited ? { edited: true } : {}),
      ...(entry.seen ? { seen: entry.seen } : {}),
      ...(entry.author === 'dream' ? { dream: true } : {}),
    });
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const state = { items, paused: repo.paused };
  projections.set(repo, state);
  return state;
}

/** 小砚记得的六类条目（记忆库的投影）。只读；改动请走 engine/memoryRepo 的 repoOps */
export function loadTutorMemory(owner: string | null): TutorMemoryState {
  try {
    return project(loadRepo(owner, REPO));
  } catch {
    return EMPTY_STATE;
  }
}

export const subscribeTutorMemory = subscribeRepo;

/** 订阅小砚的记忆，新记下的内容会立即出现 */
export function useTutorMemory(owner: string | null): TutorMemoryState {
  return useSyncExternalStore(subscribeRepo, () => loadTutorMemory(owner), () => EMPTY_STATE);
}

// ───────────────────────── 旧版记忆迁入 ─────────────────────────

function ensureMigrated(owner: string | null) {
  if (loadRepo(owner, REPO).migrated) return;
  const { legacy } = readEntry(owner);
  const at = nowIso();
  const old = (Array.isArray(legacy.items) ? legacy.items : []).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  commitRepo(owner, REPO, 'auto', `从旧版记忆迁入 ${old.length} 条`, (draft) => {
    for (const item of old) {
      const text = cleanText(item.text);
      if (!isKind(item.kind) || text.length < 2 || isSensitiveMemoryText(text)) continue;
      const topicId = typeof item.topicId === 'string' && item.topicId ? item.topicId : undefined;
      const topicTitle = typeof item.topicTitle === 'string' && item.topicTitle ? item.topicTitle : undefined;
      const place = placeKind(item.kind, { topicId, topicTitle });
      if (place.fileTitle) draft.setTitle(place.path, place.fileTitle);
      const mine = item.source === 'user';
      const addedAt = isIso(item.createdAt) ? item.createdAt : at;
      const entry: RepoEntry = {
        id: typeof item.id === 'string' && item.id ? item.id : newRepoId(),
        text,
        source: mine
          ? { type: 'user', label: '我添加的' }
          : { type: 'chat', label: topicTitle ? `对话 · ${topicTitle}` : '对话', ...(topicId ? { topicId, ref: { kind: 'topic', id: topicId, ...(topicTitle ? { title: topicTitle } : {}) } } : {}) },
        addedAt,
        updatedAt: isIso(item.updatedAt) ? item.updatedAt : addedAt,
        author: mine ? 'user' : item.dream === true ? 'dream' : 'auto',
      };
      if (place.section) entry.section = place.section;
      if (item.pinned === true) entry.pinned = true;
      if (item.edited === true) entry.edited = true;
      if (typeof item.seen === 'number' && item.seen > 1) entry.seen = Math.min(99, Math.floor(item.seen));
      draft.add(place.path, entry);
    }
  }, () => ({
    migrated: true,
    paused: legacy.paused === true,
    forgotten: (Array.isArray(legacy.forgotten) ? legacy.forgotten : []).filter((text): text is string => typeof text === 'string' && !!text).slice(0, 80),
  }));
  repoOps.markMigrated(owner, REPO);
}

// ───────────────────────── 归类 ─────────────────────────

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


/** 一条规则或模型提炼出的草稿 → 记忆库里的一条新条目 */
function draftEntry(draft: Draft): NewEntry {
  const origin: EntrySource = draft.origin ?? {
    type: 'chat',
    label: draft.topicTitle ? `对话 · ${draft.topicTitle}` : '对话',
    ...(draft.topicId ? { topicId: draft.topicId, ref: { kind: 'topic', id: draft.topicId, ...(draft.topicTitle ? { title: draft.topicTitle } : {}) } } : {}),
  };
  return { ...placeKind(draft.kind, draft), text: draft.text, source: origin };
}

/** 写入自动提炼的草稿：尊重暂停；提问摘要与概念计数一并更新 */
function commitAuto(owner: string | null, drafts: Draft[], concepts?: ConceptTrace[], digest?: TutorTurnDigest) {
  if (loadRepo(owner, REPO).paused) return;
  if (concepts || digest) {
    const entry = readEntry(owner);
    const resolvedKeys = new Set(drafts.flatMap((draft) => (draft.resolves ? [normalize(draft.resolves)] : [])));
    writeEntry(owner, {
      ...entry,
      concepts: (concepts ?? entry.concepts).filter((trace) => !resolvedKeys.has(trace.key)),
      turns: digest ? [digest, ...entry.turns].slice(0, TURN_LOG_CAP) : entry.turns,
    });
  }
  if (!drafts.length) return;
  const first = clip(drafts[0].text, 24);
  addEntries(owner, REPO, drafts.map(draftEntry), 'auto', drafts.length > 1 ? `对话里记下 ${drafts.length} 条：${first} 等` : `对话里记下：${first}`);
  // 说了「懂了」的概念：撤掉自动记下的「反复问到」
  const resolved = drafts.flatMap((draft) => (draft.resolves ? [draft.resolves] : []));
  if (resolved.length) {
    commitRepo(owner, REPO, 'auto', `说了「懂了」，撤掉「反复问到」：${resolved.join('、')}`, (draft, state) => {
      for (const { entry } of allEntries(state)) {
        if (!isProtectedEntry(entry) && resolved.some((label) => entry.text.startsWith(`反复问到「${label}」`))) draft.remove(entry.id);
      }
    });
  }
}

// ───────────────────────── 对话之外：学习行为 → 记忆 ─────────────────────────

const WRONG_SOURCES = new Set(['quiz', 'practice', 'exam']);
const STUDY_SOURCES = new Set(['lesson', 'reading', 'guided']);
const PROJECT_SOURCES = new Set(['agent', 'research']);

/** 一条学习行为该不该记、记到哪个文件。只是「做了」而没透露什么的不记。 */
function activityEntries(activity: Activity): NewEntry[] {
  const summary = cleanText(activity.summary, 90);
  const detail = cleanText(activity.detail, 60);
  if (!summary) return [];
  const title = activity.topicTitle;
  const source: EntrySource = {
    type: activity.source,
    label: `${ACTIVITY_LABELS[activity.source]}${title ? ` · ${title}` : ''}`,
    activityId: activity.id,
    ...(activity.topicId ? { topicId: activity.topicId } : {}),
    ...(activity.ref ? { ref: activity.ref } : activity.topicId ? { ref: { kind: 'topic', id: activity.topicId, ...(title ? { title } : {}) } } : {}),
  };
  const full = detail && !summary.includes(detail) ? clip(`${summary}：${detail}`, ENTRY_TEXT_MAX) : summary;
  const course = activity.topicId ? { path: coursePath(activity.topicId), fileTitle: title ?? activity.topicId } : null;
  const entry = (place: Pick<NewEntry, 'path' | 'section' | 'fileTitle'>, text = full): NewEntry[] => [{ ...place, text, source, at: activity.at }];

  if (activity.source === 'library') return entry({ path: 'materials.md' });
  switch (activity.signal) {
    case 'struggle': {
      const section = WRONG_SOURCES.has(activity.source) ? 'wrong' : activity.source === 'flashcards' ? 'lapsed' : 'stuck';
      return entry(course ? { ...course, section } : { path: 'weak-points.md' });
    }
    case 'success':
      return entry(course ? { ...course, section: 'mastered' } : { path: 'mastered.md' });
    case 'goal':
      // 目标的原话在 detail 里时，记原话
      return entry({ path: 'goals.md' }, detail || summary);
    case 'interest':
      return entry({ path: 'preferences.md', section: 'interest' });
    default:
      if (PROJECT_SOURCES.has(activity.source)) {
        return entry({ path: projectPath(activity.ref?.id ?? activity.source), fileTitle: activity.ref?.title ?? ACTIVITY_LABELS[activity.source] });
      }
      if (course && STUDY_SOURCES.has(activity.source)) return entry({ ...course, section: 'studied' });
      return [];
  }
}

/**
 * 读学习行为日志里还没看过的部分，把有含义的记进记忆库。返回新记下的条数。
 * 暂停期间的行为直接跳过（游标照常前移，恢复后也不补记）。
 */
export function ingestActivities(owner: string | null): number {
  try {
    const repo = loadRepo(owner, REPO);
    const fresh = recentActivities(owner, repo.cursor ? { since: repo.cursor } : { limit: 80 });
    if (!fresh.length) return 0;
    const cursor = fresh.reduce((latest, activity) => (activity.at > latest ? activity.at : latest), fresh[0].at);
    if (repo.paused) {
      repoOps.setCursor(owner, REPO, cursor);
      return 0;
    }
    const inputs = fresh.flatMap(activityEntries);
    const labels = [...new Set(fresh.filter((activity) => activityEntries(activity).length).map((activity) => ACTIVITY_LABELS[activity.source]))];
    const added = inputs.length ? addEntries(owner, REPO, inputs, 'auto', `从学习行为里记下：${labels.slice(0, 4).join('、')}`) : [];
    repoOps.setCursor(owner, REPO, cursor);
    // 带细节的行为再交给模型看一眼，提炼规则认不出的东西
    const subtle = fresh.filter((activity) => activity.detail && activity.source !== 'library');
    if (subtle.length) queueExtraction(owner, undefined, subtle);
    return added.length;
  } catch {
    return 0;
  }
}

/** 让记忆库跟上：迁入旧版记忆，读入新的学习行为。界面打开、取提示词、做梦之前都会调。 */
export function syncTutorRepo(owner: string | null): void {
  try {
    ensureMigrated(owner);
    ingestActivities(owner);
  } catch {
    // 同步失败不影响使用
  }
}

// ───────────────────────── 模型提炼（防抖，每隔几轮或几条行为一次） ─────────────────────────

const EXTRACT_EVERY = 2;
const EXTRACT_DELAY_MS = 1600;
const UNAVAILABLE_COOLDOWN_MS = 5 * 60_000;
interface PendingSlot { turns: Turn[]; activities: Activity[]; timer: ReturnType<typeof setTimeout> | null; running: boolean; runs: number; blockedUntil: number }
const pendingByOwner = new Map<string, PendingSlot>();

const EXTRACT_SYSTEM = [
  '你是学习助教「小砚」的记忆整理员。读下面的问答和学习行为，提炼 0–3 条值得长期记住的、关于这位学习者本人的信息。',
  'kind 只能取：preference（喜欢的讲解方式）、goal（学习目标或考试安排）、weakness（反复卡住的知识点）、strength（已经掌握的内容）、habit（学习习惯）、fact（专业、年级等背景）。',
  '每条 text 是一句不超过 40 字的中文陈述，不带「用户」「学习者」这类主语。from 填它依据的那一条的编号（a1、a2… 是学习行为；来自问答就填 "chat"）。',
  '只记以后还用得上的稳定信息；忽略一次性的题目细节、寒暄和助教自己说的话；已经记住的不要重复。',
  '不要记录密码、密钥、手机号、邮箱、住址、证件号等隐私或联系方式。没有值得记的就返回空数组。',
  '只输出 JSON：{"memories":[{"kind":"goal","text":"……","from":"chat"}]}',
].join('\n');

function parseExtraction(result: unknown, turn: Turn | undefined, activities: Activity[]): Draft[] {
  const source = Array.isArray(result) ? result : (result as { memories?: unknown; items?: unknown } | null)?.memories
    ?? (result as { items?: unknown } | null)?.items;
  if (!Array.isArray(source)) return [];
  const drafts: Draft[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    const text = cleanText(typeof raw.text === 'string' ? raw.text.replace(/^(?:用户|学习者|该?同学|学生|他|她|你|我)(?:是|的)?/, '') : '', 60);
    if (!isKind(raw.kind) || text.length < 2) continue;
    const cited = typeof raw.from === 'string' ? activities[Number(/^a(\d+)$/.exec(raw.from)?.[1] ?? 0) - 1] : undefined;
    const scoped = raw.kind === 'weakness' || raw.kind === 'strength';
    if (cited) {
      const [like] = activityEntries({ ...cited, signal: 'struggle' });
      drafts.push({
        kind: raw.kind, text, source: 'auto', ...(like ? { origin: like.source } : {}),
        ...(scoped && cited.topicId ? { topicId: cited.topicId, ...(cited.topicTitle ? { topicTitle: cited.topicTitle } : {}) } : {}),
      });
    } else if (turn) {
      drafts.push({ kind: raw.kind, text, source: 'auto', ...(scoped ? topicScope(turn) : {}) });
    } else {
      continue;
    }
    if (drafts.length >= 3) break;
  }
  return drafts;
}

async function runExtraction(owner: string | null, slot: PendingSlot) {
  if (slot.running || (!slot.turns.length && !slot.activities.length)) return;
  const turns = slot.turns.splice(0);
  const activities = slot.activities.splice(0).slice(-8);
  slot.running = true;
  slot.runs += 1;
  try {
    const { items, paused } = loadTutorMemory(owner);
    if (paused) return;
    const known = items.slice(0, 14).map((item) => `- ${KIND_LABEL[item.kind]}：${item.text}`).join('\n') || '（还没有）';
    const dialogue = turns
      .map((turn, index) => `【第 ${index + 1} 轮${turn.topicTitle ? ` · ${clip(turn.topicTitle, 24)}` : ''}】\n学习者：${clip(turn.question, 420)}\n小砚：${clip(turn.answer, 360)}`)
      .join('\n\n');
    const behaviour = activities
      .map((activity, index) => `a${index + 1}｜${ACTIVITY_LABELS[activity.source]}${activity.topicTitle ? `｜《${clip(activity.topicTitle, 20)}》` : ''}｜${clip(activity.summary, 80)}${activity.detail ? `｜${clip(activity.detail, 160)}` : ''}`)
      .join('\n');
    const result = await completeJson<unknown>({
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `已经记住的：\n${known}\n\n最近的问答：\n${dialogue || '（没有）'}\n\n最近的学习行为：\n${behaviour || '（没有）'}` },
      ],
      // 后台整理不占用学习者选的深度档位
      effort: 'low',
      maxTokens: 900,
      temperature: 0.2,
    });
    const drafts = parseExtraction(result, turns[turns.length - 1], activities);
    if (drafts.length) commitAuto(owner, drafts);
  } catch (error) {
    // 没有可用模型时歇一阵再试；其余错误（超时、JSON 不合规）丢弃这一批
    if (error instanceof ModelUnavailableError) slot.blockedUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
  } finally {
    slot.running = false;
    if (slot.turns.length + slot.activities.length >= EXTRACT_EVERY) scheduleExtraction(owner, slot);
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

function queueExtraction(owner: string | null, turn?: Turn, activities: Activity[] = []) {
  const key = ownerKey(owner);
  const slot = pendingByOwner.get(key) ?? { turns: [], activities: [], timer: null, running: false, runs: 0, blockedUntil: 0 };
  pendingByOwner.set(key, slot);
  if (turn) slot.turns = [...slot.turns, turn].slice(-4);
  if (activities.length) slot.activities = [...slot.activities, ...activities].slice(-8);
  // 头两次有一条就整理，让新用户很快看到记忆；之后攒几条再整理
  if (slot.turns.length + slot.activities.length >= (slot.runs < 2 ? 1 : EXTRACT_EVERY)) scheduleExtraction(owner, slot);
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
        syncTutorRepo(owner);
        if (loadRepo(owner, REPO).paused) return;
        const { drafts, concepts } = observeQuestion(owner, readEntry(owner), turn);
        // 提问摘要留给做梦整理回放；含隐私的提问不留
        const digestText = cleanText(turn.question, TURN_DIGEST_MAX);
        const digest: TutorTurnDigest | undefined = digestText && !isSensitiveMemoryText(turn.question)
          ? { at: nowIso(), question: digestText, ...(turn.topicId ? { topicId: turn.topicId } : {}), ...(turn.topicTitle ? { topicTitle: turn.topicTitle } : {}) }
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

// ───────────────────────── 交给模型的要点 ─────────────────────────

const stripLinks = (text: string) => text.replace(/[，,；;]?\s*(?:详见|见)?\s*\[\[[^\]]*\]\]/g, '').trim();

function hintLine(repo: RepoState, path: string, entry: RepoEntry): string {
  const info = fileInfo(REPO, path, repo.titles);
  const section = info.sections?.find((candidate) => candidate.id === entry.section)?.label;
  const label = path === 'MEMORY.md'
    ? '背景'
    : info.folder === 'courses' ? `${section ?? '课程'}（${clip(info.title, 18)}）` : section ? `${info.title} · ${section}` : info.title;
  return clip(`${label}：${stripLinks(entry.text)}`, 120);
}

/**
 * 注入提示词的记忆要点（每条一句话），取前 limit 条；暂停时返回空数组。
 * 取法照「入口文件 + 按需取用」：MEMORY.md 里始终记着的、置顶的、当前课程文件里最相关的几行，
 * 再从目标、偏好、薄弱点等文件里轮流各取最近的一条。只有这几行会交给模型，记忆库的其余内容留在本机。
 */
export function tutorMemoryHints(owner: string | null, topicId?: string, limit = 6): string[] {
  try {
    syncTutorRepo(owner);
    const repo = loadRepo(owner, REPO);
    if (repo.paused || limit <= 0) return [];
    const recentFirst = (path: string) => [...(repo.files[path] ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((entry) => ({ path, entry }));
    const pinned = allEntries(repo)
      .filter(({ path, entry }) => entry.pinned && !PASSIVE_FILES.includes(path))
      .sort((a, b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt));
    // 当前课程：卡住的、做错的、忘掉的排在学过的前面
    const urgency = (entry: RepoEntry) => (entry.section === 'stuck' || entry.section === 'wrong' || entry.section === 'lapsed' ? 0 : 1);
    const course = topicId ? recentFirst(coursePath(topicId)).sort((a, b) => urgency(a.entry) - urgency(b.entry)) : [];
    // 当前课程最相关：每一轮取两行
    const buckets = [
      pinned, recentFirst('MEMORY.md'), course.filter((_, index) => index % 2 === 0), recentFirst('goals.md'), recentFirst('preferences.md'),
      course.filter((_, index) => index % 2 === 1), recentFirst('weak-points.md'), recentFirst('habits.md'), recentFirst('mastered.md'), recentFirst('materials.md'),
    ];
    // 各处轮流取：早先说过的讲法偏好不会被后来的零碎记录挤出去
    const picked: { path: string; entry: RepoEntry }[] = [];
    const taken = new Set<string>();
    for (let round = 0; picked.length < limit && buckets.some((bucket) => bucket.length > round); round += 1) {
      for (const bucket of buckets) {
        const candidate = bucket[round];
        if (!candidate || taken.has(candidate.entry.id) || picked.length >= limit) continue;
        taken.add(candidate.entry.id);
        picked.push(candidate);
      }
    }
    return picked.map(({ path, entry }) => hintLine(repo, path, entry));
  } catch {
    return [];
  }
}
