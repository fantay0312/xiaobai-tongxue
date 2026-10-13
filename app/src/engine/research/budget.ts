/**
 * 对话体量的保险：网关一次请求最多 60 条消息、12 万字（正文 + 工具参数）。
 * 通用循环只截短较早的步骤；科研工具单次结果可以很大（论文正文、整份文件），
 * 所以这里再加两道：每一步工具结果的总量封顶；每步结束后把较早的大块内容原地压短。
 * 压短的只是发给模型的对话，文件、事件日志里的完整内容不受影响。
 */
import type { ChatMessage } from '../../lib/modelGateway';
import { clipArguments } from '../agent/loop';

/** 发给网关的对话目标上限，低于网关的 12 万字硬上限 */
export const TRANSCRIPT_BUDGET = 92_000;
const OLD_RESULT_CHARS = 1800;
const OLD_ARGUMENT_CHARS = 600;
const OLD_USER_CHARS = 6000;

const sizeOf = (message: ChatMessage) =>
  message.content.length + (message.role === 'assistant' ? (message.toolCalls ?? []).reduce((sum, call) => sum + call.arguments.length, 0) : 0);

function shrink(message: ChatMessage): ChatMessage {
  if (message.role === 'tool') {
    return message.content.length > OLD_RESULT_CHARS
      ? { ...message, content: `${message.content.slice(0, OLD_RESULT_CHARS)}…（较早的结果已截短；需要完整内容请重新读取文件或文献）` }
      : message;
  }
  if (message.role === 'assistant') {
    if (!message.toolCalls?.some((call) => call.arguments.length > OLD_ARGUMENT_CHARS * 2)) return message;
    return { ...message, toolCalls: message.toolCalls.map((call) => ({ ...call, arguments: clipArguments(call.arguments, OLD_ARGUMENT_CHARS) })) };
  }
  if (message.role === 'user') {
    return message.content.length > OLD_USER_CHARS
      ? { ...message, content: `${message.content.slice(0, OLD_USER_CHARS)}…（较早附带的材料已省略；需要时用工具重新读取）` }
      : message;
  }
  return message;
}

/**
 * 原地整理对话：最近 keepGroups 步保持原样，更早的大块内容压短；
 * 仍超出预算时，从旧到新继续压，直到落进预算（系统提示不动）。
 */
export function tidyTranscript(messages: ChatMessage[], keepGroups = 3, budget = TRANSCRIPT_BUDGET): void {
  const starts: number[] = [];
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index].role !== 'tool') starts.push(index);
  }
  const recentFrom = starts.length > keepGroups ? starts[starts.length - keepGroups] : 1;
  for (let index = 1; index < recentFrom; index += 1) messages[index] = shrink(messages[index]);

  let total = messages.reduce((sum, message) => sum + sizeOf(message), 0);
  for (let index = recentFrom; index < messages.length && total > budget; index += 1) {
    const before = sizeOf(messages[index]);
    messages[index] = shrink(messages[index]);
    total -= before - sizeOf(messages[index]);
  }
}

/** 一步之内工具结果的总量封顶：超出的那条截短并说明 */
export function stepLimiter(limit: number) {
  let used = 0;
  return {
    reset: () => { used = 0; },
    fit: (content: string): string => {
      const room = Math.max(1200, limit - used);
      const fitted = content.length > room
        ? `${content.slice(0, room)}…（这一步返回的内容已达上限，这条结果被截短；请在下一步单独读取，或用 offset 分段读）`
        : content;
      used += fitted.length;
      return fitted;
    },
  };
}
