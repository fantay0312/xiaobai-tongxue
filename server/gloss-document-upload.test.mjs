import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DOCUMENT_PART_BYTES, MAX_DOCUMENT_BYTES, validateDocumentPart, stageDocumentPart, readUploadedDocument } from './reader/gloss-document-upload.mjs';
import { createGlossRouter } from './reader/gloss-router.mjs';

const doc = { id: 'book', title: '中文🙂', blocks: [{ id: 'p', type: 'p', runs: [{ text: '中文🙂'.repeat(500000) }] }] };
const bytes = Buffer.from(JSON.stringify(doc));
const digest = (b) => createHash('sha256').update(b).digest('hex');
const uploadId = digest(bytes);
const chunks = Array.from({ length: Math.ceil(bytes.length / DOCUMENT_PART_BYTES) }, (_, part_index) => ({
  part_index, parts: Math.ceil(bytes.length / DOCUMENT_PART_BYTES), total_bytes: bytes.length,
  chunk: bytes.subarray(part_index * DOCUMENT_PART_BYTES, (part_index + 1) * DOCUMENT_PART_BYTES),
}));

test('document parts enforce canonical base64, exact lengths and bounded size', () => {
  for (const row of chunks) assert.deepEqual(validateDocumentPart(uploadId, row.part_index, { bytes: bytes.length, parts: chunks.length, chunk: row.chunk.toString('base64') }), row.chunk);
  const input = { bytes: 1, parts: 1, chunk: 'YQ==' };
  for (const [id, index, body] of [[uploadId, -1, input], ['bad', 0, input], [uploadId, 0, { ...input, bytes: MAX_DOCUMENT_BYTES + 1 }],
    [uploadId, 0, { ...input, parts: 2 }], [uploadId, 0, { ...input, chunk: 'YQ==!' }], [uploadId, 0, { ...input, chunk: '' }]]) {
    assert.throws(() => validateDocumentPart(id, index, body), { status: 400 });
  }
});

test('assembly requires complete ordered parts, exact bytes, checksum and matching article', async () => {
  let rows = chunks;
  const db = { query: async (_sql, params) => { assert.deepEqual(params, ['alice', 'book', uploadId]); return { rows }; } };
  assert.deepEqual(await readUploadedDocument(db, 'alice', 'book', uploadId), doc);
  rows = chunks.slice(1);
  await assert.rejects(readUploadedDocument(db, 'alice', 'book', uploadId), { status: 409 });
  rows = chunks.map((r, i) => i === 0 ? { ...r, total_bytes: r.total_bytes - 1 } : r);
  await assert.rejects(readUploadedDocument(db, 'alice', 'book', uploadId), { status: 409 });
  rows = chunks.map((r, i) => i === 0 ? { ...r, chunk: Buffer.alloc(r.chunk.length) } : r);
  await assert.rejects(readUploadedDocument(db, 'alice', 'book', uploadId), /完整性/);
  const wrong = Buffer.from(JSON.stringify({ ...doc, id: 'other' }));
  await assert.rejects(readUploadedDocument({ query: async () => ({ rows: [{ part_index: 0, parts: 1, total_bytes: wrong.length, chunk: wrong }] }) }, 'alice', 'book', digest(wrong)), /不匹配/);
});

test('staging serializes the owner quota and scopes all writes to the account', async () => {
  const calls = [];
  let total = 0;
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ bytes: total }] }; } };
  const input = { bytes: bytes.length, parts: chunks.length, chunk: chunks[0].chunk.toString('base64') };
  await stageDocumentPart(db, 'alice', 'book', uploadId, 0, input);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls.at(-1).params.slice(0, 6), ['alice', 'book', uploadId, 0, chunks.length, bytes.length]);
  assert.match(calls.at(-1).sql, /ON CONFLICT/);
  total = MAX_DOCUMENT_BYTES * 2;
  await assert.rejects(stageDocumentPart(db, 'alice', 'book', uploadId, 0, input), { status: 413 });
});

function harness() {
  let body, response;
  let rows = new Map(), docs = new Map();
  const staged = new Map();
  const key = (owner, article, id) => `${owner}:${article}:${id}`;
  const gloss = {
    article: async (owner, id) => docs.get(`${owner}:${id}`),
    stageDocumentPart: async (owner, article, id, index, input) => {
      const chunk = validateDocumentPart(id, index, input);
      const parts = staged.get(key(owner, article, id)) ?? [];
      parts[index] = { part_index: index, parts: input.parts, total_bytes: input.bytes, chunk };
      staged.set(key(owner, article, id), parts);
    },
    uploadedDocument: (owner, article, id) => readUploadedDocument({ query: async () => ({ rows: (staged.get(key(owner, article, id)) ?? []).filter(Boolean) }) }, owner, article, id),
    consumeUpload: async (owner, article, id) => staged.delete(key(owner, article, id)),
    put: async (owner, collection, row) => {
      const k = `${owner}:${collection}:${row.id}`;
      if ((rows.get(k)?.revision ?? 0) !== (row.revision ?? 0)) throw Object.assign(new Error('conflict'), { status: 409 });
      const revision = (row.revision ?? 0) + 1;
      rows.set(k, { ...row, revision });
      if (row.doc) docs.set(`${owner}:${row.id}`, row.doc);
      return revision;
    },
  };
  const router = createGlossRouter({
    postgres: { gloss, withTransaction: async (fn) => {
      const before = [new Map(rows), new Map(docs), new Map(staged)];
      try { return await fn({ gloss }); } catch (e) { [rows, docs] = before; staged.clear(); for (const [k, v] of before[2]) staged.set(k, v); throw e; }
    } },
    resolveOwner: async (req) => ({ id: req.owner }), readJson: async () => body,
    send: (_res, status, data) => { response = { status, data }; },
  });
  const request = async (path, method, input, owner = 'alice') => {
    body = input;
    const req = Object.assign(new EventEmitter(), { owner, method, url: path });
    const res = new EventEmitter();
    await router.handle(req, res, `/api/reader/gloss${path}`);
    return response;
  };
  const part = (index, owner = 'alice') => request(`/article-uploads/book/${uploadId}/${index}`, 'PUT', { bytes: bytes.length, parts: chunks.length, chunk: chunks[index].chunk.toString('base64') }, owner);
  const commit = (revision = 0, owner = 'alice') => request('/sync', 'POST', { changes: { articles: [{ id: 'book', articleId: 'book', data: { title: doc.title }, docUpload: uploadId, revision }] } }, owner);
  return { request, part, commit, docs: () => docs };
}

test('router publishes complete documents atomically and never exposes incomplete or cross-account uploads', async () => {
  const h = harness();
  assert.equal((await h.part(0)).status, 200);
  assert.equal((await h.commit()).status, 409);
  assert.equal(h.docs().size, 0);
  for (let i = 1; i < chunks.length; i++) assert.equal((await h.part(i)).status, 200);
  assert.equal((await h.commit(0, 'bob')).status, 409);
  assert.equal((await h.commit()).status, 200);
  const read = await h.request('/articles/book', 'GET');
  assert.deepEqual(read.data.doc, doc);
  assert.equal((await h.request('/articles/book', 'GET', null, 'bob')).status, 404);
});

test('revision conflict preserves staged text for a retry and does not overwrite the cloud document', async () => {
  const h = harness();
  for (let i = 0; i < chunks.length; i++) await h.part(i);
  assert.equal((await h.commit(7)).status, 409);
  assert.equal(h.docs().size, 0);
  assert.equal((await h.commit()).status, 200);
  assert.deepEqual(h.docs().get('alice:book'), doc);
});
