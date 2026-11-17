import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncRequest } from '../gloss/src/lib/sync-request';

function clock() {
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let id = 0;
  globalThis.setTimeout = ((fn: () => void) => { timers.set(++id, fn); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((key: number) => { timers.delete(key); }) as unknown as typeof clearTimeout;
  return { timers, expire() { for (const fn of [...timers.values()]) fn(); }, restore() { globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear; } };
}

for (const stage of ['headers', 'body'] as const) test(`deadline releases a request stalled at ${stage}, even if transport ignores abort`, async () => {
  const time = clock();
  let signal: AbortSignal | undefined;
  let calls = 0;
  try {
    const fetcher: typeof fetch = async (_url, init) => {
      calls++; signal = init!.signal!;
      if (stage === 'headers') return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) } as unknown as Response;
    };
    const pending = assert.rejects(syncRequest('/sync', { method: 'PUT', body: '{}' }, fetcher), { name: 'TimeoutError' });
    time.expire(); await pending;
    assert.equal(signal!.aborted, true);
    assert.equal(calls, 1, 'ambiguous writes are not automatically retried');
    assert.equal(time.timers.size, 0);
    const next = await syncRequest<{ saved: boolean }>('/sync', {}, async () => Response.json({ saved: true }));
    assert.equal(next.data!.saved, true, 'later work can proceed after the timeout');
    assert.equal(time.timers.size, 0);
  } finally { time.restore(); }
});

test('caller cancellation remains distinct from timeouts and prevents pre-cancelled requests', async () => {
  const time = clock();
  try {
    const controller = new AbortController();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Promise(() => {}); };
    const pending = assert.rejects(syncRequest('/sync', { signal: controller.signal }, fetcher), { name: 'AbortError' });
    controller.abort(); await pending;
    await assert.rejects(syncRequest('/sync', { signal: controller.signal }, fetcher), { name: 'AbortError' });
    assert.equal(calls, 1);
    assert.equal(time.timers.size, 0);
  } finally { time.restore(); }
});

test('HTTP errors, invalid JSON and network errors release their deadline without hiding status', async () => {
  const time = clock();
  try {
    const response = await syncRequest('/sync', {}, async () => new Response('not-json', { status: 409 }));
    assert.equal(response.response.status, 409);
    assert.equal(response.data, null);
    await assert.rejects(syncRequest('/sync', {}, async () => new Response('not-json')), SyntaxError);
    await assert.rejects(syncRequest('/sync', {}, async () => { throw new TypeError('offline'); }), /offline/);
    assert.equal(time.timers.size, 0);
  } finally { time.restore(); }
});
