/** Google Gemini（/v1beta/models/{model}:streamGenerateContent?alt=sse）。 */
import {
  ProviderError, cleanBase, createMemo, imagesOf, isRecord, num, parseArguments, randomCallId, splitSystem, str,
  type BuildContext, type Effort, type Json, type ProviderAdapter, type ProviderModel, type ProviderRequest,
} from './core';

/**
 * 思考参数随代际不同：
 * - level：Gemini 3 起用 thinkingLevel（low / high），关不掉；
 * - budget：2.5 Flash 用 thinkingBudget，0 表示关闭；
 * - budget-pro：2.5 Pro 同样用 thinkingBudget，但关不掉；
 * - plain：更早的模型没有思考参数。
 */
type Mode = 'level' | 'budget' | 'budget-pro' | 'plain';

function modeOf(model: string): Mode {
  const id = model.toLowerCase();
  const match = id.match(/gemini-(\d+(?:\.\d+)?)/);
  if (!match) return 'plain';
  const version = Number(match[1]);
  if (version >= 3) return 'level';
  if (version >= 2.5) return id.includes('pro') ? 'budget-pro' : 'budget';
  return 'plain';
}

const BUDGET: Partial<Record<Effort, number>> = { none: 0, low: 1024, medium: 4096, high: 12288 };
const LEVEL_HEADROOM: Partial<Record<Effort, number>> = { low: 2000, high: 12000 };

/** 兼容粘贴进来的 …/v1beta、…/v1beta/models/xxx:generateContent */
export function geminiRoot(baseUrl: string): string {
  return cleanBase(baseUrl).replace(/\/(v1beta|v1alpha|v1)(\/.*)?$/i, '').replace(/\/+$/, '');
}

const modelPath = (model: string) => encodeURIComponent(model.trim().replace(/^models\//, ''));

/**
 * 函数调用备忘：Gemini 3 的 functionCall 块带 thoughtSignature，下一轮必须原样带回。
 * 统一消息里没有这一项，所以按调用 id 暂存在内存里。
 */
const callMemo = createMemo<Json>();
/** 官方给「历史不是本模型产生的」场景留的占位签名，用来跳过校验 */
const PLACEHOLDER_SIGNATURE = 'context_engineering_is_the_way_to_go';

interface Plan { config: Json | null; headroom: number }

function planOf(request: ProviderRequest, context: BuildContext): Plan {
  const mode = modeOf(request.model);
  if (context.bare || mode === 'plain' || context.effort === undefined) return { config: null, headroom: 0 };
  const effort = context.effort === 'max' ? 'high' : context.effort;
  if (mode === 'level') {
    const level = effort === 'high' ? 'high' : 'low';
    return { config: { thinkingLevel: level, includeThoughts: true }, headroom: LEVEL_HEADROOM[level] ?? 2000 };
  }
  const budget = Math.max(mode === 'budget-pro' ? 1024 : 0, BUDGET[effort] ?? 1024);
  return { config: budget ? { thinkingBudget: budget, includeThoughts: true } : { thinkingBudget: 0 }, headroom: budget };
}

const SCHEMA_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'format', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems', 'anyOf']);

/** functionDeclarations.parameters 只收 OpenAPI 子集：去掉 additionalProperties、$schema 等不认识的键。 */
function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!isRecord(schema)) return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && isRecord(value)) out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, geminiSchema(child)]));
    else if (key === 'type' && Array.isArray(value)) {
      // ["string", "null"] → type + nullable
      out.type = value.find((item) => item !== 'null') ?? 'string';
      if (value.includes('null')) out.nullable = true;
    } else if (key === 'items' || key === 'anyOf') out[key] = geminiSchema(value);
    else out[key] = value;
  }
  return out;
}

function wireContents(request: ProviderRequest, context: BuildContext): { system: string; contents: Json[] } {
  const { system, rest } = splitSystem(request.messages, request.json);
  const needsSignature = !context.bare && modeOf(request.model) === 'level';
  const names = new Map<string, string>();
  const contents: Json[] = [];
  const push = (role: 'user' | 'model', parts: Json[]) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last && last.role === role) (last.parts as Json[]).push(...parts);
    else contents.push({ role, parts });
  };
  for (const message of rest) {
    if (message.role === 'tool') {
      const parsed = parseArguments(message.content);
      push('user', [{ functionResponse: { name: names.get(message.toolCallId) ?? 'tool', response: Object.keys(parsed).length ? parsed : { result: message.content } } }]);
    } else if (message.role === 'assistant') {
      const calls = (message.toolCalls ?? []).map((call, index): Json => {
        names.set(call.id, call.name);
        const remembered = callMemo.get(call.id);
        if (remembered) return remembered;
        const part: Json = { functionCall: { name: call.name, args: parseArguments(call.arguments) } };
        if (needsSignature && index === 0) part.thoughtSignature = PLACEHOLDER_SIGNATURE;
        return part;
      });
      push('model', [...(message.content.trim() ? [{ text: message.content }] : []), ...calls]);
    } else if (message.role === 'user') {
      push('user', [
        ...imagesOf(message).map((image) => ({ inlineData: { mimeType: image.mime, data: image.base64 } })),
        ...(message.content.trim() ? [{ text: message.content }] : []),
      ]);
    }
  }
  if (contents[0]?.role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '请继续。' }] });
  return { system, contents };
}

const FINISH: Record<string, string> = { STOP: 'stop', MAX_TOKENS: 'length', FINISH_REASON_UNSPECIFIED: 'stop' };

export const gemini: ProviderAdapter = {
  protocol: 'gemini',

  efforts(model) {
    const mode = modeOf(model);
    if (mode === 'level') return ['low', 'high'];
    if (mode === 'budget') return ['none', 'low', 'medium', 'high'];
    return mode === 'budget-pro' ? ['low', 'medium', 'high'] : ['none'];
  },

  defaultEffort(model) {
    const mode = modeOf(model);
    return mode === 'plain' || mode === 'budget' ? 'none' : 'low';
  },

  build(request, context) {
    const plan = planOf(request, context);
    const { system, contents } = wireContents(request, context);
    const generationConfig: Json = { maxOutputTokens: request.maxTokens + (request.exactMaxTokens ? 0 : plan.headroom) };
    if (!context.bare) {
      if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
      // 带工具时端点不收 JSON 开关，这时只靠系统提示里的那句话
      if (request.json && !request.tools?.length) generationConfig.responseMimeType = 'application/json';
      if (plan.config) generationConfig.thinkingConfig = plan.config;
    }
    const body: Json = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map((tool) => {
          const parameters = geminiSchema(tool.parameters);
          const hasFields = isRecord(parameters) && isRecord(parameters.properties) && Object.keys(parameters.properties).length > 0;
          return { name: tool.name, description: tool.description, ...(hasFields ? { parameters } : {}) };
        }),
      }];
    }
    return {
      url: `${geminiRoot(request.connection.baseUrl)}/v1beta/models/${modelPath(request.model)}:${request.stream === false ? 'generateContent' : 'streamGenerateContent?alt=sse'}`,
      headers: { 'x-goog-api-key': request.connection.apiKey },
      body,
    };
  },

  parser(_request, _context, sink) {
    const produced: { id: string; part: Json }[] = [];
    let finished = false;
    const parser = {
      event(_name: string, data: unknown) {
        if (!isRecord(data)) return;
        if (data.error) throw new ProviderError('upstream', 'model-upstream-failed');
        if (isRecord(data.usageMetadata)) {
          const thoughts = num(data.usageMetadata.thoughtsTokenCount);
          sink.usage({
            promptTokens: num(data.usageMetadata.promptTokenCount),
            completionTokens: num(data.usageMetadata.candidatesTokenCount) + thoughts,
            ...(thoughts ? { reasoningTokens: thoughts } : {}),
          });
        }
        if (isRecord(data.promptFeedback) && data.promptFeedback.blockReason) { finished = true; sink.finish('content_filter'); }
        const candidate = Array.isArray(data.candidates) && isRecord(data.candidates[0]) ? data.candidates[0] : null;
        if (!candidate) return;
        const parts = isRecord(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
        for (const part of parts) {
          if (!isRecord(part)) continue;
          if (isRecord(part.functionCall)) {
            // 函数调用整块到达，没有 id，这里自己编一个
            const id = randomCallId();
            produced.push({ id, part });
            sink.tool(id, { id, name: str(part.functionCall.name), argsFull: JSON.stringify(part.functionCall.args ?? {}) });
          } else if (typeof part.text === 'string') {
            if (part.thought === true) sink.reasoning(part.text); else sink.text(part.text);
          }
        }
        const reason = str(candidate.finishReason);
        if (reason) { finished = true; sink.finish(FINISH[reason] ?? 'content_filter'); }
      },
      /** 非流式响应和流里的一个分片是同一个形状 */
      complete(payload: unknown) {
        parser.event('', payload);
        if (!finished) sink.finish('stop');
      },
      end() {
        for (const item of produced) callMemo.set(item.id, item.part);
      },
    };
    return parser;
  },

  modelsRequest(connection) {
    return { url: `${geminiRoot(connection.baseUrl)}/v1beta/models?pageSize=1000`, headers: { 'x-goog-api-key': connection.apiKey } };
  },

  parseModels(payload) {
    const list = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
    return list.flatMap((item): ProviderModel[] => {
      if (!isRecord(item)) return [];
      const id = str(item.name).replace(/^models\//, '');
      const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : null;
      // 端点说明了能力就只留能对话的
      if (!id || (methods && !methods.includes('generateContent'))) return [];
      const label = str(item.displayName);
      return [label ? { id, label } : { id }];
    });
  },

  isAuthError(status, body) {
    return status === 400 && /API key not valid|API_KEY_INVALID|API key expired/i.test(body);
  },
};
