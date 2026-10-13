/**
 * LLM 统一封装 —— llmCall(role, payload)
 * mode='mock' 时不发网络请求(断网兜底);
 * mode='api' 是「自定义线路」:按设置里选的协议(OpenAI Chat / Responses、Anthropic Messages、Gemini)
 * 经 lib/providers 的适配器直连用户自己的端点,失败由调用方降级 mock。
 */
import type { LlmSettings } from '../types';
import type { Effort } from '../store/modelPrefs';
import { API_BASE, gatewayFetch } from '../lib/api';
import { ProviderError, extractJsonObject, isAbort } from '../lib/providers/core';
import { isDeepSeek, openAiRoot } from '../lib/providers/openaiChat';
import { runProvider } from '../lib/providers/run';
import { connectionOf } from '../lib/providers/settings';

export type LlmRole = 'evaluator' | 'xiaobai' | 'report' | 'coach';

export interface LlmPayload {
  system: string;
  user: string;
  json?: boolean; // 需要结构化输出
}

/**
 * 各角色输出上限:台词短、评估中等、报告长、备课助教答疑中长。
 * coach 给 2200:助教常配推理模型(VITE_LLM_MODEL_COACH),思考 token 与正文共用这个额度,
 * 700 会被思考吃空 → 正文空串 → 整段降级「离线锦囊」。与服务器网关同一处修复保持一致。
 * (不下发 reasoning_effort:api 模式端点由用户自带,未知参数可能被判 400。)
 * 2026-08-30 实测(deepseek-v4-flash 为推理模型):评估器在一段带类比的讲解上 reasoning_tokens 达 600–1250,
 * 700 的额度被思考吃空 → finish_reason=length、content 空串 → 整轮静默降级规则评估;小白台词 reasoning 50–190。
 * 故评估器放宽到 2000、小白到 800(只是上限,不增加正常开销);proxy 模式由服务器网关按 role 裁决,此处不参与。
 * TODO(follow-up, server/**): server/index.mjs 的 ROLE 上限仍是 { xiaobai: 400, evaluator: 700 },需镜像为 800 / 2000;
 * 在此之前 proxy 模式会更频繁地出现「规则评估 · 离线台词」(批注页会如实标注)。
 */
const ROLE_MAX_TOKENS: Record<LlmRole, number> = { xiaobai: 1200, evaluator: 2400, report: 900, coach: 2200 };

/** 各角色温度(与服务器网关一致,proxy 模式下服务器按 role 重新裁决,不信客户端) */
function roleTemperature(role: LlmRole, settings: LlmSettings): number {
  if (role === 'xiaobai') return settings.temperature;
  if (role === 'coach') return 0.5;
  return 0;
}

/**
 * api 模式的助教专属模型(可选):.env.local 设 VITE_LLM_MODEL_COACH(如 deepseek-v4-pro),
 * 课堂三角色仍走 VITE_LLM_MODEL(flash 走量);proxy 模式由服务器 config 决定,此值不参与。
 * node 环境(simulate/livetest 间接引入)无 import.meta.env,按 lib/api.ts 同款守卫回退。
 */
const ENV_COACH_MODEL = (
  (import.meta as { env?: { VITE_LLM_MODEL_COACH?: string } }).env?.VITE_LLM_MODEL_COACH ?? ''
).trim();

function roleModel(role: LlmRole, settings: LlmSettings): string {
  return role === 'coach' && ENV_COACH_MODEL ? ENV_COACH_MODEL : settings.model;
}

/** 单轮要过评估+渲染两跳,单跳超时须控制在体感可接受范围 */
const TIMEOUT_MS = 45_000;

/** 兼容三种 baseUrl 写法:https://api.deepseek.com / …/v1 / 直接粘贴完整 …/chat/completions(只有域名时补 /v1) */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${openAiRoot(baseUrl)}/chat/completions`;
}

/**
 * api 模式各角色的思考强度。
 * DeepSeek 沿用实测过的口径:小白关思考(none,台词照样自然、不再被思考挤空正文),评估与报告 low 保判定,
 * 助教不下发(用模型默认);额度 ROLE_MAX_TOKENS 已含思考,原样下发。
 * 其他协议和模型:取该模型支持的最低一档上下(由适配器就近取档,不可调的模型不发任何思考参数),
 * 开着思考时适配器另加思考额度,正文仍按 ROLE_MAX_TOKENS。
 */
const DEEPSEEK_ROLE_EFFORT: Record<LlmRole, Effort | undefined> = { xiaobai: 'none', evaluator: 'low', report: 'low', coach: undefined };
const ROLE_EFFORT: Record<LlmRole, Effort> = { xiaobai: 'none', evaluator: 'low', report: 'low', coach: 'low' };

/** 各角色温度:评估恒 0,小白用用户配置 */
export async function llmCall(
  role: LlmRole,
  payload: LlmPayload,
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<string> {
  if (settings.mode === 'proxy') return proxyCall(role, payload, settings, signal);
  if (settings.mode !== 'api' || !settings.baseUrl || !settings.apiKey) {
    throw new Error('llm-api-unavailable');
  }
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const connection = connectionOf(settings);
  const model = roleModel(role, settings);
  const deepseek = connection.protocol === 'openai-chat' && isDeepSeek(model);
  try {
    const result = await runProvider({
      connection,
      model,
      messages: [
        { role: 'system', content: payload.system },
        { role: 'user', content: payload.user },
      ],
      json: !!payload.json,
      effort: deepseek ? DEEPSEEK_ROLE_EFFORT[role] : ROLE_EFFORT[role],
      maxTokens: ROLE_MAX_TOKENS[role],
      exactMaxTokens: deepseek,
      temperature: roleTemperature(role, settings),
      // 课堂这几路不需要逐字显示，一次取回整段
      stream: false,
      signal: ctrl.signal,
    });
    // 要 JSON 时去掉围栏和前后闲话,保证调用方拿到的是能直接解析的对象
    const text = payload.json ? extractJsonObject(result.text) ?? result.text : result.text;
    if (!text) throw new Error('llm-empty');
    return text;
  } catch (e) {
    if (isAbort(e)) throw new Error('llm-timeout');
    if (e instanceof ProviderError) {
      if (e.kind === 'network') throw new Error('llm-network');
      // detail 是端点给的原因,已去掉密钥并截短
      throw new Error(`llm-http-${e.status ?? 502}${e.detail ? `:${e.detail}` : ''}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** proxy 模式:走同源网关 /api/chat,密钥在服务器侧,浏览器只传对话内容 */
async function proxyCall(role: LlmRole, payload: LlmPayload, settings: LlmSettings, signal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await gatewayFetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        temperature: roleTemperature(role, settings),
        json: !!payload.json,
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new Error('llm-auth');
    if (!res.ok) throw new Error(`llm-http-${res.status}`);
    const data = await res.json();
    const text: unknown = data?.content;
    if (typeof text !== 'string' || !text) throw new Error('llm-empty');
    return text;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('llm-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
