/**
 * 子代理：把 2–4 件互不依赖的子任务各开一个小循环并行跑。
 * 每个子代理有自己的任务书、受限的工具集和较小的步数预算；主代理只拿到各自的小结。
 */
import { newId } from '../../store/studyData';
import { isAbortError, runLoop } from './loop';
import { subAgentPrompt } from './prompt';
import { executeTool, toolSpecs, type LaneReporter, type SubAgentTask, type ToolContext, type ToolOutcome } from './tools';
import type { ProducedItem, SubAgentLane } from './types';

const SUB_STEP_BUDGET = 6;

/** 泳道看板：集中改状态并通知界面 */
export function laneBoard(tasks: SubAgentTask[], report: LaneReporter) {
  let lanes: SubAgentLane[] = tasks.map((task) => ({
    id: newId(),
    title: task.title,
    brief: task.brief,
    tools: task.tools,
    status: 'queued',
    steps: 0,
    trail: [],
    produced: [],
  }));
  report(lanes);
  return {
    get: (index: number) => lanes[index],
    all: () => lanes,
    update: (index: number, patch: (lane: SubAgentLane) => Partial<SubAgentLane>) => {
      lanes = lanes.map((lane, position) => (position === index ? { ...lane, ...patch(lane) } : lane));
      report(lanes);
    },
  };
}

/** 汇总成给主代理看的工具结果 */
export function lanesOutcome(lanes: SubAgentLane[]): ToolOutcome {
  const produced: ProducedItem[] = lanes.flatMap((lane) => lane.produced);
  return {
    content: JSON.stringify({
      ok: lanes.some((lane) => lane.status === 'done'),
      results: lanes.map((lane) => ({
        title: lane.title,
        status: lane.status,
        summary: lane.result ?? '',
        produced: lane.produced.map((item) => `${item.kind}:${item.title}`),
      })),
    }),
    ...(produced.length ? { produced } : {}),
    ...(lanes.every((lane) => lane.status === 'error') ? { error: true } : {}),
  };
}

export async function runSubAgents(tasks: SubAgentTask[], ctx: ToolContext, report: LaneReporter): Promise<ToolOutcome> {
  const board = laneBoard(tasks, report);
  // 子代理不能再派生、不能改目标清单
  const subCtx: ToolContext = { owner: ctx.owner, topic: ctx.topic, materials: ctx.materials, signal: ctx.signal };

  await Promise.all(tasks.map(async (task, index) => {
    const allowed = new Set([...task.tools, 'finish']);
    board.update(index, () => ({ status: 'running' }));
    try {
      const result = await runLoop({
        messages: [
          { role: 'system', content: subAgentPrompt({ topic: ctx.topic, materials: ctx.materials, tools: task.tools }) },
          { role: 'user', content: `子任务：${task.title}\n\n${task.brief}` },
        ],
        tools: toolSpecs([...allowed]),
        execute: (call) => executeTool(call, subCtx, allowed),
        maxSteps: SUB_STEP_BUDGET,
        signal: ctx.signal,
        onModel: (_result, step) => board.update(index, () => ({ steps: step })),
        onToolStart: (call) => {
          if (call.name !== 'finish') board.update(index, (lane) => ({ trail: [...lane.trail, call.name] }));
        },
        onToolEnd: (_call, outcome) => {
          if (outcome.produced?.length) board.update(index, (lane) => ({ produced: [...lane.produced, ...(outcome.produced ?? [])] }));
        },
      });
      const fallback = result.stop === 'budget' ? '步数用完，没有给出小结。' : '已结束，没有给出小结。';
      board.update(index, () => ({ status: 'done', result: result.summary.trim() || fallback }));
    } catch (error) {
      if (ctx.signal.aborted || isAbortError(error)) {
        board.update(index, () => ({ status: 'error', result: '已停止' }));
        throw error;
      }
      // 一条泳道出错不影响其他泳道
      board.update(index, () => ({ status: 'error', result: error instanceof Error ? error.message.slice(0, 160) : '执行失败' }));
    }
  }));

  return lanesOutcome(board.all());
}
