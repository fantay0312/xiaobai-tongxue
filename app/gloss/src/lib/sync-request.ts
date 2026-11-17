/** Bound the entire exchange, including a stalled JSON response body. No automatic write retries. */
export async function syncRequest<T = unknown>(
  input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = globalThis.fetch, timeoutMs = 30_000,
): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const cancel = () => {
    const reason = caller?.reason ?? new DOMException('Cancelled', 'AbortError');
    rejectAbort(reason);
    controller.abort(reason);
  };
  const timer = setTimeout(() => {
    const error = new DOMException('Sync request timed out', 'TimeoutError');
    rejectAbort(error);
    controller.abort(error);
  }, timeoutMs);
  caller?.addEventListener('abort', cancel, { once: true });
  try {
    if (caller?.aborted) { cancel(); return await aborted; }
    return await Promise.race([aborted, (async () => {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      const data = response.ok ? await response.json() as T : null;
      return { response, data };
    })()]);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}
