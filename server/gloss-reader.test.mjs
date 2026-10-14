import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyRows } from './reader/gloss-legacy.mjs';
import { readerMediaProviders } from './reader/media.mjs';
import { createGlossRepository } from './reader/gloss-repository.mjs';

test('legacy notes and cross-block selections survive migration to original Gloss shape', () => {
  const original = { id: 'test', title: 'T', blocks: [{ id: 'p1', kind: 'paragraph', text: 'First' }, { id: 'p2', kind: 'paragraph', text: 'Second' }], marks: [{ id: 'm1', anchors: [{ block: 'p1', start: 2, end: 5 }, { block: 'p2', start: 0, end: 3 }], quote: 'rst Sec', color: 'green', note: 'Keep me', createdAt: 1 }], threads: [], tags: [], createdAt: 1, progress: 0 };
  const migrated = legacyRows(original); assert.equal(migrated.article.blocks[0].runs[0].text, 'First');
  const mark = migrated.rows.find((r) => r.collection === 'highlights').data;
  assert.deepEqual(mark.anchor, { start: { b: 'p1', o: 2 }, end: { b: 'p2', o: 3 }, quote: 'rst Sec' }); assert.equal(mark.note, 'Keep me');
});
test('media discovery does not send main credentials to a different origin', () => {
  assert.deepEqual(readerMediaProviders({ upstreamBaseUrl: 'https://api.deepseek.com', apiKey: 'main-only', asrUpstreamUrl: 'https://openrouter.ai/api/v1/audio/transcriptions' }), []);
  const providers = readerMediaProviders({ upstreamBaseUrl: 'https://api.deepseek.com', apiKey: 'main-only', asrUpstreamUrl: 'https://openrouter.ai/api/v1/audio/transcriptions', asrApiKey: 'media-only' });
  assert.equal(providers.length, 1); assert.equal(providers[0].key, 'media-only'); assert.equal(providers[0].origin, 'https://openrouter.ai');
});
test('native reader persistence includes account and revision in writes', async () => {
  let last; const repo = createGlossRepository({ query: async (query, values) => { last = { query, values }; return { rows: [] }; } });
  await assert.rejects(repo.put('owner-a', 'highlights', { id: 'm', articleId: 'a', data: {}, revision: 7 }), /云端版本/);
  assert.equal(last.values[0], 'owner-a'); assert.equal(last.values[7], 7); assert.match(last.query, /revision=\$8/);
});
