import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Explicit development adapter; never an automatic production fallback. */
export async function createLocalLibraryStore(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const queues = new Map();
  const key = (owner) => crypto.createHash('sha256').update(String(owner)).digest('hex');
  const file = (owner) => path.join(root, `${key(owner)}.json`);
  const read = async (owner) => { try { return JSON.parse(await readFile(file(owner), 'utf8')).entries; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
  const metadata = {
    list: read,
    async mutate(owner, work) {
      const previous = queues.get(owner) ?? Promise.resolve();
      let release; const barrier = new Promise((resolve) => { release = resolve; }); queues.set(owner, previous.then(() => barrier));
      await previous;
      try {
        const entries = await read(owner); const result = await work(entries);
        const temp = `${file(owner)}.${crypto.randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ userId: owner, entries }), { mode: 0o600 }); await rename(temp, file(owner));
        return result;
      } finally { release(); }
    },
    async pendingBefore(iso) {
      const values = [];
      for (const name of await readdir(root)) if (/^[a-f0-9]{64}\.json$/.test(name)) {
        const record = JSON.parse(await readFile(path.join(root, name), 'utf8'));
        const entries = record.entries.filter((entry) => ['pending', 'cleaning', 'purging'].includes(entry.phase) && entry.createdAt < iso);
        if (entries.length) values.push({ userId: record.userId, entries });
      }
      return values;
    },
  };
  const blobPath = (owner, objectKey) => {
    if (!/^[a-f0-9]{32}$/.test(objectKey)) throw new Error('invalid-object-key');
    return path.join(root, `${key(owner)}-${objectKey}.blob`);
  };
  const blobs = {
    maxObjectBytes: 80 * 1024 * 1024,
    createLibraryFileKey: () => crypto.randomBytes(16).toString('hex'),
    async uploadLibraryFile({ userId, key: objectKey, body }) { await writeFile(blobPath(userId, objectKey), body, { mode: 0o600, flag: 'wx' }); return { key: objectKey }; },
    async read({ userId, key: objectKey }) { return { body: await readFile(blobPath(userId, objectKey)) }; },
    async delete({ userId, key: objectKey }) { await unlink(blobPath(userId, objectKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; }); },
    async verifySize({ userId, key: objectKey }) { return { byteSize: (await readFile(blobPath(userId, objectKey))).length }; },
  };
  return { metadata, blobs, mode: 'local' };
}
