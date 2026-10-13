/**
 * 运行管理：创建、推进、续跑、停止一次助理任务，并把过程写进事件日志（store/agentStore.ts）。
 * 一次「推进」= 一轮主循环；目标模式下步数用完会暂停，可手动或自动续跑下一轮。
 */
import { getTopic } from '../../data';
import { ModelUnavailableError, type ChatMessage, type ToolCall } from '../../lib/modelGateway';
import { agentStore } from '../../store/agentStore';
import { newId } from '../../store/studyData';
import type { Topic } from '../../types';
import type { NotebookSource } from '../notebookSources';
import { buildDemoPlan, runDemo, runDemoSubAgents, type DemoPlan } from './demo';
import { clipArguments, compactTranscript, fitTranscript, isAbortError, repairTranscript, runLoop, sleep, type LoopResult } from './loop';
import { continueInstruction, goalMessage, systemPrompt } from './prompt';
import { collectMaterials } from './retrieval';
import { runSubAgents } from './subagents';
import { executeTool, mainToolNames, toolSpecs, type ToolContext, type ToolOutcome } from './tools';
import type { AgentEvent, AgentRun, RunOptions } from './types';

export interface RunContext {
  topic?: Topic;
  sources: NotebookSource[];
}

export interface StartInput {
  goal: string;
  title?: string;
  options?: Partial<RunOptions>;
  context?: RunContext;
  scheduleId?: string;
  /** 开头附加的一条说明，如「补跑」 */
  note?: string;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = { goalMode: false, subagents: true, stepBudget: 12, autoContinue: true, maxRounds: 3 };
export const STEP_BUDGETS = [8, 12, 20] as const;

/** 正在执行的运行（仅本页内存） */
const active = new Map<string, AbortController>();
/** 完整的对话记录；落盘的是截短副本 */
const transcripts = new Map<string, ChatMessage[]>();
const contexts = new Map<string, RunContext>();
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();

const now = () => new Date().toISOString();
const clampBudget = (value: unknown) => Math.min(30, Math.max(3, Math.round(Number(value)) || DEFAULT_RUN_OPTIONS.stepBudget));

export const isRunActive = (runId: string) => active.has(runId);

const MODEL_ERRORS: Record<string, string> = {
  'model-auth': '模型服务拒绝了请求（密钥无效或没有权限）。',
  'model-busy': '模型服务繁忙，稍后可以继续推进。',
  'model-rate-limited': '模型服务繁忙，稍后可以继续推进。',
  'model-timeout': '模型响应超时，可以继续推进。',
  'model-stream-incomplete': '模型的回复中断了，可以继续推进。',
  'model-stream-invalid': '模型的回复中断了，可以继续推进。',
  'model-upstream-failed': '模型服务出错，稍后可以继续推进。',
  'model-upstream-rejected': '模型服务没有接受这次请求，可以换个说法重新运行。',
  'model-output-too-large': '模型一次输出的内容太长，可以继续推进并让它分几次写。',
  'model-input-too-large': '对话记录太长了，建议重新运行并把目标拆小。',
  'model-input-invalid': '对话记录没有被模型服务接受，建议重新运行。',
};

function describeError(error: unknown): string {
  if (error instanceof ModelUnavailableError) return '模型暂时不可用，稍后可以继续推进。';
  const message = error instanceof Error ? error.message : String(error);
  if (MODEL_ERRORS[message]) return MODEL_ERRORS[message];
  if (message.startsWith('model-')) return `模型服务出错（${message.replace('model-', '')}），稍后可以继续推进。`;
  return message && message !== 'undefined' ? message.slice(0, 200) : '运行出错';
}

/** 流式文本写入事件日志：首个片段建事件，之后约每 80ms 合并更新一次 */
function streamWriter(owner: string | null, runId: string, type: 'thinking' | 'text') {
  let eventId: string | null = null;
  let latest = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (eventId) agentStore.patchEvent(owner, runId, eventId, { text: latest });
  };
  return {
    write(text: string) {
      if (!text.trim()) return;
      latest = text;
      if (!eventId) eventId = agentStore.appendEvent(owner, runId, { type, text, streaming: true });
      else timer ??= setTimeout(flush, 80);
    },
    /** 收尾：传入最终全文；没有流式片段但有全文时补一条事件 */
    end(final?: string) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      // 事件日志只留展示需要的长度
      const text = (final?.trim() ? final : latest).slice(0, type === 'thinking' ? 6000 : 16_000);
      if (!eventId && text.trim()) eventId = agentStore.appendEvent(owner, runId, { type, text });
      else if (eventId) agentStore.patchEvent(owner, runId, eventId, { text, streaming: false });
      eventId = null;
      latest = '';
    },
  };
}

export function startRun(owner: string | null, input: StartInput): string {
  const goal = input.goal.trim().slice(0, 6000);
  const options: RunOptions = { ...DEFAULT_RUN_OPTIONS, ...input.options, stepBudget: clampBudget(input.options?.stepBudget) };
  const stamp = now();
  const context = input.context ?? { sources: [] };
  const run: AgentRun = {
    id: newId(),
    title: (input.title?.trim() || goal.split('\n')[0]).slice(0, 60),
    goal,
    status: 'running',
    mode: 'model',
    options,
    ...(context.topic ? { topicId: context.topic.topicId, topicTitle: context.topic.title } : {}),
    sourceTitles: context.sources.map((source) => source.title).slice(0, 12),
    events: [],
    produced: [],
    checklist: [],
    rounds: 0,
    steps: 0,
    ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
    createdAt: stamp,
    updatedAt: stamp,
  };
  agentStore.createRun(owner, run);
  contexts.set(run.id, context);
  agentStore.appendEvent(owner, run.id, { type: 'user', text: goal });
  if (input.note) agentStore.appendEvent(owner, run.id, { type: 'notice', tone: 'info', text: input.note });
  void drive(owner, run.id);
  return run.id;
}

/** 续跑一轮。context 省略时沿用上次的课程资料（刷新后只剩课程讲义）。 */
export function continueRun(owner: string | null, runId: string, context?: RunContext) {
  const run = agentStore.getRun(owner, runId);
  if (!run || active.has(runId) || run.mode === 'demo' || run.status === 'done') return;
  const timer = autoTimers.get(runId);
  if (timer) clearTimeout(timer);
  autoTimers.delete(runId);
  if (context) contexts.set(runId, context);
  agentStore.appendEvent(owner, runId, { type: 'notice', tone: 'info', text: `第 ${run.rounds + 1} 轮 · 继续推进` });
  void drive(owner, runId, continueInstruction(run.checklist.filter((item) => !item.done), run.options.goalMode));
}

export function stopRun(owner: string | null, runId: string) {
  const timer = autoTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    autoTimers.delete(runId);
    agentStore.appendEvent(owner, runId, { type: 'notice', tone: 'info', text: '已取消自动续跑。' });
  }
  active.get(runId)?.abort();
}

/** 是否有一轮自动续跑在等待 */
export const hasPendingAutoContinue = (runId: string) => autoTimers.has(runId);

export function rerun(owner: string | null, runId: string, context?: RunContext): string | null {
  const run = agentStore.getRun(owner, runId);
  if (!run) return null;
  return startRun(owner, {
    goal: run.goal,
    title: run.title,
    options: run.options,
    context: context ?? contexts.get(runId) ?? restoreContext(run),
    ...(run.scheduleId ? { scheduleId: run.scheduleId } : {}),
  });
}

export function deleteRun(owner: string | null, runId: string) {
  stopRun(owner, runId);
  transcripts.delete(runId);
  contexts.delete(runId);
  agentStore.removeRun(owner, runId);
}

function restoreContext(run: AgentRun): RunContext {
  return { topic: run.topicId ? getTopic(run.topicId) : undefined, sources: [] };
}

const closeEvent = (event: AgentEvent): AgentEvent => {
  if ((event.type === 'thinking' || event.type === 'text') && event.streaming) return { ...event, streaming: false };
  if (event.type === 'tool' && event.status === 'running') {
    return {
      ...event,
      status: 'error',
      result: event.result ?? '已中断',
      ...(event.lanes ? { lanes: event.lanes.map((lane) => (lane.status === 'done' || lane.status === 'error' ? lane : { ...lane, status: 'error' as const, result: lane.result ?? '已中断' })) } : {}),
    };
  }
  return event;
};

/** 页面刷新会打断正在执行的运行：把它们改成可续跑的暂停状态 */
export function reconcileRuns(owner: string | null) {
  for (const run of agentStore.get(owner).runs) {
    if (run.status !== 'running' || active.has(run.id)) continue;
    agentStore.patchRun(owner, run.id, (current) => ({
      status: current.mode === 'demo' ? 'stopped' : 'paused',
      events: [
        ...current.events.map(closeEvent),
        { id: newId(), at: now(), type: 'notice', tone: 'warn', text: current.mode === 'demo' ? '页面刷新时中断了，可以重新运行。' : '页面刷新时中断了，可以继续推进。' },
      ],
    }));
  }
}

async function drive(owner: string | null, runId: string, instruction?: string) {
  const run = agentStore.getRun(owner, runId);
  if (!run || active.has(runId)) return;
  const controller = new AbortController();
  const { signal } = controller;
  active.set(runId, controller);

  const context = contexts.get(runId) ?? restoreContext(run);
  contexts.set(runId, context);
  const materials = collectMaterials(context.topic, context.sources);
  const { options } = run;
  agentStore.patchRun(owner, runId, { status: 'running', rounds: run.rounds + 1, error: undefined, finishedAt: undefined });

  const thinking = streamWriter(owner, runId, 'thinking');
  const speech = streamWriter(owner, runId, 'text');
  const toolEvents = new Map<string, { eventId: string | null; started: number }>();
  let demoMode = run.mode === 'demo';
  let demoPlan: DemoPlan | null = null;
  const planOf = () => (demoPlan ??= buildDemoPlan(run.goal, context.topic, materials));

  const allowed = new Set(mainToolNames(options));
  const ctx: ToolContext = { owner, topic: context.topic, materials, signal };
  if (options.goalMode) {
    ctx.goal = {
      read: () => agentStore.getRun(owner, runId)?.checklist ?? [],
      write: (items) => agentStore.patchRun(owner, runId, { checklist: items }),
    };
  }
  if (options.subagents) {
    ctx.spawn = (tasks, report) => (demoMode ? runDemoSubAgents(tasks, ctx, report, planOf()) : runSubAgents(tasks, ctx, report));
  }

  /** 对话被裁剪时告诉模型现状：已有成果与清单 */
  const digest = () => {
    const current = agentStore.getRun(owner, runId);
    if (!current) return '';
    const produced = current.produced.map((item) => `《${item.title}》`).join('、');
    const checklist = current.checklist.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`).join('\n');
    return `${produced ? `\n已写入工作台：${produced}。` : ''}${checklist ? `\n当前清单：\n${checklist}` : ''}`;
  };

  const onToolStart = (call: ToolCall) => {
    // finish 不显示成工具卡片，结束时显示为小结
    const eventId = call.name === 'finish'
      ? null
      : agentStore.appendEvent(owner, runId, { type: 'tool', callId: call.id, name: call.name, args: clipArguments(call.arguments, 600), status: 'running' });
    toolEvents.set(call.id, { eventId, started: Date.now() });
  };
  const onToolEnd = (call: ToolCall, outcome: ToolOutcome) => {
    const entry = toolEvents.get(call.id);
    if (entry?.eventId) {
      agentStore.patchEvent(owner, runId, entry.eventId, {
        status: outcome.error ? 'error' : 'done',
        result: outcome.content.slice(0, 1800),
        ms: Date.now() - entry.started,
        ...(outcome.produced ? { produced: outcome.produced } : {}),
      });
    }
    if (outcome.produced?.length) agentStore.addProduced(owner, runId, outcome.produced);
    if (outcome.finish !== undefined) agentStore.appendEvent(owner, runId, { type: 'summary', text: outcome.finish });
  };
  const execute = (call: ToolCall) => executeTool(call, ctx, allowed, (lanes) => {
    const entry = toolEvents.get(call.id);
    if (entry?.eventId) agentStore.patchEvent(owner, runId, entry.eventId, { lanes });
  });

  const demo = (): Promise<LoopResult> => runDemo({
    goal: run.goal,
    options,
    plan: planOf(),
    signal,
    think: async (text) => {
      // 分段写入，让时间线有「正在思考」的过程
      for (let end = 12; end < text.length; end += 12) {
        thinking.write(text.slice(0, end));
        await sleep(45, signal);
      }
      thinking.end(text);
      await sleep(260, signal);
    },
    say: async (text) => {
      speech.end(text);
      await sleep(320, signal);
    },
    call: async (name, args) => {
      const call: ToolCall = { id: newId(), name, arguments: JSON.stringify(args) };
      onToolStart(call);
      await sleep(name === 'finish' ? 120 : 520, signal);
      const outcome = await execute(call);
      onToolEnd(call, outcome);
      if (name !== 'finish') agentStore.patchRun(owner, runId, (current) => ({ steps: current.steps + 1 }));
      return outcome;
    },
  });

  let messages: ChatMessage[] = [];
  try {
    let result: LoopResult;
    if (demoMode) {
      result = await demo();
    } else {
      messages = repairTranscript(transcripts.get(runId) ?? structuredClone(run.messages ?? []));
      const system: ChatMessage = { role: 'system', content: systemPrompt({ owner, topic: context.topic, materials, options }) };
      if (!messages.length) {
        messages = [system, { role: 'user', content: goalMessage(run.goal, options) }];
      } else {
        // 续跑：刷新系统提示（时间、资料目录），再接上续跑指令
        if (messages[0].role === 'system') messages[0] = system;
        if (instruction && messages.some((message) => message.role === 'assistant')) messages.push({ role: 'user', content: instruction });
      }
      transcripts.set(runId, messages);
      const startedWithHistory = messages.some((message) => message.role === 'assistant');

      try {
        result = await runLoop({
          messages,
          tools: toolSpecs([...allowed]),
          execute,
          maxSteps: options.stepBudget,
          signal,
          digest,
          onReasoning: thinking.write,
          onText: speech.write,
          onModel: (model) => {
            thinking.end(model.reasoning);
            speech.end(model.text);
            const used = (model.usage?.promptTokens ?? 0) + (model.usage?.completionTokens ?? 0);
            agentStore.patchRun(owner, runId, (current) => ({ steps: current.steps + 1, model: model.model || current.model, tokens: (current.tokens ?? 0) + used }));
          },
          onToolStart,
          onToolEnd,
          onStepEnd: () => agentStore.patchRun(owner, runId, { messages: compactTranscript(fitTranscript(messages, digest)) }),
        });
      } catch (error) {
        // 第一次调模型就发现没有可用模型：改走本地演示
        const noModelYet = error instanceof ModelUnavailableError && !startedWithHistory && !messages.some((message) => message.role === 'assistant');
        if (!noModelYet) throw error;
        demoMode = true;
        messages = [];
        transcripts.delete(runId);
        agentStore.patchRun(owner, runId, { mode: 'demo', messages: undefined });
        agentStore.appendEvent(owner, runId, { type: 'notice', tone: 'info', text: '当前没有可用的模型，这次以本地演示方式运行：按课程资料走一遍固定步骤，成果同样写进工作台。' });
        result = await demo();
      }
    }
    settle(owner, runId, result);
  } catch (error) {
    thinking.end();
    speech.end();
    const stopped = signal.aborted || isAbortError(error);
    agentStore.patchRun(owner, runId, (current) => ({
      status: stopped ? 'stopped' : 'error',
      events: current.events.map(closeEvent),
      ...(stopped ? {} : { error: describeError(error) }),
      ...(messages.length ? { messages: compactTranscript(fitTranscript(repairTranscript(messages), digest)) } : {}),
    }));
    agentStore.appendEvent(owner, runId, stopped
      ? { type: 'notice', tone: 'info', text: '已停止。' }
      : { type: 'notice', tone: 'bad', text: describeError(error) });
  } finally {
    active.delete(runId);
  }
}

/** 一轮结束后的去向：完成，或暂停等待续跑 */
function settle(owner: string | null, runId: string, result: LoopResult) {
  const run = agentStore.getRun(owner, runId);
  if (!run) return;
  const open = run.checklist.filter((item) => !item.done);
  const finished = result.stop === 'finished' || (result.stop === 'idle' && !(run.options.goalMode && open.length));
  if (finished) {
    transcripts.delete(runId);
    agentStore.patchRun(owner, runId, { status: 'done', summary: result.summary, finishedAt: now(), messages: undefined });
    return;
  }

  const canAuto = run.options.goalMode && run.options.autoContinue && run.rounds < run.options.maxRounds;
  const reason = result.stop === 'budget' ? `本轮 ${run.options.stepBudget} 步已用完` : '这一轮停下了';
  const remain = open.length ? `，清单还有 ${open.length} 项未完成` : '';
  const next = canAuto ? `稍后自动续跑第 ${run.rounds + 1} 轮（最多 ${run.options.maxRounds} 轮）。` : '可以点「继续推进」接着做。';
  if (canAuto) {
    autoTimers.set(runId, setTimeout(() => {
      autoTimers.delete(runId);
      continueRun(owner, runId);
    }, 1500));
  }
  agentStore.appendEvent(owner, runId, { type: 'notice', tone: 'warn', text: `${reason}${remain}。${next}` });
  agentStore.patchRun(owner, runId, { status: 'paused' });
}
