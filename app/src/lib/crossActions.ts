/**
 * 跨板块动作（契约）—— 任何一段内容，都可以就地变成别的东西，而不用先切到另一个板块。
 * 对话里的回答、笔记里选中的一段、AI 课的一幕、助理的成果、科研台的文件，都走这一套。
 * 生成与校验用的是工作台那一套（views/workbench/generate）：有模型走模型，没有模型按规则从内容里抽取。
 * 这里不依赖任何界面组件，可以在事件处理、Agent 工具里直接调用。
 */
import { logActivity } from '../engine/activityLog';
import { generateDeck, generateMindMap, generateQuiz, generateTodos } from '../pages/learn/views/workbench/generate';
import { setItemOrigin } from '../pages/learn/views/workbench/origins';
import { studyData, type Origin } from '../store/studyData';
import type { ArtifactOrigin } from './artifacts';

export type CrossAction = 'save-note' | 'make-flashcards' | 'make-mindmap' | 'make-quiz' | 'add-todos';

export const CROSS_ACTION_LABELS: Record<CrossAction, string> = {
  'save-note': '存为笔记', 'make-flashcards': '做成闪卡', 'make-mindmap': '整理成导图', 'make-quiz': '出几道题', 'add-todos': '拆成待办',
};

export interface CrossActionInput {
  /** 要处理的内容（Markdown） */
  text: string;
  /** 建议的标题；不给就由内容推一个 */
  title?: string;
  topicId?: string;
  topicTitle?: string;
  /** 内容从哪儿来，写进成果的来源里，便于跳回 */
  origin: ArtifactOrigin;
  signal?: AbortSignal;
}

export interface CrossActionResult {
  /** 新成果的登记键，如 note:xxx */
  artifactKey: string;
  title: string;
  /** 打开它的终端位置 */
  open: { view: string; params?: Record<string, string> };
  /** local=没有模型，按规则从内容里抽取的 */
  method: 'model' | 'local';
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** 没给标题时，取第一个小标题或第一行 */
function deriveTitle(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,4}\s+\S/.test(line));
  const first = (heading ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '').replace(/^\s*(?:[-*+•>]|\d+[.)、])\s*/, '').replace(/[*_`~$]/g, '').trim();
  return clip(first.split(/[。！？!?\n]/)[0] || first, 24) || '未命名';
}

/** 工作台条目上的来源标记只有三种，细节记在来源表里 */
const originMark = (origin: ArtifactOrigin): Origin => (origin.section === 'agent' ? 'agent' : origin.section === 'chat' ? 'chat' : 'user');

const isAbort = (error: unknown) => (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';

function failure(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (message === 'cross-empty') return new Error('内容太少，没能整理出东西');
  if (message === 'model-auth') return new Error('登录已失效，重新登录后再试');
  if (message === 'model-busy') return new Error('模型正忙，过一会儿再试');
  if (message === 'model-timeout') return new Error('模型响应超时，可以再试一次');
  return new Error('这次没有成功，可以再试一次');
}

/** 执行一个跨板块动作。失败抛 Error，message 是可以直接给用户看的中文原因。 */
export async function runCrossAction(owner: string | null, action: CrossAction, input: CrossActionInput): Promise<CrossActionResult> {
  const text = (input.text ?? '').trim();
  if (text.length < 2) throw new Error('没有可以处理的内容');
  if (input.signal?.aborted) throw new DOMException('Stopped', 'AbortError');

  const given = input.title?.trim();
  const base = clip(given || deriveTitle(text), 40);
  const link = input.topicId ? { topicId: input.topicId } : {};
  const mark = originMark(input.origin);
  const gen = { sources: [], text, signal: input.signal };
  const from = input.origin.label ? `从「${clip(input.origin.label, 24)}」` : '';
  const course = { ...(input.topicId ? { topicId: input.topicId } : {}), ...(input.topicTitle ? { topicTitle: input.topicTitle } : {}) };
  // 登记键与成果登记处（lib/artifactProviders/studyData）一致：`${kind}:${id}`
  const done = (kind: string, tool: string, id: string, title: string, local: boolean): CrossActionResult => {
    const artifactKey = `${kind}:${id}`;
    setItemOrigin(owner, artifactKey, input.origin);
    return { artifactKey, title, open: { view: 'workbench', params: { tool, id } }, method: local ? 'local' : 'model' };
  };

  try {
    switch (action) {
      case 'save-note': {
        // 存为笔记是原样保存，不经过模型
        const saved = studyData.saveNote(owner, { title: base, body: text.slice(0, 40_000), origin: mark, ...link });
        logActivity(owner, { source: 'note', summary: `${from}存了一篇笔记《${clip(saved.title, 24)}》`, ...course, ref: { kind: 'note', id: saved.id, title: saved.title } });
        return done('note', 'notes', saved.id, saved.title, false);
      }
      case 'make-flashcards': {
        const { data, local } = await generateDeck(gen, text.length > 1500 ? 12 : 8);
        if (!data.cards.length) throw new Error('cross-empty');
        const saved = studyData.saveDeck(owner, { title: given ? `${base} · 闪卡` : data.title, cards: data.cards, origin: mark, ...link });
        logActivity(owner, { source: 'flashcards', summary: `${from}做了 ${saved.cards.length} 张闪卡《${clip(saved.title, 24)}》`, ...course, ref: { kind: 'deck', id: saved.id, title: saved.title } });
        return done('deck', 'flashcards', saved.id, saved.title, local);
      }
      case 'make-mindmap': {
        const { data, local } = await generateMindMap(gen);
        if (!data.root.children.length) throw new Error('cross-empty');
        const saved = studyData.saveMindMap(owner, { title: given ? `${base} · 思维导图` : data.title, root: data.root, origin: mark, ...link });
        logActivity(owner, { source: 'mindmap', summary: `${from}整理了思维导图《${clip(saved.title, 24)}》`, ...course, ref: { kind: 'mindmap', id: saved.id, title: saved.title } });
        return done('mindmap', 'mindmap', saved.id, saved.title, local);
      }
      case 'make-quiz': {
        const { data, local } = await generateQuiz(gen, { count: text.length > 1500 ? 8 : 5, types: [] });
        if (!data.questions.length) throw new Error('cross-empty');
        const saved = studyData.saveQuizSet(owner, { title: given ? `${base} · 练习题` : data.title, questions: data.questions, origin: mark, ...link });
        logActivity(owner, { source: 'quiz', summary: `${from}出了 ${saved.questions.length} 道题《${clip(saved.title, 24)}》`, ...course, ref: { kind: 'quiz', id: saved.id, title: saved.title } });
        return done('quiz', 'quiz', saved.id, saved.title, local);
      }
      case 'add-todos': {
        const { data, local } = await generateTodos(gen);
        if (!data.length) throw new Error('cross-empty');
        // addTodo 每次插到最前，倒着加才能保持原顺序
        const added = [...data].reverse().map((todo) => studyData.addTodo(owner, { ...todo, origin: mark, ...link })).reverse();
        for (const todo of added) setItemOrigin(owner, `todo:${todo.id}`, input.origin);
        logActivity(owner, { source: 'todo', summary: `${from}拆出 ${added.length} 条待办`, signal: 'goal', detail: added.map((todo) => todo.text).join('；'), ...course, ref: { kind: 'todo-list', id: 'all', title: base } });
        // 待办整张清单算一份成果（todo-list:all）；来源记在每一条待办上
        return { artifactKey: 'todo-list:all', title: `${added.length} 条待办`, open: { view: 'workbench', params: { tool: 'todos' } }, method: local ? 'local' : 'model' };
      }
    }
  } catch (error) {
    if (isAbort(error) || input.signal?.aborted) throw error;
    throw failure(error);
  }
}
