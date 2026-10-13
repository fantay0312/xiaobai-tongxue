/** 自定义线路设置的整理：协议缺省、勾选模型去重、从设置取连接信息。 */
import type { LlmProtocol, LlmSettings } from '../../types';
import type { ProviderConnection } from './index';

const PROTOCOLS: readonly LlmProtocol[] = ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini'];
const MAX_MODELS = 40;
const MAX_MODEL_CHARS = 120;

export const isProtocol = (value: unknown): value is LlmProtocol => PROTOCOLS.includes(value as LlmProtocol);

/** 唯一、非空、有上限；设置了默认模型时一定包含它。 */
export function sanitizeModels(models: unknown, model: string): string[] {
  const list: string[] = [];
  for (const value of Array.isArray(models) ? models : []) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (id && id.length <= MAX_MODEL_CHARS && !list.includes(id)) list.push(id);
  }
  const kept = list.slice(0, MAX_MODELS);
  const chosen = model.trim();
  // 默认模型不在勾选里（或被上限挤掉）就放到最前
  return chosen && !kept.includes(chosen) ? [chosen, ...kept].slice(0, MAX_MODELS) : kept;
}

/**
 * 存档里的线路设置每次加载都过一遍（幂等）：
 * 「演示」不再是可选线路，旧存档的 mock 改成服务器线路；协议缺省 openai-chat；勾选模型整理干净。
 */
export function normalizeLlmSettings(settings: LlmSettings): LlmSettings {
  const model = typeof settings.model === 'string' ? settings.model : '';
  return {
    ...settings,
    mode: settings.mode === 'api' ? 'api' : 'proxy',
    model,
    protocol: isProtocol(settings.protocol) ? settings.protocol : 'openai-chat',
    models: sanitizeModels(settings.models, model),
  };
}

/** 自定义线路当前启用的模型；没勾选过就只有默认模型。 */
export function enabledModels(settings: Pick<LlmSettings, 'model' | 'models'>): string[] {
  return sanitizeModels(settings.models, settings.model ?? '');
}

export function connectionOf(settings: Pick<LlmSettings, 'protocol' | 'baseUrl' | 'apiKey'>): ProviderConnection {
  return { protocol: isProtocol(settings.protocol) ? settings.protocol : 'openai-chat', baseUrl: settings.baseUrl ?? '', apiKey: settings.apiKey ?? '' };
}
