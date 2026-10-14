import type { LibraryParseState } from './fileLibrary';

export const isParsing = (status?: string) => ['starting', 'pending', 'processing', 'finalizing'].includes(status ?? '');

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Each file owns its deadline; at most two documents are prepared at once. */
export async function waitForLibraryFiles(ids: string[], signal: AbortSignal, options: {
  start: (id: string, signal: AbortSignal) => Promise<LibraryParseState>;
  status: (id: string, signal: AbortSignal) => Promise<LibraryParseState>;
  progress?: (message: string) => void;
  now?: () => number;
  wait?: typeof abortableDelay;
  timeoutMs?: number;
  pollMs?: number;
}) {
  const files = [...new Set(ids)];
  const group = new AbortController();
  const abort = () => group.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const now = options.now ?? Date.now;
  const wait = options.wait ?? abortableDelay;
  let cursor = 0, completed = 0;
  const worker = async () => {
    while (cursor < files.length) {
      if (group.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const id = files[cursor++];
      const deadline = now() + (options.timeoutMs ?? 240_000);
      const request = async (read: () => Promise<LibraryParseState>) => {
        let failures = 0;
        while (true) {
          if (group.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (now() >= deadline) throw new Error('资料准备仍在进行，可稍后回到资料库查看；无需重新上传。');
          try { return await read(); }
          catch (error) {
            if (group.signal.aborted) throw error;
            const detail = error as { retryable?: boolean; status?: number };
            if (!detail.retryable) throw error;
            if (detail.status !== 429 && ++failures >= 3) throw new Error('暂时无法读取解析进度，后台任务可能仍在进行。请稍后重试，无需重新上传。');
            options.progress?.(`正在重新连接解析服务（已完成 ${completed} / ${files.length}）…`);
            await wait(Math.min(1500, Math.max(1, deadline - now())), group.signal);
          }
        }
      };
      options.progress?.(`正在准备资料（已完成 ${completed} / ${files.length}）…`);
      let state = await request(() => options.start(id, group.signal));
      while (state.status !== 'completed') {
        if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || '解析失败，请在资料库中重试。');
        options.progress?.(`正在解析资料（已完成 ${completed} / ${files.length}）…`);
        await wait(Math.min(options.pollMs ?? 1500, Math.max(1, deadline - now())), group.signal);
        state = await request(() => options.status(id, group.signal));
      }
      completed++;
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker)); }
  finally { group.abort(); signal.removeEventListener('abort', abort); }
}
