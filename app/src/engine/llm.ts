/**
 * LLM 统一封装 —— llmCall(role, payload)
 * mode='mock' 时不发网络请求(演示保稳默认);
 * mode='api' 时调 OpenAI 兼容端点,失败自动降级 mock(由调用方兜底)。
 */
import type { LlmSettings } from '../types';

export type LlmRole = 'evaluator' | 'xiaobai' | 'report';

export interface LlmPayload {
  system: string;
  user: string;
  json?: boolean; // 需要结构化输出
}

/** 各角色温度:评估恒 0,小白用用户配置 */
export async function llmCall(
  role: LlmRole,
  payload: LlmPayload,
  settings: LlmSettings,
): Promise<string> {
  if (settings.mode !== 'api' || !settings.baseUrl || !settings.apiKey) {
    throw new Error('llm-api-unavailable');
  }
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: role === 'xiaobai' ? settings.temperature : 0,
      ...(payload.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: payload.system },
        { role: 'user', content: payload.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`llm-http-${res.status}`);
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('llm-empty');
  return text;
}
