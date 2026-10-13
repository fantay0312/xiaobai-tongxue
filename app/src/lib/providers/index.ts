/**
 * 自定义线路的协议适配层。
 * 设置里选「自定义」时，浏览器用用户自己的端点和密钥直连模型；这里按协议统一成同一套调用。
 * 支持：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Gemini。
 * 密钥只发往用户填写的端点，不写日志，也不出现在报错文字里。
 */
import type { LlmProtocol } from '../../types';
import { ProviderError, cleanBase, isAbort, type Effort } from './core';
import { adapterFor, runProvider } from './run';

export type { LlmProtocol };
export { ProviderError, extractJsonObject } from './core';
export type { ProviderImage, ProviderMessage, ProviderRequest, ProviderResult } from './core';
export { adapterFor, completeProvider, runProvider } from './run';
export { connectionOf, enabledModels, normalizeLlmSettings } from './settings';

export interface ProtocolInfo {
  id: LlmProtocol;
  label: string;
  /** 一句话说明，含典型路径 */
  hint: string;
  /** 这个协议的官方默认根地址 */
  defaultBaseUrl: string;
}

export const LLM_PROTOCOLS: ProtocolInfo[] = [
  { id: 'openai-chat', label: 'OpenAI Chat', hint: '/chat/completions，DeepSeek、通义、智谱、Kimi、OpenRouter 等都兼容', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'openai-responses', label: 'OpenAI Responses', hint: '/responses，OpenAI 新一代接口', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic-messages', label: 'Anthropic Messages', hint: '/v1/messages，Claude 系列', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'gemini', label: 'Google Gemini', hint: '/v1beta/models/*:generateContent', defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
];

export interface ProviderConnection {
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string;
}

export interface ProviderModel {
  id: string;
  /** 端点给出的展示名；没有就用 id */
  label?: string;
}

// ───────────────────────── 展示信息 ─────────────────────────

const LABEL_WORDS: Record<string, string> = {
  deepseek: 'DeepSeek', gpt: 'GPT', glm: 'GLM', qwen: 'Qwen', kimi: 'Kimi', doubao: 'Doubao', claude: 'Claude', gemini: 'Gemini',
  openai: 'OpenAI', llama: 'Llama', grok: 'Grok', minimax: 'MiniMax',
};

/** deepseek-v4-flash → DeepSeek V4 Flash */
export function prettyModelLabel(id: string): string {
  const raw = (id.split('/').pop() ?? id).split(/[-_\s]+/).filter(Boolean);
  // claude-opus-5-5 这类「主版本-小版本」并成 5.5；日期和长数字不动
  const parts: string[] = [];
  for (const part of raw) {
    const last = parts.at(-1);
    if (last && /^\d{1,2}$/.test(last) && /^\d$/.test(part)) parts[parts.length - 1] = `${last}.${part}`;
    else parts.push(part);
  }
  return parts.map((part) => {
    const known = LABEL_WORDS[part.toLowerCase()];
    if (known) return known;
    if (/^v\d/i.test(part)) return part.toUpperCase();
    // 4o、2.5、o3 这类版本号原样保留
    return /^(\d|o\d)/.test(part) ? part : part[0].toUpperCase() + part.slice(1);
  }).join(' ') || id;
}

const HOST_NAMES: [RegExp, string][] = [
  [/deepseek\.com$/, 'DeepSeek'], [/openai\.com$/, 'OpenAI'], [/anthropic\.com$/, 'Anthropic'], [/googleapis\.com$/, 'Google'],
  [/openrouter\.ai$/, 'OpenRouter'], [/aliyuncs\.com$/, '阿里云百炼'], [/bigmodel\.cn$/, '智谱'], [/moonshot\.cn$/, 'Kimi'],
  [/siliconflow\.(cn|com)$/, '硅基流动'], [/volces\.com$/, '火山方舟'], [/^(localhost|127\.0\.0\.1|\[::1\])$/, '本机'],
];
const PROTOCOL_NAMES: Record<LlmProtocol, string> = { 'openai-chat': 'OpenAI 兼容', 'openai-responses': 'OpenAI', 'anthropic-messages': 'Anthropic', gemini: 'Google' };

/** 服务商名：先认域名，认不出就用域名本身，地址不合法时退回协议名。 */
export function providerName(connection: Pick<ProviderConnection, 'protocol' | 'baseUrl'>): string {
  try {
    const host = new URL(cleanBase(connection.baseUrl)).hostname;
    return HOST_NAMES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^api\./, '');
  } catch {
    return PROTOCOL_NAMES[connection.protocol] ?? '自定义';
  }
}

/** 这个协议下某个模型可调的思考强度（只有一档表示不可调）。 */
export function modelEfforts(protocol: LlmProtocol | undefined, model: string): { efforts: Effort[]; defaultEffort: Effort } {
  const adapter = adapterFor(protocol);
  return { efforts: adapter.efforts(model), defaultEffort: adapter.defaultEffort(model) };
}

// ───────────────────────── 报错文字 ─────────────────────────

/** 浏览器把「跨域被拦」和「网络不通」报成同一个错；用不带任何头的 no-cors 探一下域名通不通来区分。密钥不会随探测发出。 */
async function hostReachable(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetch(new URL(cleanBase(baseUrl)).origin, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal });
    return true;
  } catch {
    return false;
  }
}

function checkConnection(connection: ProviderConnection): string | null {
  if (!connection.baseUrl.trim()) return '请先填写接口地址';
  let url: URL;
  try { url = new URL(cleanBase(connection.baseUrl)); } catch { return '接口地址格式不对'; }
  if (!/^https?:$/.test(url.protocol)) return '接口地址要以 http:// 或 https:// 开头';
  // 本机起的模型服务通常不设密钥
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  return connection.apiKey.trim() || local ? null : '请先填写密钥';
}

async function explain(error: unknown, connection: ProviderConnection, purpose: 'models' | 'chat', signal?: AbortSignal): Promise<string> {
  if (!(error instanceof ProviderError)) return purpose === 'models' ? '地址不对或不支持获取模型列表，可手动添加' : '端点返回了无法识别的内容';
  if (error.kind === 'auth') return '密钥无效，或没有访问权限';
  if (error.kind === 'rate') return '请求太频繁或额度不足，稍后再试';
  if (error.kind === 'network') {
    return await hostReachable(connection.baseUrl, signal) ? '被浏览器跨域拦截，端点需允许跨域' : '网络不通，检查地址和网络';
  }
  if (purpose === 'models') return error.kind === 'upstream' ? '端点暂时不可用，稍后再试' : '地址不对或不支持获取模型列表，可手动添加';
  if (error.kind === 'not-found') return '地址不对，或端点上没有这个模型';
  if (error.kind === 'rejected') return error.detail ? `端点拒绝了请求：${error.detail}` : '端点拒绝了请求，检查模型名和协议';
  if (error.kind === 'incomplete') return '端点的回复不完整，检查协议是否选对';
  return error.status ? `端点暂时不可用（${error.status}）` : '端点暂时不可用';
}

// ───────────────────────── 模型列表与连通测试 ─────────────────────────

/** 明显不是对话模型的排到后面（向量、语音、绘图、审核等） */
const NOT_CHAT = /embed|whisper|tts|speech|transcri|audio|dall-e|image|imagen|veo|sora|video|moderation|rerank|bge-|aqa|ocr|realtime|babbage|davinci-00|similarity/i;

/** 向端点要可用模型列表。失败抛 Error，message 是可以直接给用户看的中文原因。 */
export async function listModels(connection: ProviderConnection, signal?: AbortSignal): Promise<ProviderModel[]> {
  const problem = checkConnection(connection);
  if (problem) throw new Error(problem);
  const adapter = adapterFor(connection.protocol);
  let models: ProviderModel[];
  try {
    const target = adapter.modelsRequest(connection);
    let response: Response;
    try {
      response = await fetch(target.url, { method: 'GET', headers: target.headers, signal });
    } catch {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      throw new ProviderError('network', 'model-network');
    }
    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 2000);
      if (response.status === 401 || response.status === 403 || adapter.isAuthError?.(response.status, body)) throw new ProviderError('auth', 'model-auth', response.status);
      if (response.status === 429) throw new ProviderError('rate', 'model-busy', 429);
      throw new ProviderError(response.status >= 500 ? 'upstream' : 'not-found', `model-http-${response.status}`, response.status);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderError('not-found', 'model-list-invalid'); }
    models = adapter.parseModels(payload);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error(await explain(error, connection, 'models', signal));
  }
  const unique = [...new Map(models.map((model) => [model.id, model])).values()];
  if (!unique.length) throw new Error('端点没有返回可用模型，可手动添加');
  const rank = (model: ProviderModel) => (NOT_CHAT.test(model.id) ? 1 : 0);
  return unique.sort((left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id, 'en', { numeric: true }));
}

/** 用指定模型发一句极短的话，确认端点、密钥、模型三者可用。不抛错。 */
export async function testConnection(connection: ProviderConnection & { model: string }, signal?: AbortSignal): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const problem = checkConnection(connection) ?? (connection.model.trim() ? null : '请先选一个模型');
  if (problem) return { ok: false, message: problem };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 30_000);
  const startedAt = Date.now();
  try {
    await runProvider({
      connection: { protocol: connection.protocol, baseUrl: connection.baseUrl, apiKey: connection.apiKey },
      model: connection.model.trim(),
      messages: [{ role: 'user', content: '只回复一个字：好' }],
      // 取最低一档思考，回复快，也顺带验证思考参数能不能用
      effort: 'none',
      maxTokens: 32,
      signal: controller.signal,
    });
    return { ok: true, message: '连接正常', latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (timedOut) return { ok: false, message: '等了 30 秒没有回应' };
    if (isAbort(error) || controller.signal.aborted) return { ok: false, message: '已取消' };
    return { ok: false, message: await explain(error, connection, 'chat') };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
