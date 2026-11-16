import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createGlossRepository } from './reader/gloss-repository.mjs';
import { DOCUMENT_PART_BYTES } from './reader/gloss-document-upload.mjs';

// Opt in with an isolated test database, never the application's configured database.
test('PostgreSQL large document upload, atomic commit, rollback and account isolation', {
  skip: !process.env.READER_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
  const { Pool } = await import('pg');
  const schema = `reader_upload_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.READER_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY)');
    for (const file of ['013_gloss_reader.sql', '015_gloss_document_upload.sql']) {
      const sql = await readFile(new URL(`./storage/postgres/migrations/${file}`, import.meta.url), 'utf8');
      await pool.query(sql);
      await pool.query(sql); // Migrations remain safe to reapply.
    }
    const owner = randomUUID(), other = randomUUID();
    await pool.query('INSERT INTO users VALUES($1),($2)', [owner, other]);
    const repo = createGlossRepository(pool);
    const transaction = async (fn) => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(createGlossRepository(client)); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const doc = { id: 'book', title: '中文与表情', blocks: [{ id: 'p', type: 'p', runs: [{ text: '中文🙂'.repeat(500000) }] }] };
    const bytes = Buffer.from(JSON.stringify(doc));
    const uploadId = createHash('sha256').update(bytes).digest('hex');
    const parts = Math.ceil(bytes.length / DOCUMENT_PART_BYTES);
    const stage = (index) => transaction((r) => r.stageDocumentPart(owner, doc.id, uploadId, index, {
      parts, bytes: bytes.length, chunk: bytes.subarray(index * DOCUMENT_PART_BYTES, (index + 1) * DOCUMENT_PART_BYTES).toString('base64'),
    }));
    await stage(0);
    await assert.rejects(transaction((r) => r.uploadedDocument(owner, doc.id, uploadId)), { status: 409 });
    assert.equal(await repo.article(owner, doc.id), null);
    await Promise.all(Array.from({ length: parts }, (_, i) => stage(i)));
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM reader_gloss_upload_parts')).rows[0].count), parts, 'retry replaces the same parts');
    await assert.rejects(transaction((r) => r.uploadedDocument(other, doc.id, uploadId)), { status: 409 });
    const commit = (revision) => transaction(async (r) => {
      const uploaded = await r.uploadedDocument(owner, doc.id, uploadId);
      await r.put(owner, 'articles', { id: doc.id, articleId: doc.id, data: { title: doc.title }, doc: uploaded, revision });
      await r.consumeUpload(owner, doc.id, uploadId);
    });
    await assert.rejects(commit(7), { status: 409 });
    assert.equal(await repo.article(owner, doc.id), null, 'stale commit rolls back');
    await commit(0);
    assert.deepEqual(await repo.article(owner, doc.id), doc);
    assert.equal(await repo.article(other, doc.id), null);
    assert.equal((await repo.list(owner))[0].docMissing, false);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM reader_gloss_upload_parts')).rows[0].count), 0, 'successful commit consumes staging');
    // Failure after consuming parts must roll back both metadata and staging deletion.
    await stage(0);
    await assert.rejects(transaction(async (r) => { await r.consumeUpload(owner, doc.id, uploadId); throw new Error('interrupted'); }), /interrupted/);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM reader_gloss_upload_parts')).rows[0].count), 1);
    await pool.query("UPDATE reader_gloss_upload_parts SET expires_at=NOW()-INTERVAL '1 second'");
    await assert.rejects(transaction((r) => r.uploadedDocument(owner, doc.id, uploadId)), { status: 409 });
    await stage(1);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM reader_gloss_upload_parts')).rows[0].count), 1, 'expired abandoned parts are reclaimed');
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
