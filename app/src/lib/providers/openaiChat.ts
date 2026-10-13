/** OpenAI Chat Completions（/chat/completions）。DeepSeek、通义、智谱、Kimi、OpenRouter 等兼容端点都走这里。 */
import {
  JSON_INSTRUCTION, ProviderError, cleanBase, createMemo, imagesOf, isRecord, num, objectSchema, str, turnKey,
  type BuildContext, type Effort, type Json, type ProviderAdapter, type ProviderModel, type ProviderRequest,
} from './core';

interface Level { params: Json; headroom: number }

/**
 * DeepSeek 的 reasoning_effort：与 server/model-catalog.mjs 同一张表（五档的实测记录在那边），两条线路的档位保持一致。
 * headroom 是留给思考的额度：max_tokens 把思考和正文算在一起，不留会把正文挤空。
 */
const DEEPSEEK_LEVELS: Partial<Record<Effort, Level>> = {
  none: { params: { reasoning_effort: 'none' }, headroom: 0 },
  low: { params: { reasoning_effort: 'low' }, headroom: 5000 },
  medium: { params: { reasoning_effort: 'medium' }, headroom: 8000 },
  high: { params: { reasoning_effort: 'high' }, headroom: 12000 },
  max: { params: { reasoning_effort: 'max' }, headroom: 24000 },
};
/** OpenAI 自家的推理模型（o 系列、gpt-5 起）：只收 max_completion_tokens，不收 temperature。 */
const OPENAI_REASONING_LEVELS: Partial<Record<Effort, Level>> = {
  low: { params: { reasoning_effort: 'low' }, headroom: 2000 },
  medium: { params: { reasoning_effort: 'medium' }, headroom: 6000 },
  high: { params: { reasoning_effort: 'high' }, headroom: 12000 },
};

export const isDeepSeek = (model: string) => /deepseek/i.test(model);
export const isOpenAiReasoning = (model: string) => /(^|\/)(o[1-9](-|$)|gpt-[5-9]|codex)/i.test(model);

function levelsOf(model: string): Partial<Record<Effort, Level>> | null {
  if (isDeepSeek(model)) return DEEPSEEK_LEVELS;
  if (isOpenAiReasoning(model)) return OPENAI_REASONING_LEVELS;
  return null;
}

/** 兼容 https://api.deepseek.com、…/v1、以及直接粘贴的完整 …/chat/completions；只有域名时补 /v1 */
export function openAiRoot(baseUrl: string): string {
  const root = cleanBase(baseUrl).replace(/\/(chat\/completions|completions|responses|models|embeddings)$/i, '').replace(/\/+$/, '');
  try {
    const url = new URL(root);
    if (url.pathname === '/' || url.pathname === '') return `${url.origin}/v1`;
  } catch { /* 地址不合法时原样返回，由 fetch 报错 */ }
  return root;
}

/**
 * DeepSeek 规定：带 tools 且开着思考时，历史里每条 assistant 都要带回当时的 reasoning_content，否则 400。
 * 统一消息里没有这一项，所以按轮次暂存在内存里；补不齐就关思考。
 */
const reasoningMemo = createMemo<string>();

interface Plan { level: Level | null; replay: boolean; thinking: boolean }

function planOf(request: ProviderRequest, context: BuildContext): Plan {
  const levels = levelsOf(request.model);
  if (context.bare || !levels || context.effort === undefined) return { level: null, replay: false, thinking: false };
  let level = levels[context.effort] ?? null;
  let replay = false;
  if (isDeepSeek(request.model) && request.tools?.length && level && level.headroom > 0) {
    const assistants = request.messages.filter((message) => message.role === 'assistant');
    const complete = assistants.every((message) => message.role === 'assistant' && reasoningMemo.has(turnKey(message.content, message.toolCalls)));
    if (complete) replay = assistants.length > 0;
    else level = levels.none ?? null;
  }
  return { level, replay, thinking: !!level && level.headroom > 0 };
}

function wireMessages(request: ProviderRequest, replay: boolean): Json[] {
  const wire = request.messages.map((message): Json => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.role === 'assistant') {
      const reasoning = replay ? reasoningMemo.get(turnKey(message.content, message.toolCalls)) : undefined;
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } })) } : {}),
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      };
    }
    const images = imagesOf(message);
    if (!images.length) return { role: message.role, content: message.content };
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } })),
      ],
    };
  });
  if (!request.json) return wire;
  // JSON 模式要求提示词里明确要 JSON，否则有的端点会一直吐空白；没有原生开关时也靠这句话
  let at = 0;
  while (at < wire.length && wire[at].role === 'system') at += 1;
  return [...wire.slice(0, at), { role: 'system', content: JSON_INSTRUCTION }, ...wire.slice(at)];
}

export const openaiChat: ProviderAdapter = {
  protocol: 'openai-chat',

  efforts(model) {
    const levels = levelsOf(model);
    return levels ? (Object.keys(levels) as Effort[]) : ['none'];
  },

  defaultEffort(model) {
    return levelsOf(model) ? 'low' : 'none';
  },

  build(request, context) {
    const plan = planOf(request, context);
    const limit = request.maxTokens + (request.exactMaxTokens ? 0 : plan.level?.headroom ?? 0);
    const reasoningModel = isOpenAiReasoning(request.model);
    const streaming = request.stream !== false;
    const body: Json = { model: request.model, stream: streaming, messages: wireMessages(request, plan.replay) };
    body[reasoningModel ? 'max_completion_tokens' : 'max_tokens'] = limit;
    if (!context.bare) {
      if (streaming) body.stream_options = { include_usage: true };
      if (request.temperature !== undefined && !reasoningModel) body.temperature = request.temperature;
      if (plan.level) Object.assign(body, plan.level.params);
      if (request.json) body.response_format = { type: 'json_object' };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: objectSchema(tool.parameters) } }));
    }
    return { url: `${openAiRoot(request.connection.baseUrl)}/chat/completions`, headers: { Authorization: `Bearer ${request.connection.apiKey}` }, body };
  },

  /** DeepSeek 多一档退让：先关思考（none 已实测可用），再去掉全部可选参数 */
  fallbacks(request, context) {
    const bare: BuildContext = { effort: undefined, bare: true };
    return isDeepSeek(request.model) && context.effort !== 'none' ? [{ effort: 'none', bare: false }, bare] : [bare];
  },

  parser(request, context, sink) {
    const plan = planOf(request, context);
    const usageOf = (usage: unknown) => {
      if (!isRecord(usage)) return;
      const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details.reasoning_tokens : undefined;
      sink.usage({
        promptTokens: num(usage.prompt_tokens),
        completionTokens: num(usage.completion_tokens),
        ...(typeof details === 'number' ? { reasoningTokens: details } : {}),
      });
    };
    return {
      event(_name, data) {
        if (!isRecord(data)) return;
        if (data.error) throw new ProviderError('upstream', 'model-upstream-failed');
        usageOf(data.usage);
        const choice = Array.isArray(data.choices) && isRecord(data.choices[0]) ? data.choices[0] : null;
        if (!choice) return;
        const delta = isRecord(choice.delta) ? choice.delta : {};
        sink.reasoning(str(delta.reasoning_content) || str(delta.reasoning));
        sink.text(str(delta.content));
        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls) {
            if (!isRecord(part)) continue;
            const fn = isRecord(part.function) ? part.function : {};
            sink.tool(typeof part.index === 'number' ? part.index : 0, { id: str(part.id), name: str(fn.name), args: str(fn.arguments) });
          }
        }
        sink.finish(str(choice.finish_reason));
      },
      complete(payload) {
        if (!isRecord(payload) || payload.error) throw new ProviderError('upstream', 'model-upstream-failed');
        usageOf(payload.usage);
        const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : null;
        const message = choice && isRecord(choice.message) ? choice.message : null;
        if (!choice || !message) throw new ProviderError('incomplete', 'model-stream-incomplete');
        sink.reasoning(str(message.reasoning_content) || str(message.reasoning));
        // content 可能是字符串，也可能是分块数组
        sink.text(Array.isArray(message.content) ? message.content.map((part) => (isRecord(part) ? str(part.text) : '')).join('') : str(message.content));
        if (Array.isArray(message.tool_calls)) {
          message.tool_calls.forEach((call, index) => {
            if (!isRecord(call)) return;
            const fn = isRecord(call.function) ? call.function : {};
            sink.tool(index, { id: str(call.id), name: str(fn.name), argsFull: str(fn.arguments) });
          });
        }
        sink.finish(str(choice.finish_reason) || 'stop');
      },
      end(result) {
        if (isDeepSeek(request.model) && request.tools?.length && plan.thinking && result.reasoning) {
          reasoningMemo.set(turnKey(result.text, result.toolCalls), result.reasoning);
        }
      },
    };
  },

  modelsRequest(connection) {
    return { url: `${openAiRoot(connection.baseUrl)}/models`, headers: { Authorization: `Bearer ${connection.apiKey}` } };
  },

  parseModels(payload) {
    const list = Array.isArray(payload) ? payload : isRecord(payload) ? (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []) : [];
    return list.flatMap((item): ProviderModel[] => {
      if (typeof item === 'string') return [{ id: item }];
      if (!isRecord(item)) return [];
      const id = str(item.id) || str(item.name);
      if (!id) return [];
      const label = str(item.display_name) || (str(item.name) !== id ? str(item.name) : '');
      return [label ? { id, label } : { id }];
    });
  },
};
