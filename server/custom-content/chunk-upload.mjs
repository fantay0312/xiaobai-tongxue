import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
const TTL_MS = 20 * 60_000;
function fail(code, status = 400) { return Object.assign(new Error(code), { status }); }

// Staging is private and bounded. Only a complete, verified file enters the existing ingest transaction.
export function createChunkUploadStore({ maxReservedBytes = 256 * 1024 * 1024, now = Date.now, parent = tmpdir() } = {}) {
  const sessions = new Map();
  let reservedBytes = 0;
  let rootPromise;
  const root = () => rootPromise ??= (async () => {
    // A killed process cannot run finally; remove only our stale private staging directories.
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^xiaobai-chunks-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
      const path = join(parent, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && info.uid === process.getuid?.() && now() - info.mtimeMs > 24 * 60 * 60_000) {
        await rm(path, { recursive: true, force: true }).catch(() => {});
      }
    }
    return mkdtemp(join(parent, 'xiaobai-chunks-'));
  })();
  function owned(ownerId, id) {
    const session = sessions.get(id);
    if (!session || session.ownerId !== ownerId || session.expiresAt <= now()) throw fail('upload-session-expired', 404);
    return session;
  }
  async function remove(session) {
    if (!sessions.delete(session.id)) return;
    if (session.reserved) reservedBytes -= session.byteSize;
    await rm(session.dir, { recursive: true, force: true });
  }
  async function cleanup() {
    for (const session of sessions.values()) {
      if (session.expiresAt <= now() && !session.active && !session.finishing) await remove(session);
    }
  }
  const timer = setInterval(() => { void cleanup().catch(() => {}); }, 60_000);
  timer.unref();
  return {
    async create(ownerId, courseId, input) {
      await cleanup();
      const existing = [...sessions.values()].find((s) => s.ownerId === ownerId && s.clientUploadId === input.clientUploadId);
      const view = (s) => ({ id: s.id, chunkBytes: UPLOAD_CHUNK_BYTES, chunkCount: Math.ceil(s.byteSize / UPLOAD_CHUNK_BYTES), expiresAt: s.expiresAt });
      if (existing && input.clientUploadId) {
        if (existing.courseId !== courseId || existing.sha256 !== input.sha256 || existing.byteSize !== input.byteSize
          || existing.filename !== input.filename || existing.assetRole !== input.assetRole) throw fail('upload-session-conflict', 409);
        return view(existing);
      }
      const active = [...sessions.values()].filter((s) => !s.settled);
      if (active.length >= 8 || sessions.size >= 256 || reservedBytes + input.byteSize > maxReservedBytes
        || active.some((s) => s.ownerId === ownerId)) throw fail('upload-busy', 429);
      const id = randomUUID();
      const session = { ...input, id, ownerId, courseId, expiresAt: now() + TTL_MS,
        chunks: new Map(), writing: new Set(), active: 0, finishing: false, completion: null, result: null, reserved: true, settled: false };
      // Reserve before awaiting filesystem work, including concurrent init requests.
      sessions.set(id, session);
      reservedBytes += input.byteSize;
      try {
        session.dir = join(await root(), id);
        await mkdir(session.dir, { mode: 0o700 });
      } catch (error) { sessions.delete(id); reservedBytes -= input.byteSize; throw error; }
      return view(session);
    },
    async put(ownerId, id, index, bytes) {
      const session = owned(ownerId, id);
      if (session.completion) throw fail('upload-already-finalized', 409);
      const count = Math.ceil(session.byteSize / UPLOAD_CHUNK_BYTES);
      if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw fail('upload-chunk-invalid');
      const expected = Math.min(UPLOAD_CHUNK_BYTES, session.byteSize - index * UPLOAD_CHUNK_BYTES);
      if (!Buffer.isBuffer(bytes) || bytes.length !== expected) throw fail('upload-chunk-size');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (session.chunks.has(index)) {
        if (session.chunks.get(index) !== hash) throw fail('upload-chunk-conflict', 409);
        return { received: true };
      }
      if (session.writing.has(index)) throw fail('upload-busy', 429);
      session.writing.add(index);
      session.active += 1;
      try {
        await writeFile(join(session.dir, String(index)), bytes, { mode: 0o600 });
        session.chunks.set(index, hash);
        session.expiresAt = now() + TTL_MS;
      } finally { session.writing.delete(index); session.active -= 1; }
      return { received: true };
    },
    async finish(ownerId, id, ingest) {
      const session = owned(ownerId, id);
      if (session.completion) return session.completion;
      const count = Math.ceil(session.byteSize / UPLOAD_CHUNK_BYTES);
      if (session.active || session.chunks.size !== count) throw fail('upload-incomplete', 409);
      session.finishing = true;
      // Cache both success and failure: a lost response must never ingest a second copy.
      session.completion = (async () => {
        try {
          const bytes = Buffer.allocUnsafe(session.byteSize);
          for (let index = 0; index < count; index += 1) {
            const chunk = await readFile(join(session.dir, String(index)));
            chunk.copy(bytes, index * UPLOAD_CHUNK_BYTES);
          }
          if (createHash('sha256').update(bytes).digest('hex') !== session.sha256) throw fail('upload-checksum-mismatch', 422);
          session.result = await ingest(session.courseId, { bytes, filename: session.filename, assetRole: session.assetRole });
          return session.result;
        } finally {
          session.finishing = false;
          session.settled = true;
          session.reserved = false;
          reservedBytes -= session.byteSize;
          session.expiresAt = now() + TTL_MS;
          await rm(session.dir, { recursive: true, force: true }).catch(() => {});
        }
      })();
      return session.completion;
    },
    async cancel(ownerId, id) {
      const session = owned(ownerId, id);
      if (session.active || session.completion) throw fail('upload-busy', 409);
      await remove(session);
      return { cancelled: true };
    },
    cleanup,
    async close() {
      clearInterval(timer);
      if (rootPromise) await rm(await rootPromise, { recursive: true, force: true });
      sessions.clear(); reservedBytes = 0;
    },
  };
}
