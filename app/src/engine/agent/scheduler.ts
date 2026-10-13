/**
 * 定时任务调度：应用在这个浏览器里打开期间，每 30 秒检查一次，到点的任务交给助理执行。
 * 关着的时候不会运行；错过的任务在下次打开时补跑一次（多次错过也只补一次）。
 */
import { toast } from 'sonner';
import { getTopic } from '../../data';
import { agentStore } from '../../store/agentStore';
import { newId, ownerKey } from '../../store/studyData';
import { courseSources } from '../notebookSources';
import { isRunActive, reconcileRuns, startRun } from './runner';
import { computeNextRun } from './schedules';
import type { ScheduledTask } from './types';

const TICK_MS = 30_000;
const LOCK_KEY = 'xiaobai-agent-scheduler-lock';
const LOCK_TTL = 75_000;
const tabId = newId();

/** 同一浏览器开了多个页签时，只让一个页签执行定时任务 */
function holdLock(): boolean {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const lock = raw ? (JSON.parse(raw) as { tab?: string; at?: number }) : null;
    if (lock && lock.tab !== tabId && Date.now() - (lock.at ?? 0) < LOCK_TTL) return false;
    localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: tabId, at: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

function releaseLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw && (JSON.parse(raw) as { tab?: string }).tab === tabId) localStorage.removeItem(LOCK_KEY);
  } catch {
    /* 忽略 */
  }
}

function formatWhen(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 执行一条定时任务。manual=true 是「立即运行」，不改动原定的下一次时间。 */
export function runSchedule(owner: string | null, taskId: string, manual = false): string | null {
  const task: ScheduledTask | undefined = agentStore.get(owner).schedules.find((item) => item.id === taskId);
  if (!task) return null;
  // 上一次还在跑就不重复开
  if (task.lastRunId && isRunActive(task.lastRunId)) return task.lastRunId;

  const topic = task.topicId ? getTopic(task.topicId) : undefined;
  const late = !manual && task.nextRunAt ? Date.now() - Date.parse(task.nextRunAt) : 0;
  const runId = startRun(owner, {
    goal: task.prompt,
    title: task.title,
    scheduleId: task.id,
    context: { topic, sources: topic ? courseSources(topic) : [] },
    options: { goalMode: false, subagents: true },
    note: manual
      ? `定时任务「${task.title}」· 手动运行`
      : late > 120_000 && task.nextRunAt
        ? `定时任务「${task.title}」· 补跑（原定 ${formatWhen(task.nextRunAt)}，当时应用没有打开）`
        : `定时任务「${task.title}」· 按时执行`,
  });

  const stamp = new Date().toISOString();
  agentStore.patchSchedule(owner, task.id, manual
    ? { lastRunAt: stamp, lastRunId: runId }
    : {
        lastRunAt: stamp,
        lastRunId: runId,
        // 从现在起算下一次，多次错过只补这一次
        nextRunAt: task.cadence === 'once' ? null : computeNextRun(task),
        ...(task.cadence === 'once' ? { enabled: false } : {}),
      });
  return runId;
}

function tick(owner: string | null) {
  if (!holdLock()) return;
  const nowMs = Date.now();
  for (const task of agentStore.get(owner).schedules) {
    if (!task.enabled || !task.nextRunAt || Date.parse(task.nextRunAt) > nowMs) continue;
    const runId = runSchedule(owner, task.id);
    if (runId) toast('定时任务开始执行', { description: task.title });
  }
}

const running = new Map<string, { count: number; stop: () => void }>();

/** 启动调度（按账号计数，重复启动不会重复执行）。返回停止函数。 */
export function startAgentScheduler(owner: string | null): () => void {
  if (typeof window === 'undefined') return () => {};
  const key = ownerKey(owner);
  let entry = running.get(key);
  if (!entry) {
    reconcileRuns(owner);
    const check = () => tick(owner);
    // 稍等一下再做首次检查，避开页面刚打开时的加载高峰
    const first = window.setTimeout(check, 2500);
    const timer = window.setInterval(check, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', releaseLock);
    entry = {
      count: 0,
      stop: () => {
        window.clearTimeout(first);
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('pagehide', releaseLock);
        releaseLock();
      },
    };
    running.set(key, entry);
  }
  entry.count += 1;
  const current = entry;
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    current.count -= 1;
    if (current.count > 0) return;
    current.stop();
    if (running.get(key) === current) running.delete(key);
  };
}
