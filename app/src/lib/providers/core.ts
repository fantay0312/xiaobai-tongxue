/**
 * 协议适配层的公共部分：统一的请求/结果形状、适配器接口、SSE 读取、错误归类。
 * 这一层不碰任何 store，也不读构建环境变量，node 脚本（simulate / livetest）可以直接引入。
 */
import type { LlmProtocol } from '../../types';
import type { Effort } from '../../store/modelPrefs';
import type { ChatMessage, ToolCall, ToolSpec } from '../modelGateway';
import type { ProviderConnection, ProviderModel } from './index';

export type { Effort, LlmProtocol, ChatMessage, ToolCall, ToolSpec, ProviderConnection, ProviderModel };
export type Json = Record<string, unknown>;

export const EFFORT_ORDER: readonly Effort[] = ['none', 'low', 'medium', 'high', 'max'];

export interface ProviderImage { mime: string; base64: string }
/** 统一消息；用户消息可以附带图片（课堂识图用） */
export type ProviderMessage = ChatMessage | { role: 'user'; content: string; images: ProviderImage[] };

export interface ProviderRequest {
  connection: ProviderConnection;
  model: string;
  messages: ProviderMessage[];
  tools?: ToolSpec[];
  /** 要求输出一个合法 JSON 对象 */
  json?: boolean;
  /** 想要的思考强度；省略 = 不带任何思考参数，由端点自己决定 */
  effort?: Effort;
  /** 正文额度。开着思考时适配器会另加一份思考额度（多数端点把两者算在同一个上限里） */
  maxTokens: number;
  /** true = maxTokens 已经含思考，原样下发 */
  exactMaxTokens?: boolean;
  temperature?: number;
  /** false = 一次取回整段（课堂的非流式调用）；缺省流式 */
  stream?: boolean;
  signal?: AbortSignal;
  /** 增量回调（不是累计全文） */
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface ProviderUsage { promptTokens: number; completionTokens: number; reasoningTokens?: number }

export interface ProviderResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  /** 统一成 stop | length | tool_calls | content_filter */
  finish: string;
  usage?: ProviderUsage;
}

/** 一次尝试的口径。bare = 被端点拒绝后的重试：去掉思考、温度、JSON 开关等一切可选参数 */
export interface BuildContext { effort: Effort | undefined; bare: boolean }

export interface WireRequest { url: string; headers: Record<string, string>; body: Json }

export interface StreamSink {
  text(delta: string): void;
  reasoning(delta: string): void;
  /** 工具调用按 key 累加；args 追加，argsFull 整体替换 */
  tool(key: string | number, patch: { id?: string; name?: string; args?: string; argsFull?: string }): void;
  finish(reason: string): void;
  usage(usage: ProviderUsage): void;
}

export interface StreamParser {
  /** 流式：逐个事件 */
  event(name: string, data: unknown): void;
  /** 非流式：整段响应。端点无视 stream 直接回 JSON 时也走这里 */
  complete(payload: unknown): void;
  /** 流正常结束后调用，适配器在这里记下后续轮次要带回的内容（思考原文、签名等） */
  end?(result: ProviderResult): void;
}

export interface ProviderAdapter {
  protocol: LlmProtocol;
  /** 这个模型真正区分的思考强度，从低到高；只有一档表示不可调 */
  efforts(model: string): Effort[];
  defaultEffort(model: string): Effort;
  build(request: ProviderRequest, context: BuildContext): WireRequest;
  parser(request: ProviderRequest, context: BuildContext, sink: StreamSink): StreamParser;
  /** 被拒绝（400）后依次改用的口径；缺省只有 bare 一档 */
  fallbacks?(request: ProviderRequest, context: BuildContext): BuildContext[];
  modelsRequest(connection: ProviderConnection): { url: string; headers: Record<string, string> };
  parseModels(payload: unknown): ProviderModel[];
  /** 个别端点用 400 报密钥错（Gemini） */
  isAuthError?(status: number, body: string): boolean;
}

// ───────────────────────── 错误 ─────────────────────────

export type ProviderErrorKind = 'auth' | 'rate' | 'rejected' | 'not-found' | 'network' | 'upstream' | 'incomplete';

/** message 是稳定的错误码（model-auth / model-busy / model-http-400 …），不含端点原文 */
export class ProviderError extends Error {
  kind: ProviderErrorKind;
  status?: number;
  /** 端点给的原因，已脱敏、截短，只用于排障提示 */
  detail: string;

  constructor(kind: ProviderErrorKind, code: string, status?: number, detail = '') {
    super(code);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export const abortError = () => new DOMException('Stopped', 'AbortError');
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** 去掉密钥本身、形似密钥的串，以及端点回显的「****abcd」式尾号。 */
export function scrub(text: string, apiKey: string): string {
  let clean = text;
  if (apiKey && apiKey.length >= 6) clean = clean.split(apiKey).join('***');
  return clean
    .replace(/\b(?:sk|pk|rk|key|AIza)[-_A-Za-z0-9]{10,}/g, '***')
    .replace(/\*{2,}[A-Za-z0-9]{1,12}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function providerMessage(body: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    const root = Array.isArray(payload) ? payload[0] : payload;
    if (!isRecord(root)) return '';
    const error = root.error;
    if (typeof error === 'string') return error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
    if (typeof root.message === 'string') return root.message;
    if (typeof root.detail === 'string') return root.detail;
  } catch { /* 不是 JSON 就不取原因 */ }
  return '';
}

export async function httpError(adapter: ProviderAdapter, response: Response, apiKey: string): Promise<ProviderError> {
  const status = response.status;
  const body = (await response.text().catch(() => '')).slice(0, 4000);
  if (status === 401 || status === 403 || adapter.isAuthError?.(status, body)) return new ProviderError('auth', 'model-auth', status);
  if (status === 429) return new ProviderError('rate', 'model-busy', status);
  const detail = scrub(providerMessage(body), apiKey);
  if (status === 400 || status === 422) return new ProviderError('rejected', `model-http-${status}`, status, detail);
  if (status === 404 || status === 405) return new ProviderError('not-found', `model-http-${status}`, status, detail);
  return new ProviderError('upstream', `model-http-${status}`, status, detail);
}

// ───────────────────────── 小工具 ─────────────────────────

export const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
export const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const JSON_INSTRUCTION = '本次只输出一个合法的 JSON 对象，不要加解释文字，也不要用代码块包裹。';

/** 去掉首尾空白和结尾斜杠 */
export function cleanBase(baseUrl: string): string {
  return baseUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** 把所有 system 消息并成一段（Responses / Anthropic / Gemini 的系统提示都是独立字段）。 */
export function splitSystem(messages: ProviderMessage[], json: boolean | undefined): { system: string; rest: ProviderMessage[] } {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean);
  if (json) system.push(JSON_INSTRUCTION);
  return { system: system.join('\n\n'), rest: messages.filter((message) => message.role !== 'system') };
}

export const imagesOf = (message: ProviderMessage): ProviderImage[] => ('images' in message && Array.isArray(message.images) ? message.images : []);

/** 工具入参：协议要对象的地方（Anthropic input / Gemini args）用它把 JSON 串还原。 */
export function parseArguments(json: string): Json {
  try {
    const value: unknown = JSON.parse(json || '{}');
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** JSON Schema 兜底成 object 形状 */
export function objectSchema(parameters: Json): Json {
  return parameters.type ? parameters : { type: 'object', properties: {}, ...parameters };
}

/** 去掉代码块围栏，取最外层的 {…}；不是合法 JSON 对象返回 null。 */
export function extractJsonObject(text: string): string | null {
  const cleaned = text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return isRecord(JSON.parse(candidate)) ? candidate : null;
  } catch {
    return null;
  }
}

/** 不支持的档位取最近一档；两边一样近时用该模型的默认档。 */
export function resolveEffort(adapter: ProviderAdapter, model: string, effort: Effort): Effort {
  const supported = adapter.efforts(model);
  if (supported.includes(effort)) return effort;
  const fallback = adapter.defaultEffort(model);
  const at = EFFORT_ORDER.indexOf(effort);
  let best = fallback;
  let bestDistance = Infinity;
  for (const candidate of supported) {
    const distance = Math.abs(EFFORT_ORDER.indexOf(candidate) - at);
    if (distance < bestDistance || (distance === bestDistance && candidate === fallback)) { best = candidate; bestDistance = distance; }
  }
  return best;
}

/** 有上限的备忘表：存后续轮次必须原样带回的东西（思考原文、签名）。只在内存里。 */
export function createMemo<T>(limit = 200) {
  const entries = new Map<string, T>();
  return {
    get: (key: string) => entries.get(key),
    has: (key: string) => entries.has(key),
    set(key: string, value: T) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

/** assistant 一轮的备忘键：有工具调用用第一个调用 id，否则用正文 */
export function turnKey(content: string, toolCalls?: ToolCall[]): string {
  return toolCalls?.length ? `call:${toolCalls[0].id}` : `text:${content.length}:${content.trim().slice(0, 2000)}`;
}

export const randomCallId = () => `call_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

// ───────────────────────── SSE ─────────────────────────

/** 逐条读 SSE；onEvent 返回 true 表示已经拿到结尾，可以收工。 */
export async function readSse(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, onEvent: (event: string, data: string) => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (!finished) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 1_000_000) throw new ProviderError('upstream', 'model-stream-invalid');
      let boundary: number;
      while (!finished && (boundary = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = raw.split('\n');
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) finished = onEvent(event, data);
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
}

/** 累积一次流式响应的统一结果。 */
export function createSink(request: ProviderRequest) {
  const calls = new Map<string, { id: string; name: string; arguments: string }>();
  let text = '';
  let reasoning = '';
  let finish = '';
  let usage: ProviderUsage | undefined;
  const sink: StreamSink = {
    text(delta) { if (delta) { text += delta; request.onText?.(delta); } },
    reasoning(delta) { if (delta) { reasoning += delta; request.onReasoning?.(delta); } },
    tool(key, patch) {
      const id = String(key);
      const call = calls.get(id) ?? { id: '', name: '', arguments: '' };
      if (patch.id) call.id = patch.id;
      if (patch.name && !call.name) call.name = patch.name;
      if (patch.args) call.arguments += patch.args;
      if (patch.argsFull !== undefined) call.arguments = patch.argsFull;
      calls.set(id, call);
    },
    finish(reason) { if (reason) finish = reason; },
    usage(next) { usage = { ...usage, ...next }; },
  };
  return {
    sink,
    result(): ProviderResult {
      const toolCalls = [...calls.values()].filter((call) => call.name).map((call) => ({
        id: call.id || randomCallId(), name: call.name, arguments: call.arguments.trim() || '{}',
      }));
      // 有的端点带着工具调用却报 stop，统一成 tool_calls
      return { text, reasoning, toolCalls, finish: toolCalls.length && finish === 'stop' ? 'tool_calls' : finish, usage };
    },
  };
}
