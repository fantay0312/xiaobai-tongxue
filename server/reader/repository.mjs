import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const fail = (message, status) => Object.assign(new Error(message), { status });
export function createReaderRepository(db) {
  return {
    async list(owner) {
      const { rows } = await db.query(`SELECT id, revision, payload - 'blocks' - 'marks' - 'threads' AS payload FROM reader_documents WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1000`, [owner]);
      return rows.map((row) => ({ ...row.payload, id: row.id, revision: row.revision }));
    },
    async get(owner, id) {
      const { rows } = await db.query('SELECT payload, revision FROM reader_documents WHERE owner_id=$1 AND id=$2', [owner, id]);
      return rows[0] ? { ...rows[0].payload, revision: rows[0].revision } : null;
    },
    async search(owner, query) {
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const { rows } = await db.query(`SELECT id, revision, payload - 'blocks' - 'marks' - 'threads' AS payload FROM reader_documents WHERE owner_id=$1 AND COALESCE((payload->>'deleted')::boolean,false)=false AND payload::text ILIKE $2 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 100`, [owner, pattern]);
      return rows.map((row) => ({ ...row.payload, id: row.id, revision: row.revision }));
    },
    async put(owner, doc, revision = 0) {
      // Compare-and-swap protects edits made on another device, including deletion tombstones.
      const { rows } = await db.query(`WITH updated AS (
        UPDATE reader_documents SET payload=$3::jsonb, revision=revision+1, updated_at=NOW()
        WHERE owner_id=$1 AND id=$2 AND revision=$4 RETURNING revision
      ), inserted AS (
        INSERT INTO reader_documents(owner_id,id,payload) SELECT $1,$2,$3::jsonb WHERE $4=0
        ON CONFLICT(owner_id,id) DO NOTHING RETURNING revision
      ) SELECT revision FROM updated UNION ALL SELECT revision FROM inserted`, [owner, doc.id, JSON.stringify(doc), revision]);
      if (!rows.length) throw fail('reader-conflict', 409);
      return rows[0].revision;
    },
    async tokens(owner) {
      return (await db.query('SELECT id,name,created_at,last_used_at FROM reader_agent_tokens WHERE owner_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC', [owner])).rows;
    },
    async tokenCreate(owner, name) {
      const token = `xbr_${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      await db.query('INSERT INTO reader_agent_tokens(id,owner_id,name,token_hash) VALUES($1,$2,$3,$4)', [id, owner, name, hashToken(token)]);
      return { id, token, name };
    },
    async tokenRevoke(owner, id) {
      await db.query('UPDATE reader_agent_tokens SET revoked_at=NOW() WHERE owner_id=$1 AND id=$2', [owner, id]);
    },
    async tokenIdentity(token) {
      if (!/^xbr_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const { rows } = await db.query('UPDATE reader_agent_tokens SET last_used_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING owner_id AS owner,name AS label', [hashToken(token)]);
      return rows[0] ?? null;
    },
    async tokenOwner(token) {
      if (!/^xbr_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const { rows } = await db.query('UPDATE reader_agent_tokens SET last_used_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING owner_id', [hashToken(token)]);
      return rows[0]?.owner_id ?? null;
    },
  };
}
