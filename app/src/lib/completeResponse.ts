/** Keep the deadline active until the response body has arrived, not just its headers. */
export async function completeResponse(
  request: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
  signal?: AbortSignal | null,
): Promise<Response> {
  const controller = new AbortController();
  let rejectAborted: (reason: DOMException) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  const abort = () => {
    controller.abort();
    rejectAborted(new DOMException('The request was aborted', 'AbortError'));
  };
  const timer = window.setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const response = await Promise.race([
      aborted,
      (async () => {
        if (controller.signal.aborted) throw new DOMException('The request was aborted', 'AbortError');
        const headers = await request(controller.signal);
        const body = await headers.arrayBuffer();
        return new Response([204, 205, 304].includes(headers.status) ? null : body, {
          status: headers.status,
          statusText: headers.statusText,
          headers: headers.headers,
        });
      })(),
    ]);
    return response;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
