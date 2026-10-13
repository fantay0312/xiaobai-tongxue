/**
 * 并行助手：把 2–4 件互不依赖的检索/阅读子任务各开一个小循环同时跑。
 * 每个助手只有只读工具和 6 步预算；主助手拿到的是各自的结构化小结。
 */
import type { ChatMessage } from '../../lib/modelGateway';
import { newId } from '../../store/studyData';
import { isAbortError, runLoop } from '../agent/loop';
import { stepLimiter, tidyTranscript } from './budget';
import { describeCall, toolLabel } from './describe';
import { workerPrompt, type Capabilities } from './prompt';
import { WORKER_TOOLS, executeTool, toolSpecs, type ResearchOutcome, type ToolContext, type WorkerTask } from './tools';
import type { ProjectGoal, WorkerLane } from './types';

const WORKER_STEPS = 6;
const WORKER_STEP_CHARS = 16_000;

interface WorkerReport {
  summary: string;
  findings: string[];
  sources: string[];
}

function parseReport(raw: string): WorkerReport {
  try {
    const value = JSON.parse(raw) as Partial<WorkerReport>;
    return {
      summary: typeof value.summary === 'string' ? value.summary : '',
      findings: Array.isArray(value.findings) ? value.findings.filter((item): item is string => typeof item === 'string') : [],
      sources: Array.isArray(value.sources) ? value.sources.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    // 没调用 finish、直接用文字收尾
    return { summary: raw.trim().slice(0, 1600), findings: [], sources: [] };
  }
}

export async function runWorkers(
  tasks: WorkerTask[],
  ctx: ToolContext,
  report: (lanes: WorkerLane[]) => void,
  brief: { projectTitle: string; goal?: ProjectGoal; capabilities: Capabilities },
): Promise<ResearchOutcome> {
  let lanes: WorkerLane[] = tasks.map((task) => ({ id: newId(), title: task.title, brief: task.brief, status: 'queued', steps: 0, trail: [] }));
  const reports = new Map<number, WorkerReport>();
  const update = (index: number, patch: (lane: WorkerLane) => Partial<WorkerLane>) => {
    lanes = lanes.map((lane, position) => (position === index ? { ...lane, ...patch(lane) } : lane));
    report(lanes);
  };
  report(lanes);

  const allowed = new Set<string>(WORKER_TOOLS);
  // 助手不能改计划、提问、再派助手；权限闸门与主助手共用
  const workerCtx: ToolContext = {
    owner: ctx.owner, projectId: ctx.projectId, sessionId: ctx.sessionId, sessionTitle: ctx.sessionTitle, turn: ctx.turn,
    actor: 'worker', signal: ctx.signal, retrieved: ctx.retrieved, gate: ctx.gate,
  };

  await Promise.all(tasks.map(async (task, index) => {
    update(index, () => ({ status: 'running' }));
    const messages: ChatMessage[] = [
      { role: 'system', content: workerPrompt(brief) },
      { role: 'user', content: `子任务：${task.title}\n\n${task.brief}` },
    ];
    const limiter = stepLimiter(WORKER_STEP_CHARS);
    try {
      const result = await runLoop({
        messages,
        tools: toolSpecs(WORKER_TOOLS, true),
        execute: (call) => executeTool(call, workerCtx, allowed).then((outcome) => ({ ...outcome, content: limiter.fit(outcome.content) })),
        onStepEnd: () => tidyTranscript(messages, 2, 60_000),
        maxSteps: WORKER_STEPS,
        maxTokens: 4000,
        signal: ctx.signal,
        onModel: (_result, step) => {
          limiter.reset();
          update(index, () => ({ steps: step }));
        },
        onToolStart: (call) => {
          if (call.name === 'finish') return;
          const what = describeCall(call.name, call.arguments);
          update(index, (lane) => ({ trail: [...lane.trail, `${toolLabel(call.name)}${what ? ` ${what}` : ''}`].slice(-12) }));
        },
      });
      const parsed = parseReport(result.summary);
      const summary = parsed.summary.trim() || (result.stop === 'budget' ? '步数用完，没有给出小结。' : '已结束，没有给出小结。');
      reports.set(index, { ...parsed, summary });
      update(index, () => ({ status: 'done', summary, sources: parsed.sources.slice(0, 12) }));
    } catch (error) {
      if (ctx.signal.aborted || isAbortError(error)) {
        update(index, () => ({ status: 'error', summary: '已停止' }));
        throw error;
      }
      // 一条泳道出错不影响其他泳道
      update(index, () => ({ status: 'error', summary: error instanceof Error ? error.message.slice(0, 160) : '执行失败' }));
    }
  }));

  const anyDone = lanes.some((lane) => lane.status === 'done');
  return {
    content: JSON.stringify({
      ok: anyDone,
      results: lanes.map((lane, index) => ({
        title: lane.title,
        status: lane.status,
        summary: lane.summary ?? '',
        findings: reports.get(index)?.findings ?? [],
        sources: reports.get(index)?.sources ?? [],
      })),
      note: '助手报告的文献须是它们实际检索到的；写入综述前，关键论断请你自己用 read_paper 核对。',
    }),
    ...(anyDone ? {} : { error: true }),
  };
}
