import net from 'node:net';
import { randomUUID } from 'node:crypto';

const TERMINAL_PARSE_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function privateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '127.0.0.1') return true;
  if (net.isIP(host) === 4) {
    return /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || /^127\./.test(host);
  }
  return false;
}

export function normalizeWeKnoraBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('weknora-base-url-invalid');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('weknora-base-url-invalid');
  }
  if (!/\/api\/v1\/?$/.test(parsed.pathname)) throw new Error('weknora-base-url-invalid');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && privateHost(parsed.hostname))) {
    throw new Error('weknora-base-url-insecure');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

export class WeKnoraError extends Error {
  constructor(code, { status = 0, operation = 'request', retryable = false } = {}) {
    super(code);
    this.name = 'WeKnoraError';
    this.code = code;
    this.status = status;
    this.operation = operation;
    this.retryable = retryable;
  }
}

function responseData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.success === false) {
    throw new WeKnoraError('weknora-upstream-rejected');
  }
  return Object.hasOwn(payload, 'data') ? payload.data : payload;
}

function safeMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidate = payload.code ?? payload.error?.code ?? payload.error ?? payload.message;
  return typeof candidate === 'string' && /^[a-z0-9_.:-]{1,100}$/i.test(candidate)
    ? candidate.toLowerCase()
    : '';
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items', 'list', 'chunks', 'results', 'hits', 'knowledge']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function requestIdHeader(requestId) {
  return typeof requestId === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(requestId)
    ? requestId
    : `xb-${randomUUID()}`;
}

export function createWeKnoraClient({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  uploadTimeoutMs = 180_000,
} = {}) {
  const root = normalizeWeKnoraBaseUrl(baseUrl);
  if (typeof apiKey !== 'string' || apiKey.trim() === '') throw new Error('weknora-api-key-required');
  const token = apiKey.trim();
  if (typeof fetchImpl !== 'function') throw new Error('fetch-required');

  async function request(operation, method, pathname, {
    body,
    headers = {},
    requestId,
    timeout = timeoutMs,
  } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();
    let response;
    let raw;
    try {
      response = await fetchImpl(`${root}${pathname}`, {
        method,
        headers: {
          'X-API-Key': token,
          'X-Request-ID': requestIdHeader(requestId),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      raw = await response.text();
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      throw new WeKnoraError(timedOut ? 'weknora-timeout' : 'weknora-unreachable', {
        operation,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { /* 转成稳定错误，不透出上游页面或栈 */ }
    }
    if (!response.ok) {
      const upstreamCode = safeMessage(payload);
      const code = response.status === 404
        ? 'weknora-not-found'
        : response.status === 409
          ? 'weknora-conflict'
          : response.status === 413
            ? 'weknora-file-too-large'
            : response.status === 429
              ? 'weknora-rate-limited'
              : 'weknora-upstream-failed';
      throw new WeKnoraError(upstreamCode ? `${code}:${upstreamCode}` : code, {
        status: response.status,
        operation,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    if (payload === null) throw new WeKnoraError('weknora-invalid-response', { operation });
    try {
      return responseData(payload);
    } catch (error) {
      if (error instanceof WeKnoraError) {
        error.status = response.status;
        error.operation = operation;
      }
      throw error;
    }
  }

  async function json(operation, method, pathname, payload, options = {}) {
    return request(operation, method, pathname, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  }

  return Object.freeze({
    async healthCheck() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5_000));
      timer.unref?.();
      try {
        const healthRoot = new URL(root);
        healthRoot.pathname = healthRoot.pathname.replace(/\/api\/v1\/?$/, '/health');
        const response = await fetchImpl(healthRoot, { signal: controller.signal });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },

    createKnowledgeBase(input, requestId) {
      return json('create-kb', 'POST', '/knowledge-bases', input, { requestId });
    },

    deleteKnowledgeBase(id, requestId) {
      return json('delete-kb', 'DELETE', `/knowledge-bases/${encodeURIComponent(id)}`, undefined, { requestId });
    },

    async uploadFile(kbId, {
      bytes,
      filename,
      contentType,
      metadata,
      processConfig,
      requestId,
    }) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: contentType }), filename);
      form.append('fileName', filename);
      form.append('channel', 'api');
      if (metadata) form.append('metadata', JSON.stringify(metadata));
      if (processConfig) form.append('process_config', JSON.stringify(processConfig));
      return request('upload-file', 'POST', `/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/file`, {
        body: form,
        requestId,
        timeout: uploadTimeoutMs,
      });
    },

    getKnowledge(id, requestId) {
      return json('get-knowledge', 'GET', `/knowledge/${encodeURIComponent(id)}`, undefined, { requestId });
    },

    reparseKnowledge(id, processConfig, requestId) {
      return json('reparse-knowledge', 'POST', `/knowledge/${encodeURIComponent(id)}/reparse`, processConfig ?? {}, { requestId });
    },

    deleteKnowledge(id, requestId) {
      return json('delete-knowledge', 'DELETE', `/knowledge/${encodeURIComponent(id)}`, undefined, { requestId });
    },

    async listChunks(knowledgeId, requestId, maximum = 1_000) {
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5_000) {
        throw new Error('weknora-chunk-limit-invalid');
      }
      const chunks = [];
      const pageSize = 200;
      for (let page = 1; page <= 100; page += 1) {
        const requested = Math.min(pageSize, maximum - chunks.length);
        if (requested <= 0) break;
        const data = await json(
          'list-chunks',
          'GET',
          `/chunks/${encodeURIComponent(knowledgeId)}?page=${page}&page_size=${requested}`,
          undefined,
          { requestId },
        );
        const batch = asArray(data);
        chunks.push(...batch);
        const total = Number(data?.total ?? data?.pagination?.total);
        const hasMore = data?.has_more === true || data?.hasMore === true;
        if (chunks.length >= maximum) break;
        if (batch.length < requested && !hasMore) break;
        if (Number.isFinite(total) && chunks.length >= total) break;
      }
      return chunks.slice(0, maximum);
    },

    async search({ kbId, query, knowledgeIds, requestId }) {
      const data = await json('knowledge-search', 'POST', '/knowledge-search', {
        query,
        knowledge_base_id: kbId,
        knowledge_ids: knowledgeIds,
      }, { requestId });
      return asArray(data);
    },

    async hybridSearch({ kbId, queryText, knowledgeIds, matchCount = 5, requestId }) {
      const data = await json(
        'hybrid-search',
        'POST',
        `/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`,
        { query_text: queryText, knowledge_ids: knowledgeIds, match_count: matchCount },
        { requestId },
      );
      return asArray(data);
    },

    createFaq(kbId, entry, requestId) {
      return json(
        'create-faq',
        'POST',
        `/knowledge-bases/${encodeURIComponent(kbId)}/faq/entry`,
        entry,
        { requestId },
      );
    },

    upsertFaqEntries(kbId, entries, requestId) {
      return json(
        'upsert-faq',
        'POST',
        `/knowledge-bases/${encodeURIComponent(kbId)}/faq/entries`,
        { entries, mode: 'replace', dry_run: false },
        { requestId },
      );
    },

    async waitForFaqImport(taskId, requestId, maximumWaitMs = 60_000) {
      if (typeof taskId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(taskId)) {
        throw new Error('weknora-faq-task-invalid');
      }
      const deadline = Date.now() + maximumWaitMs;
      while (Date.now() < deadline) {
        const data = await json(
          'faq-import-progress',
          'GET',
          `/faq/import/progress/${encodeURIComponent(taskId)}`,
          undefined,
          { requestId },
        );
        const status = String(data?.status ?? data?.state ?? '').toLowerCase();
        if (status === 'completed' || status === 'success') return data;
        if (status === 'failed') throw new WeKnoraError('weknora-faq-import-failed', {
          operation: 'faq-import-progress',
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new WeKnoraError('weknora-faq-import-timeout', {
        operation: 'faq-import-progress',
        retryable: true,
      });
    },

    isTerminalParseStatus(status) {
      return TERMINAL_PARSE_STATUSES.has(status);
    },
  });
}
