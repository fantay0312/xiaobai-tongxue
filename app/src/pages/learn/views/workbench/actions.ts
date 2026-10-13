import { logActivity } from '../../../../engine/activityLog';
import { studyData, type QuestionType } from '../../../../store/studyData';
import { generateDeck, generateMindMap, generateNote, generateQuiz, generateTodos, type GenInput } from './generate';
import type { ToolId } from './util';

export type GenKind = 'note' | 'mindmap' | 'quiz' | 'deck' | 'todos';
export const KIND_TOOL: Record<GenKind, ToolId> = { note: 'notes', mindmap: 'mindmap', quiz: 'quiz', deck: 'flashcards', todos: 'todos' };
export interface GenOptions { quizCount?: number; quizTypes?: QuestionType[]; deckCount?: number }
export interface Created { kind: GenKind; id: string | null; local: boolean; summary: string }

/** 生成并写入工作台数据。内容为空时抛 Error('gen-empty')。 */
export async function createFromAI(kind: GenKind, owner: string | null, input: GenInput, options: GenOptions = {}): Promise<Created> {
  const link = input.topic ? { topicId: input.topic.topicId } : {};
  const course = input.topic ? { topicId: input.topic.topicId, topicTitle: input.topic.title } : {};
  switch (kind) {
    case 'note': {
      const { data, local } = await generateNote(input);
      if (!data.body.trim()) throw new Error('gen-empty');
      const saved = studyData.saveNote(owner, { ...data, ...link });
      logActivity(owner, { source: 'note', summary: `让小砚整理了笔记《${saved.title}》`, ...course, ref: { kind: 'note', id: saved.id, title: saved.title } });
      return { kind, id: saved.id, local, summary: `笔记「${saved.title}」` };
    }
    case 'mindmap': {
      const { data, local } = await generateMindMap(input);
      if (!data.root.children.length) throw new Error('gen-empty');
      const saved = studyData.saveMindMap(owner, { ...data, ...link });
      logActivity(owner, { source: 'mindmap', summary: `做了一张思维导图《${saved.title}》`, ...course, ref: { kind: 'mindmap', id: saved.id, title: saved.title } });
      return { kind, id: saved.id, local, summary: `思维导图「${saved.title}」` };
    }
    case 'quiz': {
      const { data, local } = await generateQuiz(input, { count: options.quizCount ?? 8, types: options.quizTypes ?? [] });
      if (!data.questions.length) throw new Error('gen-empty');
      const saved = studyData.saveQuizSet(owner, { ...data, ...link });
      logActivity(owner, { source: 'quiz', summary: `出了一套练习题《${saved.title}》，共 ${saved.questions.length} 题`, ...course, ref: { kind: 'quiz', id: saved.id, title: saved.title } });
      return { kind, id: saved.id, local, summary: `${saved.questions.length} 道题` };
    }
    case 'deck': {
      const { data, local } = await generateDeck(input, options.deckCount ?? 12);
      if (!data.cards.length) throw new Error('gen-empty');
      const saved = studyData.saveDeck(owner, { ...data, ...link });
      logActivity(owner, { source: 'flashcards', summary: `做了一组闪卡《${saved.title}》，共 ${saved.cards.length} 张`, ...course, ref: { kind: 'deck', id: saved.id, title: saved.title } });
      return { kind, id: saved.id, local, summary: `${saved.cards.length} 张闪卡` };
    }
    case 'todos': {
      const { data, local } = await generateTodos(input);
      if (!data.length) throw new Error('gen-empty');
      // addTodo 每次插到最前，倒着加才能保持原顺序
      for (const todo of [...data].reverse()) studyData.addTodo(owner, { ...todo, ...link });
      logActivity(owner, { source: 'todo', summary: `排了 ${data.length} 条学习待办`, signal: 'goal', detail: data.map((todo) => todo.text).join('；'), ...course });
      return { kind, id: null, local, summary: `${data.length} 条待办` };
    }
  }
}

export const isAbort = (error: unknown) => error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError';
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message === 'gen-empty') return '材料太少，没能整理出内容。补充一段更完整的文字再试。';
  return '这次没有成功：模型没有返回可用的内容。可以重试，或先用本地演示。';
}
