/**
 * 助理任务的运行记录与定时任务 —— 按账号保存在当前浏览器。
 * 运行中的流式事件写得很密，所以落盘是节流的：内存里立即更新，localStorage 最多约每 0.6 秒写一次，
 * 页面隐藏或关闭前补写一次。
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { newId, ownerKey } from './studyData';
import type {
  AgentData,
  AgentEvent,
  AgentEventInput,
  AgentEventPatch,
  AgentRun,
  ProducedItem,
  ScheduledTask,
} from '../engine/agent/types';

interface AgentState {
  byOwner: Record<string, AgentData>;
}

const STORAGE_KEY = 'xiaobai-agent-v1';
const MAX_RUNS = 30;
const MAX_EVENTS = 240;
const MAX_SCHEDULES = 30;
const EMPTY: AgentData = { runs: [], schedules: [] };
const now = () => new Date().toISOString();

/** 配额不够时只留每个账号最近的几次运行 */
function shrink(state: AgentState): AgentState {
  return {
    byOwner: Object.fromEntries(
      Object.entries(state.byOwner).map(([key, data]) => [
        key,
        { ...data, runs: data.runs.slice(0, 8).map((run) => ({ ...run, messages: run.status === 'done' ? undefined : run.messages })) },
      ]),
    ),
  };
}

function throttledStorage(delay = 600): PersistStorage<AgentState> {
  let pending: { name: string; value: StorageValue<AgentState> } | null = null;
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
      } catch {
        /* 仍然写不下：保留内存里的状态，本次不落盘 */
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
        return raw ? (JSON.parse(raw) as StorageValue<AgentState>) : null;
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

const useStore = create<AgentState>()(
  persist((): AgentState => ({ byOwner: {} }), {
    name: STORAGE_KEY,
    version: 1,
    storage: throttledStorage(),
    merge: (persisted, current) => {
      const stored = (persisted ?? {}) as { byOwner?: Record<string, Partial<AgentData>> };
      const byOwner: Record<string, AgentData> = {};
      for (const [key, value] of Object.entries(stored.byOwner ?? {})) {
        byOwner[key] = {
          runs: (Array.isArray(value?.runs) ? value.runs : []).filter((run) => run && typeof run.id === 'string' && Array.isArray(run.events)),
          schedules: (Array.isArray(value?.schedules) ? value.schedules : []).filter((task) => task && typeof task.id === 'string'),
        };
      }
      return { ...current, byOwner };
    },
  }),
);

function mutate(owner: string | null, update: (data: AgentData) => AgentData) {
  const key = ownerKey(owner);
  useStore.setState((state) => ({ byOwner: { ...state.byOwner, [key]: update(state.byOwner[key] ?? EMPTY) } }));
}

function mutateRun(owner: string | null, runId: string, update: (run: AgentRun) => AgentRun) {
  mutate(owner, (data) => ({ ...data, runs: data.runs.map((run) => (run.id === runId ? update(run) : run)) }));
}

/** 读写接口（非 Hook）：Agent 运行器、调度器与界面事件处理里直接调用。 */
export const agentStore = {
  /** 任务数据有变化时回调（非 Hook），返回取消订阅。运行中变化很频繁，订阅方自己比对关心的部分 */
  subscribe: (listener: () => void): (() => void) => useStore.subscribe(listener),
  get: (owner: string | null): AgentData => useStore.getState().byOwner[ownerKey(owner)] ?? EMPTY,
  getRun: (owner: string | null, runId: string): AgentRun | undefined => agentStore.get(owner).runs.find((run) => run.id === runId),

  createRun: (owner: string | null, run: AgentRun) =>
    mutate(owner, (data) => {
      const runs = [run, ...data.runs];
      // 超出上限时先丢最旧的、已经结束的运行
      while (runs.length > MAX_RUNS) {
        const index = runs.findLastIndex((item) => item.status !== 'running');
        runs.splice(index < 0 ? runs.length - 1 : index, 1);
      }
      return { ...data, runs };
    }),

  patchRun: (owner: string | null, runId: string, patch: Partial<AgentRun> | ((run: AgentRun) => Partial<AgentRun>)) =>
    mutateRun(owner, runId, (run) => ({ ...run, ...(typeof patch === 'function' ? patch(run) : patch), updatedAt: now() })),

  appendEvent: (owner: string | null, runId: string, input: AgentEventInput): string => {
    const event = { ...input, id: newId(), at: now() } as AgentEvent;
    mutateRun(owner, runId, (run) => {
      const events = [...run.events, event];
      // 保留开头的目标，其余超限时从最旧处裁掉
      if (events.length > MAX_EVENTS) events.splice(1, events.length - MAX_EVENTS);
      return { ...run, events, updatedAt: event.at };
    });
    return event.id;
  },

  patchEvent: (owner: string | null, runId: string, eventId: string, patch: AgentEventPatch) =>
    mutateRun(owner, runId, (run) => ({
      ...run,
      events: run.events.map((event) => (event.id === eventId ? ({ ...event, ...patch } as AgentEvent) : event)),
    })),

  addProduced: (owner: string | null, runId: string, items: ProducedItem[]) =>
    mutateRun(owner, runId, (run) => {
      const seen = new Set(run.produced.map((item) => `${item.kind}:${item.id}`));
      const fresh = items.filter((item) => !seen.has(`${item.kind}:${item.id}`) && seen.add(`${item.kind}:${item.id}`));
      return fresh.length ? { ...run, produced: [...run.produced, ...fresh] } : run;
    }),

  removeRun: (owner: string | null, runId: string) =>
    mutate(owner, (data) => ({ ...data, runs: data.runs.filter((run) => run.id !== runId) })),

  saveSchedule: (owner: string | null, task: ScheduledTask) =>
    mutate(owner, (data) => {
      const exists = data.schedules.some((item) => item.id === task.id);
      const schedules = exists ? data.schedules.map((item) => (item.id === task.id ? task : item)) : [task, ...data.schedules];
      return { ...data, schedules: schedules.slice(0, MAX_SCHEDULES) };
    }),

  patchSchedule: (owner: string | null, taskId: string, patch: Partial<ScheduledTask>) =>
    mutate(owner, (data) => ({ ...data, schedules: data.schedules.map((task) => (task.id === taskId ? { ...task, ...patch } : task)) })),

  removeSchedule: (owner: string | null, taskId: string) =>
    mutate(owner, (data) => ({ ...data, schedules: data.schedules.filter((task) => task.id !== taskId) })),
};

/** 订阅当前账号的助理任务数据 */
export function useAgentData(owner: string | null): AgentData {
  return useStore((state) => state.byOwner[ownerKey(owner)] ?? EMPTY);
}
