/**
 * LLM 统一封装 —— llmCall(role, payload)
 * mode='mock' 时不发网络请求(断网兜底);
 * mode='api' 时调 OpenAI 兼容端点(默认 DeepSeek),失败由调用方降级 mock。
 */
import type { LlmSettings } from '../types';
import { API_BASE } from '../lib/api';

export type LlmRole = 'evaluator' | 'xiaobai' | 'report' | 'coach';

export interface LlmPayload {
  system: string;
  user: string;
  json?: boolean; // 需要结构化输出
}

/** 各角色输出上限:台词短、评估中等、报告长、备课助教答疑中长 */
const ROLE_MAX_TOKENS: Record<LlmRole, number> = { xiaobai: 400, evaluator: 700, report: 900, coach: 700 };

/** 各角色温度(与服务器网关一致,proxy 模式下服务器按 role 重新裁决,不信客户端) */
function roleTemperature(role: LlmRole, settings: LlmSettings): number {
  if (role === 'xiaobai') return settings.temperature;
  if (role === 'coach') return 0.5;
  return 0;
}

/** 单轮要过评估+渲染两跳,单跳超时须控制在体感可接受范围 */
const TIMEOUT_MS = 45_000;

/** 兼容三种 baseUrl 写法:https://api.deepseek.com / …/v1 / 直接粘贴完整 …/chat/completions */
export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `${root}/chat/completions`;
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
        model: settings.model,
        temperature: roleTemperature(role, settings),
        max_tokens: ROLE_MAX_TOKENS[role],
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
    const res = await fetch(`${API_BASE}/chat`, {
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
