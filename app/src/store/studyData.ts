/**
 * 学习工作台数据 —— 笔记、思维导图、题目集、闪卡、待办、作文与翻译。
 * 界面（pages/learn/views/workbench）与 Agent 工具（engine/agent）共用这一份数据：
 * Agent 调工具即写入这里，界面立刻可见。按账号分开，保存在当前浏览器。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** user=自己写的 agent=助理任务写入 chat=从对话保存 */
export type Origin = 'user' | 'agent' | 'chat';

export interface StudyNote { id: string; title: string; body: string; topicId?: string; tags: string[]; origin: Origin; createdAt: string; updatedAt: string }
export interface MindNode { id: string; text: string; note?: string; children: MindNode[] }
export interface MindMap { id: string; title: string; root: MindNode; topicId?: string; origin: Origin; createdAt: string; updatedAt: string }
export type QuestionType = 'single' | 'multiple' | 'truefalse' | 'blank' | 'short';
export interface QuizQuestion {
  id: string; type: QuestionType; stem: string;
  /** single / multiple / truefalse 的选项 */
  options?: string[];
  /** single、truefalse：[下标]；multiple：多个下标；blank、short：参考答案文本 */
  answer: number[] | string;
  explanation: string; difficulty?: 1 | 2 | 3; tags?: string[];
}
export interface QuizAttempt { at: string; answers: Record<string, number[] | string>; correct: number; total: number }
export interface QuizSet { id: string; title: string; topicId?: string; questions: QuizQuestion[]; attempts: QuizAttempt[]; wrongIds: string[]; origin: Origin; createdAt: string; updatedAt: string }
export interface Flashcard { id: string; front: string; back: string; due: string; interval: number; ease: number; reps: number; lapses: number }
export interface Deck { id: string; title: string; topicId?: string; cards: Flashcard[]; origin: Origin; createdAt: string; updatedAt: string }
export interface Todo { id: string; text: string; done: boolean; due?: string; topicId?: string; origin: Origin; createdAt: string; doneAt?: string }
export interface WritingDoc {
  id: string; kind: 'essay' | 'translation'; title: string;
  /** 作文题目与要求，或待翻译的原文 */
  source: string;
  /** 我的作文或译文 */
  draft: string;
  /** 批改意见（Markdown） */
  feedback?: string; score?: number; origin: Origin; createdAt: string; updatedAt: string;
}
export interface StudyData { notes: StudyNote[]; mindmaps: MindMap[]; quizSets: QuizSet[]; decks: Deck[]; todos: Todo[]; writings: WritingDoc[] }
export type StudyCollection = keyof StudyData;
export type CardRating = 'again' | 'hard' | 'good' | 'easy';

const CAPS: Record<StudyCollection, number> = { notes: 300, mindmaps: 80, quizSets: 80, decks: 80, todos: 300, writings: 120 };
export const emptyStudyData = (): StudyData => ({ notes: [], mindmaps: [], quizSets: [], decks: [], todos: [], writings: [] });
export const ownerKey = (owner: string | null) => owner ?? 'local';
export const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();

const useStore = create<{ byOwner: Record<string, StudyData> }>()(
  persist(() => ({ byOwner: {} as Record<string, StudyData> }), {
    name: 'xiaobai-study-data-v1',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => {
      const stored = (persisted ?? {}) as { byOwner?: Record<string, Partial<StudyData>> };
      const byOwner: Record<string, StudyData> = {};
      for (const [key, value] of Object.entries(stored.byOwner ?? {})) {
        const base = emptyStudyData();
        byOwner[key] = Object.fromEntries((Object.keys(base) as StudyCollection[]).map((name) => [name, Array.isArray(value?.[name]) ? value[name] : []])) as unknown as StudyData;
      }
      return { ...current, byOwner };
    },
  }),
);

function mutate(owner: string | null, update: (data: StudyData) => StudyData) {
  const key = ownerKey(owner);
  useStore.setState((state) => ({ byOwner: { ...state.byOwner, [key]: update(state.byOwner[key] ?? emptyStudyData()) } }));
}

type Stamped = { id: string; createdAt: string; updatedAt?: string };
function upsert<K extends StudyCollection>(owner: string | null, collection: K, input: Partial<StudyData[K][number]>, defaults: Omit<StudyData[K][number], 'id' | 'createdAt' | 'updatedAt'>): StudyData[K][number] {
  const stamp = now();
  let saved!: StudyData[K][number];
  mutate(owner, (data) => {
    const list = data[collection] as unknown as Stamped[];
    const existing = input.id ? list.find((item) => item.id === input.id) : undefined;
    saved = { ...defaults, ...existing, ...input, id: existing?.id ?? input.id ?? newId(), createdAt: existing?.createdAt ?? stamp, updatedAt: stamp } as StudyData[K][number];
    const next = existing ? list.map((item) => (item.id === existing.id ? saved : item)) : [saved, ...list];
    return { ...data, [collection]: next.slice(0, CAPS[collection]) };
  });
  return saved;
}
function remove(owner: string | null, collection: StudyCollection, id: string) {
  mutate(owner, (data) => ({ ...data, [collection]: (data[collection] as Stamped[]).filter((item) => item.id !== id) }));
}

/** 新卡片：立即到期 */
export const newCard = (front: string, back: string): Flashcard => ({ id: newId(), front, back, due: now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 });
export const mindNode = (text: string, children: MindNode[] = [], note?: string): MindNode => ({ id: newId(), text, children, ...(note ? { note } : {}) });
export const dueCards = (deck: Deck, at = new Date()) => deck.cards.filter((card) => Date.parse(card.due) <= at.getTime());

/** 简化的 SM-2 间隔重复 */
export function scheduleCard(card: Flashcard, rating: CardRating, at = new Date()): Flashcard {
  const ease = Math.max(1.3, card.ease + { again: -0.2, hard: -0.15, good: 0, easy: 0.15 }[rating]);
  const interval = rating === 'again' ? 0
    : card.reps === 0 ? { hard: 1, good: 1, easy: 3 }[rating]
      : Math.max(1, Math.round(card.interval * { hard: 1.2, good: ease, easy: ease * 1.3 }[rating]));
  const due = new Date(at.getTime() + (rating === 'again' ? 10 * 60_000 : interval * 86_400_000)).toISOString();
  return { ...card, ease, interval, due, reps: rating === 'again' ? 0 : card.reps + 1, lapses: card.lapses + (rating === 'again' ? 1 : 0) };
}

/** 读写接口（非 Hook）：Agent 工具与事件处理里直接调用。所有写入立即持久化。 */
export const studyData = {
  get: (owner: string | null): StudyData => useStore.getState().byOwner[ownerKey(owner)] ?? emptyStudyData(),

  saveNote: (owner: string | null, input: Partial<StudyNote> & { title: string; body: string }) =>
    upsert(owner, 'notes', input, { title: '', body: '', tags: [], origin: 'user' }),
  removeNote: (owner: string | null, id: string) => remove(owner, 'notes', id),

  saveMindMap: (owner: string | null, input: Partial<MindMap> & { title: string; root: MindNode }) =>
    upsert(owner, 'mindmaps', input, { title: '', root: mindNode(''), origin: 'user' }),
  removeMindMap: (owner: string | null, id: string) => remove(owner, 'mindmaps', id),

  saveQuizSet: (owner: string | null, input: Partial<QuizSet> & { title: string; questions: QuizQuestion[] }) =>
    upsert(owner, 'quizSets', input, { title: '', questions: [], attempts: [], wrongIds: [], origin: 'user' }),
  removeQuizSet: (owner: string | null, id: string) => remove(owner, 'quizSets', id),
  recordQuizAttempt: (owner: string | null, setId: string, attempt: QuizAttempt, wrongIds: string[]) =>
    mutate(owner, (data) => ({ ...data, quizSets: data.quizSets.map((set) => set.id === setId ? { ...set, attempts: [...set.attempts, attempt].slice(-30), wrongIds, updatedAt: now() } : set) })),

  saveDeck: (owner: string | null, input: Partial<Deck> & { title: string; cards: Flashcard[] }) =>
    upsert(owner, 'decks', input, { title: '', cards: [], origin: 'user' }),
  removeDeck: (owner: string | null, id: string) => remove(owner, 'decks', id),
  reviewCard: (owner: string | null, deckId: string, cardId: string, rating: CardRating) =>
    mutate(owner, (data) => ({ ...data, decks: data.decks.map((deck) => deck.id === deckId ? { ...deck, cards: deck.cards.map((card) => card.id === cardId ? scheduleCard(card, rating) : card), updatedAt: now() } : deck) })),

  addTodo: (owner: string | null, input: { text: string; due?: string; topicId?: string; origin?: Origin }): Todo => {
    const todo: Todo = { id: newId(), text: input.text, done: false, origin: input.origin ?? 'user', createdAt: now(), ...(input.due ? { due: input.due } : {}), ...(input.topicId ? { topicId: input.topicId } : {}) };
    mutate(owner, (data) => ({ ...data, todos: [todo, ...data.todos].slice(0, CAPS.todos) }));
    return todo;
  },
  updateTodo: (owner: string | null, id: string, patch: Partial<Pick<Todo, 'text' | 'done' | 'due'>>) =>
    mutate(owner, (data) => ({ ...data, todos: data.todos.map((todo) => todo.id === id ? { ...todo, ...patch, ...(patch.done === undefined ? {} : { doneAt: patch.done ? now() : undefined }) } : todo) })),
  removeTodo: (owner: string | null, id: string) => remove(owner, 'todos', id),

  saveWriting: (owner: string | null, input: Partial<WritingDoc> & { kind: WritingDoc['kind']; title: string }) =>
    upsert(owner, 'writings', input, { kind: 'essay', title: '', source: '', draft: '', origin: 'user' }),
  removeWriting: (owner: string | null, id: string) => remove(owner, 'writings', id),
};

/** 任一账号的工作台数据变化时通知（非 Hook；资料库的「生成的内容」据此刷新） */
export const subscribeStudyData = (listener: () => void): (() => void) => useStore.subscribe(listener);

const EMPTY = emptyStudyData();
/** 订阅当前账号的工作台数据 */
export function useStudyData(owner: string | null): StudyData {
  return useStore((state) => state.byOwner[ownerKey(owner)] ?? EMPTY);
}
