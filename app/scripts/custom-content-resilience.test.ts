import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { test } from 'node:test';
import { CustomContentError, listCourseAssets, startTopicCompile } from '../src/lib/customContent';
import { watchCustomContent } from '../src/lib/customContentSync';

function environment() {
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const nav = { onLine: true };
  let sequence = 0;
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: win },
    document: { configurable: true, value: doc },
    navigator: { configurable: true, value: nav },
    setTimeout: { configurable: true, value: (callback: () => void, delay: number) => {
      timers.set(++sequence, { at: now + delay, callback }); return sequence;
    } },
    clearTimeout: { configurable: true, value: (id: number) => timers.delete(id) },
  });
  return {
    win, doc, nav, timers,
    async tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      await flush();
    },
    restore() {
      for (const key of ['window', 'document', 'navigator', 'setTimeout', 'clearTimeout', 'fetch']) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('a stalled read times out, while caller cancellation stays distinguishable', async () => {
  const env = environment();
  try {
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
    const timeout = assert.rejects(listCourseAssets('a'), (error: unknown) => error instanceof CustomContentError && error.message === 'request-timeout');
    await env.tick(20_000);
    await timeout;
    const controller = new AbortController();
    const aborted = assert.rejects(listCourseAssets('a', controller.signal), { name: 'AbortError' });
    controller.abort();
    await aborted;
    assert.equal(env.timers.size, 0, 'both paths clean up deadlines');
  } finally { env.restore(); }
});

test('ambiguous writes are never automatically repeated', async () => {
  const env = environment();
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls += 1; throw new TypeError('network failure'); };
    await assert.rejects(startTopicCompile({ courseId: 'a', assetIds: ['b'] }), /request-network-failed/);
    await env.tick(300_000);
    assert.equal(calls, 1);
  } finally { env.restore(); }
});

test('malformed asset lists fail as recoverable contract errors', async () => {
  const env = environment();
  try {
    for (const body of [{ assets: null }, { assets: [null] }, { assets: [{}] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      await assert.rejects(listCourseAssets('a'), /custom-content-contract-invalid/);
    }
  } finally { env.restore(); }
});

test('polling backs off, honors retry-after and probes slowly after repeated transient failures', async () => {
  const env = environment();
  let calls = 0;
  const errors: boolean[] = [];
  const stop = watchCustomContent({
    load: async () => { calls += 1; throw new CustomContentError('busy', 429, 10); },
    onData: () => assert.fail('unexpected data'),
    onError: (_error, stopped) => errors.push(stopped),
  });
  try {
    await flush();
    assert.equal(calls, 1);
    await env.tick(9_999); assert.equal(calls, 1);
    await env.tick(1); assert.equal(calls, 2);
    await env.tick(10_000); assert.equal(calls, 3);
    await env.tick(29_999); assert.equal(calls, 3);
    await env.tick(1); assert.equal(calls, 4);
    assert.deepEqual(errors, [false, false, false, false]);
  } finally { stop(); env.restore(); }
});

test('permission failures stop immediately', async () => {
  const env = environment();
  let calls = 0;
  let stopped = false;
  const stop = watchCustomContent({
    load: async () => { calls += 1; throw new CustomContentError('forbidden', 403); },
    onData: () => {}, onError: (_error, value) => { stopped = value; },
  });
  try {
    await flush(); await env.tick(60_000);
    env.win.dispatchEvent(new Event('online'));
    env.doc.dispatchEvent(new Event('visibilitychange'));
    await flush(); assert.equal(calls, 1); assert.equal(stopped, true);
  }
  finally { stop(); env.restore(); }
});

test('hidden and offline tabs pause reads, reconnect resumes one non-overlapping read', async () => {
  const env = environment();
  env.doc.visibilityState = 'hidden';
  let calls = 0;
  let resolveRead: ((value: number) => void) | undefined;
  const stop = watchCustomContent({
    load: async () => { calls += 1; return new Promise<number>((resolve) => { resolveRead = resolve; }); },
    onData: () => {}, onError: () => assert.fail('unexpected error'), shouldPoll: () => true,
  });
  try {
    await flush(); assert.equal(calls, 0);
    env.doc.visibilityState = 'visible'; env.doc.dispatchEvent(new Event('visibilitychange'));
    env.win.dispatchEvent(new Event('online')); await flush(); assert.equal(calls, 1);
    resolveRead!(1); await flush();
    env.nav.onLine = false; env.win.dispatchEvent(new Event('offline'));
    await env.tick(60_000); assert.equal(calls, 1);
    env.nav.onLine = true; env.win.dispatchEvent(new Event('online')); await flush(); assert.equal(calls, 2);
    resolveRead!(2); await flush();
  } finally { stop(); env.restore(); }
});

test('disposing a poll aborts its pending read and ignores stale data', async () => {
  const env = environment();
  let signal: AbortSignal | undefined;
  let resolveRead: ((value: number) => void) | undefined;
  let updates = 0;
  const stop = watchCustomContent({
    load: async (value) => { signal = value; return new Promise<number>((resolve) => { resolveRead = resolve; }); },
    onData: () => { updates += 1; }, onError: () => assert.fail('unexpected error'),
  });
  try {
    stop(); resolveRead!(1); await flush();
    assert.equal(signal!.aborted, true); assert.equal(updates, 0); assert.equal(env.timers.size, 0);
  } finally { env.restore(); }
});

test('online recovers a paused transient poll', async () => {
  const env = environment();
  let calls = 0;
  const stop = watchCustomContent({
    load: async () => { if (++calls <= 3) throw new CustomContentError('offline', 0); return 'done'; },
    onData: () => {}, onError: () => {},
  });
  try {
    await flush(); await env.tick(2_000); await env.tick(4_000);
    assert.equal(calls, 3);
    env.nav.onLine = false; env.win.dispatchEvent(new Event('offline'));
    env.nav.onLine = true; env.win.dispatchEvent(new Event('online'));
    await flush(); assert.equal(calls, 4);
    env.win.dispatchEvent(new Event('online')); await flush(); assert.equal(calls, 4);
  } finally { stop(); env.restore(); }
});

test('hiding aborts an in-flight read without consuming retry budget', async () => {
  const env = environment();
  let calls = 0;
  let errors = 0;
  const stop = watchCustomContent({
    load: (signal) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('pause', 'AbortError')))); },
    onData: () => {}, onError: () => { errors++; }, shouldPoll: () => true,
  });
  try {
    env.doc.visibilityState = 'hidden'; env.doc.dispatchEvent(new Event('visibilitychange'));
    env.doc.visibilityState = 'visible'; env.doc.dispatchEvent(new Event('visibilitychange'));
    await flush(); await env.tick(0);
    assert.equal(calls, 2); assert.equal(errors, 0);
  } finally { stop(); env.restore(); }
});
