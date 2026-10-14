/**
 * 第六章「记」：记忆库与做梦。
 * 一个能点的记忆库复刻：两份记忆（小砚 / 小白）各一棵 Markdown 文件树，MEMORY.md 常带、主题文件按需取；
 * 每条带出处和日期、能回到出处；变更历史可以逐次撤销（撤销本身也是一次提交，再撤就是重做）；做梦整理直接生效、整场可撤。
 * 数据是写死的示例，规则与文案对照 engine/memoryRepo、engine/dreams 与 pages/learn/views/memory，不引引擎代码。
 */
import { useState, type ReactNode } from 'react';
import {
  Activity, Archive, ArrowUpRight, BadgeCheck, Ban, BookOpen, ChevronDown, ChevronRight, CopyCheck, FileText, FolderOpen, FolderTree, HeartHandshake,
  History, Layers, ListTree, Lock, MessageCircleQuestion, MoonStar, NotebookPen, PauseCircle, PencilLine, Pin, Repeat, RotateCcw,
  ShieldCheck, SlidersHorizontal, Target, TriangleAlert, Undo2, UsersRound,
} from 'lucide-react';
import { Badge, Button, Segmented } from '../../components/ui';
import { IconMemory } from '../../components/ui/icons';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Caps, type Cap } from './Caps';
import { ChapterHead } from './ChapterHead';
import { sectionById } from './sections';
import base from './landing.module.css';
import s from './memory.module.css';

// ───────────────────────── 示例数据 ─────────────────────────

type RepoId = 'xiaoyan' | 'xiaobai';
type Author = 'auto' | 'user' | 'dream';
type Layer = 'recent' | 'short' | 'long';

interface Entry {
  id: string;
  text: string;
  section?: string;
  /** 出处类型：学习行为的来源，或 user / dream / classroom */
  kind: string;
  /** 人读的出处，如「闪卡 · 操作系统」 */
  label: string;
  /** 记下的日子 */
  day: string;
  /** 小砚的条目标保留层级；归档、排除掉的和小白的不标 */
  layer?: Layer;
  author: Author;
  pinned?: boolean;
  seen?: number;
}
interface Change { path: string; before: Entry | null; after: Entry | null }
interface Commit {
  id: string;
  at: string;
  author: Author;
  message: string;
  changes: Change[];
  reverted?: boolean;
  /** 随课堂记录对账的改动：只读，不能在这里撤 */
  classroom?: boolean;
}
interface Repo { files: Record<string, Entry[]>; commits: Commit[] }
interface FileDef { path: string; title: string; hint: string; folder?: string; sections?: readonly (readonly [string, string])[]; sub?: string }

const REPO_NAME: Record<RepoId, string> = { xiaoyan: '小砚的记忆库', xiaobai: '小白的记忆库' };
const FOLDER: Record<string, string> = { courses: '课程', lessons: '教过的课' };
const LAYER: Record<Layer, string> = { recent: '最近记忆', short: '短期记忆', long: '长期记忆' };
const AUTHOR: Record<Author, { label: string; tone: 'neutral' | 'accent' | 'warn' }> = {
  auto: { label: '自动', tone: 'neutral' },
  user: { label: '我', tone: 'accent' },
  dream: { label: '做梦', tone: 'warn' },
};
/** 归档、排除掉的没有内容时不占位置；课程文件有内容才出现 */
const HIDE_EMPTY = ['archive.md', 'ruled-out.md'];

const COURSE_HINT = '这门课里学过什么、卡在哪、做错的题、忘掉的卡片，和讲得明白的讲法。';
const COURSE_SECTIONS = [['stuck', '卡住的地方'], ['wrong', '错题'], ['lapsed', '忘掉的卡片'], ['studied', '学过的'], ['mastered', '已掌握']] as const;
const LESSON_HINT = '这门课你给小白讲明白了什么、打过的比方，他想通了和还没想通的地方。';
const LESSON_SECTIONS = [['taught', '先生讲明白的'], ['analogy', '先生打的比方'], ['cleared', '想通了的'], ['open', '还没想通的'], ['fading', '开始模糊的']] as const;

const FILES: Record<RepoId, FileDef[]> = {
  xiaoyan: [
    { path: 'MEMORY.md', title: '记忆总览', sub: '每次都带上', hint: '这里的背景只在与当前问题相关时使用。一次性问题不会自动变成长久的偏好。' },
    { path: 'preferences.md', title: '讲法偏好', hint: '你喜欢怎样的讲法，对什么感兴趣。', sections: [['style', '讲法'], ['interest', '感兴趣的']] },
    { path: 'goals.md', title: '目标', hint: '你在为什么而学：考试、升学，或想学会的东西。' },
    { path: 'weak-points.md', title: '薄弱点', hint: '不分课程的薄弱点，和从各门课里看出的规律。具体卡在哪一题，记在各门课的文件里。' },
    { path: 'mastered.md', title: '已掌握', hint: '已经弄懂、不用再从头讲的内容。' },
    { path: 'habits.md', title: '习惯', hint: '你平时怎么学、什么时候学、常用哪些工具。' },
    { path: 'materials.md', title: '资料', hint: '你上传和读过的资料。' },
    { path: 'ruled-out.md', title: '排除掉的', hint: '整理时发现已经不成立的说法，留一笔免得再记回来。' },
    { path: 'archive.md', title: '归档', hint: '很久没再提起的旧记录。不会交给小砚，想留的可以置顶或改回去。' },
    { path: 'courses/os.md', title: '操作系统', folder: 'courses', hint: COURSE_HINT, sections: COURSE_SECTIONS },
    { path: 'courses/linear-algebra.md', title: '线性代数', folder: 'courses', hint: COURSE_HINT, sections: COURSE_SECTIONS },
    { path: 'courses/signals.md', title: '信号与系统', folder: 'courses', hint: COURSE_HINT, sections: COURSE_SECTIONS },
  ],
  xiaobai: [
    { path: 'MEMORY.md', title: '始终记着的', sub: '小白心里的先生', hint: '小白心里的先生，和他总共学到了什么。' },
    {
      path: 'teacher.md', title: '先生怎么教', hint: '小白在课上记下的：你的讲法、长处和短板。',
      sections: [['preference', '偏好'], ['habit', '习惯'], ['strength', '长处'], ['weakness', '短板'], ['note', '笔记']],
    },
    { path: 'questions.md', title: '还想问的', hint: '小白醒来还惦记着、想在下一堂课问你的话。' },
    { path: 'archive.md', title: '归档', hint: '很久没再提起的旧记录。' },
    { path: 'lessons/process-thread.md', title: '进程与线程', folder: 'lessons', hint: LESSON_HINT, sections: LESSON_SECTIONS },
    { path: 'lessons/newton-2.md', title: '牛顿第二定律', folder: 'lessons', hint: LESSON_HINT, sections: LESSON_SECTIONS },
  ],
};

const FILE_ICON: Record<string, ReactNode> = {
  'MEMORY.md': <IconMemory size={16} />,
  'preferences.md': <SlidersHorizontal size={16} strokeWidth={1.75} />,
  'goals.md': <Target size={16} strokeWidth={1.75} />,
  'weak-points.md': <TriangleAlert size={16} strokeWidth={1.75} />,
  'mastered.md': <BadgeCheck size={16} strokeWidth={1.75} />,
  'habits.md': <Repeat size={16} strokeWidth={1.75} />,
  'materials.md': <BookOpen size={16} strokeWidth={1.75} />,
  'ruled-out.md': <Ban size={16} strokeWidth={1.75} />,
  'archive.md': <Archive size={16} strokeWidth={1.75} />,
  'teacher.md': <HeartHandshake size={16} strokeWidth={1.75} />,
  'questions.md': <MessageCircleQuestion size={16} strokeWidth={1.75} />,
};

const e = (id: string, text: string, kind: string, label: string, day: string, extra: Partial<Entry> = {}): Entry => ({
  id, text, kind, label, day, author: kind === 'user' ? 'user' : kind === 'dream' ? 'dream' : 'auto', ...extra,
});

// 小砚：做梦之前的几条，和做梦之后的样子
const O1_BEFORE = e('o1', '「页面置换」的 LRU 和 FIFO 总是分不清', 'chat', '对话 · 操作系统', '2026-10-10', { section: 'stuck', layer: 'short' });
const O1 = { ...O1_BEFORE, seen: 2 };
const O1B = e('o1b', '反复问到「页面置换」，还没完全弄懂', 'chat', '对话 · 操作系统', '2026-10-12', { section: 'stuck', layer: 'short' });
const LA_WRONG = e('la-wrong', '题目集做错 1 题：矩阵的秩', 'quiz', '题目集 · 线性代数', '2026-10-07', { section: 'wrong', layer: 'short' });
const SIG_OLD = e('sig', '读完《傅里叶变换》讲义的前两节', 'reading', '读讲义 · 信号与系统', '2026-09-20', { section: 'studied', layer: 'recent' });
const SIG_ARCHIVED: Entry = { ...SIG_OLD, section: undefined, layer: undefined };
const W1 = e('w1', '《操作系统》里卡住的不止一处（对话、题目集、闪卡）：页面置换、死锁，详见 [[courses/os.md]]', 'dream', '做梦整理 · 依据 3 条卡点', '2026-10-13', { layer: 'short' });
const X1 = e('x1', '不再记「题目集做错 1 题：矩阵的秩」：后来的记录显示已经弄懂（2026-10-12，练一练 · 线性代数）', 'dream', '做梦整理 · 原出处：题目集 · 线性代数', '2026-10-13');
const O3 = e('o3', '闪卡复习 12 张，3 张选了重来：页面置换', 'flashcards', '闪卡 · 操作系统', '2026-10-12', { section: 'lapsed', layer: 'short' });
const P1 = e('p1', '讲解时先给结论，再展开', 'user', '我添加的', '2026-10-14', { section: 'style', layer: 'long' });
const L2 = e('l2', '上完《特征值与特征向量》这一课', 'lesson', 'AI 课堂 · 线性代数', '2026-10-14', { section: 'studied', layer: 'recent' });

// 小白
const B1_OLD = e('b1', '先生教过我 1 门课，其中 1 门我已经出师', 'classroom', '课堂记录', '2026-10-09');
const B1 = { ...B1_OLD, text: '先生教过我 2 门课，其中 1 门我已经出师', day: '2026-10-13' };
const PT1 = e('pt1', '进程是资源分配的单位，线程是调度的单位', 'teach', '给小白上课 · 进程与线程', '2026-10-13', { section: 'taught' });
const PT2 = e('pt2', '「进程像一间厨房，线程是在里面同时干活的厨师」', 'teach', '给小白上课 · 进程与线程', '2026-10-13', { section: 'analogy' });
const PT3 = e('pt3', '我在课上说过「线程切换不用保存寄存器」，还没想通', 'teach', '给小白上课 · 进程与线程', '2026-10-13', { section: 'open' });
const Q1 = e('q1', '《进程与线程》里我说过「线程切换不用保存寄存器」，先生，是这样吗？', 'dream', '梦醒后 · 进程与线程', '2026-10-13');
const NW3 = e('nw3', '出师时记得 92%，现在 78%，有点起雾了', 'dream', '梦里回放 · 牛顿第二定律', '2026-10-13', { section: 'fading' });
const T3 = e('t3', '下一堂想先讲死锁', 'user', '先生亲笔', '2026-10-14', { section: 'note', pinned: true });

const INITIAL: Record<RepoId, Repo> = {
  xiaoyan: {
    files: {
      'MEMORY.md': [
        e('m1', '计算机专业大二，这学期在学操作系统和线性代数', 'user', '我添加的', '2026-10-05', { pinned: true, layer: 'long' }),
        e('m2', '期末前想把操作系统的内存管理一章吃透', 'chat', '对话 · 操作系统', '2026-10-09', { layer: 'long', seen: 3 }),
      ],
      'preferences.md': [P1, e('p2', '对联邦学习里的隐私问题感兴趣', 'research', '科研台 · 联邦学习综述', '2026-10-10', { section: 'interest', layer: 'short' })],
      'goals.md': [e('g1', '十二月前学完操作系统', 'agent', '助理任务 · 期末复习计划', '2026-10-08', { layer: 'long', seen: 3 })],
      'weak-points.md': [W1],
      'mastered.md': [e('s1', '链表的增删已经很熟', 'practice', '练一练 · 数据结构', '2026-10-03', { layer: 'long', seen: 3 })],
      'habits.md': [
        e('h1', '一般晚上做题，早上看书', 'user', '我添加的', '2026-10-05', { layer: 'long' }),
        e('h2', '最近常用「闪卡」学习（近 7 天 9 次）', 'dream', '做梦整理 · 依据 9 次闪卡', '2026-10-11', { layer: 'short' }),
      ],
      'materials.md': [e('mt1', '主要看王道的操作系统讲义', 'chat', '对话 · 操作系统', '2026-10-06', { layer: 'short' })],
      'ruled-out.md': [X1],
      'archive.md': [SIG_ARCHIVED],
      'courses/os.md': [O1, e('o2', '题目集做错 2 题：死锁的四个必要条件', 'quiz', '题目集 · 操作系统', '2026-10-11', { section: 'wrong', layer: 'short' }), O3],
      'courses/linear-algebra.md': [e('l1', '小测全对：矩阵的秩', 'practice', '练一练 · 线性代数', '2026-10-12', { section: 'mastered', layer: 'short' }), L2],
      'courses/signals.md': [],
    },
    commits: [
      { id: 'c-lesson', at: '10月14日 09:12', author: 'auto', message: '从学习行为里记下：AI 课堂', changes: [{ path: 'courses/linear-algebra.md', before: null, after: L2 }] },
      { id: 'c-pref', at: '10月14日 08:30', author: 'user', message: '我添了一条：讲解时先给结论，再展开', changes: [{ path: 'preferences.md', before: null, after: P1 }] },
      {
        id: 'c-dream', at: '10月13日 23:40', author: 'dream', message: '做梦整理：想明白了一件事',
        changes: [
          { path: 'courses/os.md', before: O1B, after: null },
          { path: 'courses/os.md', before: O1_BEFORE, after: O1 },
          { path: 'weak-points.md', before: null, after: W1 },
          { path: 'courses/linear-algebra.md', before: LA_WRONG, after: null },
          { path: 'ruled-out.md', before: null, after: X1 },
          { path: 'courses/signals.md', before: SIG_OLD, after: null },
          { path: 'archive.md', before: null, after: SIG_ARCHIVED },
        ],
      },
      { id: 'c-flash', at: '10月12日 21:30', author: 'auto', message: '从学习行为里记下：闪卡', changes: [{ path: 'courses/os.md', before: null, after: O3 }] },
    ],
  },
  xiaobai: {
    files: {
      'MEMORY.md': [B1, e('b2', '先生爱先打比方再讲定义，讲到公式会放慢', 'classroom', '课堂记录', '2026-10-13')],
      'teacher.md': [
        T3,
        e('t1', '开讲前爱先问我一句「你猜猜看」', 'teach', '给小白上课 · 进程与线程', '2026-10-11', { section: 'preference' }),
        e('t2', '比方打得准，我一听就懂', 'teach', '给小白上课 · 牛顿第二定律', '2026-10-09', { section: 'strength' }),
      ],
      'questions.md': [Q1],
      'archive.md': [],
      'lessons/process-thread.md': [PT1, PT2, PT3],
      'lessons/newton-2.md': [
        e('nw1', '合力决定加速度，质量越大越难推动', 'teach', '给小白上课 · 牛顿第二定律', '2026-10-09', { section: 'taught' }),
        e('nw2', '「力越大，速度就越大」：先生讲明白了', 'teach', '给小白上课 · 牛顿第二定律', '2026-10-09', { section: 'cleared' }),
        NW3,
      ],
    },
    commits: [
      { id: 'xc-note', at: '10月14日 08:50', author: 'auto', message: '课堂记录对账：新增 1', classroom: true, changes: [{ path: 'teacher.md', before: null, after: T3 }] },
      {
        id: 'xc-dream', at: '10月13日 23:55', author: 'dream', message: '做梦整理：梦见先生讲《进程与线程》',
        changes: [{ path: 'questions.md', before: null, after: Q1 }, { path: 'lessons/newton-2.md', before: null, after: NW3 }],
      },
      {
        id: 'xc-sync', at: '10月13日 20:10', author: 'auto', message: '课堂记录对账：新增 3，更新 1', classroom: true,
        changes: [
          { path: 'MEMORY.md', before: B1_OLD, after: B1 },
          { path: 'lessons/process-thread.md', before: null, after: PT1 },
          { path: 'lessons/process-thread.md', before: null, after: PT2 },
          { path: 'lessons/process-thread.md', before: null, after: PT3 },
        ],
      },
    ],
  },
};

/** 点出处会回到哪里：照着学习终端记忆页的跳转表 */
function jumpTarget(entry: Entry): string | null {
  const topic = entry.label.split(' · ')[1];
  const tools: Record<string, string> = { flashcards: '闪卡', quiz: '题目集', note: '笔记', mindmap: '思维导图', todo: '待办', writing: '作文与翻译' };
  if (tools[entry.kind]) return `工作台 › ${tools[entry.kind]}`;
  if (entry.kind === 'lesson') return 'AI 课堂';
  if (entry.kind === 'agent') return '助理任务';
  if (entry.kind === 'research') return '科研台';
  if (entry.kind === 'library') return '资料库';
  if (['chat', 'reading', 'guided', 'practice', 'teach', 'exam'].includes(entry.kind) && topic) return `《${topic}》这门课`;
  if (entry.kind === 'chat') return '对话';
  return null;
}

const dayText = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

function visibleFiles(who: RepoId, files: Record<string, Entry[]>) {
  return FILES[who]
    .map((file) => ({ ...file, count: files[file.path]?.length ?? 0 }))
    .filter((file) => (file.folder || HIDE_EMPTY.includes(file.path) ? file.count > 0 : true));
}

/** 一条记忆的 Markdown 行，和记忆库原文一致：`- 文本 [来源: …; 时间: …]` */
function entryLine(entry: Entry): string {
  const flags = [entry.pinned ? '置顶' : '', entry.author === 'user' ? '我写的' : entry.author === 'dream' ? '做梦整理' : ''].filter(Boolean);
  return `- ${entry.text} [来源: ${entry.label}; 时间: ${entry.day}${flags.length ? `; ${flags.join('、')}` : ''}]`;
}

function sortEntries(list: Entry[]): Entry[] {
  return [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.day.localeCompare(a.day));
}

function groupEntries(file: FileDef, list: Entry[]): { label: string | null; entries: Entry[] }[] {
  const sorted = sortEntries(list);
  if (!file.sections) return sorted.length ? [{ label: null, entries: sorted }] : [];
  return file.sections
    .map(([id, label]) => ({ label, entries: sorted.filter((entry) => entry.section === id) }))
    .filter((group) => group.entries.length > 0);
}

function renderMarkdown(who: RepoId, repo: Repo, file: FileDef): string {
  const lines = [`# ${file.title}`, '', `> ${file.hint}`, ''];
  const groups = groupEntries(file, repo.files[file.path] ?? []);
  if (!groups.length) lines.push('（还没有内容）', '');
  for (const group of groups) {
    if (group.label) lines.push(`## ${group.label}`, '');
    for (const entry of group.entries) lines.push(entryLine(entry));
    lines.push('');
  }
  if (file.path === 'MEMORY.md') {
    lines.push('## 索引', '');
    for (const link of visibleFiles(who, repo.files).filter((item) => item.path !== 'MEMORY.md' && item.count > 0)) {
      lines.push(`- [[${link.path}]] ${link.folder ? `${FOLDER[link.folder]} · ` : ''}${link.title}（${link.count} 条）`);
    }
  }
  return lines.join('\n').trimEnd();
}

/** 撤销一次提交：它新增的删掉，它删掉的放回，它改过的改回去；后来又变过的条目不动。撤销本身也是一次提交。 */
function revertCommit(repo: Repo, id: string, serial: number): { next: Repo; paths: string[] } | null {
  const target = repo.commits.find((commit) => commit.id === id);
  if (!target || target.reverted) return null;
  const files: Record<string, Entry[]> = { ...repo.files };
  const present = (entryId: string) => Object.values(files).some((list) => list.some((item) => item.id === entryId));
  const applied: Change[] = [];
  for (const change of [...target.changes].reverse()) {
    const list = files[change.path] ?? [];
    if (!change.before && change.after) {
      const added = change.after;
      if (list.some((item) => item.id === added.id && item.text === added.text)) {
        files[change.path] = list.filter((item) => item.id !== added.id);
        applied.push({ path: change.path, before: added, after: null });
      }
    } else if (change.before && !change.after) {
      const removed = change.before;
      if (!present(removed.id)) {
        files[change.path] = [removed, ...list];
        applied.push({ path: change.path, before: null, after: removed });
      }
    } else if (change.before && change.after) {
      const { before, after } = change;
      if (list.some((item) => item.id === after.id && item.text === after.text && item.seen === after.seen)) {
        files[change.path] = list.map((item) => (item.id === after.id ? before : item));
        applied.push({ path: change.path, before: after, after: before });
      }
    }
  }
  if (!applied.length) return null;
  // 按实际执行的顺序记下：再撤这一条时倒着走，跨文件的移动才能原样挪回去
  const undo: Commit = { id: `undo-${serial}`, at: '刚刚', author: 'user', message: `撤销：${target.message}`, changes: applied };
  return {
    next: { files, commits: [undo, ...repo.commits.map((commit) => (commit.id === id ? { ...commit, reverted: true } : commit))] },
    paths: [...new Set(applied.map((change) => change.path))],
  };
}

// ───────────────────────── 梦境 ─────────────────────────

interface DreamGroup { label: string; kind: 'merged' | 'promoted' | 'faded' | 'kept' | 'question'; items: string[] }
const DREAMS: Record<RepoId, {
  name: string; about: string; title: string; at: string; method: string; ops: string; narrative: string; groups: DreamGroup[];
  /** 这场梦写下的一条：还在库里，说明这场梦的改动还在 */
  marker: { path: string; id: string };
  /** 这场梦在变更历史里的那次提交 */
  commitId: string;
}> = {
  xiaoyan: {
    name: '小砚的梦',
    about: '空闲时，小砚把记忆库重新整理一遍：从各种学习行为里反复出现的事中提炼新的认识，合并重复，归档到期的记录，按出处和日期裁决前后矛盾的说法。整理直接生效。',
    title: '想明白了一件事',
    at: '10月13日 23:40',
    method: '本地规则整理',
    ops: '7 处改动 · 合并 1 · 提炼 1 · 排除 1 · 归档 1',
    narrative: '夜里我把记忆库里的 16 条翻了一遍，也把最近的 9 次提问和 14 次对话之外的学习行为回想了一下。有 1 处说的其实是同一件事，我把它们并成了一条。从反复出现的事里，我看出了一点：《操作系统》里卡住的不止一处（对话、题目集、闪卡）：页面置换、死锁。有 1 处前后说法相反，我对了对出处和日期，把不成立的记进了「排除掉的」。',
    groups: [
      { label: '合并', kind: 'merged', items: ['把 2 条并成一条：「页面置换」的 LRU 和 FIFO 总是分不清'] },
      { label: '提炼', kind: 'promoted', items: ['薄弱点：《操作系统》里卡住的不止一处（对话、题目集、闪卡）：页面置换、死锁'] },
      { label: '淡忘', kind: 'faded', items: ['排除了「题目集做错 1 题：矩阵的秩」：后来的记录显示已经弄懂', '读完《傅里叶变换》讲义的前两节（到期，已归档）'] },
    ],
    marker: { path: 'weak-points.md', id: 'w1' },
    commitId: 'c-dream',
  },
  xiaobai: {
    name: '小白的梦',
    about: '空闲时，小白把你教过的课在梦里回放一遍：哪些记牢了，哪些开始模糊，还有哪句想问你。他的梦只往自己的记忆库里写，不改课堂上的任何数据。',
    title: '梦见先生讲《进程与线程》',
    at: '10月13日 23:55',
    method: '模型整理',
    ops: '2 处改动 · 还想问 1 · 开始模糊 1',
    narrative: '梦里先生又讲了一遍进程与线程，厨房和厨师那个比方我记得清清楚楚。可我在课上说的那句线程切换，醒来越想越没底。牛顿第二定律也有点起雾了。',
    groups: [
      { label: '加深', kind: 'kept', items: ['《进程与线程》记牢了「进程是资源分配的单位，线程是调度的单位」'] },
      { label: '提炼', kind: 'promoted', items: ['先生的比方抄进了小本子：「进程像一间厨房，线程是在里面同时干活的厨师」'] },
      { label: '淡忘', kind: 'faded', items: ['《牛顿第二定律》有点起雾：出师时 92%，现在 78%'] },
      { label: '还想问', kind: 'question', items: ['《进程与线程》里我说过「线程切换不用保存寄存器」，先生，是这样吗？'] },
    ],
    marker: { path: 'questions.md', id: 'q1' },
    commitId: 'xc-dream',
  },
};

/** 三层保留：与学习终端记忆页的分层说明一致 */
const LAYERS: { id: Layer; short: string; hint: string }[] = [
  { id: 'recent', short: '最近', hint: '最近 24 小时的上下文，不作为长期偏好。' },
  { id: 'short', short: '短期', hint: '当前学习中的疑点和临时目标，7 天未再提及就淡出回答。' },
  { id: 'long', short: '长期', hint: '你明确要求记住的内容，或跨天反复确认的信息；只在相关时使用。' },
];
/** 最近上下文（示例）：普通阅读、上传只留 24 小时，不单独成条 */
const RECENT_CONTEXT = ['上传了《操作系统》第 4 章讲义', '读讲义《页面置换算法》到第 3 节'];

const PAUSED_NOTE: Record<RepoId, string> = {
  xiaoyan: '记忆已暂停：不再记入新的学习行为，回答时也不带记忆。',
  xiaobai: '记忆已暂停：这段时间上的课，小白不会再记。',
};

/** 近 7 天的学习行为（示例）：对话之外的占多数 */
const RECENT_SOURCES: [string, number][] = [
  ['对话', 12], ['闪卡', 9], ['题目集', 5], ['读讲义', 4], ['AI 课堂', 3], ['练一练', 3], ['笔记', 2], ['助理任务', 1], ['科研台', 1], ['资料库', 1],
];

// ───────────────────────── 记忆库复刻 ─────────────────────────

function MemoryBrowser() {
  const [who, setWho] = useState<RepoId>('xiaoyan');
  const [repos, setRepos] = useState<Record<RepoId, Repo>>(INITIAL);
  const [opened, setOpened] = useState<Record<RepoId, string>>({ xiaoyan: 'MEMORY.md', xiaobai: 'MEMORY.md' });
  const [paused, setPaused] = useState<Record<RepoId, boolean>>({ xiaoyan: false, xiaobai: false });
  const [raw, setRaw] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [jumpNote, setJumpNote] = useState('');
  const [historyNote, setHistoryNote] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [serial, setSerial] = useState(1);
  const [layer, setLayer] = useState<Layer | 'all'>('all');

  const repo = repos[who];
  const files = visibleFiles(who, repo.files);
  const path = files.some((file) => file.path === opened[who]) ? opened[who] : 'MEMORY.md';
  const file = FILES[who].find((item) => item.path === path)!;
  const title = file.folder ? `${FOLDER[file.folder]} · ${file.title}` : file.title;
  const dream = DREAMS[who];
  const dreamLive = (repo.files[dream.marker.path] ?? []).some((entry) => entry.id === dream.marker.id);
  const touched = repos !== INITIAL;

  const layerOn = who === 'xiaoyan' && layer !== 'all';
  const layered = layerOn
    ? files
      .filter((item) => !HIDE_EMPTY.includes(item.path))
      .flatMap((item) => (repo.files[item.path] ?? []).filter((entry) => entry.layer === layer).map((entry) => ({ entry, file: item })))
      .sort((a, b) => b.entry.day.localeCompare(a.entry.day))
    : [];

  const switchRepo = (next: RepoId) => {
    setWho(next);
    setLayer('all');
    setRaw(false);
    setTreeOpen(false);
    setJumpNote('');
    setHistoryNote('');
    setExpanded(null);
  };
  const openFile = (next: string) => {
    setOpened((current) => ({ ...current, [who]: next }));
    setLayer('all');
    setTreeOpen(false);
    setJumpNote('');
  };
  const undo = (id: string) => {
    const result = revertCommit(repo, id, serial);
    setSerial((value) => value + 1);
    if (!result) {
      setHistoryNote('这次改动涉及的条目后来都变过了，没有可撤的。');
      return;
    }
    setRepos((current) => ({ ...current, [who]: result.next }));
    const names = result.paths.map((changed) => FILES[who].find((item) => item.path === changed)?.title ?? changed);
    setHistoryNote(`已撤销这次改动，改回了：${names.join('、')}。新的一条「撤销」也能再撤。`);
  };
  const reset = () => {
    setRepos(INITIAL);
    setHistoryNote('已恢复成示例的样子。');
    setExpanded(null);
  };

  const folders = [...new Set(files.flatMap((item) => (item.folder ? [item.folder] : [])))];
  const treeItem = (item: (typeof files)[number], nested = false) => (
    <li key={item.path}>
      <button
        type="button"
        className={s.treeItem}
        data-nested={nested || undefined}
        aria-current={item.path === path ? 'page' : undefined}
        title={item.path}
        onClick={() => openFile(item.path)}
      >
        {!nested && <span className={s.treeIcon}>{FILE_ICON[item.path] ?? <FileText size={16} strokeWidth={1.75} />}</span>}
        <span className={s.treeName}>
          {item.title}
          {item.sub && <small>{item.sub}</small>}
        </span>
        {item.count > 0 && <em>{item.count}</em>}
      </button>
    </li>
  );

  return (
    <div className={`${base.stage} ${s.stage}`} data-reveal>
      <div className={`${base.panel} ${s.browser}`}>
        {/* 左：两份记忆的切换 + 文件树；窄屏收成一行，点开才列全部文件 */}
        <div className={s.side}>
          <Segmented
            block
            size="sm"
            label="两份记忆"
            value={who}
            onChange={switchRepo}
            className={s.repoSwitch}
            options={[
              { value: 'xiaoyan', label: REPO_NAME.xiaoyan },
              { value: 'xiaobai', label: REPO_NAME.xiaobai },
            ]}
          />
          <button
            type="button"
            className={s.treeToggle}
            aria-expanded={treeOpen}
            aria-controls="memory-tree"
            onClick={() => setTreeOpen((value) => !value)}
          >
            <ListTree size={16} strokeWidth={1.75} />
            <span className={s.treeToggleName}>{title}</span>
            <em>{files.length} 个文件</em>
            <ChevronDown size={16} strokeWidth={1.75} className={s.treeChevron} />
          </button>
          <nav id="memory-tree" className={s.tree} data-open={treeOpen || undefined} aria-label={`${REPO_NAME[who]}的文件`}>
            <ul>
              {files.filter((item) => !item.folder).map((item) => treeItem(item))}
              {folders.map((folder) => (
                <li key={folder}>
                  <span className={s.treeFolder}><FolderOpen size={16} strokeWidth={1.75} />{FOLDER[folder]}</span>
                  <ul>{files.filter((item) => item.folder === folder).map((item) => treeItem(item, true))}</ul>
                </li>
              ))}
            </ul>
          </nav>
          <p className={s.sideFoot}>保存在这个浏览器，按账号分开</p>
        </div>

        {/* 右：选中的文件 */}
        <div className={s.main}>
          <header className={s.mainHead}>
            <div className={s.mainTitle}>
              <p className={s.repoMark}><IconMemory size={14} />{REPO_NAME[who]}</p>
              <h3>
                {title}
                {paused[who] && <Badge tone="warn">已暂停</Badge>}
              </h3>
              <p>{paused[who] ? PAUSED_NOTE[who] : file.hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={paused[who]}
              className={s.pause}
              onClick={() => setPaused((current) => ({ ...current, [who]: !current[who] }))}
            >
              <span>暂停记忆</span>
              <i className={s.track} aria-hidden="true"><b /></i>
            </button>
          </header>

          {who === 'xiaoyan' && (
            <div className={s.layers}>
              <Segmented
                block
                size="sm"
                label="记忆保留层级"
                value={layer}
                onChange={setLayer}
                className={s.layerSwitch}
                options={[
                  { value: 'all', label: '全部' },
                  ...LAYERS.map((item) => ({ value: item.id, label: item.short, title: LAYER[item.id] })),
                ]}
              />
              <p className={s.layerHint}>
                {layerOn
                  ? `${LAYER[layer as Layer]}：${LAYERS.find((item) => item.id === layer)!.hint}`
                  : '当前问题优先。回答最多参考 3 条相关记忆；最近上下文不会变成长久偏好。'}
              </p>
            </div>
          )}

          {layerOn ? (
            <section aria-label={LAYER[layer as Layer]}>
              <ul className={s.layerList}>
                {layer === 'recent' && RECENT_CONTEXT.map((text) => (
                  <li key={text}>
                    <p>{text}</p>
                    <small>今天 · 临时上下文，不单独带入其他对话</small>
                  </li>
                ))}
                {layered.map(({ entry, file: home }) => (
                  <li key={entry.id}>
                    <p>{entry.text.replace(/，?详见 \[\[[^\]]*\]\]/, '')}</p>
                    <Button size="sm" variant="ghost" onClick={() => openFile(home.path)}>
                      查看与修改 · {home.folder ? `${FOLDER[home.folder]} · ` : ''}{home.title}
                    </Button>
                  </li>
                ))}
              </ul>
              {layer === 'short' && <p className={s.layerHint}>到期后停止用于回答，原记录仍可在对应文件中查看，之后自动归档。需要长期保留的可以改为长期记忆。</p>}
            </section>
          ) : (
          <>
          {who === 'xiaobai' && path === 'MEMORY.md' && (
            <section className={s.story} data-story aria-label="小白的话">
              <XiaobaiAvatar mood="happy" level={2} size={56} />
              <div>
                <p className={s.storyQuote}>先生教过我的课、打过的比方、我想通和没想通的地方，都记在这个小本子里。</p>
                <p className={s.storySign}>—— 小白</p>
              </div>
            </section>
          )}

          <div className={s.toolbar}>
            <span className={s.path}><FileText size={13} strokeWidth={1.75} />{path}</span>
            <Button size="sm" variant={raw ? 'soft' : 'ghost'} aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
              {raw ? '回到条目' : '原文'}
            </Button>
          </div>
          <p className={s.jumpNote} data-active={jumpNote ? '' : undefined} role="status" aria-live="polite">
            {jumpNote || ((repo.files[path] ?? []).some((entry) => jumpTarget(entry)) ? '点出处上的箭头，看这一条会回到哪里。' : '')}
          </p>

          {raw ? (
            <pre className={s.raw} tabIndex={0} aria-label={`${path} 的 Markdown 原文`}>{renderMarkdown(who, repo, file)}</pre>
          ) : (
            <FileEntries
              file={file}
              list={repo.files[path] ?? []}
              titleOf={(target) => FILES[who].find((item) => item.path === target)?.title ?? target}
              onOpenFile={openFile}
              onJump={(entry, target) => setJumpNote(`回到出处：在学习终端里，「${entry.label}」这一条会带你回到${target}。`)}
            />
          )}

          {!raw && path === 'MEMORY.md' && (
            <section className={s.block} aria-labelledby="memory-index-title">
              <h4 id="memory-index-title">索引</h4>
              <p>其余的细节在这些文件里，用到时才取。</p>
              <ul className={s.index}>
                {files.filter((item) => item.path !== 'MEMORY.md' && item.count > 0).map((item) => (
                  <li key={item.path}>
                    <button type="button" className={s.indexLink} onClick={() => openFile(item.path)}>
                      {item.folder ? <FolderOpen size={16} strokeWidth={1.75} /> : <FileText size={16} strokeWidth={1.75} />}
                      <strong>{item.folder ? `${FOLDER[item.folder]} · ` : ''}{item.title}</strong>
                      <code>{item.path}</code>
                      <em>{item.count} 条</em>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!raw && path === 'MEMORY.md' && (
            <section className={s.block} aria-labelledby="memory-sources-title">
              <h4 id="memory-sources-title">记忆从哪里来</h4>
              {who === 'xiaoyan' ? (
                <>
                  <p>近 7 天记下了 41 次学习行为，其中 29 次在对话之外。透露出卡住、学会、目标或兴趣的会进记忆库；只是「做了」的不记。</p>
                  <ul className={s.sourceRow} aria-label="近 7 天的学习行为">
                    {RECENT_SOURCES.map(([name, count]) => (
                      <li key={name} data-outside={name !== '对话' || undefined}>{name}<b>{count}</b></li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>小白的记忆来自你给他上的课（课堂记录在这里只读），和他自己做的梦。这份记忆不交给小砚。</p>
              )}
            </section>
          )}
          </>
          )}
        </div>
      </div>

      <div className={s.aside}>
        {/* 变更历史：每次写入一条，能撤 */}
        <section className={`${base.panel} ${s.card}`} aria-labelledby="memory-history-title">
          <header className={s.cardHead}>
            <History size={17} strokeWidth={1.75} />
            <h3 id="memory-history-title">变更历史</h3>
            {touched && (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={reset}>恢复示例</Button>
            )}
          </header>
          <p className={s.cardIntro}>每一次写入：自动记下的、你亲手改的，还是做梦整理的，改了哪几行。可以逐次撤销。</p>
          <p className={s.cardNote} role="status" aria-live="polite">{historyNote}</p>
          <ol className={s.commits}>
            {repo.commits.map((commit) => {
              const author = AUTHOR[commit.author];
              const open = expanded === commit.id;
              const paths = [...new Set(commit.changes.map((change) => change.path))];
              return (
                <li key={commit.id} className={s.commit} data-reverted={commit.reverted || undefined}>
                  <div className={s.commitHead}>
                    <button type="button" className={s.commitToggle} aria-expanded={open} onClick={() => setExpanded(open ? null : commit.id)}>
                      <span className={s.commitTitle}>
                        <ChevronRight size={15} strokeWidth={1.75} className={s.commitChevron} />
                        <span>{commit.message}</span>
                      </span>
                      <span className={s.commitMeta}>
                        <Badge tone={author.tone}>{author.label}</Badge>
                        <span>{commit.at}</span>
                        <span>{commit.changes.length} 处改动</span>
                        {commit.reverted && <span>已撤销</span>}
                      </span>
                    </button>
                    {commit.classroom ? (
                      <span className={s.commitAside}>随课堂记录更新</span>
                    ) : !commit.reverted && (
                      <Button size="sm" variant="ghost" icon={<Undo2 size={14} strokeWidth={1.75} />} aria-label={`撤销：${commit.message}`} onClick={() => undo(commit.id)}>
                        撤销
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className={s.diff}>
                      {paths.map((changed) => (
                        <div key={changed}>
                          <code className={s.diffPath}>{changed}</code>
                          <ul>
                            {commit.changes.filter((change) => change.path === changed).flatMap((change, index) => [
                              change.before && <li key={`${index}-`} data-sign="-"><b aria-label="去掉">−</b><span>{entryLine(change.before).slice(2)}</span></li>,
                              change.after && <li key={`${index}+`} data-sign="+"><b aria-label="新写">+</b><span>{entryLine(change.after).slice(2)}</span></li>,
                            ])}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* 做梦：整理直接生效，整场是一次提交 */}
        <section className={`${base.panel} ${s.card}`} aria-labelledby="memory-dream-title">
          <header className={s.cardHead}>
            <MoonStar size={17} strokeWidth={1.75} />
            <h3 id="memory-dream-title">{dream.name}</h3>
            <span className={s.cardAside}>每个角色至少隔 18 小时</span>
          </header>
          <p className={s.cardIntro}>{dream.about}</p>
          <article className={who === 'xiaobai' ? s.paper : s.dream} data-story={who === 'xiaobai' || undefined}>
            <header>
              <h4>{dream.title}</h4>
              <div className={s.dreamMeta}>
                <span>{dream.at}</span>
                {who === 'xiaobai' ? (
                  <>
                    <span className={s.paperTag}>{dream.method}</span>
                    <span className={s.paperTag}>已生效</span>
                  </>
                ) : (
                  <>
                    <Badge tone="neutral">{dream.method}</Badge>
                    <Badge tone="outline">已生效</Badge>
                  </>
                )}
              </div>
            </header>
            <p className={s.narrative}>{dream.narrative}</p>
            {who === 'xiaobai' && <p className={s.sign}>—— 小白，醒来记</p>}
            <p className={s.ops}>{dream.ops.split(' · ').map((part) => <span key={part}>{part}</span>)}</p>
            <dl className={s.groups}>
              {dream.groups.map((group) => (
                <div key={group.kind} data-kind={group.kind}>
                  <dt>{group.label}</dt>
                  <dd>
                    <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  </dd>
                </div>
              ))}
            </dl>
          </article>
          <div className={s.dreamFoot}>
            <p role="status" aria-live="polite">
              {paused[who]
                ? '记忆暂停着，暂停期间不整理。'
                : dreamLive
                  ? '整理直接生效，不用逐条确认。整场梦是变更历史里的一次提交，可以整场撤销。'
                  : '这场梦的改动已撤销，记忆库回到了梦之前的样子。变更历史里那条「撤销」还能再撤回来。'}
            </p>
            {dreamLive && repo.commits.some((commit) => commit.id === dream.commitId && !commit.reverted) && (
              <Button size="sm" variant="outline" icon={<Undo2 size={14} strokeWidth={1.75} />} onClick={() => undo(dream.commitId)}>
                撤销这场梦
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** 一个文件的条目：按小节分组，每条带出处（能回去的带箭头）、日期、层级与标记 */
function FileEntries({ file, list, titleOf, onOpenFile, onJump }: {
  file: FileDef;
  list: Entry[];
  titleOf: (path: string) => string;
  onOpenFile: (path: string) => void;
  onJump: (entry: Entry, target: string) => void;
}) {
  const groups = groupEntries(file, list);
  if (!groups.length) return <p className={s.empty}>这个文件还空着。{file.hint}</p>;
  const withLinks = (text: string) => {
    const parts = text.split(/\[\[([^\]]+)\]\]/);
    if (parts.length === 1) return text;
    return parts.map((part, index) => (index % 2 === 0
      ? part
      : <button key={part} type="button" className={s.inlineLink} title={part} onClick={() => onOpenFile(part)}>{titleOf(part)}</button>));
  };
  return (
    <div className={s.groupsList}>
      {groups.map((group) => (
        <div key={group.label ?? 'all'} role="group" aria-label={group.label ?? file.title}>
          {group.label && <h4 className={s.groupHead}>{group.label}<span>{group.entries.length}</span></h4>}
          <ul className={s.entries}>
            {group.entries.map((entry) => {
              const target = jumpTarget(entry);
              return (
                <li key={entry.id} className={s.entry}>
                  <p className={s.entryText}>
                    {entry.pinned && <Pin size={13} strokeWidth={2} className={s.pin} aria-label="已置顶" />}
                    {withLinks(entry.text)}
                  </p>
                  <div className={s.entryMeta}>
                    {target ? (
                      <button type="button" className={s.sourceChip} title="回到它被记下的地方" onClick={() => onJump(entry, target)}>
                        <span>{entry.label}<ArrowUpRight size={12} strokeWidth={1.75} /></span>
                      </button>
                    ) : (
                      <span className={s.sourceChip}><span>{entry.label}</span></span>
                    )}
                    <span>{dayText(entry.day)}</span>
                    {entry.layer && <Badge>{LAYER[entry.layer]}</Badge>}
                    {(entry.seen ?? 1) > 1 && <span>提到 {entry.seen} 次</span>}
                    {entry.author === 'dream' && <Badge tone="accent">做梦整理</Badge>}
                    {entry.author === 'user' && <Badge>我写的</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── 功能清单 ─────────────────────────

const CAPS: Cap[] = [
  { icon: UsersRound, title: '两份记忆', text: '小砚记得你：讲法偏好、目标、薄弱点、已掌握、习惯和各门课；小白记得你教过他的课。两份分开保存，小白的这份不交给小砚。' },
  { icon: FolderTree, title: 'Markdown 文件树', text: 'MEMORY.md 是每次都带上的要点和索引，细节放在主题文件和各门课的文件里，用到时才取。可以切到「原文」看 Markdown。' },
  { icon: ArrowUpRight, title: '出处与日期', text: '每条记忆都写着出处和日期，点出处回到它被记下的地方：工作台里的那组闪卡、那份题目集、AI 课堂、科研台或那门课。' },
  { icon: Activity, title: '来自全部学习行为', text: '对话、读讲义、带我学、练一练、闪卡、笔记、题目集、AI 课堂、助理任务、资料库、科研台、给小白上课和小白赴考都会送进来；只是「做了」的不记。' },
  { icon: Layers, title: '三层保留', text: '最近记忆留 24 小时，普通阅读、上传和一次性任务只算最近上下文；短期记忆 7 天未再提及就淡出回答；长期记忆只来自你明确要求或跨天反复确认。到期的立即退出检索，之后自动归档，原文和历史都留着；层级可以手动调整。' },
  { icon: Target, title: '相关才用', text: '当前问题优先：每次回答最多参考 3 条相关记忆，共不超过 240 字，不强行关联旧兴趣、旧目标。' },
  { icon: History, title: '可撤销的变更记录', text: '每次写入都是一次提交：谁写的、为什么、改了哪几行，能看差异，也能逐次撤销。' },
  { icon: PencilLine, title: '亲手修改', text: '可以添一条、改、删、置顶，切换记忆层级。删掉的自动记录不会再被自动记回来。' },
  { icon: CopyCheck, title: '整理重复内容', text: '同一位置、同样内容的记录并成一条，留下置顶的、改过的、手写的那条，再看新旧，出现次数累加；整批合并也能撤销。' },
  { icon: MoonStar, title: '做梦整理', text: '学习终端开着时找空闲整理：从跨行为的规律里提炼新条目、合并重复、归档过时、按出处与日期裁决前后矛盾，并让 MEMORY.md 保持简短。每个角色至少隔 18 小时，也可以现在整理。' },
  { icon: Undo2, title: '一场梦一次提交', text: '整理直接生效，不用逐条确认；一场梦的全部改动是变更历史里的一次提交，可以整场撤销。有模型时由模型整理，没有时按本地规则整理。' },
  { icon: ShieldCheck, title: '你写的不被改', text: '置顶的、你写的、你改过的条目，做梦时除了一字不差的重复之外一概不动。' },
  { icon: NotebookPen, title: '小白的梦', text: '小白回放你教过的课：记牢的、开始模糊的，醒来把想问你的一句记进「还想问的」，下一堂课会用上。课堂数据在这里只读。' },
  { icon: PauseCircle, title: '暂停与清空', text: '暂停后不再记入新的学习行为，回答时也不带记忆，暂停期间也不做梦；小砚的记忆库可以一键清空。' },
  { icon: Lock, title: '存在这个浏览器', text: '密码、手机号、邮箱这类信息不会被记下。记忆库按账号保存在当前浏览器，换设备或清除浏览器数据后不会跟过去。' },
];

export function MemoryChapter() {
  const meta = sectionById('memory');
  return (
    <section id={meta.id} className={`${base.chapter} ${base.chapterTinted}`} aria-labelledby="memory-title">
      <div className={base.wrap}>
        <ChapterHead
          no={meta.no!}
          glyph={meta.glyph!}
          name={meta.label}
          titleId="memory-title"
          title="小砚记得你，小白记得你教过的课"
          lead="两份记忆各是一棵 Markdown 文件树。每一条写着出处和日期，每一次写入都能撤销；空闲时，它们会做梦，把自己整理一遍。"
        />
        <div className={base.chapterBody}>
          <p className={s.tryLine} data-reveal>可以点：切换小砚和小白、打开文件、点出处、撤销一次写入、打开「暂停记忆」。</p>
          <MemoryBrowser />
          <Caps label="记忆库的全部能力" items={CAPS} />
        </div>
      </div>
    </section>
  );
}
