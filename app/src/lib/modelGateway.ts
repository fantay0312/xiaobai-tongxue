/**
 * 模型网关（客户端）—— 学习终端里所有「调模型」的新功能都走这里：
 * Agent 任务、AI 课堂、工作台生成、记忆提炼等。
 * proxy 模式走同源网关 /api/model/*（密钥在服务器）；api 模式是「自定义线路」：用本机填写的端点和密钥，
 * 按所选协议直连（lib/providers：OpenAI Chat / Responses、Anthropic Messages、Gemini）；
 * mock 是线路不可用时的内部降级，这里没有模型，抛 ModelUnavailableError，由调用方给出本地降级。
 */
import { API_BASE, currentAuthEpoch, gatewayFetch } from './api';
import { ProviderError, connectionOf, enabledModels, extractJsonObject, modelEfforts, prettyModelLabel, providerName, runProvider } from './providers';
import { readSse } from './providers/core';
import { useAppStore } from '../store/appStore';
import { EFFORTS, useModelPrefs } from '../store/modelPrefs';
import type { Effort } from '../store/modelPrefs';
import type { LlmSettings } from '../types';

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
      await readSse(response.body, link.signal, (event, data) => {
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

// ───────────────────────── api：自定义线路，按协议直连 ─────────────────────────

/** 这次用哪个模型：点名的（或偏好里选的）模型要在勾选列表里，否则用默认模型。 */
function directModel(request: ModelRequest, settings: LlmSettings): string {
  const models = enabledModels(settings);
  const wanted = request.model ?? useModelPrefs.getState().model;
  return wanted && models.includes(wanted) ? wanted : settings.model || models[0] || '';
}

async function streamDirect(request: ModelRequest, settings: LlmSettings): Promise<ModelResult> {
  const model = directModel(request, settings);
  const link = linkSignal(request.signal, CLIENT_TIMEOUT_MS);
  let text = '';
  let reasoning = '';
  try {
    const result = await runProvider({
      connection: connectionOf(settings),
      model,
      messages: cleanMessages(request.messages),
      tools: request.tools?.length ? request.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) : undefined,
      json: request.json === true,
      effort: request.effort ?? useModelPrefs.getState().effort,
      maxTokens: clampTokens(request.maxTokens),
      temperature: clampTemperature(request.temperature) ?? (request.json ? 0.2 : 0.6),
      signal: link.signal,
      onText: (delta) => { text += delta; request.onText?.(text); },
      onReasoning: (delta) => { reasoning += delta; request.onReasoning?.(reasoning); },
    });
    return { text: result.text, reasoning: reasoning || result.reasoning, toolCalls: result.toolCalls, model, finish: result.finish, usage: result.usage };
  } catch (error) {
    if (link.signal.aborted) throw link.reason();
    if (error instanceof ProviderError) {
      // 端点连不上（断网、地址不通、被跨域拦截）按「没有模型」处理，调用方走本地降级
      if (error.kind === 'network') throw new ModelUnavailableError('model-network');
      throw new Error(error.message);
    }
    throw error instanceof Error && error.message.startsWith('model-') ? error : new Error('model-stream-incomplete');
  } finally {
    link.dispose();
  }
}

// ───────────────────────── 目录 ─────────────────────────

/** 自定义线路的目录：设置里勾选的模型，强度档位由协议和模型决定。 */
function localCatalog(settings: LlmSettings): ModelCatalog {
  const models = enabledModels(settings);
  if (!settings.baseUrl || !settings.apiKey || !models.length) return unavailable();
  const connection = connectionOf(settings);
  const provider = providerName(connection);
  return {
    available: true,
    defaultModel: models.includes(settings.model) ? settings.model : models[0],
    models: models.map((id) => ({ id, label: prettyModelLabel(id), provider, ...modelEfforts(connection.protocol, id) })),
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
      label: typeof item.label === 'string' && item.label ? item.label : prettyModelLabel(item.id),
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
  if (settings.mode === 'api' && settings.baseUrl && settings.apiKey && (settings.model || enabledModels(settings).length)) return streamDirect(request, settings);
  throw new ModelUnavailableError();
}

/** 便捷封装：要求 JSON 输出并解析；解析失败抛 Error('model-invalid-json')。 */
export async function completeJson<T = unknown>(request: Omit<ModelRequest, 'json' | 'tools'>): Promise<T> {
  const result = await streamModel({ ...request, json: true });
  const json = extractJsonObject(result.text);
  if (!json) throw new Error('model-invalid-json');
  return JSON.parse(json) as T;
}
