import assert from 'node:assert/strict';
import { uploadInChunks, type UploadProgress } from '../src/lib/chunkedUpload';

const id = '00000000-0000-4000-8000-000000000001';
const chunkBytes = 1024 * 1024;
const bytes = new Uint8Array(chunkBytes * 3 + 41).map((_, i) => i % 251);
const file = new File([bytes], 'large.pdf');
let concurrent = 0;
let maximum = 0;
let retried = false;
let completeCalls = 0;
const stored = new Map<number, Uint8Array>();
const progress: UploadProgress[] = [];
const transport = async <T>(path: string, init: RequestInit): Promise<T> => {
  if (path.endsWith('/uploads')) return { upload: { id, chunkBytes, chunkCount: 4 } } as T;
  if (path.endsWith('/complete')) {
    completeCalls += 1;
    if (completeCalls === 1) throw Object.assign(new Error('lost response'), { status: 0 });
    return { asset: { id: 'asset' } } as T;
  }
  const index = Number(path.split('/').at(-1));
  concurrent += 1; maximum = Math.max(maximum, concurrent);
  try {
    await new Promise((r) => setTimeout(r, 5));
    if (index === 1 && !retried) { retried = true; throw Object.assign(new Error('busy'), { status: 503 }); }
    stored.set(index, new Uint8Array(await (init.body as Blob).arrayBuffer()));
    return { received: true } as T;
  } finally { concurrent -= 1; }
};
assert.deepEqual(await uploadInChunks(transport, 'course', file, 'lecture', { onProgress: (p) => progress.push(p) }), { id: 'asset' });
assert.equal(maximum, 3);
assert.equal(completeCalls, 2);
assert.equal(stored.size, 4);
for (const [index, value] of stored) assert.deepEqual(value, bytes.slice(index * chunkBytes, (index + 1) * chunkBytes));
const acknowledged = progress.filter((p) => p.phase === 'uploading').map((p) => p.loaded);
assert.deepEqual(acknowledged, [...acknowledged].sort((a, b) => a - b));
assert.equal(acknowledged.at(-1), file.size);
let calls = 0;
await assert.rejects(uploadInChunks(async () => { calls += 1; throw Object.assign(new Error('unauthorized'), { status: 401 }); }, 'course', file, 'lecture'), /unauthorized/);
assert.equal(calls, 1);
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(uploadInChunks(transport, 'course', file, 'lecture', { signal: cancelled.signal }), { name: 'AbortError' });
console.log('Chunked upload: concurrency, exact bytes, retries, progress, authentication and cancellation passed.');
