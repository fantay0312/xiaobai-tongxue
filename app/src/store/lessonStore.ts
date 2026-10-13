/**
 * AI 课堂的课程库 —— 按账号分开，保存在当前浏览器，每个账号最多留 12 堂。
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Lesson, LessonScene } from '../engine/lessonStudio';
import { ownerKey } from './studyData';

export const LESSON_CAP = 12;

/** 课程里带整页互动 HTML，写满配额时不让整个应用报错 */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, value); } catch { /* 存不下时保留内存中的课程，本次会话仍可用 */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* 忽略 */ }
  },
};

const isLesson = (value: unknown): value is Lesson =>
  !!value && typeof value === 'object'
  && typeof (value as Lesson).id === 'string'
  && typeof (value as Lesson).title === 'string'
  && Array.isArray((value as Lesson).scenes);

const useStore = create<{ byOwner: Record<string, Lesson[]> }>()(
  persist(() => ({ byOwner: {} as Record<string, Lesson[]> }), {
    name: 'xiaobai-lessons-v1',
    version: 1,
    storage: createJSONStorage(() => safeStorage),
    merge: (persisted, current) => {
      const stored = (persisted ?? {}) as { byOwner?: Record<string, unknown> };
      const byOwner: Record<string, Lesson[]> = {};
      for (const [key, value] of Object.entries(stored.byOwner ?? {})) {
        byOwner[key] = (Array.isArray(value) ? value : []).filter(isLesson).slice(0, LESSON_CAP);
      }
      return { ...current, byOwner };
    },
  }),
);

function mutate(owner: string | null, update: (lessons: Lesson[]) => Lesson[]) {
  const key = ownerKey(owner);
  useStore.setState((state) => ({ byOwner: { ...state.byOwner, [key]: update(state.byOwner[key] ?? []).slice(0, LESSON_CAP) } }));
}

export const lessonStore = {
  list: (owner: string | null): Lesson[] => useStore.getState().byOwner[ownerKey(owner)] ?? [],
  get: (owner: string | null, id: string): Lesson | undefined => lessonStore.list(owner).find((lesson) => lesson.id === id),
  /** 新课放到最前；同 id 的原地更新 */
  save: (owner: string | null, lesson: Lesson) =>
    mutate(owner, (lessons) => (lessons.some((item) => item.id === lesson.id)
      ? lessons.map((item) => (item.id === lesson.id ? lesson : item))
      : [lesson, ...lessons])),
  remove: (owner: string | null, id: string) => mutate(owner, (lessons) => lessons.filter((lesson) => lesson.id !== id)),
  replaceScene: (owner: string | null, lessonId: string, index: number, scene: LessonScene) =>
    mutate(owner, (lessons) => lessons.map((lesson) => (lesson.id === lessonId
      ? { ...lesson, scenes: lesson.scenes.map((item, i) => (i === index ? scene : item)), updatedAt: new Date().toISOString() }
      : lesson))),
};

const EMPTY: Lesson[] = [];
/** 订阅当前账号的课程库 */
export function useLessons(owner: string | null): Lesson[] {
  return useStore((state) => state.byOwner[ownerKey(owner)] ?? EMPTY);
}
