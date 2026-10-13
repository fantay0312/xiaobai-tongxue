/** The source is an actual OpenAI-compatible SSE response; never exposes reasoning_content. */
export async function readModelStream(body, { signal, onText, maxChars = 40000 } = {}) {
  if (!body) throw new Error('model-stream-empty');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', finish = null, usage = null, done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = async (event) => {
    const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    let value;
    try { value = JSON.parse(data); } catch { throw new Error('model-stream-invalid'); }
    if (value.error) throw new Error('model-upstream-failed');
    const choice = value.choices?.[0];
    if (typeof choice?.delta?.content === 'string') {
      text += choice.delta.content;
      if (text.length > maxChars) throw new Error('model-output-too-large');
      await onText?.(text);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (value.usage) usage = value.usage;
  };
  try {
    while (!done) {
      if (signal?.aborted) throw new Error('model-cancelled');
      const next = await reader.read();
      if (next.done) break;
      buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 128000) throw new Error('model-stream-too-large');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); await consume(event);
      }
    }
    if (signal?.aborted) throw new Error('model-cancelled');
    if (!done || finish !== 'stop') throw new Error(finish === 'length' ? 'model-output-truncated' : 'model-stream-incomplete');
    if (!text.trim()) throw new Error('model-empty');
    return { text, usage };
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
}
