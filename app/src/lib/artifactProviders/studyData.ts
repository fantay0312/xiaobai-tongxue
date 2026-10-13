/**
 * 工作台数据的成果提供者：笔记、思维导图、题目集、闪卡、待办清单、作文与翻译。
 * 只读 store/studyData，把每一类转写成可读的 Markdown，供资料库、对话来源和导出使用。
 * 以副作用方式引入即可：import '…/lib/artifactProviders/studyData'。
 */
import {
  ARTIFACT_LABELS, registerArtifactProvider,
  type Artifact, type ArtifactContent, type ArtifactKind, type ArtifactOrigin,
} from '../artifacts';
import {
  studyData, subscribeStudyData,
  type Deck, type MindMap, type MindNode, type Origin, type QuizQuestion, type QuizSet, type StudyData, type StudyNote, type Todo, type WritingDoc,
} from '../../store/studyData';
import { getTopic } from '../../data';
import { getItemOrigin } from '../../pages/learn/views/workbench/origins';
// 终端一启动就会引入本文件：顺带让「自动存一份到资料库」在后台待命，不必等用户先打开资料库
import '../librarySync';

type WorkbenchKind = Extract<ArtifactKind, 'note' | 'mindmap' | 'quiz' | 'deck' | 'todo-list' | 'writing'>;

const TOOL: Record<WorkbenchKind, string> = {
  note: 'notes', mindmap: 'mindmap', quiz: 'quiz', deck: 'flashcards', 'todo-list': 'todos', writing: 'writing',
};
/** 待办整张清单算一份成果 */
const TODO_LIST_ID = 'all';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** 去掉 Markdown 记号，取一行摘要 */
const plain = (markdown: string) => markdown
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
  .replace(/[*_`~$|]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const safeName = (title: string) => title.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名';
const day = (iso?: string) => {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return iso ?? '';
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

function originOf(owner: string | null, origin: Origin, kind: WorkbenchKind, id: string): ArtifactOrigin {
  // 生成时记下的精确出处（哪次对话、哪节课、哪个任务）优先
  const exact = getItemOrigin(owner, `${kind}:${id}`);
  if (exact) return exact;
  if (origin === 'agent') return { section: 'agent', label: '助理任务写入', open: { view: 'agent' } };
  if (origin === 'chat') return { section: 'chat', label: '从对话保存', open: { view: 'ask' } };
  return { section: 'workbench', label: `工作台 · ${ARTIFACT_LABELS[kind]}`, open: { view: 'workbench', params: { tool: TOOL[kind], id } } };
}

function base(owner: string | null, kind: WorkbenchKind, item: { id: string; topicId?: string; origin: Origin; createdAt: string; updatedAt?: string }, title: string, summary: string): Artifact {
  const topic = item.topicId ? getTopic(item.topicId) : undefined;
  return {
    key: `${kind}:${item.id}`,
    kind,
    id: item.id,
    title,
    summary,
    ...(item.topicId ? { topicId: item.topicId } : {}),
    ...(topic ? { topicTitle: topic.title } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt ?? item.createdAt,
    madeBy: item.origin === 'user' ? 'user' : 'ai',
    origin: originOf(owner, item.origin, kind, item.id),
    open: { view: 'workbench', params: { tool: TOOL[kind], id: item.id } },
  };
}

const countNodes = (node: MindNode): number => 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);

/* ── 转写成 Markdown ── */
const heading = (title: string) => `# ${title}\n\n`;

function noteText(note: StudyNote): string {
  const title = note.title || '未命名笔记';
  // 正文自己带了同名一级标题就不再重复
  const body = note.body.trim();
  const titled = body.startsWith(`# ${title}`);
  return `${titled ? '' : heading(title)}${body}${note.tags.length ? `\n\n标签：${note.tags.join('、')}` : ''}\n`;
}

function outline(node: MindNode, depth = 0): string {
  const text = node.text.replace(/\s+/g, ' ').trim() || '（空）';
  const note = node.note?.replace(/\s+/g, ' ').trim();
  const line = `${'  '.repeat(depth)}- ${text}${note ? ` —— ${note}` : ''}`;
  return [line, ...node.children.map((child) => outline(child, depth + 1))].join('\n');
}
const mindMapText = (map: MindMap) => `${heading(map.title || '未命名导图')}${outline(map.root)}\n`;

const TYPE_NAMES: Record<QuizQuestion['type'], string> = { single: '单选', multiple: '多选', truefalse: '判断', blank: '填空', short: '简答' };
const letter = (index: number) => String.fromCharCode(65 + index);
function answerText(question: QuizQuestion): string {
  if (typeof question.answer === 'string') return question.answer.trim() || '（未给出）';
  const options = question.options ?? [];
  return question.answer.map((index) => (options[index] === undefined ? letter(index) : `${letter(index)}. ${options[index]}`)).join('；') || '（未给出）';
}
function quizText(set: QuizSet): string {
  const blocks = set.questions.map((question, index) => {
    const options = (question.options ?? []).map((option, at) => `- ${letter(at)}. ${option}`).join('\n');
    return [
      `## ${index + 1}. （${TYPE_NAMES[question.type] ?? '题目'}）${question.stem.trim()}`,
      options,
      `**答案**：${answerText(question)}`,
      question.explanation?.trim() ? `**解析**：${question.explanation.trim()}` : '',
    ].filter(Boolean).join('\n\n');
  });
  return `${heading(set.title || '未命名题目集')}共 ${set.questions.length} 道题。\n\n${blocks.join('\n\n')}\n`;
}

function deckText(deck: Deck): string {
  const cards = deck.cards.map((card, index) => `## 卡片 ${index + 1}\n\n**问**：${card.front.trim()}\n\n**答**：${card.back.trim()}`);
  return `${heading(deck.title || '未命名卡组')}共 ${deck.cards.length} 张卡片。\n\n${cards.join('\n\n')}\n`;
}

function todoText(todos: Todo[]): string {
  const line = (todo: Todo) => `- [${todo.done ? 'x' : ' '}] ${todo.text.replace(/\s+/g, ' ').trim()}${todo.due && !todo.done ? `（截止 ${day(todo.due)}）` : ''}`;
  const open = todos.filter((todo) => !todo.done);
  const done = todos.filter((todo) => todo.done);
  return [
    heading('待办清单').trimEnd(),
    open.length ? `## 未完成（${open.length}）\n\n${open.map(line).join('\n')}` : '',
    done.length ? `## 已完成（${done.length}）\n\n${done.map(line).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').concat('\n');
}

function writingText(doc: WritingDoc): string {
  const essay = doc.kind === 'essay';
  return [
    heading(doc.title || (essay ? '未命名作文' : '未命名翻译')).trimEnd(),
    doc.source.trim() ? `## ${essay ? '题目与要求' : '原文'}\n\n${doc.source.trim()}` : '',
    doc.draft.trim() ? `## ${essay ? '我的作文' : '我的译文'}\n\n${doc.draft.trim()}` : '',
    doc.feedback?.trim() ? `## 批改意见${doc.score === undefined ? '' : `（${doc.score} 分）`}\n\n${doc.feedback.trim()}` : '',
  ].filter(Boolean).join('\n\n').concat('\n');
}

/* ── 列表 ── */
function todoListArtifact(todos: Todo[]): Artifact[] {
  if (!todos.length) return [];
  const stamps = todos.flatMap((todo) => [todo.createdAt, todo.doneAt]).filter((value): value is string => !!value).sort();
  const open = todos.filter((todo) => !todo.done).length;
  return [{
    key: `todo-list:${TODO_LIST_ID}`,
    kind: 'todo-list',
    id: TODO_LIST_ID,
    title: '待办清单',
    summary: `未完成 ${open} 项 · 已完成 ${todos.length - open} 项`,
    createdAt: stamps[0],
    updatedAt: stamps[stamps.length - 1],
    madeBy: 'user',
    origin: { section: 'workbench', label: '工作台 · 待办', open: { view: 'workbench', params: { tool: 'todos' } } },
    open: { view: 'workbench', params: { tool: 'todos' } },
  }];
}

const lists: Record<WorkbenchKind, (data: StudyData, owner: string | null) => Artifact[]> = {
  note: (data, owner) => data.notes.map((note) => base(owner, 'note', note, note.title || '未命名笔记', clip(plain(note.body), 90) || '空白笔记')),
  mindmap: (data, owner) => data.mindmaps.map((map) => base(owner, 'mindmap', map, map.title || '未命名导图', `${countNodes(map.root)} 个节点${map.root.children.length ? ` · ${clip(map.root.children.map((child) => child.text).join('、'), 60)}` : ''}`)),
  quiz: (data, owner) => data.quizSets.map((set) => {
    const last = set.attempts[set.attempts.length - 1];
    return base(owner, 'quiz', set, set.title || '未命名题目集', `${set.questions.length} 道题${last ? ` · 上次答对 ${last.correct}/${last.total}` : ' · 还没做过'}${set.wrongIds.length ? ` · 错题 ${set.wrongIds.length}` : ''}`);
  }),
  deck: (data, owner) => data.decks.map((deck) => {
    const due = deck.cards.filter((card) => Date.parse(card.due) <= Date.now()).length;
    return base(owner, 'deck', deck, deck.title || '未命名卡组', `${deck.cards.length} 张卡片${due ? ` · ${due} 张到期` : ''}`);
  }),
  'todo-list': (data) => todoListArtifact(data.todos),
  writing: (data, owner) => data.writings.map((doc) => base(owner, 'writing', doc, doc.title || (doc.kind === 'essay' ? '未命名作文' : '未命名翻译'),
    `${doc.kind === 'essay' ? '作文' : '翻译'}${doc.feedback ? ` · 已批改${doc.score === undefined ? '' : ` ${doc.score} 分`}` : ' · 未批改'}${doc.draft ? ` · ${clip(plain(doc.draft), 50)}` : ''}`)),
};

const file = (title: string, text: string): ArtifactContent => ({ title, text, filename: `${safeName(title)}.md`, mime: 'text/markdown' });
const contents: Record<WorkbenchKind, (data: StudyData, id: string) => ArtifactContent | null> = {
  note: (data, id) => { const note = data.notes.find((item) => item.id === id); return note ? file(note.title || '未命名笔记', noteText(note)) : null; },
  mindmap: (data, id) => { const map = data.mindmaps.find((item) => item.id === id); return map ? file(map.title || '未命名导图', mindMapText(map)) : null; },
  quiz: (data, id) => { const set = data.quizSets.find((item) => item.id === id); return set ? file(set.title || '未命名题目集', quizText(set)) : null; },
  deck: (data, id) => { const deck = data.decks.find((item) => item.id === id); return deck ? file(deck.title || '未命名卡组', deckText(deck)) : null; },
  'todo-list': (data, id) => (id === TODO_LIST_ID && data.todos.length ? file('待办清单', todoText(data.todos)) : null),
  writing: (data, id) => { const doc = data.writings.find((item) => item.id === id); return doc ? file(doc.title || (doc.kind === 'essay' ? '未命名作文' : '未命名翻译'), writingText(doc)) : null; },
};

/* ── 变化通知 ── 工作台数据一变就通知登记处 */
const watchers = new Set<() => void>();
let stop: (() => void) | undefined;
const check = () => watchers.forEach((notify) => notify());
function watch(notify: () => void): () => void {
  watchers.add(notify);
  stop ??= subscribeStudyData(check);
  return () => {
    watchers.delete(notify);
    if (!watchers.size) { stop?.(); stop = undefined; }
  };
}

/** 手动催一次刷新 */
export function refreshStudyArtifacts(): void { check(); }

// 每一类单独注册：登记处按「提供者 + id」取内容，分开后不同类型的 id 不会互相撞
(Object.keys(lists) as WorkbenchKind[]).forEach((kind, index) => {
  registerArtifactProvider(`study-data:${kind}`, {
    list: (owner) => lists[kind](studyData.get(owner), owner),
    content: (owner, id) => contents[kind](studyData.get(owner), id),
    // 六类共用一个订阅，只挂在第一个提供者上
    ...(index === 0 ? { subscribe: watch } : {}),
  });
});
