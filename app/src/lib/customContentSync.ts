import { CustomContentError } from './customContent';

/** One read at a time. A hidden/offline page resumes from the server, never replays writes. */
export function watchCustomContent<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown, stopped: boolean) => void;
  shouldPoll?: (data: T) => boolean;
  intervalMs?: number;
}) {
  let disposed = false;
  let stopped = false;
  let completed = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const available = () => navigator.onLine !== false && document.visibilityState !== 'hidden';
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!disposed && !stopped && !completed && available()) timer = setTimeout(() => void run(), delay);
  };
  const run = async () => {
    if (disposed || stopped || completed || controller || !available()) return;
    controller = new AbortController();
    try {
      const data = await options.load(controller.signal);
      if (disposed) return;
      failures = 0;
      options.onData(data);
      completed = !options.shouldPoll?.(data);
      if (!completed) schedule(options.intervalMs ?? 4_000);
    } catch (error) {
      if (disposed) return;
      failures += 1;
      const retryable = !(error instanceof CustomContentError)
        || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
      stopped = !retryable || failures >= 3;
      options.onError(error, stopped);
      if (!stopped) schedule(Math.max(
        Math.min(15_000, 1_000 * (2 ** failures)),
        error instanceof CustomContentError ? error.retryAfter * 1_000 : 0,
      ));
    } finally {
      controller = undefined;
    }
  };
  const resume = () => {
    clearTimeout(timer);
    if (available()) void run();
  };
  window.addEventListener('online', resume);
  window.addEventListener('offline', resume);
  document.addEventListener('visibilitychange', resume);
  void run();
  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
