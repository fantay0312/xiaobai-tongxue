/** OpenAI Responses（/responses）。输入是条目列表：消息、function_call、function_call_output。 */
import {
  ProviderError, imagesOf, isRecord, num, objectSchema, splitSystem, str,
  type Effort, type Json, type ProviderAdapter, type ProviderRequest,
} from './core';
import { isOpenAiReasoning, openAiRoot, openaiChat } from './openaiChat';

/** max_output_tokens 把思考也算在内，开着思考时多留一份 */
const HEADROOM: Partial<Record<Effort, number>> = { low: 2000, medium: 6000, high: 12000 };

function inputItems(request: ProviderRequest): { instructions: string; input: Json[] } {
  const { system, rest } = splitSystem(request.messages, request.json);
  const input: Json[] = [];
  for (const message of rest) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
    } else if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
      // 不带条目 id：带了 id 端点会要求把配对的 reasoning 条目一起传回
      for (const call of message.toolCalls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments || '{}' });
    } else if (message.role === 'user') {
      const images = imagesOf(message);
      input.push({
        role: 'user',
        content: images.length
          ? [{ type: 'input_text', text: message.content }, ...images.map((image) => ({ type: 'input_image', image_url: `data:${image.mime};base64,${image.base64}` }))]
          : message.content,
      });
    }
  }
  return { instructions: system, input };
}

export const openaiResponses: ProviderAdapter = {
  protocol: 'openai-responses',

  efforts(model) {
    return isOpenAiReasoning(model) ? ['low', 'medium', 'high'] : ['none'];
  },

  defaultEffort(model) {
    return isOpenAiReasoning(model) ? 'low' : 'none';
  },

  build(request, context) {
    const { instructions, input } = inputItems(request);
    const reasoningModel = isOpenAiReasoning(request.model);
    const effort = !context.bare && reasoningModel && context.effort && context.effort !== 'none' ? context.effort : undefined;
    const limit = request.maxTokens + (request.exactMaxTokens || !effort ? 0 : HEADROOM[effort] ?? 0);
    const body: Json = { model: request.model, stream: request.stream !== false, store: false, input, max_output_tokens: Math.max(16, limit) };
    if (instructions) body.instructions = instructions;
    if (!context.bare) {
      if (effort) body.reasoning = { effort, summary: 'auto' };
      if (request.temperature !== undefined && !reasoningModel) body.temperature = request.temperature;
      if (request.json) body.text = { format: { type: 'json_object' } };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: objectSchema(tool.parameters), strict: false }));
    }
    return { url: `${openAiRoot(request.connection.baseUrl)}/responses`, headers: { Authorization: `Bearer ${request.connection.apiKey}` }, body };
  },

  parser(_request, _context, sink) {
    let sawCall = false;
    const usageOf = (response: unknown) => {
      if (!isRecord(response) || !isRecord(response.usage)) return;
      const details = isRecord(response.usage.output_tokens_details) ? response.usage.output_tokens_details.reasoning_tokens : undefined;
      sink.usage({
        promptTokens: num(response.usage.input_tokens),
        completionTokens: num(response.usage.output_tokens),
        ...(typeof details === 'number' ? { reasoningTokens: details } : {}),
      });
    };
    return {
      event(name, data) {
        if (!isRecord(data)) return;
        const type = str(data.type) || name;
        const key = typeof data.output_index === 'number' ? data.output_index : str(data.item_id);
        if (type === 'response.output_text.delta' || type === 'response.refusal.delta') sink.text(str(data.delta));
        else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') sink.reasoning(str(data.delta));
        else if (type === 'response.reasoning_summary_part.added' && num(data.summary_index) > 0) sink.reasoning('\n\n');
        else if ((type === 'response.output_item.added' || type === 'response.output_item.done') && isRecord(data.item) && data.item.type === 'function_call') {
          sawCall = true;
          const full = str(data.item.arguments);
          // done 事件带完整入参，以它为准；added 时通常还是空串
          sink.tool(key, { id: str(data.item.call_id), name: str(data.item.name), ...(type === 'response.output_item.done' && full ? { argsFull: full } : {}) });
        } else if (type === 'response.function_call_arguments.delta') sink.tool(key, { args: str(data.delta) });
        else if (type === 'response.completed') {
          usageOf(data.response);
          sink.finish(sawCall ? 'tool_calls' : 'stop');
        } else if (type === 'response.incomplete') {
          usageOf(data.response);
          const reason = isRecord(data.response) && isRecord(data.response.incomplete_details) ? str(data.response.incomplete_details.reason) : '';
          sink.finish(reason === 'content_filter' ? 'content_filter' : 'length');
        } else if (type === 'response.failed' || type === 'error') {
          throw new ProviderError('upstream', 'model-upstream-failed');
        }
      },
      complete(payload) {
        if (!isRecord(payload) || payload.error || payload.status === 'failed') throw new ProviderError('upstream', 'model-upstream-failed');
        const output = Array.isArray(payload.output) ? payload.output : [];
        output.forEach((item, index) => {
          if (!isRecord(item)) return;
          if (item.type === 'function_call') {
            sawCall = true;
            sink.tool(index, { id: str(item.call_id), name: str(item.name), argsFull: str(item.arguments) });
          } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
            sink.reasoning(item.summary.map((part) => (isRecord(part) ? str(part.text) : '')).filter(Boolean).join('\n\n'));
          } else if (item.type === 'message' && Array.isArray(item.content)) {
            sink.text(item.content.map((part) => (isRecord(part) ? str(part.text) || str(part.refusal) : '')).join(''));
          }
        });
        usageOf(payload);
        const reason = isRecord(payload.incomplete_details) ? str(payload.incomplete_details.reason) : '';
        if (payload.status === 'incomplete') sink.finish(reason === 'content_filter' ? 'content_filter' : 'length');
        else sink.finish(sawCall ? 'tool_calls' : 'stop');
      },
    };
  },

  modelsRequest: (connection) => openaiChat.modelsRequest(connection),
  parseModels: (payload) => openaiChat.parseModels(payload),
};
