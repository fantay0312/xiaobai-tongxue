const fail = () => Object.assign(new Error('云端版本已更新，本机修改已保留，请刷新后重试。'), { status: 409 });
export function createGlossRepository(db) {
  return {
    async list(owner, since = '1970-01-01') { return (await db.query('SELECT collection,id,article_id AS "articleId",data,deleted,revision FROM reader_gloss_entities WHERE owner_id=$1 AND updated_at >= $2 ORDER BY updated_at', [owner, since])).rows; },
    async put(owner, collection, row) {
      const revision = Number.isSafeInteger(row.revision) ? row.revision : 0;
      const result = await db.query(`WITH updated AS (UPDATE reader_gloss_entities SET data=$5::jsonb,doc=COALESCE($6::jsonb,doc),deleted=$7,revision=revision+1,updated_at=NOW()
        WHERE owner_id=$1 AND collection=$2 AND id=$3 AND revision=$8 RETURNING revision), inserted AS (
        INSERT INTO reader_gloss_entities(owner_id,collection,id,article_id,data,doc,deleted) SELECT $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7 WHERE $8=0
        ON CONFLICT DO NOTHING RETURNING revision) SELECT revision FROM updated UNION ALL SELECT revision FROM inserted`,
      [owner, collection, row.id, row.articleId, JSON.stringify(row.data), row.doc ? JSON.stringify(row.doc) : null, row.deleted === true, revision]);
      if (!result.rows.length) throw fail();
      return result.rows[0].revision;
    },
    async article(owner, id) { return (await db.query("SELECT doc FROM reader_gloss_entities WHERE owner_id=$1 AND collection='articles' AND id=$2 AND deleted=false", [owner, id])).rows[0]?.doc ?? null; },
    async cover(owner, id) { return (await db.query('SELECT image,content_type FROM reader_gloss_covers WHERE owner_id=$1 AND id=$2', [owner, id])).rows[0]; },
    async saveCover(owner, id, bytes, mime) { await db.query('INSERT INTO reader_gloss_covers(owner_id,id,image,content_type) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,id) DO UPDATE SET image=$3,content_type=$4', [owner, id, bytes, mime]); },
  };
}
