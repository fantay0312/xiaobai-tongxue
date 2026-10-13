/**
 * 模型目录：把「可选模型 + 思考强度」收在一处，模型网关与学习问答共用。
 * 强度五档 none | low | medium | high | max 是产品口径；每个模型只列上游接受的档位。
 */
export const EFFORTS = ['none', 'low', 'medium', 'high', 'max'];

/**
 * DeepSeek（flash / v4-pro）的 reasoning_effort。
 * 2026-10-14 用生产密钥实测：deepseek-flash 与 deepseek-v4-pro 对 none / low / medium / high / max 五档均返回 200，
 * none 不产生思考内容，其余各档有思考输出。
 * reasoningTokens 是留给思考的额度：上游的 max_tokens 把思考和正文算在一起，不留会把正文挤空。
 */
const DEEPSEEK_LEVELS = {
  none: { params: { reasoning_effort: 'none' }, reasoningTokens: 0 },
  low: { params: { reasoning_effort: 'low' }, reasoningTokens: 5000 },
  medium: { params: { reasoning_effort: 'medium' }, reasoningTokens: 8000 },
  high: { params: { reasoning_effort: 'high' }, reasoningTokens: 12000 },
  max: { params: { reasoning_effort: 'max' }, reasoningTokens: 24000 },
};
const DEFAULT_REASONING_TOKENS = { none: 0, low: 5000, medium: 8000, high: 12000, max: 24000 };

const WORDS = { deepseek: 'DeepSeek', gpt: 'GPT', glm: 'GLM', qwen: 'Qwen', kimi: 'Kimi', doubao: 'Doubao', claude: 'Claude', gemini: 'Gemini' };
const isDeepSeek = (model) => /deepseek/i.test(model);
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** deepseek-v4-flash → DeepSeek V4 Flash */
function prettyLabel(id) {
  const parts = id.split('/').pop().split(/[-_\s]+/).filter(Boolean);
  return parts.map((part) => WORDS[part.toLowerCase()] ?? (/^v?\d/i.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))).join(' ') || id;
}

function providerName(model, baseUrl) {
  if (isDeepSeek(model)) return 'DeepSeek';
  try { return new URL(baseUrl).hostname.replace(/^api\./, ''); } catch { return '自定义'; }
}

/** 每档对应的上游参数。未知模型不发任何思考参数，只留一档。 */
function levelsFor(upstream, efforts, effortParams) {
  const levels = {};
  const custom = isPlainObject(effortParams) ? effortParams : {};
  const family = isDeepSeek(upstream) ? DEEPSEEK_LEVELS : null;
  const wanted = efforts.length ? efforts : family ? Object.keys(family) : ['none'];
  for (const effort of EFFORTS) {
    if (!wanted.includes(effort)) continue;
    if (isPlainObject(custom[effort])) levels[effort] = { params: { ...custom[effort] }, reasoningTokens: DEFAULT_REASONING_TOKENS[effort] };
    else if (family) { if (family[effort]) levels[effort] = family[effort]; }
    else levels[effort] = { params: efforts.length ? { reasoning_effort: effort } : {}, reasoningTokens: efforts.length ? DEFAULT_REASONING_TOKENS[effort] : 0 };
  }
  if (!Object.keys(levels).length) levels.none = { params: {}, reasoningTokens: 0 };
  return levels;
}

function buildEntry(raw, baseUrl) {
  const id = text(raw.id, 120);
  if (!id || !/^[\w.:/@-]+$/.test(id)) return null;
  const upstream = text(raw.model, 120) || id;
  const efforts = Array.isArray(raw.efforts) ? raw.efforts.filter((item) => EFFORTS.includes(item)) : [];
  const levels = levelsFor(upstream, efforts, raw.effortParams);
  const supported = EFFORTS.filter((effort) => levels[effort]);
  const fallback = supported.includes('medium') ? 'medium' : supported.includes('low') ? 'low' : supported[0];
  return {
    id,
    upstream,
    label: text(raw.label, 60) || prettyLabel(id),
    provider: text(raw.provider, 40) || providerName(upstream, baseUrl),
    description: text(raw.description, 120),
    badge: text(raw.badge, 12),
    efforts: supported,
    defaultEffort: supported.includes(raw.defaultEffort) ? raw.defaultEffort : fallback,
    levels,
  };
}

/** 没有 cfg.models 时，由课堂模型（快）和助教模型（强）派生两项。默认模型名与 index.mjs 保持一致。 */
function derivedModels(cfg) {
  const fast = text(cfg.upstreamModel, 120) || 'deepseek-v4-flash';
  const strong = text(cfg.upstreamModelCoach, 120) || fast;
  const models = [{ id: fast, description: '回答快，适合日常答疑', badge: '快速', defaultEffort: 'low' }];
  if (strong !== fast) models.push({ id: strong, description: '推理更强，适合推导与难题', badge: '深度', defaultEffort: 'high' });
  return models;
}

export function createModelCatalog(cfg = {}) {
  const baseUrl = text(cfg.upstreamBaseUrl, 300);
  const configured = Array.isArray(cfg.models) ? cfg.models.filter(isPlainObject) : [];
  const byId = new Map();
  for (const raw of configured.length ? configured : derivedModels(cfg)) {
    const entry = buildEntry(raw, baseUrl);
    if (entry && !byId.has(entry.id) && byId.size < 12) byId.set(entry.id, entry);
  }
  if (!byId.size) for (const raw of derivedModels(cfg)) { const entry = buildEntry(raw, baseUrl); if (entry) byId.set(entry.id, entry); }
  const wantedDefault = text(cfg.defaultModel, 120);
  const defaultModel = byId.has(wantedDefault) ? wantedDefault : byId.keys().next().value;

  /** 不支持的档位取最近一档；两边一样近时优先该模型的默认档。 */
  function nearestEffort(entry, effort) {
    if (entry.efforts.includes(effort)) return effort;
    const at = EFFORTS.indexOf(effort);
    if (at < 0) return entry.defaultEffort;
    let best = entry.defaultEffort;
    let bestDistance = Infinity;
    for (const candidate of entry.efforts) {
      const distance = Math.abs(EFFORTS.indexOf(candidate) - at);
      if (distance < bestDistance || (distance === bestDistance && candidate === entry.defaultEffort)) { best = candidate; bestDistance = distance; }
    }
    return best;
  }

  return {
    defaultModel,
    list() {
      return [...byId.values()].map(({ id, label, provider, description, efforts, defaultEffort, badge }) => ({
        id, label, provider, description, efforts: [...efforts], defaultEffort, ...(badge ? { badge } : {}),
      }));
    },
    /** → { model: 上游模型名, id: 目录 id, effort: 实际档位, params: 追加到上游请求体的字段, reasoningTokens } */
    resolve(modelId, effort) {
      const entry = byId.get(modelId) ?? byId.get(defaultModel);
      const picked = nearestEffort(entry, effort);
      const level = entry.levels[picked];
      return { model: entry.upstream, id: entry.id, effort: picked, params: { ...level.params }, reasoningTokens: level.reasoningTokens };
    },
  };
}
