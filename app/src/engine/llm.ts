/**
 * LLM 统一封装 —— llmCall(role, payload)
 * mode='mock' 时不发网络请求(断网兜底);
 * mode='api' 时调 OpenAI 兼容端点(默认 DeepSeek),失败由调用方降级 mock。
 */
import type { LlmSettings } from '../types';
import { API_BASE, gatewayFetch } from '../lib/api';

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

/** 兼容三种 baseUrl 写法:https://api.deepseek.com / …/v1 / 直接粘贴完整 …/chat/completions */
export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `${root}/chat/completions`;
}

/** api 模式的思考预算:只对模型名含 deepseek 的端点下发(已实测 v4 系列接受 none/low),其余自带端点不发,
 *  未知参数可能被判 400。小白关思考(none):台词照样自然、不再被思考挤空正文;评估器 low 保判定;与网关同策略。 */
function apiReasoningEffort(role: LlmRole, settings: LlmSettings): { reasoning_effort?: 'none' | 'low' } {
  if (role === 'coach' || !/deepseek/i.test(roleModel(role, settings))) return {};
  return { reasoning_effort: role === 'xiaobai' ? 'none' : 'low' };
}

/** 各角色温度:评估恒 0,小白用用户配置 */
export async function llmCall(
  role: LlmRole,
  payload: LlmPayload,
  settings: LlmSettings,
): Promise<string> {
  if (settings.mode === 'proxy') return proxyCall(role, payload, settings);
  if (settings.mode !== 'api' || !settings.baseUrl || !settings.apiKey) {
    throw new Error('llm-api-unavailable');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: roleModel(role, settings),
        temperature: roleTemperature(role, settings),
        max_tokens: ROLE_MAX_TOKENS[role],
        ...apiReasoningEffort(role, settings),
        ...(payload.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`llm-http-${res.status}${body ? `:${body.slice(0, 160)}` : ''}`);
    }
    const data = await res.json();
    const text: unknown = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) throw new Error('llm-empty');
    return text;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('llm-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** proxy 模式:走同源网关 /api/chat,密钥在服务器侧,浏览器只传对话内容 */
async function proxyCall(role: LlmRole, payload: LlmPayload, settings: LlmSettings): Promise<string> {
  const ctrl = new AbortController();
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
  }
}
