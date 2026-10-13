export interface UploadProgress {
  phase: 'preparing' | 'uploading' | 'processing';
  loaded: number;
  total: number;
}

type Transport = <T>(path: string, init: RequestInit) => Promise<T>;
type Session = { id: string; chunkBytes: number; chunkCount: number };
type UploadOptions = { signal?: AbortSignal; onProgress?: (value: UploadProgress) => void };

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function retry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    checkAbort(signal);
    try { return await operation(); } catch (error) {
      checkAbort(signal);
      const status = (error as { status?: number }).status;
      if (attempt >= 2 || ![0, 408, 429, 502, 503, 504].includes(status ?? -1)) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 500 * (attempt + 1));
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

export async function uploadInChunks<T>(transport: Transport, courseId: string, file: File, assetRole: string, options: UploadOptions = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const progress = (phase: UploadProgress['phase'], loaded: number) => options.onProgress?.({ phase, loaded, total: file.size });
  let session: Session | undefined;
  let completing = false;
  try {
    checkAbort(options.signal);
    progress('preparing', 0);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    checkAbort(options.signal);
    const sha256 = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
    const clientUploadId = crypto.randomUUID();
    session = (await retry(() => transport<{ upload: Session }>(`/courses/${encodeURIComponent(courseId)}/uploads`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.webkitRelativePath || file.name, byteSize: file.size, assetRole, sha256, clientUploadId }),
    }), controller.signal)).upload;
    if (!session || !/^[a-f0-9-]{36}$/.test(session.id) || !Number.isSafeInteger(session.chunkBytes)
      || session.chunkBytes < 64 * 1024 || session.chunkBytes > 1024 * 1024
      || session.chunkCount !== Math.ceil(file.size / session.chunkBytes)) throw new Error('Invalid upload session');
    const activeSession = session;
    let next = 0;
    let loaded = 0;
    progress('uploading', 0);
    const workers = Array.from({ length: Math.min(3, session.chunkCount) }, async () => {
      while (next < activeSession.chunkCount) {
        checkAbort(controller.signal);
        const index = next++;
        const chunk = file.slice(index * activeSession.chunkBytes, (index + 1) * activeSession.chunkBytes);
        await retry(() => transport(`/uploads/${activeSession.id}/chunks/${index}`, {
          method: 'PUT', signal: controller.signal, headers: { 'Content-Type': 'application/octet-stream' }, body: chunk,
        }), controller.signal);
        loaded += chunk.size;
        progress('uploading', loaded);
      }
    });
    try { await Promise.all(workers); } catch (error) {
      controller.abort();
      await Promise.allSettled(workers);
      throw error;
    }
    completing = true;
    progress('processing', file.size);
    return (await retry(() => transport<{ asset: T }>(`/uploads/${activeSession.id}/complete`, {
      method: 'POST', signal: controller.signal,
    }), controller.signal)).asset;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (session && !completing) {
      void transport(`/uploads/${session.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}
