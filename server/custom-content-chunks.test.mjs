import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createChunkUploadStore, UPLOAD_CHUNK_BYTES } from './custom-content/chunk-upload.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = (bytes) => ({ filename: 'lesson.pdf', byteSize: bytes.length, sha256: sha(bytes), assetRole: 'lecture', clientUploadId: randomUUID() });

test('chunk upload preserves out-of-order bytes, owner boundaries and idempotency', async (t) => {
  const store = createChunkUploadStore(); t.after(() => store.close());
  const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES + 45, 7);
  const meta = input(bytes);
  const session = await store.create('alice', 'course', meta);
  assert.equal((await store.create('alice', 'course', meta)).id, session.id);
  await assert.rejects(store.create('alice', 'course', { ...meta, filename: 'different.pdf' }), /upload-session-conflict/);
  await assert.rejects(store.put('bob', session.id, 0, bytes.subarray(0, UPLOAD_CHUNK_BYTES)), /upload-session-expired/);
  await assert.rejects(store.put('alice', session.id, 0, Buffer.from('short')), /upload-chunk-size/);
  await assert.rejects(store.put('alice', session.id, -1, bytes), /upload-chunk-invalid/);
  await store.put('alice', session.id, 1, bytes.subarray(UPLOAD_CHUNK_BYTES));
  await assert.rejects(store.finish('alice', session.id, () => assert.fail('incomplete file ingested')), /upload-incomplete/);
  await store.put('alice', session.id, 0, bytes.subarray(0, UPLOAD_CHUNK_BYTES));
  await store.put('alice', session.id, 0, bytes.subarray(0, UPLOAD_CHUNK_BYTES));
  await assert.rejects(store.put('alice', session.id, 0, Buffer.alloc(UPLOAD_CHUNK_BYTES)), /upload-chunk-conflict/);
  let ingested = 0;
  const ingest = async (course, upload) => {
    ingested += 1; assert.equal(course, 'course'); assert.deepEqual(upload.bytes, bytes);
    return { id: 'asset' };
  };
  assert.deepEqual(await Promise.all([store.finish('alice', session.id, ingest), store.finish('alice', session.id, ingest)]), [{ id: 'asset' }, { id: 'asset' }]);
  assert.equal(ingested, 1);
  await assert.rejects(store.finish('bob', session.id, ingest), /upload-session-expired/);
});

test('checksum mismatch never ingests, and failed finalization is not repeated', async (t) => {
  const store = createChunkUploadStore(); t.after(() => store.close());
  const bytes = Buffer.from('original');
  const session = await store.create('alice', 'course', input(bytes));
  await store.put('alice', session.id, 0, Buffer.from('modified'));
  await assert.rejects(store.finish('alice', session.id, () => assert.fail()), /upload-checksum-mismatch/);
  await assert.rejects(store.finish('alice', session.id, () => assert.fail()), /upload-checksum-mismatch/);
  const second = await store.create('alice', 'course', input(bytes));
  await store.put('alice', second.id, 0, bytes);
  let calls = 0;
  const reject = async () => { calls += 1; throw new Error('upstream failed'); };
  await assert.rejects(store.finish('alice', second.id, reject), /upstream failed/);
  await assert.rejects(store.finish('alice', second.id, reject), /upstream failed/);
  assert.equal(calls, 1);
});

test('staging reservations are bounded, cancelled and expired sessions release capacity', async (t) => {
  let clock = Date.now();
  const store = createChunkUploadStore({ maxReservedBytes: 10, now: () => clock }); t.after(() => store.close());
  const session = await store.create('alice', 'course', input(Buffer.alloc(8)));
  await assert.rejects(store.create('bob', 'course', input(Buffer.alloc(8))), /upload-busy/);
  await assert.rejects(store.cancel('bob', session.id), /upload-session-expired/);
  await store.cancel('alice', session.id);
  const replacement = await store.create('bob', 'course', input(Buffer.alloc(8)));
  clock += 21 * 60_000;
  await store.cleanup();
  await assert.rejects(store.put('bob', replacement.id, 0, Buffer.alloc(8)), /upload-session-expired/);
  assert.ok(await store.create('alice', 'course', input(Buffer.alloc(8))));
});
