import { assertUuid } from '../storage/contact-crypto.mjs';

/** Called inside postgres.withTransaction; one row lock serializes each account tree. */
export function createFileLibraryRepository(queryable) {
  return {
    async list(userId) {
      assertUuid(userId, 'user-id');
      const result = await queryable.query('SELECT catalog FROM file_libraries WHERE user_id = $1', [userId]);
      return result.rows[0]?.catalog ?? [];
    },
    async mutate(userId, work) {
      assertUuid(userId, 'user-id');
      await queryable.query('INSERT INTO file_libraries(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
      const current = await queryable.query('SELECT catalog FROM file_libraries WHERE user_id = $1 FOR UPDATE', [userId]);
      const entries = structuredClone(current.rows[0]?.catalog ?? []);
      const result = await work(entries);
      await queryable.query('UPDATE file_libraries SET catalog = $2::JSONB, revision = revision + 1, updated_at = NOW() WHERE user_id = $1', [userId, JSON.stringify(entries)]);
      return result;
    },
    async pendingBefore(iso) {
      const result = await queryable.query(`SELECT user_id, catalog FROM file_libraries WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(catalog) entry WHERE entry->>'phase' IN ('pending', 'cleaning', 'purging') AND entry->>'createdAt' < $1
      ) LIMIT 50`, [iso]);
      return result.rows.map((row) => ({ userId: row.user_id, entries: row.catalog.filter((entry) => ['pending', 'cleaning', 'purging'].includes(entry.phase) && entry.createdAt < iso) }));
    },
  };
}

export function postgresFileLibraryStore(postgres) {
  return { list: (owner) => postgres.fileLibrary.list(owner), mutate: (owner, work) => postgres.withTransaction((tx) => tx.fileLibrary.mutate(owner, work)), pendingBefore: (iso) => postgres.fileLibrary.pendingBefore(iso) };
}
