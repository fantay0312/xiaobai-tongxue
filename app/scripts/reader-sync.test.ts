import assert from 'node:assert/strict';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
const events = new EventTarget();
Object.assign(globalThis, { window: Object.assign(events, { fetch, localStorage: storage }), localStorage: storage,
  indexedDB: { open() { throw new Error('This sync test must not access documents.'); } },
  document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
const { useStore } = await import('../gloss/src/lib/store');
const { startSync, syncConflicts } = await import('../gloss/src/lib/sync');
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
const empty = () => Object.fromEntries(['articles', 'highlights', 'glosses', 'briefs', 'progress'].map(c => [c, {}]));
const note = { id: 'note', articleId: 'article', anchor: { start: { b: 'p1', o: 0 }, end: { b: 'p1', o: 2 }, quote: '原文' }, createdAt: 1, note: '本机笔记' };
const reset = () => useStore.setState({ hydrated: false, library: [], highlights: {}, glosses: {}, briefs: {}, progress: {} });

reset();
const seen = empty(); seen.highlights.note = [JSON.stringify({ ...note, note: '旧笔记' }), 'article'];
storage.setItem('gloss:sync:conflict-test', JSON.stringify({ since: '2026-10-15T00:00:00Z', seen, revisions: { 'highlights:note': 1 } }));
useStore.setState({ highlights: { article: [note] }, hydrated: true });
let pushes = 0;
globalThis.fetch = async (_url, init) => {
  if (!init?.method) return Response.json({ now: '2026-10-15T00:01:00Z', changes: { highlights: [{ id: 'note', articleId: 'article', data: { ...note, note: '另一台设备笔记' }, revision: 2 }] } });
  const body = JSON.parse(String(init.body)); pushes++;
  assert.equal(body.changes.highlights[0].revision, 2);
  return Response.json({ revisions: { 'highlights:note': 3 } });
};
let sync = startSync('conflict-test'); await pause(); sync.stop();
assert.equal(pushes, 1);
assert.equal(useStore.getState().highlights.article[0].note, '本机笔记');
assert.equal((syncConflicts('conflict-test')[0] as { remote: typeof note }).remote.note, '另一台设备笔记');

reset(); values.clear();
useStore.setState({ hydrated: true, highlights: { article: Array.from({ length: 501 }, (_, i) => ({ ...note, id: `note-${i}` })) } });
const sizes: number[] = [];
globalThis.fetch = async (_url, init) => {
  if (!init?.method) return Response.json({ now: new Date().toISOString(), changes: {} });
  const rows = JSON.parse(String(init.body)).changes.highlights; sizes.push(rows.length);
  assert.ok(rows.length <= 500);
  return Response.json({ revisions: Object.fromEntries(rows.map((r: { id: string }) => [`highlights:${r.id}`, 1])) });
};
sync = startSync('batch-test'); await pause(); sync.stop();
assert.deepEqual(sizes, [500, 1]);

reset(); values.clear();
useStore.setState({ hydrated: true, highlights: { article: [note] } });
let attempt = 0; let pulls = 0;
globalThis.fetch = async (_url, init) => {
  if (!init?.method) { pulls++; return Response.json({ now: new Date().toISOString(), changes: pulls > 1 ? { highlights: [{ id: 'note', articleId: 'article', data: { ...note, note: '同时更新' }, revision: 4 }] } : {} }); }
  attempt++;
  if (attempt === 1) return Response.json({ error: 'conflict' }, { status: 409 });
  assert.equal(JSON.parse(String(init.body)).changes.highlights[0].revision, 4);
  return Response.json({ revisions: { 'highlights:note': 5 } });
};
sync = startSync('race-test'); await pause(); sync.stop();
assert.equal(attempt, 2); assert.equal(pulls, 2);
reset();
const { createHash } = await import('node:crypto');
const largeDoc = { id: 'large-book', title: '大篇幅中文', origin: 'file' as const,
  blocks: [{ id: 'p1', type: 'p' as const, runs: [{ text: '中文🙂\\"\n'.repeat(450_000) }] }] };
const item = { id: largeDoc.id, title: largeDoc.title, origin: 'file' as const, addedAt: 1, words: 1, rev: 1 };
const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('sync did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const baseline = (user: string) => JSON.parse(values.get(`gloss:sync:${user}`) || '{}');
const seed = () => {
  reset(); values.clear();
  values.set(`gloss:doc:${largeDoc.id}`, JSON.stringify(largeDoc));
  useStore.setState({ hydrated: true, library: [item] });
};
const parts = new Map<number, Buffer>();
let committedDoc: typeof largeDoc | undefined;
let uploadId = ''; let failedPart = false; let syncErrors = 0;
events.addEventListener('gloss:sync-error', () => syncErrors++);
globalThis.fetch = async (url, init) => {
  if (!init?.method) return Response.json({ now: new Date().toISOString(), changes: {} });
  if (init.method === 'PUT') {
    const body = JSON.parse(String(init.body));
    const index = Number(String(url).split('/').at(-1));
    uploadId = String(url).split('/').at(-2)!;
    assert.ok(Buffer.byteLength(String(init.body)) < 710000, 'each encoded part is bounded');
    assert.equal(baseline('large').seen?.articles?.[item.id], undefined, 'never acknowledge a partial upload');
    if (index === 1 && !failedPart) { failedPart = true; return new Response(null, { status: 503 }); }
    parts.set(index, Buffer.from(body.chunk, 'base64'));
    return Response.json({ ok: true });
  }
  const row = JSON.parse(String(init.body)).changes.articles[0];
  assert.equal(row.doc, undefined);
  assert.equal(row.docUpload, uploadId);
  const bytes = Buffer.concat([...parts.entries()].sort(([a], [b]) => a - b).map(([, b]) => b));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), uploadId);
  assert.deepEqual(JSON.parse(bytes.toString()), largeDoc, 'Chinese, emoji, escapes and line breaks round-trip exactly');
  committedDoc = JSON.parse(bytes.toString());
  return Response.json({ revisions: { [`articles:${item.id}`]: 1 } });
};

seed();
sync = startSync('large'); await waitFor(() => syncErrors === 1); sync.stop();
assert.equal(baseline('large').seen.articles[item.id], undefined, 'failed part leaves the book pending');
sync = startSync('large'); await waitFor(() => !!baseline('large').seen?.articles?.[item.id]); sync.stop();
assert.deepEqual(committedDoc, largeDoc, 'retry completes the full cloud document');
let duplicatePushes = 0;
globalThis.fetch = async (_url, init) => {
  if (init?.method) duplicatePushes++;
  return Response.json({ now: new Date().toISOString(), changes: {} });
};
sync = startSync('large'); await pause(); sync.stop();
assert.equal(duplicatePushes, 0, 'acknowledged document is not uploaded again');

// A second device reads the complete cloud document, without the first device's storage.
reset(); values.clear();
const { fetchText } = await import('../gloss/src/lib/sync');
globalThis.fetch = async () => Response.json({ doc: committedDoc });
assert.deepEqual(await fetchText(item.id), largeDoc);

// Old metadata-only acknowledgements are discovered by a one-time full pull and repaired.
seed();
values.set('gloss:sync:repair', JSON.stringify({ since: '2026-10-15T00:00:00Z',
  seen: { ...empty(), articles: { [item.id]: [JSON.stringify(item), item.id] } }, revisions: { [`articles:${item.id}`]: 3 } }));
let repaired = false;
globalThis.fetch = async (url, init) => {
  if (!init?.method) {
    assert.equal(url, '/api/sync', 'legacy baseline must inspect old rows too');
    return Response.json({ now: new Date().toISOString(), changes: { articles: [{ id: item.id, articleId: item.id, data: item, revision: 3, docMissing: true }] } });
  }
  if (init.method === 'POST') {
    assert.equal(JSON.parse(String(init.body)).changes.articles[0].revision, 3);
    repaired = true;
    return Response.json({ revisions: { [`articles:${item.id}`]: 4 } });
  }
  return Response.json({ ok: true });
};
sync = startSync('repair'); await waitFor(() => repaired && baseline('repair').revisions?.[`articles:${item.id}`] === 4); sync.stop();

seed();
const errorCount = syncErrors;
globalThis.fetch = async (_url, init) => !init?.method
  ? Response.json({ now: new Date().toISOString(), changes: {} })
  : init.method === 'PUT' ? Response.json({ ok: true }) : new Response(null, { status: 503 });
sync = startSync('commit-failed'); await waitFor(() => syncErrors > errorCount); sync.stop();
assert.equal(baseline('commit-failed').seen.articles[item.id], undefined, 'failed final save never acknowledges the document');

seed();
const malformedErrors = syncErrors;
globalThis.fetch = async (_url, init) => !init?.method
  ? Response.json({ now: new Date().toISOString(), changes: {} }) : Response.json({ ok: true });
sync = startSync('malformed-ack'); await waitFor(() => syncErrors > malformedErrors); sync.stop();
assert.equal(baseline('malformed-ack').seen.articles[item.id], undefined, 'a malformed final acknowledgement cannot mark a document synced');

reset(); values.clear();
useStore.setState({ hydrated: true, library: [item] });
const missingErrors = syncErrors;
let missingWrites = 0;
globalThis.fetch = async (_url, init) => {
  if (init?.method) missingWrites++;
  return Response.json({ now: new Date().toISOString(), changes: {} });
};
sync = startSync('missing'); await waitFor(() => syncErrors > missingErrors); sync.stop();
assert.equal(missingWrites, 0, 'a missing local document cannot become a metadata-only acknowledgement');
reset();
console.log('Reader sync: conflicts, batching, large UTF-8 documents, interrupted retry, cross-device reads, legacy repair and failed commits passed.');
