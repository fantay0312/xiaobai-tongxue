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
console.log('Reader sync: concurrent note preservation, 409 recovery and 501-row batching passed.');
