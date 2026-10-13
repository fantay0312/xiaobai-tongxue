/**
 * 模型网关（客户端）—— 学习终端里所有「调模型」的新功能都走这里：
 * Agent 任务、AI 课堂、工作台生成、记忆提炼等。
 * proxy 模式走同源网关 /api/model/*（密钥在服务器）；api 模式用本机配置的 OpenAI 兼容端点直连；
 * mock 模式没有模型，抛 ModelUnavailableError，由调用方给出本地降级。
 */
import { API_BASE, currentAuthEpoch, gatewayFetch } from './api';
import { chatCompletionsUrl } from '../engine/llm';
import { useAppStore } from '../store/appStore';
import { EFFORTS, useModelPrefs } from '../store/modelPrefs';
import type { Effort } from '../store/modelPrefs';

export type { Effort };

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  description?: string;
  /** 支持的思考强度，从低到高 */
  efforts: Effort[];
  defaultEffort: Effort;
  badge?: string;
}
export interface ModelCatalog { available: boolean; models: ModelInfo[]; defaultModel: string | null }

export interface ToolSpec { name: string; description: string; /** JSON Schema（object） */ parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; /** JSON 字符串 */ arguments: string }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** 要求输出合法 JSON 对象 */
  json?: boolean;
  /** 省略时用 store/modelPrefs 里的选择 */
  model?: string | null;
  effort?: Effort;
  /** 上限 8000 */
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** 正文流式回调，参数是累计全文 */
  onText?: (text: string) => void;
  /** 思考过程流式回调，参数是累计全文 */
  onReasoning?: (reasoning: string) => void;
}
export interface ModelResult {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  model: string;
  finish: string;
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number };
}

export class ModelUnavailableError extends Error {
  constructor(message = 'model-unavailable') { super(message); this.name = 'ModelUnavailableError'; }
}

// ───────────────────────── 公共小件 ─────────────────────────

type Json = Record<string, unknown>;
type Usage = ModelResult['usage'];

const DEFAULT_MAX_TOKENS = 4000;
const MAX_TOKENS = 8000;
/** 略长于网关的 120 秒，让网关先给出明确的超时原因 */
const CLIENT_TIMEOUT_MS = 150_000;

const isRecord = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);
const unavailable = (): ModelCatalog => ({ available: false, models: [], defaultModel: null });
const stopped = () => new DOMException('Stopped', 'AbortError');

function clampTokens(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_TOKENS, Math.max(16, Math.floor(value))) : DEFAULT_MAX_TOKENS;
}

function clampTemperature(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

/** 只带契约里的字段，避免把调用方挂在消息上的界面状态一起发出去。 */
function cleanMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role === 'tool') return { role: 'tool', toolCallId: message.toolCallId, content: message.content };
    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls?.map(({ id, name, arguments: args }) => ({ id, name, arguments: args }));
      return toolCalls?.length ? { role: 'assistant', content: message.content, toolCalls } : { role: 'assistant', content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

/** 调用方的取消信号 + 自带超时，合成一个信号。 */
function linkSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    /** 把「被掐断」翻译成调用方能分辨的错误 */
    reason: (): Error => (timedOut ? new Error('model-timeout') : stopped()),
    dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}

/** 逐条读 SSE；onEvent 返回 true 表示已经拿到结尾，可以收工。 */
async function readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, onEvent: (event: string, data: string) => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!finished) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 512_000) throw new Error('model-stream-invalid');
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
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
}

function parseJson(data: string): unknown {
  try { return JSON.parse(data); } catch { throw new Error('model-stream-invalid'); }
}

function readToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ToolCall[] => (isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' && item.name
    ? [{ id: item.id, name: item.name, arguments: typeof item.arguments === 'string' && item.arguments.trim() ? item.arguments : '{}' }]
    : []));
}

function readUsage(value: unknown): Usage {
  if (!isRecord(value)) return undefined;
  // 网关已经转成驼峰；直连上游时是下划线
  const prompt = value.promptTokens ?? value.prompt_tokens;
  const completion = value.completionTokens ?? value.completion_tokens;
  const details = isRecord(value.completion_tokens_details) ? value.completion_tokens_details.reasoning_tokens : undefined;
  const reasoning = value.reasoningTokens ?? details;
  return {
    promptTokens: typeof prompt === 'number' ? prompt : 0,
    completionTokens: typeof completion === 'number' ? completion : 0,
    ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}),
  };
}

async function errorCode(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
  } catch {
    return '';
  }
}

// ───────────────────────── proxy：同源网关 ─────────────────────────

async function streamViaGateway(request: ModelRequest): Promise<ModelResult> {
  const prefs = useModelPrefs.getState();
  const link = linkSignal(request.signal, CLIENT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await gatewayFetch(`${API_BASE}/model/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: link.signal,
        body: JSON.stringify({
          messages: cleanMessages(request.messages),
          tools: request.tools?.length ? request.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) : undefined,
          json: request.json === true,
          model: request.model ?? prefs.model ?? undefined,
          effort: request.effort ?? prefs.effort,
          maxTokens: clampTokens(request.maxTokens),
          temperature: clampTemperature(request.temperature),
        }),
      });
    } catch {
      if (link.signal.aborted) throw link.reason();
      // 网关连不上（断网、服务没起）按「没有模型」处理，调用方走本地降级
      throw new ModelUnavailableError('model-network');
    }
    if (!response.ok || !response.body) {
      const status = response.status;
      if (status === 401) throw new Error('model-auth');
      if (status === 429) throw new Error('model-busy');
      // 404 = 网关还是没有这条路由的旧版本
      if (status === 404 || status === 405 || status === 501 || status === 503) throw new ModelUnavailableError();
      const code = await errorCode(response);
      throw new Error(code.startsWith('model-') ? code : `model-http-${status}`);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new ModelUnavailableError();

    let text = '';
    let reasoning = '';
    let result: ModelResult | null = null;
    try {
      await readEvents(response.body, link.signal, (event, data) => {
        const payload = parseJson(data);
        if (!isRecord(payload)) return false;
        if (event === 'error') {
          const code = typeof payload.code === 'string' ? payload.code : 'model-failed';
          throw new Error(code === 'model-rate-limited' ? 'model-busy' : code);
        }
        if (event === 'text' && typeof payload.delta === 'string') { text += payload.delta; request.onText?.(text); }
        else if (event === 'reasoning' && typeof payload.delta === 'string') { reasoning += payload.delta; request.onReasoning?.(reasoning); }
        else if (event === 'done') {
          if (typeof payload.text !== 'string') throw new Error('model-stream-invalid');
          result = {
            text: payload.text,
            reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : reasoning,
            toolCalls: readToolCalls(payload.toolCalls),
            model: typeof payload.model === 'string' ? payload.model : '',
            finish: typeof payload.finish === 'string' ? payload.finish : 'stop',
            usage: readUsage(payload.usage),
          };
          return true;
        }
        return false;
      });
    } catch (error) {
      if (link.signal.aborted) throw link.reason();
      throw error instanceof Error && error.message.startsWith('model-') ? error : new Error('model-stream-incomplete');
    }
    if (link.signal.aborted) throw link.reason();
    if (!result) throw new Error('model-stream-incomplete');
    return result;
  } finally {
    link.dispose();
  }
}

// ───────────────────────── api：本机配置的端点直连 ─────────────────────────

interface EffortLevel { params: Json; reasoningTokens: number }

/**
 * 与 server/model-catalog.mjs 同一张表：DeepSeek V4 只区分 none / low / high / max。
 * reasoningTokens 是留给思考的额度（上游把思考和正文算进同一个 max_tokens）。
 * 其他端点不知道认不认思考参数，一律不发，只留一档。
 */
const DEEPSEEK_LEVELS: Partial<Record<Effort, EffortLevel>> = {
  none: { params: { reasoning_effort: 'none' }, reasoningTokens: 0 },
  low: { params: { reasoning_effort: 'low' }, reasoningTokens: 5000 },
  high: { params: { reasoning_effort: 'high' }, reasoningTokens: 12000 },
  max: { params: { reasoning_effort: 'max' }, reasoningTokens: 24000 },
};
const PLAIN_LEVELS: Partial<Record<Effort, EffortLevel>> = { none: { params: {}, reasoningTokens: 0 } };
const BARE: EffortLevel = { params: {}, reasoningTokens: 0 };

const levelsFor = (model: string) => (/deepseek/i.test(model) ? DEEPSEEK_LEVELS : PLAIN_LEVELS);
const defaultEffortFor = (model: string): Effort => (/deepseek/i.test(model) ? 'low' : 'none');

/** 不支持的档位取最近一档；两边一样近时用默认档。 */
function nearestEffort(model: string, effort: Effort): Effort {
  const levels = levelsFor(model);
  if (levels[effort]) return effort;
  const fallback = defaultEffortFor(model);
  const at = EFFORTS.indexOf(effort);
  let best = fallback;
  let bestDistance = Infinity;
  for (const candidate of EFFORTS) {
    if (!levels[candidate]) continue;
    const distance = Math.abs(EFFORTS.indexOf(candidate) - at);
    if (distance < bestDistance || (distance === bestDistance && candidate === fallback)) { best = candidate; bestDistance = distance; }
  }
  return best;
}

/**
 * 思考原文备忘（仅 api 模式；proxy 模式由网关代管）。
 * DeepSeek 规定：带 tools 且开着思考时，历史里每条 assistant 都要带回当时的 reasoning_content，否则 400。
 */
const reasoningMemo = new Map<string, string>();
const memoKey = (content: string, toolCalls?: ToolCall[]) => (toolCalls?.length ? `call:${toolCalls[0].id}` : `text:${content.length}:${content.trim().slice(0, 2000)}`);
function remember(content: string, toolCalls: ToolCall[], reasoning: string) {
  reasoningMemo.set(memoKey(content, toolCalls), reasoning);
  while (reasoningMemo.size > 200) {
    const oldest = reasoningMemo.keys().next().value;
    if (oldest === undefined) break;
    reasoningMemo.delete(oldest);
  }
}

function toWire(messages: ChatMessage[], json: boolean, withReasoning: boolean): Json[] {
  const wire = cleanMessages(messages).map((message): Json => {
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.role !== 'assistant') return { role: message.role, content: message.content };
    const reasoning = withReasoning ? reasoningMemo.get(memoKey(message.content, message.toolCalls)) : undefined;
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments || '{}' } })) } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    };
  });
  if (!json) return wire;
  // JSON 模式要求提示词里明确要 JSON，否则上游可能一直吐空白
  let at = 0;
  while (at < wire.length && wire[at].role === 'system') at += 1;
  return [...wire.slice(0, at), { role: 'system', content: '本次只输出一个合法的 JSON 对象，不要加解释文字，也不要用代码块包裹。' }, ...wire.slice(at)];
}

interface DirectRun { text: string; reasoning: string; toolCalls: ToolCall[]; finish: string; usage: Usage }

async function runDirect(
  request: ModelRequest,
  target: { url: string; apiKey: string; model: string },
  level: EffortLevel,
  signal: AbortSignal,
  streamed: { text: string; reasoning: string },
): Promise<DirectRun> {
  const withReasoning = !!request.tools?.length && level.reasoningTokens > 0;
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      signal,
      body: JSON.stringify({
        model: target.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: clampTokens(request.maxTokens) + level.reasoningTokens,
        temperature: clampTemperature(request.temperature) ?? (request.json ? 0.2 : 0.6),
        ...level.params,
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
        messages: toWire(request.messages, request.json === true, withReasoning),
      }),
    });
  } catch {
    if (signal.aborted) throw stopped();
    throw new ModelUnavailableError('model-network');
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new Error('model-auth');
    if (response.status === 429) throw new Error('model-busy');
    throw new Error(`model-http-${response.status}`);
  }

  const calls: ToolCall[] = [];
  let text = '';
  let reasoning = '';
  let finish = '';
  let usage: Usage;
  await readEvents(response.body, signal, (_event, data) => {
    if (data === '[DONE]') return true;
    const chunk = parseJson(data);
    if (!isRecord(chunk)) return false;
    if (chunk.error) throw new Error('model-upstream-failed');
    if (chunk.usage) usage = readUsage(chunk.usage);
    const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : null;
    if (!choice) return false;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    const thought = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : '';
    if (thought) { reasoning += thought; streamed.reasoning += thought; request.onReasoning?.(streamed.reasoning); }
    if (typeof delta.content === 'string' && delta.content) { text += delta.content; streamed.text += delta.content; request.onText?.(streamed.text); }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        if (!isRecord(part)) continue;
        const index = typeof part.index === 'number' && Number.isInteger(part.index) && part.index >= 0 && part.index < 16 ? part.index : Math.max(0, calls.length - 1);
        const call = calls[index] ??= { id: '', name: '', arguments: '' };
        if (typeof part.id === 'string' && part.id) call.id = part.id;
        const fn = isRecord(part.function) ? part.function : {};
        if (typeof fn.name === 'string' && !call.name) call.name = fn.name;
        if (typeof fn.arguments === 'string') call.arguments += fn.arguments;
      }
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) finish = choice.finish_reason;
    return false;
  });
  if (signal.aborted) throw stopped();
  if (!finish) throw new Error('model-stream-incomplete');
  const toolCalls = calls.filter((call) => call?.name).map((call, index) => ({
    id: call.id || `call_${Date.now().toString(36)}_${index}`, name: call.name, arguments: call.arguments.trim() || '{}',
  }));
  return { text, reasoning, toolCalls, finish, usage };
}

async function streamDirect(request: ModelRequest, settings: { baseUrl: string; apiKey: string; model: string }): Promise<ModelResult> {
  const target = { url: chatCompletionsUrl(settings.baseUrl), apiKey: settings.apiKey, model: settings.model };
  const levels = levelsFor(target.model);
  const wanted = levels[nearestEffort(target.model, request.effort ?? useModelPrefs.getState().effort)] ?? BARE;
  const off = levels.none ?? BARE;
  const hasTools = !!request.tools?.length;
  const assistants = request.messages.filter((message) => message.role === 'assistant');
  const canReplay = assistants.every((message) => reasoningMemo.has(memoKey(message.content, message.toolCalls)));
  // 上游返回 400 时依次退让：想要的档位 → 关思考 → 不带任何思考参数
  const chain: EffortLevel[] = [];
  for (const candidate of [hasTools && assistants.length && wanted.reasoningTokens > 0 && !canReplay ? off : wanted, off, BARE]) {
    if (!chain.some((item) => JSON.stringify(item.params) === JSON.stringify(candidate.params))) chain.push(candidate);
  }

  const link = linkSignal(request.signal, CLIENT_TIMEOUT_MS);
  const streamed = { text: '', reasoning: '' };
  try {
    let level = chain[0];
    let run: DirectRun | null = null;
    for (let step = 0; !run; step += 1) {
      level = chain[step];
      try {
        run = await runDirect(request, target, level, link.signal, streamed);
      } catch (error) {
        const rejected = error instanceof Error && error.message === 'model-http-400';
        if (!rejected || link.signal.aborted || step + 1 >= chain.length) throw error;
      }
    }
    // 思考把额度吃光、正文一个字没出：关思考补一次正文
    if (!run.text.trim() && !run.toolCalls.length && run.finish === 'length' && level.reasoningTokens > 0 && level !== off) {
      level = off;
      run = await runDirect(request, target, level, link.signal, streamed);
    }
    if (hasTools && level.reasoningTokens > 0 && run.reasoning) remember(run.text, run.toolCalls, run.reasoning);
    return { text: run.text, reasoning: streamed.reasoning, toolCalls: run.toolCalls, model: target.model, finish: run.finish, usage: run.usage };
  } catch (error) {
    if (link.signal.aborted) throw link.reason();
    if (error instanceof ModelUnavailableError) throw error;
    throw error instanceof Error && error.message.startsWith('model-') ? error : new Error('model-stream-incomplete');
  } finally {
    link.dispose();
  }
}

// ───────────────────────── 目录 ─────────────────────────

const LABEL_WORDS: Record<string, string> = { deepseek: 'DeepSeek', gpt: 'GPT', glm: 'GLM', qwen: 'Qwen', kimi: 'Kimi', doubao: 'Doubao', claude: 'Claude', gemini: 'Gemini' };

/** deepseek-v4-flash → DeepSeek V4 Flash */
function prettyLabel(id: string): string {
  const parts = (id.split('/').pop() ?? id).split(/[-_\s]+/).filter(Boolean);
  return parts.map((part) => LABEL_WORDS[part.toLowerCase()] ?? (/^v?\d/i.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))).join(' ') || id;
}

function localCatalog(settings: { baseUrl: string; apiKey: string; model: string }): ModelCatalog {
  if (!settings.baseUrl || !settings.apiKey || !settings.model) return unavailable();
  let provider = '自定义端点';
  if (/deepseek/i.test(settings.model)) provider = 'DeepSeek';
  else { try { provider = new URL(settings.baseUrl).hostname.replace(/^api\./, ''); } catch { /* 地址不规范时用默认名 */ } }
  const levels = levelsFor(settings.model);
  return {
    available: true,
    defaultModel: settings.model,
    models: [{
      id: settings.model,
      label: prettyLabel(settings.model),
      provider,
      description: '使用你在设置里填写的接口',
      efforts: EFFORTS.filter((effort) => levels[effort]),
      defaultEffort: defaultEffortFor(settings.model),
    }],
  };
}

function parseCatalog(payload: unknown): ModelCatalog | null {
  if (!isRecord(payload)) return null;
  if (payload.available !== true || !Array.isArray(payload.models)) return unavailable();
  const models = payload.models.flatMap((item): ModelInfo[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) return [];
    const efforts = Array.isArray(item.efforts) ? EFFORTS.filter((effort) => (item.efforts as unknown[]).includes(effort)) : [];
    if (!efforts.length) efforts.push('none');
    return [{
      id: item.id,
      label: typeof item.label === 'string' && item.label ? item.label : prettyLabel(item.id),
      provider: typeof item.provider === 'string' ? item.provider : '',
      ...(typeof item.description === 'string' && item.description ? { description: item.description } : {}),
      efforts,
      defaultEffort: isEffort(item.defaultEffort) && efforts.includes(item.defaultEffort) ? item.defaultEffort : efforts[0],
      ...(typeof item.badge === 'string' && item.badge ? { badge: item.badge } : {}),
    }];
  });
  if (!models.length) return unavailable();
  const defaultModel = typeof payload.defaultModel === 'string' && models.some((model) => model.id === payload.defaultModel) ? payload.defaultModel : models[0].id;
  return { available: true, models, defaultModel };
}

/** 按登录世代缓存：换账号或重新登录后重新取。失败只短暂记住，避免每个组件都重打一遍。 */
let catalogCache: { epoch: number; value?: ModelCatalog; pending?: Promise<ModelCatalog>; failedAt?: number } | null = null;

async function fetchGatewayCatalog(): Promise<ModelCatalog | null> {
  try {
    const response = await gatewayFetch(`${API_BASE}/model/catalog`);
    if (!response.ok) return null;
    return parseCatalog(await response.json());
  } catch {
    return null;
  }
}

function gatewayCatalog(): Promise<ModelCatalog> {
  const epoch = currentAuthEpoch();
  if (catalogCache?.epoch !== epoch) catalogCache = { epoch };
  const cache = catalogCache;
  if (cache.value) return Promise.resolve(cache.value);
  if (cache.pending) return cache.pending;
  if (cache.failedAt && Date.now() - cache.failedAt < 10_000) return Promise.resolve(unavailable());
  cache.pending = fetchGatewayCatalog().then((value) => {
    cache.pending = undefined;
    if (value) cache.value = value; else cache.failedAt = Date.now();
    return value ?? unavailable();
  });
  return cache.pending;
}

/** 可选模型与强度目录；mock 模式返回 available=false。结果按会话缓存。 */
export async function loadModelCatalog(signal?: AbortSignal): Promise<ModelCatalog> {
  const settings = useAppStore.getState().settings;
  if (settings.mode === 'api') return localCatalog(settings);
  if (settings.mode !== 'proxy' || signal?.aborted) return unavailable();
  const pending = gatewayCatalog();
  if (!signal) return pending;
  // 调用方已经不等了就立刻放手；目录请求本身照常完成并进缓存
  return new Promise<ModelCatalog>((resolve) => {
    const giveUp = () => resolve(unavailable());
    signal.addEventListener('abort', giveUp, { once: true });
    void pending.then((value) => { signal.removeEventListener('abort', giveUp); resolve(value); });
  });
}

/** 一次模型调用（流式）。失败抛错；没有可用模型抛 ModelUnavailableError。 */
export async function streamModel(request: ModelRequest): Promise<ModelResult> {
  if (request.signal?.aborted) throw stopped();
  const settings = useAppStore.getState().settings;
  if (settings.mode === 'proxy') return streamViaGateway(request);
  if (settings.mode === 'api' && settings.baseUrl && settings.apiKey && settings.model) return streamDirect(request, settings);
  throw new ModelUnavailableError();
}

/** 去掉代码块围栏，取最外层的 {…}。 */
function parseJsonObject(text: string): unknown {
  const cleaned = text.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const value: unknown = JSON.parse(cleaned.slice(start, end + 1));
      if (isRecord(value)) return value;
    } catch { /* 落到下面统一报错 */ }
  }
  throw new Error('model-invalid-json');
}

/** 便捷封装：要求 JSON 输出并解析；解析失败抛 Error('model-invalid-json')。 */
export async function completeJson<T = unknown>(request: Omit<ModelRequest, 'json' | 'tools'>): Promise<T> {
  const result = await streamModel({ ...request, json: true });
  return parseJsonObject(result.text) as T;
}
