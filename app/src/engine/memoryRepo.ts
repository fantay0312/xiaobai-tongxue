/**
 * 记忆库 —— 每个角色、每个账号各有一个：小砚的记忆库（她记得的你）和小白的记忆库（你教过他的课）。
 *
 * 形态参照「记忆即文件」：一棵小小的 Markdown 文件树，像维基一样互相链接。
 *   MEMORY.md 是入口，只放每次都要带上的要点和一份索引；其余细节放在各自的文件里，按需取用。
 *   一件事只记在一处；一条记忆是一行，行尾带出处与日期，出处能跳回它被学到的地方。
 *   每次写入都是一次提交（谁写的、为什么、改了哪几行），留有历史，可以逐次撤销。
 *
 * 存储：条目以结构化形式按账号保存在当前浏览器（localStorage），Markdown 由条目渲染得出；
 * 每个文件最多 80 条、整库最多 400 条、历史最多 200 次提交。
 */
import { useSyncExternalStore } from 'react';
import type { MemoryLayer } from './memoryRetention';

export type RepoId = 'xiaoyan' | 'xiaobai';
/** auto=学习过程中自动记下 user=我亲手写或改 dream=做梦整理 */
export type EntryAuthor = 'auto' | 'user' | 'dream';

export interface EntrySource {
  /** 行为来源（activityLog 的 source），或 user / dream / classroom / legacy */
  type: string;
  /** 人读的出处，如「闪卡 · 梯度下降」 */
  label: string;
  topicId?: string;
  /** 产生它的那条学习行为 */
  activityId?: string;
  /** 指回产生它的东西，界面据此跳回去 */
  ref?: { kind: string; id: string; title?: string };
}

export interface RepoEntry {
  id: string;
  text: string;
  /** 文件里的小节，如课程文件的「卡住的地方」「错题」 */
  section?: string;
  source: EntrySource;
  addedAt: string;
  updatedAt: string;
  author: EntryAuthor;
  pinned?: boolean;
  /** 自动记下后被我改过：之后不会被自动覆盖 */
  edited?: boolean;
  /** 同一件事被再次观察到的次数 */
  seen?: number;
  retention?: MemoryLayer;
}

/** 一处改动：before 为空是新增，after 为空是删除，都有是修改；跨文件移动记成一删一增 */
export interface RepoChange { path: string; before: RepoEntry | null; after: RepoEntry | null }
export interface RepoCommit {
  id: string; at: string; author: EntryAuthor; message: string; changes: RepoChange[];
  /** 这次提交是对哪次提交的撤销 */
  revertOf?: string;
  /** 已被撤销 */
  reverted?: boolean;
}

export type ProposalKind = 'merged' | 'promoted' | 'faded' | 'kept' | 'question' | 'moved' | 'ruled';
/**
 * 做梦提出的一处改动。给了 toPath 时表示「从 path 拿走 before，在 toPath 写下 after」——
 * 归档、从入口文件挪走、把不成立的说法改记到「排除掉的」，都是这一种。
 */
export interface ProposalChange extends RepoChange { id: string; kind: ProposalKind; note: string; toPath?: string }
export interface RepoProposal { id: string; at: string; title: string; narrative: string; method: 'model' | 'local'; changes: ProposalChange[] }

export interface RepoState {
  repo: RepoId;
  /** path → 条目（新的在前） */
  files: Record<string, RepoEntry[]>;
  /** 动态文件的标题，如 courses/<topicId>.md → 课程名 */
  titles: Record<string, string>;
  /** 提交历史，新的在前 */
  commits: RepoCommit[];
  /** 暂停后不再自动记入，也不交给模型（小白的暂停沿用课堂记忆的开关） */
  paused: boolean;
  /** 做梦后先给我看再生效 */
  review: boolean;
  pending: RepoProposal | null;
  /** 学习行为日志已经读到的时刻 */
  cursor: string | null;
  /** 我删掉的自动条目：之后不再自动记回来 */
  forgotten: string[];
  /** 旧版记忆是否已迁入 */
  migrated: boolean;
  /** 清空或暂停后，旧的后台任务不得再写入。 */
  workGeneration: string;
  dedupeVersion: number;
}

export const REPO_NAMES: Record<RepoId, string> = { xiaoyan: '小砚的记忆库', xiaobai: '小白的记忆库' };
export const ENTRY_TEXT_MAX = 120;
const FILE_CAP = 80;
const REPO_CAP = 400;
const COMMIT_CAP = 200;
const FORGOTTEN_CAP = 400;
const DUPLICATE_AT = 0.72;
const STORAGE_PREFIX = 'xiaobai-memory-repo-v1:';

// ───────────────────────── 文件目录 ─────────────────────────

export interface RepoSection { id: string; label: string }
export interface RepoFileInfo {
  path: string;
  title: string;
  /** 这个文件记什么 */
  hint: string;
  /** 文件夹：courses / projects / lessons；顶层文件为空 */
  folder?: string;
  sections?: RepoSection[];
}

const COURSE_SECTIONS: RepoSection[] = [
  { id: 'stuck', label: '卡住的地方' },
  { id: 'wrong', label: '错题' },
  { id: 'lapsed', label: '忘掉的卡片' },
  { id: 'studied', label: '学过的' },
  { id: 'explained', label: '讲得明白的讲法' },
  { id: 'mastered', label: '已掌握' },
];
const LESSON_SECTIONS: RepoSection[] = [
  { id: 'taught', label: '先生讲明白的' },
  { id: 'analogy', label: '先生打的比方' },
  { id: 'cleared', label: '想通了的' },
  { id: 'open', label: '还没想通的' },
  { id: 'fading', label: '开始模糊的' },
];
const TEACHER_SECTIONS: RepoSection[] = [
  { id: 'preference', label: '偏好' },
  { id: 'habit', label: '习惯' },
  { id: 'strength', label: '长处' },
  { id: 'weakness', label: '短板' },
  { id: 'milestone', label: '里程碑' },
  { id: 'note', label: '笔记' },
];

const STATIC_FILES: Record<RepoId, RepoFileInfo[]> = {
  xiaoyan: [
    { path: 'MEMORY.md', title: '记忆总览', hint: '这里的背景只在与当前问题相关时使用。一次性问题不会自动变成长久的偏好。' },
    { path: 'preferences.md', title: '讲法偏好', hint: '你喜欢怎样的讲法，对什么感兴趣。', sections: [{ id: 'style', label: '讲法' }, { id: 'interest', label: '感兴趣的' }] },
    { path: 'goals.md', title: '目标', hint: '你在为什么而学：考试、升学，或想学会的东西。' },
    { path: 'weak-points.md', title: '薄弱点', hint: '不分课程的薄弱点，和从各门课里看出的规律。具体卡在哪一题，记在各门课的文件里。' },
    { path: 'mastered.md', title: '已掌握', hint: '已经弄懂、不用再从头讲的内容。' },
    { path: 'habits.md', title: '习惯', hint: '你平时怎么学、什么时候学、常用哪些工具。' },
    { path: 'materials.md', title: '资料', hint: '你上传和读过的资料。' },
    { path: 'profile.md', title: '背景细节', hint: '入口文件放不下的背景信息。整理时会把细节从「始终记着的」挪到这里。' },
    { path: 'ruled-out.md', title: '排除掉的', hint: '整理时发现已经不成立的说法，留一笔免得再记回来。' },
    { path: 'archive.md', title: '归档', hint: '很久没再提起的旧记录。不会交给小砚，想留的可以置顶或改回去。' },
  ],
  xiaobai: [
    { path: 'MEMORY.md', title: '始终记着的', hint: '小白心里的先生，和他总共学到了什么。' },
    { path: 'teacher.md', title: '先生怎么教', hint: '小白在课上记下的：你的讲法、长处和短板。', sections: TEACHER_SECTIONS },
    { path: 'questions.md', title: '还想问的', hint: '小白醒来还惦记着、想在下一堂课问你的话。' },
    { path: 'archive.md', title: '归档', hint: '很久没再提起的旧记录。' },
  ],
};
const FOLDER_LABEL: Record<string, string> = { courses: '课程', projects: '任务与课题', lessons: '教过的课' };
export const folderLabel = (folder: string) => FOLDER_LABEL[folder] ?? folder;
/** 不交给模型、也不参与整理的文件 */
export const PASSIVE_FILES = ['archive.md', 'ruled-out.md'];

export const coursePath = (topicId: string) => `courses/${encodeURIComponent(topicId)}.md`;
export const lessonPath = (topicId: string) => `lessons/${encodeURIComponent(topicId)}.md`;
export const projectPath = (slug: string) => `projects/${encodeURIComponent(slug)}.md`;
/** courses/<topicId>.md 或 lessons/<topicId>.md 对应的课程 id */
export function topicIdOfPath(path: string): string | null {
  const match = /^(?:courses|lessons)\/(.+)\.md$/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function fileInfo(repo: RepoId, path: string, titles: Record<string, string> = {}): RepoFileInfo {
  const fixed = STATIC_FILES[repo].find((file) => file.path === path);
  if (fixed) return fixed;
  const folder = path.includes('/') ? path.slice(0, path.indexOf('/')) : undefined;
  const fallback = path.replace(/^.*\//, '').replace(/\.md$/, '');
  const title = titles[path] ?? fallback;
  if (folder === 'courses') return { path, title, folder, hint: '这门课里学过什么、卡在哪、做错的题、忘掉的卡片，和讲得明白的讲法。', sections: COURSE_SECTIONS };
  if (folder === 'lessons') return { path, title, folder, hint: '这门课你给小白讲明白了什么、打过的比方，他想通了和还没想通的地方。', sections: LESSON_SECTIONS };
  if (folder === 'projects') return { path, title, folder, hint: '交给小砚办的任务和科研课题里值得记住的事。' };
  return { path, title, folder, hint: '' };
}

/** 文件树：固定文件总在（哪怕还空着），课程、任务等文件有内容才出现 */
export function listFiles(state: RepoState): (RepoFileInfo & { count: number })[] {
  const count = (path: string) => state.files[path]?.length ?? 0;
  const fixed = STATIC_FILES[state.repo];
  const dynamic = Object.keys(state.files)
    .filter((path) => count(path) > 0 && !fixed.some((file) => file.path === path))
    .sort((a, b) => a.localeCompare(b));
  // 归档、排除掉的、背景细节没有内容时不占位置
  const hideEmpty = [...PASSIVE_FILES, 'profile.md'];
  return [
    ...fixed.filter((file) => !hideEmpty.includes(file.path) || count(file.path) > 0).map((file) => ({ ...file, count: count(file.path) })),
    ...dynamic.map((path) => ({ ...fileInfo(state.repo, path, state.titles), count: count(path) })),
  ];
}

// ───────────────────────── 文本工具：清洗、隐私过滤、相似度 ─────────────────────────

const SENSITIVE_WORDS = /(密码|口令|密钥|验证码|pass(?:word|wd)?|api[\s_-]?key|secret)\s*(?:是|为|[:：=])|身份证号?|银行卡|支付密码|手机号|电话号码|微信号|qq\s*号|邮箱|家庭住址|住址|门牌号|(?:access|api|auth|bearer|refresh)[\s_-]?token/i;
const SENSITIVE_SHAPES = /1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w.-]+|\d{7,}|https?:\/\/|\bsk-[a-z0-9_-]{8,}/i;

/** 密码、密钥、联系方式一类内容不进记忆 */
export function isSensitiveMemoryText(text: string): boolean {
  return SENSITIVE_WORDS.test(text) || SENSITIVE_SHAPES.test(text);
}

export function cleanText(value: unknown, max = ENTRY_TEXT_MAX): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').replace(/^[\s，。、；：:,.;!！?？~～\-—]+|[\s，。、；：:,.;!！~～\-—]+$/g, '').slice(0, max).trim();
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\[\[[^\]]*\]\]/g, '').replace(/[\s\p{P}\p{S}]+/gu, '').replace(/^(?:我们?|你|用户|学习者|该?同学)+/, '');
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

/** 两句话说的是不是同一件事：归一化后的二元组 Dice 系数，一方完整包含另一方也算 */
export function textSimilarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
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

/** text 里有多少内容能在 sources 里找到出处（按二元组算，0..1） */
export function supportedBy(text: string, sources: string[]): number {
  const pool = new Set<string>();
  for (const source of sources) for (const gram of bigrams(normalizeText(source)).keys()) pool.add(gram);
  let hit = 0;
  let total = 0;
  for (const [gram, count] of bigrams(normalizeText(text))) {
    total += count;
    if (pool.has(gram)) hit += count;
  }
  return total ? hit / total : 0;
}

/** 置顶的、我写的、我改过的：自动整理不改不删 */
export const isProtectedEntry = (entry: RepoEntry) => Boolean(entry.pinned) || entry.author === 'user' || Boolean(entry.edited);

// ───────────────────────── 存取与订阅 ─────────────────────────

const cache = new Map<string, RepoState>();
const listeners = new Set<() => void>();

const ownerKey = (owner: string | null) => (typeof owner === 'string' && owner.trim() ? owner.trim() : 'local');
const storageKey = (owner: string | null, repo: RepoId) => `${STORAGE_PREFIX}${repo}:${ownerKey(owner)}`;
export const nowIso = () => new Date().toISOString();
export const newRepoId = () => globalThis.crypto?.randomUUID?.() ?? `mr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const isIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function emptyState(repo: RepoId): RepoState {
  return { repo, files: {}, titles: {}, commits: [], paused: false, review: false, pending: null, cursor: null, forgotten: [], migrated: false, workGeneration: '', dedupeVersion: 0 };
}

function sanitizeSource(value: unknown): EntrySource {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const ref = raw.ref && typeof raw.ref === 'object' ? raw.ref as Record<string, unknown> : null;
  return {
    type: typeof raw.type === 'string' && raw.type ? raw.type.slice(0, 24) : 'legacy',
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 60) : '较早的记录',
    ...(typeof raw.topicId === 'string' && raw.topicId ? { topicId: raw.topicId.slice(0, 120) } : {}),
    ...(typeof raw.activityId === 'string' && raw.activityId ? { activityId: raw.activityId.slice(0, 80) } : {}),
    ...(ref && typeof ref.kind === 'string' && typeof ref.id === 'string'
      ? { ref: { kind: ref.kind.slice(0, 40), id: ref.id.slice(0, 120), ...(typeof ref.title === 'string' && ref.title ? { title: ref.title.slice(0, 80) } : {}) } }
      : {}),
  };
}

function sanitizeEntry(value: unknown): RepoEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = cleanText(raw.text);
  if (!text || typeof raw.id !== 'string' || !raw.id || isSensitiveMemoryText(text)) return null;
  const addedAt = isIso(raw.addedAt) ? raw.addedAt : nowIso();
  const entry: RepoEntry = {
    id: raw.id,
    text,
    source: sanitizeSource(raw.source),
    addedAt,
    updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : addedAt,
    author: raw.author === 'user' || raw.author === 'dream' ? raw.author : 'auto',
  };
  if (typeof raw.section === 'string' && raw.section) entry.section = raw.section.slice(0, 24);
  if (raw.pinned === true) entry.pinned = true;
  if (raw.edited === true) entry.edited = true;
  if (raw.retention === 'recent' || raw.retention === 'short' || raw.retention === 'long') entry.retention = raw.retention;
  if (typeof raw.seen === 'number' && Number.isFinite(raw.seen) && raw.seen > 1) entry.seen = Math.min(99, Math.floor(raw.seen));
  return entry;
}

function sanitizeChange(value: unknown): RepoChange | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string' || !raw.path) return null;
  const before = raw.before ? sanitizeEntry(raw.before) : null;
  const after = raw.after ? sanitizeEntry(raw.after) : null;
  return before || after ? { path: raw.path.slice(0, 200), before, after } : null;
}

const PROPOSAL_KINDS: readonly ProposalKind[] = ['merged', 'promoted', 'faded', 'kept', 'question', 'moved', 'ruled'];

function sanitizeState(repo: RepoId, value: unknown): RepoState {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const state = emptyState(repo);
  const seen = new Set<string>();
  for (const [path, list] of Object.entries(raw.files && typeof raw.files === 'object' ? raw.files as Record<string, unknown> : {})) {
    if (!Array.isArray(list)) continue;
    const entries: RepoEntry[] = [];
    for (const candidate of list) {
      const entry = sanitizeEntry(candidate);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    if (entries.length) state.files[path.slice(0, 200)] = entries.slice(0, FILE_CAP);
  }
  for (const [path, title] of Object.entries(raw.titles && typeof raw.titles === 'object' ? raw.titles as Record<string, unknown> : {})) {
    if (typeof title === 'string' && title.trim()) state.titles[path.slice(0, 200)] = title.trim().slice(0, 80);
  }
  for (const candidate of Array.isArray(raw.commits) ? raw.commits : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const commit = candidate as Record<string, unknown>;
    const changes = (Array.isArray(commit.changes) ? commit.changes : []).map(sanitizeChange).filter((change): change is RepoChange => change !== null);
    if (typeof commit.id !== 'string' || !isIso(commit.at) || !changes.length) continue;
    state.commits.push({
      id: commit.id,
      at: commit.at,
      author: commit.author === 'user' || commit.author === 'dream' ? commit.author : 'auto',
      message: typeof commit.message === 'string' ? commit.message.slice(0, 160) : '',
      changes: changes.slice(0, REPO_CAP * 2),
      ...(typeof commit.revertOf === 'string' ? { revertOf: commit.revertOf } : {}),
      ...(commit.reverted === true ? { reverted: true } : {}),
    });
  }
  state.commits = state.commits.slice(0, COMMIT_CAP);
  state.paused = raw.paused === true;
  state.review = raw.review === true;
  state.cursor = isIso(raw.cursor) ? raw.cursor : null;
  state.migrated = raw.migrated === true;
  state.workGeneration = typeof raw.workGeneration === 'string' ? raw.workGeneration : '';
  state.dedupeVersion = raw.dedupeVersion === 1 ? 1 : 0;
  state.forgotten = (Array.isArray(raw.forgotten) ? raw.forgotten : []).filter((text): text is string => typeof text === 'string' && !!text).slice(0, FORGOTTEN_CAP);
  const pending = raw.pending && typeof raw.pending === 'object' ? raw.pending as Record<string, unknown> : null;
  if (pending && typeof pending.id === 'string' && isIso(pending.at)) {
    const changes: ProposalChange[] = [];
    for (const candidate of Array.isArray(pending.changes) ? pending.changes : []) {
      const change = sanitizeChange(candidate);
      const extra = candidate as Record<string, unknown>;
      if (!change || typeof extra.id !== 'string') continue;
      changes.push({
        ...change,
        id: extra.id,
        kind: PROPOSAL_KINDS.includes(extra.kind as ProposalKind) ? extra.kind as ProposalKind : 'kept',
        note: typeof extra.note === 'string' ? extra.note.slice(0, 160) : '',
        ...(typeof extra.toPath === 'string' && extra.toPath ? { toPath: extra.toPath.slice(0, 200) } : {}),
      });
    }
    if (changes.length) {
      state.pending = {
        id: pending.id,
        at: pending.at,
        title: typeof pending.title === 'string' ? pending.title.slice(0, 40) : '一场梦',
        narrative: typeof pending.narrative === 'string' ? pending.narrative.slice(0, 400) : '',
        method: pending.method === 'model' ? 'model' : 'local',
        changes,
      };
    }
  }
  return state;
}

function read(owner: string | null, repo: RepoId): RepoState {
  const key = storageKey(owner, repo);
  const cached = cache.get(key);
  if (cached) return cached;
  let state = emptyState(repo);
  try {
    const text = browserStorage()?.getItem(key);
    if (text) state = sanitizeState(repo, JSON.parse(text));
  } catch {
    // 存档损坏时按空库处理
  }
  cache.set(key, state);
  return state;
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

function write(owner: string | null, state: RepoState) {
  const key = storageKey(owner, state.repo);
  cache.set(key, state);
  try {
    browserStorage()?.setItem(key, JSON.stringify({ v: 1, ...state }));
  } catch {
    // 存储已满或被禁用：本次会话内仍然可用
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null) cache.clear();
    else if (event.key.startsWith(STORAGE_PREFIX)) cache.delete(event.key);
    else return;
    emit();
  });
}

export function subscribeRepo(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 读取记忆库。返回值是只读快照，改动请走 repoOps / commitRepo */
export function loadRepo(owner: string | null, repo: RepoId): RepoState {
  try {
    return read(owner, repo);
  } catch {
    return emptyState(repo);
  }
}

const SERVER_STATE: Record<RepoId, RepoState> = { xiaoyan: emptyState('xiaoyan'), xiaobai: emptyState('xiaobai') };
export function useRepo(owner: string | null, repo: RepoId): RepoState {
  return useSyncExternalStore(subscribeRepo, () => loadRepo(owner, repo), () => SERVER_STATE[repo]);
}

// ───────────────────────── 提交 ─────────────────────────

export interface RepoDraft {
  /** 当前（含本次提交里已做的改动）某个文件的条目 */
  entries: (path: string) => RepoEntry[];
  find: (id: string) => { path: string; entry: RepoEntry } | null;
  add: (path: string, entry: RepoEntry) => void;
  update: (id: string, next: RepoEntry) => void;
  remove: (id: string) => void;
  /** 只刷新时间和次数，不进历史 */
  touch: (id: string, patch: Partial<Pick<RepoEntry, 'updatedAt' | 'seen'>>) => void;
  setTitle: (path: string, title: string) => void;
}

function capFiles(files: Record<string, RepoEntry[]>): Record<string, RepoEntry[]> {
  const rank = (entry: RepoEntry) => (entry.pinned ? 2 : isProtectedEntry(entry) ? 1 : 0);
  const trim = (entries: RepoEntry[], cap: number) => {
    if (entries.length <= cap) return entries;
    const kept = new Set([...entries].sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, cap).map((entry) => entry.id));
    return entries.filter((entry) => kept.has(entry.id));
  };
  const next: Record<string, RepoEntry[]> = {};
  let total = 0;
  for (const [path, entries] of Object.entries(files)) {
    if (!entries.length) continue;
    next[path] = trim(entries, FILE_CAP);
    total += next[path].length;
  }
  if (total <= REPO_CAP) return next;
  // 整库超额：先丢最旧的自动条目
  const all = Object.values(next).flat().sort((a, b) => rank(b) - rank(a) || b.updatedAt.localeCompare(a.updatedAt));
  const kept = new Set(all.slice(0, REPO_CAP).map((entry) => entry.id));
  for (const path of Object.keys(next)) next[path] = next[path].filter((entry) => kept.has(entry.id));
  return next;
}

/**
 * 一次提交：build 里做的增、改、删合成一条历史记录。没有实际改动时不产生提交。
 * 所有写入都走这里，所以历史是完整的。
 */
export function commitRepo(
  owner: string | null, repo: RepoId, author: EntryAuthor, message: string | ((changes: RepoChange[]) => string),
  build: (draft: RepoDraft, state: RepoState) => void,
  extra: (state: RepoState) => Partial<RepoState> = () => ({}),
): RepoCommit | null {
  const state = read(owner, repo);
  const files: Record<string, RepoEntry[]> = { ...state.files };
  const titles = { ...state.titles };
  const changes: RepoChange[] = [];
  let touched = false;
  const locate = (id: string) => {
    for (const [path, entries] of Object.entries(files)) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry) return { path, entry };
    }
    return null;
  };
  const draft: RepoDraft = {
    entries: (path) => files[path] ?? [],
    find: locate,
    add: (path, entry) => {
      if (locate(entry.id)) return;
      files[path] = [entry, ...(files[path] ?? [])];
      changes.push({ path, before: null, after: entry });
    },
    update: (id, next) => {
      const found = locate(id);
      if (!found) return;
      files[found.path] = files[found.path].map((entry) => (entry.id === id ? next : entry));
      changes.push({ path: found.path, before: found.entry, after: next });
    },
    remove: (id) => {
      const found = locate(id);
      if (!found) return;
      files[found.path] = files[found.path].filter((entry) => entry.id !== id);
      changes.push({ path: found.path, before: found.entry, after: null });
    },
    touch: (id, patch) => {
      const found = locate(id);
      if (!found) return;
      files[found.path] = files[found.path].map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
      touched = true;
    },
    setTitle: (path, title) => {
      const clean = title.trim().slice(0, 80);
      if (clean && titles[path] !== clean) {
        titles[path] = clean;
        touched = true;
      }
    },
  };
  build(draft, state);
  const patch = extra(state);
  if (!changes.length && !touched && !Object.keys(patch).length) return null;
  const commit: RepoCommit | null = changes.length
    ? { id: newRepoId(), at: nowIso(), author, message: (typeof message === 'function' ? message(changes) : message).slice(0, 160), changes: changes.slice(0, REPO_CAP * 2) }
    : null;
  write(owner, {
    ...state,
    files: capFiles(files),
    titles,
    commits: commit ? [commit, ...state.commits].slice(0, COMMIT_CAP) : state.commits,
    ...patch,
  });
  return commit;
}

/** 不产生提交的设置类改动 */
function patchState(owner: string | null, repo: RepoId, patch: (state: RepoState) => Partial<RepoState> | null) {
  const state = read(owner, repo);
  const next = patch(state);
  if (next) write(owner, { ...state, ...next });
}

// ───────────────────────── 写入：新增（带去重）、改、删、撤销 ─────────────────────────

export interface NewEntry {
  path: string;
  text: string;
  section?: string;
  source: EntrySource;
  /** 文件第一次出现时用的标题（课程名、课题名） */
  fileTitle?: string;
  /** 指定 id（小白的课堂条目用固定 id，便于和课堂数据对账） */
  id?: string;
  pinned?: boolean;
  /** 这件事发生的时刻（来自学习行为时用它，而不是记下的时刻，这样先后顺序才对） */
  at?: string;
  retention?: MemoryLayer;
}

function findDuplicate(entries: RepoEntry[], text: string, section?: string): RepoEntry | undefined {
  let best: RepoEntry | undefined;
  let bestScore = 0;
  for (const entry of entries) {
    // 同一句话可能分别在错题、已掌握等小节出现，不能跨语义归类合并。
    if ((entry.section ?? '') !== (section ?? '')) continue;
    if (negativeMemory(entry.text) !== negativeMemory(text)) continue;
    if (JSON.stringify(entry.text.match(/\d+(?:\.\d+)?/g)) !== JSON.stringify(text.match(/\d+(?:\.\d+)?/g))) continue;
    const score = textSimilarity(entry.text, text);
    if (score >= DUPLICATE_AT && score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

const negativeMemory = (text: string) => /不|没|未|无|别|不要|避免/.test(text);

function duplicateKey(path: string, entry: RepoEntry): string {
  const scope = path === 'profile.md' ? 'MEMORY.md' : path;
  // 课程由路径隔离；全局偏好不因在不同课程被观察到而再存一遍。资料则保留文件身份。
  return JSON.stringify([scope, entry.section ?? '', path === 'materials.md' ? entry.source.ref?.id ?? '' : '', normalizeText(entry.text)]);
}

/**
 * 记下若干条：同一个文件里说法相近的只刷新时间和次数，不重复记；隐私内容、我删过的自动条目不记。
 * 返回真正新增的条目。
 */
export function addEntries(owner: string | null, repo: RepoId, inputs: NewEntry[], author: EntryAuthor, message: string): RepoEntry[] {
  const added: RepoEntry[] = [];
  try {
    commitRepo(owner, repo, author, message, (draft, state) => {
      for (const input of inputs) {
        const at = isIso(input.at) ? input.at : nowIso();
        const text = cleanText(input.text);
        if (text.length < 2 || isSensitiveMemoryText(text)) continue;
        const key = normalizeText(text);
        if (author !== 'user' && state.forgotten.some((old) => old === key || old === `id:${input.id}` || textSimilarity(old, key) >= DUPLICATE_AT)) continue;
        if (input.fileTitle) draft.setTitle(input.path, input.fileTitle);
        if (input.id && draft.find(input.id)) continue;
        const duplicate = findDuplicate(draft.entries(input.path), text, input.section);
        if (duplicate) {
          const more = Math.min(99, (duplicate.seen ?? 1) + 1);
          if (input.retention && duplicate.retention !== input.retention) {
            draft.update(duplicate.id, { ...duplicate, retention: input.retention, updatedAt: at, seen: more });
          } else if (author === 'user') {
            draft.update(duplicate.id, { ...duplicate, text, author: 'user', updatedAt: at, seen: more, ...(input.section ? { section: input.section } : {}) });
          } else if (!isProtectedEntry(duplicate) && text.length > duplicate.text.length && normalizeText(text).includes(normalizeText(duplicate.text))) {
            // 新说法更具体：换成新的
            draft.update(duplicate.id, { ...duplicate, text, updatedAt: at, seen: more });
          } else {
            draft.touch(duplicate.id, { updatedAt: at, seen: more });
          }
          continue;
        }
        const entry: RepoEntry = { id: input.id ?? newRepoId(), text, source: input.source, addedAt: at, updatedAt: at, author };
        if (input.section) entry.section = input.section;
        if (input.pinned) entry.pinned = true;
        if (input.retention) entry.retention = input.retention;
        draft.add(input.path, entry);
        added.push(entry);
      }
    }, (state) => (author === 'user' && inputs.length
      ? { forgotten: state.forgotten.filter((old) => !inputs.some((input) => normalizeText(cleanText(input.text)) === old)) }
      : {}));
  } catch {
    // 记不下来不影响正在做的事
  }
  return added;
}

export const repoOps = {
  /** 合并既有的完全重复记录；不同课程/小节不合并，保留人工修改和置顶优先。可在历史中撤销。 */
  deduplicate(owner: string | null, repo: RepoId, automatic = false): number {
    let removed = 0;
    const forgottenIds: string[] = [];
    commitRepo(owner, repo, automatic ? 'auto' : 'user', () => `合并了 ${removed} 条重复记忆`, (draft, state) => {
      const groups = new Map<string, { path: string; entry: RepoEntry }[]>();
      for (const item of allEntries(state)) {
        const key = duplicateKey(item.path, item.entry);
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      const rank = (entry: RepoEntry) => Number(Boolean(entry.pinned)) * 4 + Number(Boolean(entry.edited)) * 2 + Number(entry.author === 'user');
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => rank(b.entry) - rank(a.entry) || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
        const keep = group[0].entry;
        const seen = Math.min(99, group.reduce((sum, { entry }) => sum + (entry.seen ?? 1), 0));
        const retention = group.filter(({entry}) => entry.retention).sort((a,b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt))[0]?.entry.retention;
        draft.update(keep.id, { ...keep, seen, ...(retention ? {retention} : {}) });
        for (const { entry } of group.slice(1)) {
          draft.remove(entry.id);
          if (entry.id.startsWith('xb:')) forgottenIds.push(`id:${entry.id}`);
          removed += 1;
        }
      }
    }, (state) => ({ dedupeVersion: 1, ...(forgottenIds.length ? { forgotten: [...new Set([...forgottenIds, ...state.forgotten])].slice(0, FORGOTTEN_CAP) } : {}) }));
    return removed;
  },
  /** 改文字或小节。改过的自动条目标为「我改过」，之后不会被自动覆盖 */
  edit(owner: string | null, repo: RepoId, id: string, patch: { text?: string; section?: string; retention?: MemoryLayer }): boolean {
    const text = patch.text === undefined ? undefined : cleanText(patch.text);
    if (text !== undefined && (text.length < 2 || isSensitiveMemoryText(text))) return false;
    let found = false;
    commitRepo(owner, repo, 'user', `改了一条：${text ?? ''}`.slice(0, 60), (draft) => {
      const hit = draft.find(id);
      if (!hit) return;
      found = true;
      const next: RepoEntry = { ...hit.entry, text: text ?? hit.entry.text, ...(patch.section ? { section: patch.section } : {}), ...(patch.retention ? { retention: patch.retention } : {}) };
      if (next.text === hit.entry.text && next.section === hit.entry.section && next.retention === hit.entry.retention) return;
      draft.update(id, { ...next, updatedAt: nowIso(), ...(hit.entry.author !== 'user' && (patch.text !== undefined || patch.section !== undefined) ? { edited: true } : {}) });
    });
    return found;
  },

  pin(owner: string | null, repo: RepoId, id: string, pinned: boolean) {
    commitRepo(owner, repo, 'user', pinned ? '置顶了一条' : '取消了一条置顶', (draft) => {
      const hit = draft.find(id);
      if (!hit || Boolean(hit.entry.pinned) === pinned) return;
      const { pinned: _old, ...rest } = hit.entry;
      draft.update(id, pinned ? { ...rest, pinned: true } : rest);
    });
  },

  /** 删除一条。删掉的自动条目之后不会再被自动记回来；想恢复，到变更历史里撤销 */
  remove(owner: string | null, repo: RepoId, id: string): RepoCommit | null {
    let forget: string | null = null;
    return commitRepo(owner, repo, 'user', '删了一条', (draft) => {
      const hit = draft.find(id);
      if (!hit) return;
      if (hit.entry.author !== 'user') forget = /^xb:/.test(hit.entry.id) ? `id:${hit.entry.id}` : normalizeText(hit.entry.text);
      draft.remove(id);
    }, (state) => (forget ? { forgotten: [forget, ...state.forgotten.filter((old) => old !== forget)].slice(0, FORGOTTEN_CAP) } : {}));
  },

  /** 把条目挪到另一个文件（做梦整理、我手动归类都用它） */
  move(owner: string | null, repo: RepoId, id: string, path: string, author: EntryAuthor = 'user', section?: string) {
    commitRepo(owner, repo, author, '挪了一条', (draft) => {
      const hit = draft.find(id);
      if (!hit || hit.path === path) return;
      draft.remove(id);
      const { section: _old, ...rest } = hit.entry;
      draft.add(path, { ...rest, ...(section ? { section } : {}), updatedAt: nowIso() });
    });
  },

  /**
   * 撤销一次提交：它新增的删掉，它删掉的放回，它改过的改回去。
   * 之后别的提交又动过的条目，以当前内容为准，只撤还对得上的部分。
   */
  revert(owner: string | null, repo: RepoId, commitId: string): RepoCommit | null {
    const target = read(owner, repo).commits.find((commit) => commit.id === commitId);
    if (!target || target.reverted) return null;
    const restored = new Set<string>();
    const commit = commitRepo(owner, repo, 'user', `撤销：${target.message}`.slice(0, 160), (draft) => {
      for (const change of [...target.changes].reverse()) {
        if (!change.before && change.after) {
          const hit = draft.find(change.after.id);
          if (matchesSnapshot(hit, change.path, change.after)) draft.remove(change.after.id);
        } else if (change.before && !change.after) {
          if (!draft.find(change.before.id)) {
            draft.add(change.path, change.before);
            restored.add(normalizeText(change.before.text));
            restored.add(`id:${change.before.id}`);
          }
        } else if (change.before && change.after) {
          const hit = draft.find(change.after.id);
          if (matchesSnapshot(hit, change.path, change.after)) draft.update(change.after.id, change.before);
        }
      }
    }, (state) => {
      // 撤销的是「删除」时，把它从「别再记回来」里拿掉
      return restored.size ? { forgotten: state.forgotten.filter((old) => !restored.has(old)) } : {};
    });
    if (!commit) return null;
    patchState(owner, repo, (state) => ({
      commits: state.commits.map((entry) => (entry.id === commitId ? { ...entry, reverted: true } : entry.id === commit.id ? { ...entry, revertOf: commitId } : entry)),
    }));
    return commit;
  },

  setPaused(owner: string | null, repo: RepoId, paused: boolean) {
    patchState(owner, repo, (state) => (state.paused === paused ? null : { paused, workGeneration: newRepoId(), cursor: nowIso() }));
  },

  setReview(owner: string | null, repo: RepoId, review: boolean) {
    patchState(owner, repo, (state) => (state.review === review ? null : { review }));
  },

  setCursor(owner: string | null, repo: RepoId, cursor: string) {
    patchState(owner, repo, (state) => (state.cursor === cursor ? null : { cursor }));
  },

  markMigrated(owner: string | null, repo: RepoId) {
    patchState(owner, repo, (state) => (state.migrated ? null : { migrated: true }));
  },

  setPending(owner: string | null, repo: RepoId, pending: RepoProposal | null) {
    patchState(owner, repo, () => ({ pending }));
  },

  /** 采纳做梦提出的改动（不给 ids 就是全部）。条目在这期间被我动过的，那一处跳过。 */
  applyProposal(owner: string | null, repo: RepoId, ids?: string[]): RepoCommit | null {
    const pending = read(owner, repo).pending;
    if (!pending) return null;
    const chosen = pending.changes.filter((change) => !ids || ids.includes(change.id));
    if (!chosen.length) return null;
    const applied = new Set<string>();
    const commit = commitRepo(owner, repo, 'dream', `做梦整理（我确认过）：${pending.title}`, (draft) => {
      for (const change of chosen) if (applyProposalChange(draft, change)) applied.add(change.id);
    });
    const left = pending.changes.filter((change) => !applied.has(change.id));
    patchState(owner, repo, () => ({ pending: left.length ? { ...pending, changes: left } : null }));
    return commit;
  },

  discardProposal(owner: string | null, repo: RepoId, ids?: string[]) {
    patchState(owner, repo, (state) => {
      if (!state.pending) return null;
      const left = ids ? state.pending.changes.filter((change) => !ids.includes(change.id)) : [];
      return { pending: left.length ? { ...state.pending, changes: left } : null };
    });
  },

  /** 清空整个记忆库（历史一并清掉）。暂停和审阅设置保留。 */
  clear(owner: string | null, repo: RepoId) {
    const state = read(owner, repo);
    write(owner, { ...emptyState(repo), paused: state.paused, review: state.review, cursor: nowIso(), migrated: true, workGeneration: newRepoId() });
  },
};

/** 后台观察次数不算手动修改；路径、内容、归类、来源和保护状态必须仍与快照一致。 */
function matchesSnapshot(hit: { path: string; entry: RepoEntry } | null, path: string, expected: RepoEntry): boolean {
  if (!hit || hit.path !== path) return false;
  const { updatedAt: _a, seen: _b, ...actual } = hit.entry;
  const { updatedAt: _c, seen: _d, ...before } = expected;
  return JSON.stringify(actual) === JSON.stringify(before);
}

/** 落一处做梦提出的改动；带 toPath 的是「拿走旧的、在另一个文件写下新的」 */
export function applyProposalChange(draft: RepoDraft, change: ProposalChange): boolean {
  if (!change.toPath || !change.before || !change.after) return applyChange(draft, change);
  const hit = draft.find(change.before.id);
  if (!matchesSnapshot(hit, change.path, change.before)) return false;
  draft.remove(change.before.id);
  draft.add(change.toPath, change.after);
  return true;
}

/** 把一处改动落到草稿上；对不上的（条目已经不在或被改过）跳过 */
export function applyChange(draft: RepoDraft, change: RepoChange): boolean {
  if (!change.before && change.after) {
    if (draft.find(change.after.id)) return false;
    draft.add(change.path, change.after);
    return true;
  }
  if (change.before && !change.after) {
    const hit = draft.find(change.before.id);
    if (!matchesSnapshot(hit, change.path, change.before)) return false;
    draft.remove(change.before.id);
    return true;
  }
  if (change.before && change.after) {
    const hit = draft.find(change.before.id);
    if (!matchesSnapshot(hit, change.path, change.before)) return false;
    draft.update(change.before.id, change.after);
    return true;
  }
  return false;
}

// ───────────────────────── 渲染成 Markdown ─────────────────────────

const day = (iso: string) => iso.slice(0, 10);

/** 一条记忆的 Markdown 行：`- 文本 [来源: 闪卡 · 梯度下降; 时间: 2026-10-14]` */
export function entryLine(entry: RepoEntry): string {
  const flags = [entry.pinned ? '置顶' : '', entry.author === 'user' ? '我写的' : entry.edited ? '我改过' : entry.author === 'dream' ? '做梦整理' : ''].filter(Boolean);
  return `- ${entry.text} [来源: ${entry.source.label}; 时间: ${day(entry.addedAt)}${flags.length ? `; ${flags.join('、')}` : ''}]`;
}

/** 按小节分组（文件没有小节时是一组），组内置顶在前、新的在前 */
export function groupEntries(info: RepoFileInfo, entries: RepoEntry[]): { section: RepoSection | null; entries: RepoEntry[] }[] {
  const sorted = [...entries].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt));
  if (!info.sections?.length) return sorted.length ? [{ section: null, entries: sorted }] : [];
  const known = new Set(info.sections.map((section) => section.id));
  const groups = info.sections
    .map((section) => ({ section: section as RepoSection | null, entries: sorted.filter((entry) => entry.section === section.id) }))
    .filter((group) => group.entries.length > 0);
  const loose = sorted.filter((entry) => !entry.section || !known.has(entry.section));
  return loose.length ? [{ section: null, entries: loose }, ...groups] : groups;
}

/** MEMORY.md 的索引：指向每个有内容的文件 */
export function indexLinks(state: RepoState): { path: string; title: string; count: number; folder?: string }[] {
  return listFiles(state)
    .filter((file) => file.path !== 'MEMORY.md' && file.count > 0)
    .map((file) => ({ path: file.path, title: file.title, count: file.count, ...(file.folder ? { folder: file.folder } : {}) }));
}

export function renderFile(state: RepoState, path: string): string {
  const info = fileInfo(state.repo, path, state.titles);
  const lines = [`# ${info.title}`, '', `> ${info.hint}`, ''];
  const groups = groupEntries(info, state.files[path] ?? []);
  if (!groups.length) lines.push('（还没有内容）', '');
  for (const group of groups) {
    if (group.section) lines.push(`## ${group.section.label}`, '');
    for (const entry of group.entries) lines.push(entryLine(entry));
    lines.push('');
  }
  if (path === 'MEMORY.md') {
    lines.push('## 索引', '');
    const links = indexLinks(state);
    if (!links.length) lines.push('（其余文件还空着）');
    for (const link of links) lines.push(`- [[${link.path}]] ${link.folder ? `${folderLabel(link.folder)} · ` : ''}${link.title}（${link.count} 条）`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** 一次提交的改动按文件归拢成可读的差异行：`-` 是去掉的，`+` 是新写的 */
export function commitDiff(commit: RepoCommit): { path: string; lines: { sign: '+' | '-'; text: string }[] }[] {
  const byPath = new Map<string, { sign: '+' | '-'; text: string }[]>();
  for (const change of commit.changes) {
    const lines = byPath.get(change.path) ?? [];
    if (change.before) lines.push({ sign: '-', text: entryLine(change.before) });
    if (change.after) lines.push({ sign: '+', text: entryLine(change.after) });
    byPath.set(change.path, lines);
  }
  return [...byPath].map(([path, lines]) => ({ path, lines }));
}

/** 所有条目连同所在文件（做梦整理、检索时遍历用） */
export function allEntries(state: RepoState): { path: string; entry: RepoEntry }[] {
  return Object.entries(state.files).flatMap(([path, entries]) => entries.map((entry) => ({ path, entry })));
}
