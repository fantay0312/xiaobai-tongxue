/** Anthropic Messages（/v1/messages）。system 是顶层字段；工具调用和工具结果都是内容块。 */
import {
  ProviderError, cleanBase, createMemo, imagesOf, isRecord, num, objectSchema, parseArguments, splitSystem, str, turnKey,
  type BuildContext, type Effort, type Json, type ProviderAdapter, type ProviderModel, type ProviderRequest,
} from './core';

/**
 * 思考参数随模型代际不同：
 * - always：思考关不掉（Opus 5 起、Sonnet 5.5、Fable / Mythos），只能用 output_config.effort 调深浅；
 * - adaptive：自适应思考，可以显式关闭（4.6–4.8、Sonnet 5、Haiku 5.5）；
 * - budget：旧式 budget_tokens（3.7、4.0–4.5、Haiku 4.5）；
 * - plain：没有思考，或者是挂在 Anthropic 兼容端点上的其他模型，一律不发思考参数。
 */
type Mode = 'always' | 'adaptive' | 'budget' | 'plain';

function claudeInfo(model: string): { tier: string; version: number } | null {
  const id = model.toLowerCase();
  let match = id.match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|@|$)/);
  if (match) return { tier: match[1], version: Number(match[2]) + (match[3] ? Number(match[3]) / 10 : 0) };
  match = id.match(/claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/);
  if (match) return { tier: match[3], version: Number(match[1]) + (match[2] ? Number(match[2]) / 10 : 0) };
  return null;
}

function modeOf(model: string): Mode {
  const info = claudeInfo(model);
  if (!info) return 'plain';
  if (info.tier === 'fable' || info.tier === 'mythos') return 'always';
  if (info.tier === 'haiku') return info.version >= 5.5 ? 'adaptive' : info.version >= 4.5 ? 'budget' : 'plain';
  // Opus 5 关思考后容易把工具调用写进正文，这里按「关不掉」处理，只调深浅
  if (info.version >= 5.5 || (info.tier === 'opus' && info.version >= 5)) return 'always';
  if (info.version >= 4.6) return 'adaptive';
  return info.version >= 3.7 ? 'budget' : 'plain';
}

/** 4.7 起采样参数会被拒绝；开着思考时旧模型也不收 temperature */
function acceptsTemperature(model: string, thinking: boolean): boolean {
  const info = claudeInfo(model);
  return !thinking && (!info || info.version < 4.7);
}

const BUDGET: Partial<Record<Effort, number>> = { low: 2000, medium: 6000, high: 12000 };
/** max_tokens 把思考也算在内，开着思考时多留一份 */
const HEADROOM: Partial<Record<Effort, number>> = { low: 4000, medium: 8000, high: 16000 };

/** 兼容粘贴进来的 …/v1、…/v1/messages、…/v1/models */
export function anthropicRoot(baseUrl: string): string {
  return cleanBase(baseUrl).replace(/\/(v1\/)?(messages|models)$/i, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
}

function headers(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
}

/**
 * 思考块备忘：同一个模型接着聊时，带签名的 thinking 块要原样带回（工具循环里尤其如此）。
 * 统一消息里没有这一项，所以按轮次暂存在内存里；缺了就不带，必要时关掉这一次的思考。
 */
const thinkingMemo = createMemo<Json[]>();

interface Plan { thinking: Json | null; effort: Effort | null; replay: boolean; headroom: number }

function planOf(request: ProviderRequest, context: BuildContext): Plan {
  const mode = modeOf(request.model);
  const off: Plan = { thinking: null, effort: null, replay: false, headroom: 0 };
  if (context.bare || mode === 'plain' || context.effort === undefined) return off;
  const effort = context.effort === 'max' ? 'high' : context.effort;
  const toolTurns = request.messages.filter((message) => message.role === 'assistant' && message.toolCalls?.length);
  const replayable = toolTurns.every((message) => message.role === 'assistant' && thinkingMemo.has(turnKey(message.content, message.toolCalls)));
  // 工具循环里缺了思考块：旧模型会直接报错，能关的就关掉这一次
  const mustDisable = !!request.tools?.length && toolTurns.length > 0 && !replayable;
  if (mode === 'budget') {
    if (effort === 'none' || mustDisable) return off;
    const budget = BUDGET[effort] ?? 2000;
    return { thinking: { type: 'enabled', budget_tokens: budget }, effort: null, replay: true, headroom: budget };
  }
  if (mode === 'adaptive' && (effort === 'none' || mustDisable)) return { ...off, thinking: { type: 'disabled' } };
  const level = effort === 'none' ? 'low' : effort;
  // display 要显式打开，否则新模型流回来的思考是空文本
  return { thinking: { type: 'adaptive', display: 'summarized' }, effort: level, replay: true, headroom: HEADROOM[level] ?? 4000 };
}

function wireMessages(request: ProviderRequest, replay: boolean): { system: string; messages: Json[] } {
  const { system, rest } = splitSystem(request.messages, request.json);
  const messages: Json[] = [];
  // 连续同角色并成一轮：同一轮的工具结果必须放在同一条 user 消息里
  const push = (role: 'user' | 'assistant', blocks: Json[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last && last.role === role) (last.content as Json[]).push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const message of rest) {
    if (message.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, ...(message.content ? { content: message.content } : {}) }]);
    } else if (message.role === 'assistant') {
      const remembered = replay ? thinkingMemo.get(turnKey(message.content, message.toolCalls)) ?? [] : [];
      push('assistant', [
        ...remembered,
        ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: parseArguments(call.arguments) })),
      ]);
    } else if (message.role === 'user') {
      push('user', [
        ...imagesOf(message).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } })),
        ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
      ]);
    }
  }
  // 第一条必须是 user
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: '请继续。' }] });
  return { system, messages };
}

const FINISH: Record<string, string> = {
  end_turn: 'stop', stop_sequence: 'stop', pause_turn: 'stop', max_tokens: 'length', model_context_window_exceeded: 'length',
  tool_use: 'tool_calls', refusal: 'content_filter',
};

export const anthropicMessages: ProviderAdapter = {
  protocol: 'anthropic-messages',

  efforts(model) {
    const mode = modeOf(model);
    if (mode === 'plain') return ['none'];
    return mode === 'always' ? ['low', 'medium', 'high'] : ['none', 'low', 'medium', 'high'];
  },

  defaultEffort(model) {
    const mode = modeOf(model);
    return mode === 'plain' || mode === 'budget' ? 'none' : 'low';
  },

  build(request, context) {
    const plan = planOf(request, context);
    const { system, messages } = wireMessages(request, plan.replay);
    const body: Json = { model: request.model, max_tokens: request.maxTokens + plan.headroom, stream: request.stream !== false, messages };
    if (system) body.system = system;
    if (plan.thinking) body.thinking = plan.thinking;
    if (plan.effort) body.output_config = { effort: plan.effort };
    const thinkingOn = !!plan.thinking && plan.thinking.type !== 'disabled';
    if (!context.bare && request.temperature !== undefined && acceptsTemperature(request.model, thinkingOn || modeOf(request.model) === 'always')) {
      body.temperature = request.temperature;
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: objectSchema(tool.parameters) }));
    }
    return { url: `${anthropicRoot(request.connection.baseUrl)}/v1/messages`, headers: headers(request.connection.apiKey), body };
  },

  parser(request, context, sink) {
    const plan = planOf(request, context);
    const blocks = new Map<number, Json>();
    let promptTokens = 0;
    return {
      event(name, data) {
        if (!isRecord(data)) return;
        const type = str(data.type) || name;
        const index = num(data.index);
        if (type === 'message_start' && isRecord(data.message) && isRecord(data.message.usage)) {
          const usage = data.message.usage;
          promptTokens = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
          sink.usage({ promptTokens, completionTokens: num(usage.output_tokens) });
        } else if (type === 'content_block_start' && isRecord(data.content_block)) {
          const block = data.content_block;
          if (block.type === 'tool_use') sink.tool(index, { id: str(block.id), name: str(block.name) });
          else if (block.type === 'thinking') blocks.set(index, { type: 'thinking', thinking: str(block.thinking), signature: str(block.signature) });
          else if (block.type === 'redacted_thinking') blocks.set(index, { type: 'redacted_thinking', data: str(block.data) });
          else if (block.type === 'text') sink.text(str(block.text));
        } else if (type === 'content_block_delta' && isRecord(data.delta)) {
          const delta = data.delta;
          const block = blocks.get(index);
          if (delta.type === 'text_delta') sink.text(str(delta.text));
          else if (delta.type === 'thinking_delta') {
            sink.reasoning(str(delta.thinking));
            if (block) block.thinking = str(block.thinking) + str(delta.thinking);
          } else if (delta.type === 'signature_delta') {
            if (block) block.signature = str(block.signature) + str(delta.signature);
          } else if (delta.type === 'input_json_delta') sink.tool(index, { args: str(delta.partial_json) });
        } else if (type === 'message_delta') {
          if (isRecord(data.delta) && data.delta.stop_reason) sink.finish(FINISH[str(data.delta.stop_reason)] ?? 'stop');
          if (isRecord(data.usage)) sink.usage({ promptTokens, completionTokens: num(data.usage.output_tokens) });
        } else if (type === 'error') {
          const kind = isRecord(data.error) ? str(data.error.type) : '';
          throw kind === 'overloaded_error' || kind === 'rate_limit_error'
            ? new ProviderError('rate', 'model-busy')
            : new ProviderError('upstream', 'model-upstream-failed');
        }
      },
      complete(payload) {
        if (!isRecord(payload) || payload.type === 'error' || !Array.isArray(payload.content)) throw new ProviderError('upstream', 'model-upstream-failed');
        payload.content.forEach((block, index) => {
          if (!isRecord(block)) return;
          if (block.type === 'text') sink.text(str(block.text));
          else if (block.type === 'tool_use') sink.tool(index, { id: str(block.id), name: str(block.name), argsFull: JSON.stringify(isRecord(block.input) ? block.input : {}) });
          else if (block.type === 'thinking') {
            sink.reasoning(str(block.thinking));
            blocks.set(index, { type: 'thinking', thinking: str(block.thinking), signature: str(block.signature) });
          } else if (block.type === 'redacted_thinking') blocks.set(index, { type: 'redacted_thinking', data: str(block.data) });
        });
        if (isRecord(payload.usage)) {
          const usage = payload.usage;
          sink.usage({ promptTokens: num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens), completionTokens: num(usage.output_tokens) });
        }
        sink.finish(FINISH[str(payload.stop_reason)] ?? 'stop');
      },
      end(result) {
        const kept = [...blocks.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1]);
        if (plan.replay && kept.length) thinkingMemo.set(turnKey(result.text, result.toolCalls), kept);
      },
    };
  },

  modelsRequest(connection) {
    return { url: `${anthropicRoot(connection.baseUrl)}/v1/models?limit=1000`, headers: headers(connection.apiKey) };
  },

  parseModels(payload) {
    const list = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    return list.flatMap((item): ProviderModel[] => {
      if (!isRecord(item) || !str(item.id)) return [];
      const label = str(item.display_name);
      return [label ? { id: str(item.id), label } : { id: str(item.id) }];
    });
  },
};
