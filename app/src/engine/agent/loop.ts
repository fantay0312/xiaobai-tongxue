/**
 * Agent 主循环（pi 式）：调模型 → 本地执行它要的工具 → 把结果接回对话 → 再调模型，
 * 直到模型不再调用工具、调用了 finish，或用完步数预算。主代理和子代理都跑这一个循环。
 */
import { streamModel, type ChatMessage, type ModelRequest, type ModelResult, type ToolCall, type ToolSpec } from '../../lib/modelGateway';
import { newId } from '../../store/studyData';
import type { ToolOutcome } from './tools';

/** finished = 调用了 finish；idle = 模型自己停下；budget = 步数用完 */
export type LoopStop = 'finished' | 'idle' | 'budget';

export interface LoopResult {
  stop: LoopStop;
  steps: number;
  /** finish 的小结，或模型最后一段文字 */
  summary: string;
}

export interface LoopInput {
  /** 对话记录，循环过程中原地追加 */
  messages: ChatMessage[];
  tools: ToolSpec[];
  execute: (call: ToolCall) => Promise<ToolOutcome>;
  maxSteps: number;
  signal: AbortSignal;
  maxTokens?: number;
  /** 对话过长、较早的步骤被省略时，附在省略说明后面的现状摘要（清单、已有成果） */
  digest?: () => string;
  /** 流式回调，参数都是当前这一步的累计全文 */
  onReasoning?: (text: string) => void;
  onText?: (text: string) => void;
  /** 一次模型调用结束 */
  onModel?: (result: ModelResult, step: number) => void;
  onToolStart?: (call: ToolCall) => void;
  onToolEnd?: (call: ToolCall, outcome: ToolOutcome) => void;
  /** 一步（模型调用 + 它的全部工具）结束，此刻对话记录是完整的 */
  onStepEnd?: (step: number) => void;
}

const LAST_STEP_HINT = '【系统提示】这是本轮的最后一步。如果已经做完，现在调用 finish；如果还没做完，用一两句话说明进度和下一步（目标模式下先用 update_goal 更新清单）。';

export const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const RETRYABLE = new Set(['model-busy', 'model-rate-limited', 'model-stream-incomplete', 'model-stream-invalid', 'model-upstream-failed']);

/** 调一次模型；遇到繁忙、断流这类临时错误，等一下再试一次 */
async function callModel(request: ModelRequest, signal: AbortSignal): Promise<ModelResult> {
  try {
    return await streamModel(request);
  } catch (error) {
    if (signal.aborted || !(error instanceof Error) || !RETRYABLE.has(error.message)) throw error;
    await sleep(1500, signal);
    return streamModel(request);
  }
}

function isJsonObject(text: string): boolean {
  if (!text.trim()) return true;
  try {
    const value: unknown = JSON.parse(text);
    return !!value && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

const safeToolName = (name: string) => {
  const cleaned = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return /^[a-z]/.test(cleaned) ? cleaned : `tool_${cleaned}`.slice(0, 40);
};

/* 网关一次请求最多 60 条消息、12 万字；这里留出余量 */
const WIRE_MESSAGES = 50;
const WIRE_CHARS = 88_000;
const KEEP_RECENT = 4;

const messageSize = (message: ChatMessage) =>
  message.content.length + (message.role === 'assistant' ? (message.toolCalls ?? []).reduce((sum, call) => sum + call.arguments.length, 0) : 0);

/**
 * 发送前的视图（不改动原记录）：超过上限时，先截短较早步骤里的工具参数与结果，
 * 还不够就整步丢弃最早的几步，并补一条省略说明。一步 = 一条助手消息 + 它的全部工具结果，不会拆散。
 */
export function fitTranscript(messages: ChatMessage[], digest?: () => string): ChatMessage[] {
  const total = (list: ChatMessage[]) => list.reduce((sum, message) => sum + messageSize(message), 0);
  if (messages.length <= WIRE_MESSAGES && total(messages) <= WIRE_CHARS) return messages;

  const head = messages.slice(0, 2);
  const groups: ChatMessage[][] = [];
  for (const message of messages.slice(2)) {
    if (message.role === 'tool' && groups.length) groups[groups.length - 1].push(message);
    else groups.push([message]);
  }
  const shrink = (message: ChatMessage): ChatMessage => {
    if (message.role === 'tool') return message.content.length > 500 ? { ...message, content: `${message.content.slice(0, 500)}…（已截短）` } : message;
    if (message.role === 'assistant' && message.toolCalls) {
      return { ...message, toolCalls: message.toolCalls.map((call) => ({ ...call, arguments: clipArguments(call.arguments, 200) })) };
    }
    return message;
  };
  const kept = groups.map((group, index) => (index >= groups.length - KEEP_RECENT ? group : group.map(shrink)));
  let dropped = 0;
  const count = () => head.length + 1 + kept.reduce((sum, group) => sum + group.length, 0);
  while (kept.length > KEEP_RECENT && (count() > WIRE_MESSAGES || total(head) + total(kept.flat()) > WIRE_CHARS)) {
    kept.shift();
    dropped += 1;
  }
  const note: ChatMessage[] = dropped
    ? [{ role: 'user', content: `【系统提示】为节省篇幅，较早的 ${dropped} 步已省略；那些步骤的成果已经写入工作台，不要重复创建。${digest?.() ?? ''}` }]
    : [];
  return [...head, ...note, ...kept.flat()];
}

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const { messages, tools, execute, maxSteps, signal } = input;
  for (let step = 1; step <= maxSteps; step += 1) {
    throwIfAborted(signal);
    if (step === maxSteps && maxSteps > 2) messages.push({ role: 'user', content: LAST_STEP_HINT });

    const result = await callModel({
      messages: fitTranscript(messages, input.digest),
      tools,
      signal,
      maxTokens: input.maxTokens ?? 8000,
      onText: input.onText,
      onReasoning: input.onReasoning,
    }, signal);
    throwIfAborted(signal);
    // 网关只接受小写下划线的工具名；模型写错名字时先规整，再由执行器回它一个「没有这个工具」
    result.toolCalls = result.toolCalls.slice(0, 16).map((call) => ({
      id: call.id && call.id.length <= 120 ? call.id : newId(),
      name: safeToolName(call.name),
      arguments: call.arguments,
    }));
    // 对话记录里的参数必须是合法 JSON（被截断的换成 {}）；执行时仍用原文，好让执行器报出「参数被截断」
    const recorded = result.toolCalls.map((call) => ({ ...call, arguments: isJsonObject(call.arguments) ? call.arguments : '{}' }));
    messages.push({ role: 'assistant', content: result.text, ...(recorded.length ? { toolCalls: recorded } : {}) });
    input.onModel?.(result, step);

    if (!result.toolCalls.length) {
      input.onStepEnd?.(step);
      return { stop: 'idle', steps: step, summary: result.text };
    }

    let finish: string | undefined;
    for (const call of result.toolCalls) {
      throwIfAborted(signal);
      input.onToolStart?.(call);
      let outcome: ToolOutcome;
      try {
        outcome = await execute(call);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        outcome = { content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 200) : '工具执行失败' }), error: true };
      }
      messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
      input.onToolEnd?.(call, outcome);
      if (outcome.finish !== undefined) finish = outcome.finish;
    }
    input.onStepEnd?.(step);
    if (finish !== undefined) return { stop: 'finished', steps: step, summary: finish };
  }
  return { stop: 'budget', steps: maxSteps, summary: '' };
}

/**
 * 续跑前修补对话记录：被打断时可能留下没有结果的工具调用，
 * 给它们补一条「已中断」的结果，否则模型接口会拒绝这段对话。
 */
export function repairTranscript(messages: ChatMessage[]): ChatMessage[] {
  const repaired: ChatMessage[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    repaired.push(message);
    index += 1;
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue;
    // 先收下紧跟着的工具结果，再给缺失的补上
    const answered = new Set<string>();
    while (index < messages.length) {
      const next = messages[index];
      if (next.role !== 'tool') break;
      answered.add(next.toolCallId);
      repaired.push(next);
      index += 1;
    }
    for (const call of message.toolCalls) {
      if (!answered.has(call.id)) repaired.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ ok: false, error: '执行被中断，没有结果' }) });
    }
  }
  return repaired;
}

/** 落盘用的精简副本：长的工具结果和正文截短，结构不变 */
export function compactTranscript(messages: ChatMessage[]): ChatMessage[] {
  const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…（已截短）` : value);
  return messages.map((message) => {
    if (message.role === 'tool') return { ...message, content: clip(message.content, 2400) };
    if (message.role === 'assistant') {
      return {
        ...message,
        content: clip(message.content, 4000),
        ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({ ...call, arguments: clipArguments(call.arguments) })) } : {}),
      };
    }
    return message;
  });
}

/** 工具参数里的长字符串截短，保持合法 JSON */
export function clipArguments(json: string, maxString = 1200): string {
  if (json.length <= maxString * 2) return json;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  try {
    return JSON.stringify(walk(JSON.parse(json)));
  } catch {
    return '{}';
  }
}
