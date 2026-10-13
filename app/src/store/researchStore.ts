/**
 * 科研台的课题、会话日志、文件元数据与文献列表 —— 按账号保存在当前浏览器。
 * 文件内容不在这里（见 engine/research/workspace.ts 的 IndexedDB）。
 * 运行中的流式事件写得很密，所以落盘节流：内存立即更新，localStorage 约每 0.8 秒写一次，页面隐藏前补写。
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { newId, ownerKey } from './studyData';
import type {
  FileMeta,
  PermissionMode,
  ResearchData,
  ResearchEvent,
  ResearchEventInput,
  ResearchEventPatch,
  ResearchProject,
  ResearchSession,
  SavedPaper,
} from '../engine/research/types';

interface ResearchState {
  byOwner: Record<string, ResearchData>;
  /** 最近一次落盘是否因为空间不足而精简过 */
  trimmed: boolean;
}

const STORAGE_KEY = 'xiaobai-research-v1';
const MAX_PROJECTS = 40;
const MAX_SESSIONS_PER_PROJECT = 24;
const MAX_EVENTS = 400;
const MAX_PAPERS = 200;
const EMPTY: ResearchData = { projects: [], sessions: [], files: {}, papers: {} };
const now = () => new Date().toISOString();

/** 配额不够时：每个课题只留最近 4 个会话，旧会话的对话记录与工具详情去掉 */
function shrink(state: ResearchState): ResearchState {
  const byOwner = Object.fromEntries(Object.entries(state.byOwner).map(([key, data]) => {
    const kept = new Map<string, number>();
    const sessions = data.sessions.filter((session) => {
      const count = kept.get(session.projectId) ?? 0;
      kept.set(session.projectId, count + 1);
      return count < 4;
    }).map((session, index) => (index < 2 ? session : {
      ...session,
      messages: undefined,
      events: session.events.slice(-120).map((event) => (event.type === 'tool' ? { ...event, view: undefined, live: undefined } : event)),
    }));
    return [key, { ...data, sessions }];
  }));
  return { byOwner, trimmed: true };
}

function throttledStorage(delay = 800): PersistStorage<ResearchState> {
  let pending: { name: string; value: StorageValue<ResearchState> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      try {
        localStorage.setItem(name, JSON.stringify({ ...value, state: shrink(value.state) }));
        useStore.setState({ trimmed: true });
      } catch {
        /* 仍然写不下：保留内存里的状态，本次不落盘 */
        useStore.setState({ trimmed: true });
      }
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  return {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<ResearchState>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      timer ??= setTimeout(flush, delay);
    },
    removeItem: (name) => {
      pending = null;
      localStorage.removeItem(name);
    },
  };
}

const isMode = (value: unknown): value is PermissionMode => value === 'ask' || value === 'risky' || value === 'auto';

const useStore = create<ResearchState>()(
  persist((): ResearchState => ({ byOwner: {}, trimmed: false }), {
    name: STORAGE_KEY,
    version: 1,
    storage: throttledStorage(),
    partialize: (state) => ({ byOwner: state.byOwner, trimmed: false }),
    merge: (persisted, current) => {
      const stored = (persisted ?? {}) as { byOwner?: Record<string, Partial<ResearchData>> };
      const byOwner: Record<string, ResearchData> = {};
      for (const [key, value] of Object.entries(stored.byOwner ?? {})) {
        byOwner[key] = {
          projects: (Array.isArray(value?.projects) ? value.projects : [])
            .filter((project) => project && typeof project.id === 'string' && typeof project.title === 'string')
            .map((project) => ({ ...project, permission: isMode(project.permission) ? project.permission : 'risky' })),
          sessions: (Array.isArray(value?.sessions) ? value.sessions : [])
            .filter((session) => session && typeof session.id === 'string' && Array.isArray(session.events))
            .map((session) => ({ ...session, plan: Array.isArray(session.plan) ? session.plan : [], allow: Array.isArray(session.allow) ? session.allow : [] })),
          files: value?.files && typeof value.files === 'object' ? value.files : {},
          papers: value?.papers && typeof value.papers === 'object' ? value.papers : {},
        };
      }
      return { ...current, byOwner };
    },
  }),
);

function mutate(owner: string | null, update: (data: ResearchData) => ResearchData) {
  const key = ownerKey(owner);
  useStore.setState((state) => ({ byOwner: { ...state.byOwner, [key]: update(state.byOwner[key] ?? EMPTY) } }));
}

function mutateSession(owner: string | null, sessionId: string, update: (session: ResearchSession) => ResearchSession) {
  mutate(owner, (data) => ({ ...data, sessions: data.sessions.map((session) => (session.id === sessionId ? update(session) : session)) }));
}

function touchProject(data: ResearchData, projectId: string): ResearchProject[] {
  const stamp = now();
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: stamp } : project));
}

/** 读写接口（非 Hook）：运行器、工具与界面事件处理里直接调用。 */
export const researchStore = {
  get: (owner: string | null): ResearchData => useStore.getState().byOwner[ownerKey(owner)] ?? EMPTY,
  getProject: (owner: string | null, projectId: string) => researchStore.get(owner).projects.find((project) => project.id === projectId),
  getSession: (owner: string | null, sessionId: string) => researchStore.get(owner).sessions.find((session) => session.id === sessionId),
  files: (owner: string | null, projectId: string): FileMeta[] => researchStore.get(owner).files[projectId] ?? [],
  papers: (owner: string | null, projectId: string): SavedPaper[] => researchStore.get(owner).papers[projectId] ?? [],

  createProject: (owner: string | null, title: string): ResearchProject => {
    const stamp = now();
    const project: ResearchProject = { id: newId(), title: title.trim().slice(0, 60) || '未命名课题', permission: 'risky', createdAt: stamp, updatedAt: stamp };
    mutate(owner, (data) => ({ ...data, projects: [project, ...data.projects].slice(0, MAX_PROJECTS) }));
    return project;
  },

  patchProject: (owner: string | null, projectId: string, patch: Partial<Pick<ResearchProject, 'title' | 'goal' | 'permission'>>) =>
    mutate(owner, (data) => ({
      ...data,
      projects: data.projects.map((project) => (project.id === projectId ? { ...project, ...patch, updatedAt: now() } : project)),
    })),

  /** 只删元数据；文件内容由调用方先清掉 */
  removeProject: (owner: string | null, projectId: string) =>
    mutate(owner, (data) => {
      const files = { ...data.files };
      const papers = { ...data.papers };
      delete files[projectId];
      delete papers[projectId];
      return {
        projects: data.projects.filter((project) => project.id !== projectId),
        sessions: data.sessions.filter((session) => session.projectId !== projectId),
        files,
        papers,
      };
    }),

  createSession: (owner: string | null, projectId: string, title: string): ResearchSession => {
    const stamp = now();
    const session: ResearchSession = {
      id: newId(), projectId, title: title.trim().slice(0, 60) || '新会话', status: 'idle',
      events: [], plan: [], allow: [], turns: 0, steps: 0, createdAt: stamp, updatedAt: stamp,
    };
    mutate(owner, (data) => {
      const sessions = [session, ...data.sessions];
      // 同一课题超出上限时丢最旧的、不在运行的会话
      const mine = sessions.filter((item) => item.projectId === projectId);
      if (mine.length > MAX_SESSIONS_PER_PROJECT) {
        const victim = [...mine].reverse().find((item) => item.status !== 'running' && item.status !== 'waiting' && item.id !== session.id);
        if (victim) sessions.splice(sessions.indexOf(victim), 1);
      }
      return { ...data, sessions, projects: touchProject(data, projectId) };
    });
    return session;
  },

  patchSession: (owner: string | null, sessionId: string, patch: Partial<ResearchSession> | ((session: ResearchSession) => Partial<ResearchSession>)) =>
    mutateSession(owner, sessionId, (session) => ({ ...session, ...(typeof patch === 'function' ? patch(session) : patch), updatedAt: now() })),

  removeSession: (owner: string | null, sessionId: string) =>
    mutate(owner, (data) => ({ ...data, sessions: data.sessions.filter((session) => session.id !== sessionId) })),

  appendEvent: (owner: string | null, sessionId: string, input: ResearchEventInput): string => {
    const event = { ...input, id: newId(), at: now() } as ResearchEvent;
    mutateSession(owner, sessionId, (session) => {
      const events = [...session.events, event];
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      return { ...session, events, updatedAt: event.at };
    });
    return event.id;
  },

  patchEvent: (owner: string | null, sessionId: string, eventId: string, patch: ResearchEventPatch) =>
    mutateSession(owner, sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => (event.id === eventId ? ({ ...event, ...patch } as ResearchEvent) : event)),
    })),

  setFiles: (owner: string | null, projectId: string, update: (files: FileMeta[]) => FileMeta[]) =>
    mutate(owner, (data) => ({
      ...data,
      files: { ...data.files, [projectId]: update(data.files[projectId] ?? []).sort((a, b) => a.path.localeCompare(b.path)) },
      projects: touchProject(data, projectId),
    })),

  savePaper: (owner: string | null, projectId: string, paper: SavedPaper) =>
    mutate(owner, (data) => {
      const current = data.papers[projectId] ?? [];
      const rest = current.filter((item) => item.id !== paper.id);
      return { ...data, papers: { ...data.papers, [projectId]: [paper, ...rest].slice(0, MAX_PAPERS) } };
    }),

  removePaper: (owner: string | null, projectId: string, paperId: string) =>
    mutate(owner, (data) => ({ ...data, papers: { ...data.papers, [projectId]: (data.papers[projectId] ?? []).filter((item) => item.id !== paperId) } })),
};

/** 订阅当前账号的科研台数据 */
export function useResearchData(owner: string | null): ResearchData {
  return useStore((state) => state.byOwner[ownerKey(owner)] ?? EMPTY);
}

/** 本机空间不足、旧会话被精简过时为 true */
export function useResearchTrimmed(): boolean {
  return useStore((state) => state.trimmed);
}

/** 课题或文件元数据变了才通知；会话事件的高频更新不触发 */
export function subscribeResearchFiles(listener: () => void): () => void {
  return useStore.subscribe((state, previous) => {
    if (state.byOwner === previous.byOwner) return;
    const keys = new Set([...Object.keys(state.byOwner), ...Object.keys(previous.byOwner)]);
    for (const key of keys) {
      const next = state.byOwner[key];
      const before = previous.byOwner[key];
      if (next?.files !== before?.files || next?.projects !== before?.projects) {
        listener();
        return;
      }
    }
  });
}
