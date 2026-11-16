import { createHash } from 'node:crypto';

export const DOCUMENT_PART_BYTES = 512 * 1024;
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const documentUploadId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function validateDocumentPart(uploadId, index, input) {
  if (!documentUploadId(uploadId) || !Number.isInteger(index) || index < 0
    || !Number.isInteger(input?.bytes) || input.bytes < 1 || input.bytes > MAX_DOCUMENT_BYTES
    || input.parts !== Math.ceil(input.bytes / DOCUMENT_PART_BYTES) || index >= input.parts
    || typeof input.chunk !== 'string' || input.chunk.length > Math.ceil(DOCUMENT_PART_BYTES / 3) * 4) {
    throw fail('正文分块无效或过大。');
  }
  const chunk = Buffer.from(input.chunk, 'base64');
  const expected = index === input.parts - 1 ? input.bytes - index * DOCUMENT_PART_BYTES : DOCUMENT_PART_BYTES;
  if (chunk.length !== expected || chunk.toString('base64') !== input.chunk) throw fail('正文分块长度无效。');
  return chunk;
}

/** Called inside a transaction. An owner lock bounds concurrent temporary uploads. */
export async function stageDocumentPart(db, owner, articleId, uploadId, index, input) {
  const chunk = validateDocumentPart(uploadId, index, input);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`gloss-upload:${owner}`]);
  await db.query('DELETE FROM reader_gloss_upload_parts WHERE owner_id=$1 AND expires_at < NOW()', [owner]);
  // Reclaim abandoned uploads even when their owner never returns. Keep each sweep bounded.
  await db.query(`DELETE FROM reader_gloss_upload_parts WHERE ctid IN (
    SELECT ctid FROM reader_gloss_upload_parts WHERE expires_at < NOW()
    ORDER BY expires_at LIMIT 128 FOR UPDATE SKIP LOCKED)`);
  const { rows } = await db.query('SELECT COALESCE(SUM(octet_length(chunk)),0) AS bytes FROM reader_gloss_upload_parts WHERE owner_id=$1 AND NOT (article_id=$2 AND upload_id=$3 AND part_index=$4)', [owner, articleId, uploadId, index]);
  if (Number(rows[0].bytes) + chunk.length > MAX_DOCUMENT_BYTES * 2) throw fail('待同步正文过多，请稍后重试。', 413);
  await db.query(`INSERT INTO reader_gloss_upload_parts(owner_id,article_id,upload_id,part_index,parts,total_bytes,chunk)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,article_id,upload_id,part_index)
    DO UPDATE SET chunk=$7,parts=$5,total_bytes=$6,expires_at=NOW()+INTERVAL '1 hour'`,
  [owner, articleId, uploadId, index, input.parts, input.bytes, chunk]);
}

/** The complete document is read in the same transaction as its shelf row. */
export async function readUploadedDocument(db, owner, articleId, uploadId) {
  if (!documentUploadId(uploadId)) throw fail('正文上传标识无效。');
  const { rows } = await db.query(`SELECT part_index,parts,total_bytes,chunk FROM reader_gloss_upload_parts
    WHERE owner_id=$1 AND article_id=$2 AND upload_id=$3 AND expires_at > NOW() ORDER BY part_index FOR UPDATE`, [owner, articleId, uploadId]);
  const first = rows[0];
  if (!first || rows.length !== first.parts || rows.some((r, i) => r.part_index !== i || r.parts !== first.parts || r.total_bytes !== first.total_bytes)) throw fail('正文尚未完整上传，请重试。', 409);
  const bytes = Buffer.concat(rows.map((r) => r.chunk));
  if (bytes.length !== first.total_bytes || bytes.length > MAX_DOCUMENT_BYTES
    || createHash('sha256').update(bytes).digest('hex') !== uploadId) throw fail('正文完整性校验失败，请重试。');
  let doc;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('正文格式无效。'); }
  if (doc?.id !== articleId) throw fail('正文与书目不匹配。');
  return doc;
}
