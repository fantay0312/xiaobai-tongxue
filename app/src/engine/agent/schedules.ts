/**
 * 定时任务的纯逻辑：计算下一次执行时间、创建与更新。
 * 真正的定时执行在 scheduler.ts（应用打开期间才会跑）。
 */
import { agentStore } from '../../store/agentStore';
import { newId } from '../../store/studyData';
import type { Cadence, ScheduledTask } from './types';

export interface ScheduleInput {
  title: string;
  prompt: string;
  cadence: Cadence;
  time: string;
  date?: string;
  weekday?: number;
  topicId?: string;
  topicTitle?: string;
  enabled?: boolean;
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isValidTime = (value: string) => TIME_RE.test(value);
export const isValidDate = (value: string) => DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));

/** 本地日期 YYYY-MM-DD */
export function localDate(at = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 从 from 之后的下一次执行时间；一次性任务返回它指定的那个时刻（可能已过，表示应立即补跑） */
export function computeNextRun(task: Pick<ScheduledTask, 'cadence' | 'time' | 'date' | 'weekday'>, from = new Date()): string | null {
  const match = TIME_RE.exec(task.time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (task.cadence === 'once') {
    const at = task.date && isValidDate(task.date) ? new Date(`${task.date}T00:00:00`) : new Date(from);
    at.setHours(hours, minutes, 0, 0);
    if (!task.date && at <= from) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (task.cadence === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const weekday = Number.isInteger(task.weekday) ? (task.weekday as number) : from.getDay();
  next.setDate(next.getDate() + ((weekday - next.getDay() + 7) % 7));
  if (next <= from) next.setDate(next.getDate() + 7);
  return next.toISOString();
}

/** 新建或更新一条定时任务；传 id 表示更新 */
export function saveSchedule(owner: string | null, input: ScheduleInput, id?: string): ScheduledTask {
  const previous = id ? agentStore.get(owner).schedules.find((task) => task.id === id) : undefined;
  const base = {
    cadence: input.cadence,
    time: input.time,
    ...(input.cadence === 'once' && input.date ? { date: input.date } : {}),
    ...(input.cadence === 'weekly' ? { weekday: input.weekday ?? new Date().getDay() } : {}),
  };
  const task: ScheduledTask = {
    id: previous?.id ?? newId(),
    title: input.title.trim().slice(0, 60) || input.prompt.trim().slice(0, 24) || '定时任务',
    prompt: input.prompt.trim().slice(0, 4000),
    ...base,
    nextRunAt: computeNextRun(base),
    enabled: input.enabled ?? previous?.enabled ?? true,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    ...(previous?.lastRunAt ? { lastRunAt: previous.lastRunAt } : {}),
    ...(previous?.lastRunId ? { lastRunId: previous.lastRunId } : {}),
    ...(input.topicId ? { topicId: input.topicId, topicTitle: input.topicTitle } : {}),
  };
  agentStore.saveSchedule(owner, task);
  return task;
}

/** 开关：重新打开时把下一次执行时间算到将来，避免一打开就补跑很久以前的任务 */
export function setScheduleEnabled(owner: string | null, id: string, enabled: boolean) {
  const task = agentStore.get(owner).schedules.find((item) => item.id === id);
  if (!task) return;
  if (!enabled) {
    agentStore.patchSchedule(owner, id, { enabled });
    return;
  }
  let next = computeNextRun(task);
  if (task.cadence === 'once' && next && Date.parse(next) <= Date.now()) {
    // 已经过期的一次性任务：改到同一时刻的下一次
    next = computeNextRun({ ...task, date: undefined });
    agentStore.patchSchedule(owner, id, { enabled, nextRunAt: next, date: next ? localDate(new Date(next)) : task.date });
    return;
  }
  agentStore.patchSchedule(owner, id, { enabled, nextRunAt: next });
}

export function describeCadence(task: Pick<ScheduledTask, 'cadence' | 'time' | 'date' | 'weekday'>): string {
  if (task.cadence === 'daily') return `每天 ${task.time}`;
  if (task.cadence === 'weekly') return `每${WEEKDAY_LABELS[task.weekday ?? 0]} ${task.time}`;
  return `${task.date ? task.date.slice(5).replace('-', ' 月 ') + ' 日' : '一次'} ${task.time}`;
}
