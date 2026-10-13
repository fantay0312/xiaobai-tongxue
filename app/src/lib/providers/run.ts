/** 按协议选适配器，发一次流式请求；被端点拒绝时按适配器给的口径退让重试。 */
import type { LlmProtocol } from '../../types';
import { anthropicMessages } from './anthropic';
import {
  ProviderError, abortError, createSink, httpError, isAbort, readSse, resolveEffort,
  type BuildContext, type Effort, type ProviderAdapter, type ProviderRequest, type ProviderResult, type WireRequest,
} from './core';
import { gemini } from './gemini';
import { openaiChat } from './openaiChat';
import { openaiResponses } from './openaiResponses';

const ADAPTERS: Record<LlmProtocol, ProviderAdapter> = {
  'openai-chat': openaiChat,
  'openai-responses': openaiResponses,
  'anthropic-messages': anthropicMessages,
  gemini,
};

export function adapterFor(protocol: LlmProtocol | undefined): ProviderAdapter {
  return ADAPTERS[protocol ?? 'openai-chat'] ?? openaiChat;
}

async function attempt(adapter: ProviderAdapter, request: ProviderRequest, context: BuildContext, wire: WireRequest, body: string): Promise<ProviderResult> {
  let response: Response;
  try {
    response = await fetch(wire.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...wire.headers },
      body,
      signal: request.signal,
    });
  } catch {
    if (request.signal?.aborted) throw abortError();
    // 断网、域名不通、被浏览器跨域拦截，在这里都是同一种失败
    throw new ProviderError('network', 'model-network');
  }
  if (!response.ok || !response.body) throw await httpError(adapter, response, request.connection.apiKey);

  const { sink, result } = createSink(request);
  const parser = adapter.parser(request, context, sink);
  // 非流式调用，或者端点无视 stream 直接回了一整段 JSON
  const whole = request.stream === false || (response.headers.get('content-type') ?? '').includes('application/json');
  try {
    if (whole) {
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new ProviderError('incomplete', 'model-stream-incomplete'); }
      parser.complete(payload);
    } else await readSse(response.body, request.signal, (event, data) => {
      if (data === '[DONE]') return true;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { throw new ProviderError('upstream', 'model-stream-invalid'); }
      parser.event(event, payload);
      return false;
    });
  } catch (error) {
    if (request.signal?.aborted || isAbort(error)) throw abortError();
    throw error instanceof ProviderError ? error : new ProviderError('incomplete', 'model-stream-incomplete');
  }
  if (request.signal?.aborted) throw abortError();
  const final = result();
  if (!final.finish) throw new ProviderError('incomplete', 'model-stream-incomplete');
  parser.end?.(final);
  return final;
}

/** 实际用到的思考强度会随结果带回（没发思考参数时为 undefined）。 */
export async function runProvider(request: ProviderRequest): Promise<ProviderResult & { effort?: Effort }> {
  const adapter = adapterFor(request.connection.protocol);
  const first: BuildContext = {
    effort: request.effort === undefined ? undefined : resolveEffort(adapter, request.model, request.effort),
    bare: false,
  };
  const chain = [first, ...(adapter.fallbacks?.(request, first) ?? [{ effort: undefined, bare: true }])];
  const tried = new Set<string>();
  let context = first;
  let result: ProviderResult | null = null;
  let rejection: unknown = null;
  for (const candidate of chain) {
    const wire = adapter.build(request, candidate);
    const body = JSON.stringify(wire.body);
    // 退让后的请求体和试过的一样就不必再发
    if (tried.has(body)) continue;
    tried.add(body);
    try {
      result = await attempt(adapter, request, candidate, wire, body);
      context = candidate;
      break;
    } catch (error) {
      // 只有「请求被拒绝」值得换个口径重试：多半是端点不认思考、温度或 JSON 开关
      if (!(error instanceof ProviderError) || error.kind !== 'rejected' || request.signal?.aborted) throw error;
      rejection = error;
    }
  }
  if (!result) throw rejection ?? new ProviderError('rejected', 'model-http-400', 400);

  // 思考把额度吃光、正文一个字没出：用最低一档补一次正文
  if (!result.text.trim() && !result.toolCalls.length && result.finish === 'length' && context.effort !== undefined && !context.bare) {
    const lowest = resolveEffort(adapter, request.model, 'none');
    const retry: BuildContext = { effort: lowest, bare: false };
    const wire = adapter.build(request, retry);
    const body = JSON.stringify(wire.body);
    if (lowest !== context.effort && !tried.has(body)) {
      result = await attempt(adapter, request, retry, wire, body);
      context = retry;
    }
  }
  return { ...result, effort: context.bare ? undefined : context.effort };
}

/** 一次不关心增量的调用，只要正文。 */
export async function completeProvider(request: Omit<ProviderRequest, 'onText' | 'onReasoning'>): Promise<string> {
  return (await runProvider(request)).text;
}
