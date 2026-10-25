import { assertUuid } from '../contact-crypto.mjs';
import { randomUUID } from 'node:crypto';

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function courseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    wkDocKbId: row.wk_doc_kb_id,
    wkFaqKbId: row.wk_faq_kb_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function courseIntentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    wkDocKbId: row.wk_doc_kb_id,
    wkFaqKbId: row.wk_faq_kb_id,
    createdAt: iso(row.created_at),
  };
}

function assetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.context_course_id ?? row.course_id,
    ownerId: row.owner_id,
    wkKbId: row.wk_kb_id,
    libraryFileId: row.library_file_id ?? null,
    assetRole: row.context_asset_role ?? row.asset_role,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    cosKey: row.cos_key,
    wkKnowledgeId: row.wk_knowledge_id,
    parseStatus: row.parse_status,
    enableStatus: row.enable_status,
    errorMessage: row.error_message,
    reparseToken: row.reparse_token ?? null,
    reparseStartedAt: iso(row.reparse_started_at),
    statusRevision: Number(row.status_revision ?? 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function topicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.topic_id,
    courseId: row.course_id,
    status: row.status,
    payload: row.payload,
    qualityIssues: Array.isArray(row.quality_issues) ? row.quality_issues : [],
    promptVersion: row.prompt_version,
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function jobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    topicId: row.topic_id,
    assetIds: Array.isArray(row.asset_ids) ? row.asset_ids : [],
    requestedTitle: row.requested_title,
    status: row.status,
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function uploadIntentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    ownerId: row.owner_id,
    cosKey: row.cos_key,
    wkKnowledgeId: row.wk_knowledge_id,
    wkDocKbId: row.wk_doc_kb_id ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function createCustomContentRepository(queryable, { uuid = randomUUID } = {}) {
  if (!queryable?.query) throw new Error('postgres-queryable-required');

  async function withTransaction(work) {
    // PoolClient 由外层事务持有并带 release()；Pool 才在此开短事务。
    if (typeof queryable.connect !== 'function' || typeof queryable.release === 'function') {
      return work(queryable);
    }
    const client = await queryable.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  const courses = Object.freeze({
    async createCreationIntent({ ownerId, title, wkDocKbId, wkFaqKbId }) {
      const id = uuid();
      assertUuid(id);
      assertUuid(ownerId);
      assertUuid(wkDocKbId);
      assertUuid(wkFaqKbId);
      const result = await queryable.query(
        `INSERT INTO custom_course_create_intents
           (id, owner_id, title, wk_doc_kb_id, wk_faq_kb_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, ownerId, title, wkDocKbId, wkFaqKbId],
      );
      return courseIntentRow(result.rows[0]);
    },

    async finalizeCreationIntent(ownerId, intentId) {
      const courseId = uuid();
      assertUuid(courseId);
      assertUuid(ownerId);
      assertUuid(intentId);
      return withTransaction(async (client) => {
        const locked = await client.query(
          `SELECT * FROM custom_course_create_intents
            WHERE id = $1 AND owner_id = $2
            FOR UPDATE`,
          [intentId, ownerId],
        );
        const intent = locked.rows[0];
        if (!intent || intent.cleanup_started_at) return null;
        const result = await client.query(
          `INSERT INTO custom_courses
             (id, owner_id, title, wk_doc_kb_id, wk_faq_kb_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [courseId, ownerId, intent.title, intent.wk_doc_kb_id, intent.wk_faq_kb_id],
        );
        await client.query('DELETE FROM custom_course_create_intents WHERE id = $1', [intentId]);
        return courseRow(result.rows[0]);
      });
    },

    async removeCreationIntent(ownerId, intentId) {
      assertUuid(ownerId);
      assertUuid(intentId);
      const result = await queryable.query(
        'DELETE FROM custom_course_create_intents WHERE id = $1 AND owner_id = $2',
        [intentId, ownerId],
      );
      return result.rowCount > 0;
    },

    async claimStaleCreationIntents() {
      const result = await queryable.query(
        `WITH candidates AS (
           SELECT id
             FROM custom_course_create_intents
            WHERE created_at <= NOW() - INTERVAL '10 minutes'
              AND (cleanup_started_at IS NULL OR cleanup_started_at <= NOW() - INTERVAL '30 minutes')
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 100
         )
         UPDATE custom_course_create_intents i
            SET cleanup_started_at = NOW()
           FROM candidates c
          WHERE i.id = c.id
          RETURNING i.*`,
      );
      return result.rows.map(courseIntentRow);
    },

    async listByOwner(ownerId) {
      assertUuid(ownerId);
      const result = await queryable.query(
        `SELECT c.*,
                COUNT(DISTINCT a.id)::int AS asset_count,
                COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'ready')::int AS topic_count
           FROM custom_courses c
           LEFT JOIN custom_course_assets ca ON ca.course_id = c.id
           LEFT JOIN custom_assets a ON a.id = ca.asset_id
           LEFT JOIN custom_topics t ON t.course_id = c.id
          WHERE c.owner_id = $1 AND c.archived_at IS NULL
          GROUP BY c.id
          ORDER BY c.created_at DESC`,
        [ownerId],
      );
      return result.rows.map((row) => ({
        ...courseRow(row),
        assetCount: Number(row.asset_count),
        topicCount: Number(row.topic_count),
      }));
    },

    async findOwned(ownerId, courseId) {
      assertUuid(ownerId);
      assertUuid(courseId);
      const result = await queryable.query(
        'SELECT * FROM custom_courses WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL',
        [courseId, ownerId],
      );
      return courseRow(result.rows[0]);
    },

    async manageOwned(ownerId, courseId, title = null) {
      assertUuid(ownerId);
      assertUuid(courseId);
      return withTransaction(async (client) => {
        const owned = await client.query('SELECT * FROM custom_courses WHERE id=$1 AND owner_id=$2 AND archived_at IS NULL FOR UPDATE', [courseId, ownerId]);
        if (!owned.rows[0]) return null;
        const active = await client.query("SELECT id FROM custom_compile_jobs WHERE course_id=$1 AND status IN ('queued','running','needs_review') LIMIT 1", [courseId]);
        if (active.rows.length) { const error = new Error('compile-job-active'); error.status = 409; throw error; }
        const result = title === null
          ? await client.query('UPDATE custom_courses SET archived_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *', [courseId])
          : await client.query('UPDATE custom_courses SET title=$2,updated_at=NOW() WHERE id=$1 RETURNING *', [courseId, title]);
        if (title === null) await client.query("UPDATE custom_topics SET status='archived',updated_at=NOW() WHERE course_id=$1", [courseId]);
        else await client.query("UPDATE custom_topics SET payload=jsonb_set(payload,'{course}',to_jsonb($2::text)),updated_at=NOW() WHERE course_id=$1", [courseId, title]);
        return courseRow(result.rows[0]);
      });
    },

    async findById(courseId) {
      assertUuid(courseId);
      const result = await queryable.query('SELECT * FROM custom_courses WHERE id = $1', [courseId]);
      return courseRow(result.rows[0]);
    },

    async findOwnedByKnowledgeBaseIds(ownerId, wkDocKbId, wkFaqKbId) {
      assertUuid(ownerId);
      assertUuid(wkDocKbId);
      assertUuid(wkFaqKbId);
      const result = await queryable.query(
        `SELECT * FROM custom_courses
          WHERE owner_id = $1 AND wk_doc_kb_id = $2 AND wk_faq_kb_id = $3`,
        [ownerId, wkDocKbId, wkFaqKbId],
      );
      return courseRow(result.rows[0]);
    },
  });

  const assets = Object.freeze({
    async createUploadIntent({ ownerId, courseId, cosKey }) {
      const id = uuid();
      assertUuid(id);
      assertUuid(ownerId);
      assertUuid(courseId);
      const result = await queryable.query(
        `INSERT INTO custom_asset_upload_intents (id, course_id, owner_id, cos_key)
         SELECT $1, c.id, c.owner_id, $4
           FROM custom_courses c
          WHERE c.id = $2 AND c.owner_id = $3
         RETURNING *`,
        [id, courseId, ownerId, cosKey],
      );
      return uploadIntentRow(result.rows[0]);
    },

    async setUploadIntentKnowledge(ownerId, id, wkKnowledgeId) {
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        `UPDATE custom_asset_upload_intents
            SET wk_knowledge_id = $3, updated_at = NOW()
          WHERE id = $1 AND owner_id = $2 AND cleanup_started_at IS NULL
          RETURNING *`,
        [id, ownerId, wkKnowledgeId],
      );
      return uploadIntentRow(result.rows[0]);
    },

    async removeUploadIntent(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        'DELETE FROM custom_asset_upload_intents WHERE id = $1 AND owner_id = $2',
        [id, ownerId],
      );
      return result.rowCount > 0;
    },

    async claimStaleUploadIntents() {
      const result = await queryable.query(
        `WITH candidates AS (
           SELECT id
             FROM custom_asset_upload_intents
            WHERE created_at <= NOW() - INTERVAL '10 minutes'
              AND (cleanup_started_at IS NULL OR cleanup_started_at <= NOW() - INTERVAL '30 minutes')
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 100
         ), claimed AS (
           UPDATE custom_asset_upload_intents i
              SET cleanup_started_at = NOW(), updated_at = NOW()
             FROM candidates c
            WHERE i.id = c.id
            RETURNING i.*
         )
         SELECT i.*, c.wk_doc_kb_id
           FROM claimed i
           JOIN custom_courses c ON c.id = i.course_id`,
      );
      return result.rows.map(uploadIntentRow);
    },

    async finalizeUploadIntent(ownerId, intentId, input) {
      const id = uuid();
      assertUuid(id);
      assertUuid(ownerId);
      assertUuid(intentId);
      return withTransaction(async (client) => {
        const locked = await client.query(
          `SELECT * FROM custom_asset_upload_intents
            WHERE id = $1 AND owner_id = $2
            FOR UPDATE`,
          [intentId, ownerId],
        );
        const intent = locked.rows[0];
        if (!intent || intent.cleanup_started_at
          || intent.course_id !== input.courseId || intent.wk_knowledge_id !== input.wkKnowledgeId) return null;
        const result = await client.query(
          `INSERT INTO custom_assets
             (id, course_id, asset_role, filename, content_type, byte_size, sha256,
              cos_key, wk_knowledge_id, parse_status, enable_status, error_message, owner_id, wk_kb_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, (SELECT wk_doc_kb_id FROM custom_courses WHERE id = $2))
           RETURNING *`,
          [
            id, input.courseId, input.assetRole, input.filename, input.contentType,
            input.byteSize, input.sha256, intent.cos_key, input.wkKnowledgeId, input.parseStatus,
            input.enableStatus ?? 'disabled', input.errorMessage ?? null, ownerId,
          ],
        );
        await client.query('INSERT INTO custom_course_assets(course_id,asset_id,asset_role) VALUES($1,$2,$3)', [input.courseId,id,input.assetRole]);
        await client.query('DELETE FROM custom_asset_upload_intents WHERE id = $1', [intentId]);
        return assetRow(result.rows[0]);
      });
    },

    async create(input) {
      const id = uuid(); assertUuid(id);
      if (input.courseId) assertUuid(input.courseId);
      return withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO custom_assets (id,course_id,asset_role,filename,content_type,byte_size,sha256,cos_key,wk_knowledge_id,parse_status,enable_status,error_message,owner_id,wk_kb_id,library_file_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::uuid,(SELECT owner_id FROM custom_courses WHERE id=$2)),COALESCE($14,(SELECT wk_doc_kb_id FROM custom_courses WHERE id=$2)),$15) RETURNING *`,
          [id,input.courseId ?? null,input.assetRole,input.filename,input.contentType,input.byteSize,input.sha256,input.cosKey,input.wkKnowledgeId,input.parseStatus,input.enableStatus ?? 'disabled',input.errorMessage ?? null,input.ownerId ?? null,input.wkKbId ?? null,input.libraryFileId ?? null]);
        if (input.courseId) await client.query('INSERT INTO custom_course_assets(course_id,asset_id,asset_role) VALUES($1,$2,$3)',[input.courseId,id,input.assetRole]);
        return assetRow(result.rows[0]);
      });
    },
    async ensureLibrarySpace(ownerId) {
      assertUuid(ownerId);
      await queryable.query('INSERT INTO library_parse_spaces(owner_id,wk_kb_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ownerId,uuid()]);
      const result = await queryable.query('SELECT * FROM library_parse_spaces WHERE owner_id=$1',[ownerId]);
      return { id: result.rows[0].wk_kb_id, ready: result.rows[0].ready };
    },
    async readyLibrarySpace(ownerId) { await queryable.query('UPDATE library_parse_spaces SET ready=TRUE WHERE owner_id=$1',[ownerId]); },
    async getLibrarySpace(ownerId) {
      const result = await queryable.query('SELECT * FROM library_parse_spaces WHERE owner_id=$1',[ownerId]);
      return result.rows[0] ? { id: result.rows[0].wk_kb_id, ready: result.rows[0].ready } : null;
    },
    async findLibraryFile(ownerId, fileId) {
      const result = await queryable.query(`SELECT a.* FROM custom_assets a WHERE a.owner_id=$1 AND (
        a.library_file_id=$2 OR EXISTS (SELECT 1 FROM file_libraries l, jsonb_array_elements(l.catalog) e
          WHERE l.user_id=$1 AND e->>'id'=$2::text AND (e->'parse'->>'assetId'=a.id::text OR e->>'sourceAssetId'=a.id::text))
        ) ORDER BY (a.library_file_id=$2) DESC NULLS LAST LIMIT 1`,[ownerId,fileId]);
      return assetRow(result.rows[0]);
    },
    async reuseLibraryFile(ownerId, fileId, token) {
      assertUuid(ownerId); assertUuid(fileId); assertUuid(token);
      return withTransaction(async (client) => {
        const catalog = await client.query('SELECT catalog FROM file_libraries WHERE user_id=$1 FOR UPDATE',[ownerId]);
        const entries = catalog.rows[0]?.catalog ?? [];
        const entry = entries.find((item) => item.id === fileId);
        if (!entry || entry.kind !== 'file' || entry.deletedAt || entry.phase !== 'ready'
          || entry.parse?.token !== token || !entry.sha256) return null;
        const result = await client.query(`SELECT * FROM custom_assets WHERE owner_id=$1 AND sha256=$2 AND byte_size=$3
          AND parse_status IN ('pending','processing','finalizing','completed')
          AND LOWER(substring(filename from '\\.[^.]+$'))=LOWER(substring($4::text from '\\.[^.]+$'))
          ORDER BY (parse_status='completed') DESC, created_at LIMIT 1 FOR UPDATE`,[ownerId,entry.sha256,entry.byteSize,entry.name]);
        const asset = assetRow(result.rows[0]);
        if (!asset) return null;
        entry.parse = { assetId:asset.id, status:asset.parseStatus, error:asset.errorMessage, updatedAt:new Date().toISOString() };
        await client.query('UPDATE file_libraries SET catalog=$2::jsonb, revision=revision+1, updated_at=NOW() WHERE user_id=$1',[ownerId,JSON.stringify(entries)]);
        return asset;
      });
    },
    async adoptLibraryFile(ownerId, assetId, fileId) {
      const result = await queryable.query(`UPDATE custom_assets SET library_file_id=$3 WHERE owner_id=$1 AND id=$2 AND parse_status<>'deleting' AND (library_file_id IS NULL OR library_file_id=$3) RETURNING *`,[ownerId,assetId,fileId]);
      return assetRow(result.rows[0]);
    },
    async attach(ownerId, courseId, assetId, assetRole) {
      return withTransaction(async (client) => {
        const owned = await client.query(`SELECT a.id FROM custom_assets a JOIN custom_courses c ON c.id=$2 WHERE a.id=$3 AND a.owner_id=$1 AND c.owner_id=$1 AND a.parse_status<>'deleting' FOR UPDATE OF a`,[ownerId,courseId,assetId]);
        if (!owned.rows.length) return null;
        await client.query(`INSERT INTO custom_course_assets(course_id,asset_id,asset_role) VALUES($1,$2,$3) ON CONFLICT(course_id,asset_id) DO UPDATE SET asset_role=EXCLUDED.asset_role`,[courseId,assetId,assetRole]);
        return true;
      });
    },
    async detach(ownerId, courseId, assetId) {
      return withTransaction(async (client) => {
        const owned = await client.query(`SELECT a.id FROM custom_assets a JOIN custom_courses c ON c.id=$2 WHERE a.id=$3 AND a.owner_id=$1 AND c.owner_id=$1 FOR UPDATE OF a`,[ownerId,courseId,assetId]);
        if (!owned.rows.length) return false;
        const references = await client.query(`SELECT EXISTS(SELECT 1 FROM custom_topics WHERE course_id=$1 AND status IN ('draft','ready') AND COALESCE(payload->'sources','[]'::jsonb) @> $3::jsonb) OR EXISTS(SELECT 1 FROM custom_compile_jobs WHERE course_id=$1 AND status IN ('queued','running','needs_review') AND $2=ANY(asset_ids)) AS used`,[courseId,assetId,JSON.stringify([{assetId}])]);
        if (references.rows[0].used) return false;
        await client.query('DELETE FROM custom_course_assets WHERE course_id=$1 AND asset_id=$2',[courseId,assetId]); return true;
      });
    },
    async listBindings(ownerId, assetId) {
      const result = await queryable.query(`SELECT ca.course_id FROM custom_course_assets ca JOIN custom_assets a ON a.id=ca.asset_id WHERE a.owner_id=$1 AND a.id=$2`,[ownerId,assetId]);
      return result.rows.map((row) => row.course_id);
    },
    async listOwned(ownerId, courseId) {
      assertUuid(ownerId); assertUuid(courseId);
      const result = await queryable.query(`SELECT a.*,ca.course_id AS context_course_id,ca.asset_role AS context_asset_role FROM custom_assets a JOIN custom_course_assets ca ON ca.asset_id=a.id JOIN custom_courses c ON c.id=ca.course_id WHERE ca.course_id=$1 AND a.owner_id=$2 AND c.owner_id=$2 ORDER BY a.created_at DESC`,[courseId,ownerId]);
      return result.rows.map(assetRow);
    },
    async findOwned(ownerId, assetId) {
      assertUuid(ownerId); assertUuid(assetId);
      const result = await queryable.query('SELECT * FROM custom_assets WHERE id=$1 AND owner_id=$2',[assetId,ownerId]);
      return assetRow(result.rows[0]);
    },
    async findOwnedByStorageRefs(ownerId, cosKey, wkKnowledgeId) {
      assertUuid(ownerId);
      const result = await queryable.query('SELECT * FROM custom_assets WHERE owner_id=$1 AND cos_key=$2 AND wk_knowledge_id=$3',[ownerId,cosKey,wkKnowledgeId]);
      return assetRow(result.rows[0]);
    },
    async findManyOwned(ownerId, courseId, assetIds) {
      assertUuid(ownerId); assertUuid(courseId); for (const id of assetIds) assertUuid(id);
      const result = await queryable.query(`SELECT a.*,ca.course_id AS context_course_id,ca.asset_role AS context_asset_role FROM custom_assets a JOIN custom_course_assets ca ON ca.asset_id=a.id JOIN custom_courses c ON c.id=ca.course_id WHERE ca.course_id=$1 AND a.owner_id=$2 AND c.owner_id=$2 AND a.id=ANY($3::uuid[]) ORDER BY a.created_at`,[courseId,ownerId,assetIds]);
      return result.rows.map(assetRow);
    },
    async findManyByCourse(courseId, assetIds) {
      assertUuid(courseId); for (const id of assetIds) assertUuid(id);
      const result = await queryable.query(`SELECT a.*,ca.course_id AS context_course_id,ca.asset_role AS context_asset_role FROM custom_assets a JOIN custom_course_assets ca ON ca.asset_id=a.id JOIN custom_courses c ON c.id=ca.course_id WHERE ca.course_id=$1 AND a.owner_id=c.owner_id AND a.id=ANY($2::uuid[]) ORDER BY a.created_at`,[courseId,assetIds]);
      return result.rows.map(assetRow);
    },

    async updateStatus(id, { parseStatus, enableStatus, errorMessage }, {
      expectedStatusRevision,
      expectedReparseToken = null,
    } = {}) {
      assertUuid(id);
      if (!Number.isSafeInteger(expectedStatusRevision) || expectedStatusRevision < 0) {
        throw new Error('asset-status-guard-required');
      }
      if (expectedReparseToken !== null) assertUuid(expectedReparseToken);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET parse_status = $2,
                enable_status = $3,
                error_message = $4,
                status_revision = status_revision + 1,
                updated_at = NOW()
          WHERE id = $1
            AND parse_status <> 'deleting'
            AND status_revision = $5
            AND reparse_token IS NOT DISTINCT FROM $6::uuid
          RETURNING *`,
        [
          id,
          parseStatus,
          enableStatus ?? 'disabled',
          errorMessage ?? null,
          expectedStatusRevision,
          expectedReparseToken,
        ],
      );
      return assetRow(result.rows[0]);
    },

    async markDeleteFailed(id, errorMessage) {
      assertUuid(id);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET parse_status = 'failed',
                enable_status = 'disabled',
                error_message = $2,
                status_revision = status_revision + 1,
                updated_at = NOW()
          WHERE id = $1 AND parse_status = 'deleting'
          RETURNING *`,
        [id, String(errorMessage ?? '').slice(0, 2_000) || '资料删除未完成，可再次删除重试'],
      );
      return assetRow(result.rows[0]);
    },

    async claimStaleDeletingAssets() {
      const result = await queryable.query(
        `WITH candidates AS (
           SELECT id
             FROM custom_assets
            WHERE parse_status = 'deleting'
              AND updated_at <= NOW() - INTERVAL '2 minutes'
            ORDER BY updated_at
            FOR UPDATE SKIP LOCKED
            LIMIT 25
         ), claimed AS (
           UPDATE custom_assets a
              SET updated_at = NOW()
             FROM candidates c
            WHERE a.id = c.id
            RETURNING a.*
         )
         SELECT a.* FROM claimed a`,
      );
      return result.rows.map((row) => ({ ...assetRow(row), ownerId: row.owner_id }));
    },

    async remove(id) {
      assertUuid(id);
      const result = await queryable.query('DELETE FROM custom_assets WHERE id = $1', [id]);
      return result.rowCount > 0;
    },

    async claimDelete(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const source = JSON.stringify([{ assetId: id }]);
      return withTransaction(async (client) => {
        const locked = await client.query(
          `SELECT a.*
             FROM custom_assets a
             WHERE a.id = $1
              AND a.owner_id = $2
            FOR UPDATE OF a`,
          [id, ownerId],
        );
        if (!locked.rows[0]
          || !['completed', 'failed', 'cancelled'].includes(locked.rows[0].parse_status)) return null;
        const referenced = await client.query(
          `SELECT (
             EXISTS (
               SELECT 1
                 FROM custom_topics t
                WHERE t.status IN ('draft', 'ready')
                  AND COALESCE(t.payload->'sources', '[]'::jsonb) @> $2::jsonb
             ) OR EXISTS (
               SELECT 1
                 FROM custom_compile_jobs j
                WHERE j.status IN ('queued', 'running', 'needs_review')
                  AND $1 = ANY(j.asset_ids)
             )
           ) OR EXISTS (SELECT 1 FROM custom_course_assets ca JOIN custom_assets a ON a.id=ca.asset_id WHERE ca.asset_id=$1 AND a.library_file_id IS NOT NULL)
             OR EXISTS (SELECT 1 FROM file_libraries l, jsonb_array_elements(l.catalog) e
               WHERE l.user_id=$3 AND (e->'parse'->>'assetId'=$1::text OR e->>'sourceAssetId'=$1::text)
                 AND COALESCE(e->>'phase','ready') NOT IN ('purging','removed')) AS referenced`,
          [id, source, ownerId],
        );
        if (referenced.rows[0]?.referenced === true) return null;
        const result = await client.query(
          `UPDATE custom_assets
              SET parse_status = 'deleting',
                  enable_status = 'disabled',
                  error_message = NULL,
                  status_revision = status_revision + 1,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [id],
        );
        return assetRow(result.rows[0]);
      });
    },

    async claimReparse(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const reparseToken = uuid();
      assertUuid(reparseToken);
      const source = JSON.stringify([{ assetId: id }]);
      return withTransaction(async (client) => {
        const locked = await client.query(
          `SELECT a.*
             FROM custom_assets a
             WHERE a.id = $1
              AND a.owner_id = $2
            FOR UPDATE OF a`,
          [id, ownerId],
        );
        if (!locked.rows[0]
          || !['completed', 'failed', 'cancelled'].includes(locked.rows[0].parse_status)) return null;
        const referenced = await client.query(
          `SELECT (
             EXISTS (
               SELECT 1
                 FROM custom_topics t
                WHERE t.status IN ('draft', 'ready')
                  AND COALESCE(t.payload->'sources', '[]'::jsonb) @> $2::jsonb
             ) OR EXISTS (
               SELECT 1
                 FROM custom_compile_jobs j
                WHERE j.status IN ('queued', 'running', 'needs_review')
                  AND $1 = ANY(j.asset_ids)
             )
           ) AS referenced`,
          [id, source],
        );
        if (referenced.rows[0]?.referenced === true) return null;
        const result = await client.query(
          `UPDATE custom_assets
              SET parse_status = 'pending',
                  enable_status = 'disabled',
                  error_message = NULL,
                  reparse_token = $2,
                  reparse_started_at = NOW(),
                  status_revision = status_revision + 1,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [id, reparseToken],
        );
        return assetRow(result.rows[0]);
      });
    },

    async acknowledgeReparse(id, reparseToken) {
      assertUuid(id);
      assertUuid(reparseToken);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET reparse_token = NULL,
                reparse_started_at = NULL,
                status_revision = status_revision + 1,
                updated_at = NOW()
          WHERE id = $1
            AND parse_status = 'pending'
            AND reparse_token = $2
          RETURNING *`,
        [id, reparseToken],
      );
      return assetRow(result.rows[0]);
    },

    async failReparse(id, reparseToken, errorMessage) {
      assertUuid(id);
      assertUuid(reparseToken);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET parse_status = 'failed',
                enable_status = 'disabled',
                error_message = $3,
                reparse_token = NULL,
                reparse_started_at = NULL,
                status_revision = status_revision + 1,
                updated_at = NOW()
          WHERE id = $1 AND reparse_token = $2
          RETURNING *`,
        [id, reparseToken, String(errorMessage ?? '').slice(0, 2_000)],
      );
      return assetRow(result.rows[0]);
    },

    async finishReparseStatus(id, reparseToken, { parseStatus, enableStatus, errorMessage }) {
      assertUuid(id);
      assertUuid(reparseToken);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET parse_status = $3,
                enable_status = $4,
                error_message = $5,
                reparse_token = NULL,
                reparse_started_at = NULL,
                status_revision = status_revision + 1,
                updated_at = NOW()
          WHERE id = $1 AND reparse_token = $2
          RETURNING *`,
        [id, reparseToken, parseStatus, enableStatus ?? 'disabled', errorMessage ?? null],
      );
      return assetRow(result.rows[0]);
    },

    async isReferenced(id) {
      assertUuid(id);
      const source = JSON.stringify([{ assetId: id }]);
      const result = await queryable.query(
        `SELECT (
           EXISTS (
             SELECT 1
               FROM custom_topics
              WHERE status IN ('draft', 'ready')
                AND COALESCE(payload->'sources', '[]'::jsonb) @> $2::jsonb
           ) OR EXISTS (
             SELECT 1
               FROM custom_compile_jobs j
              WHERE j.status IN ('queued', 'running', 'needs_review')
                AND custom_assets.id = ANY(j.asset_ids)
           )
         ) AS referenced
         FROM custom_assets
         WHERE id = $1`,
        [id, source],
      );
      return result.rows[0]?.referenced === true;
    },
  });

  const topics = Object.freeze({
    async findOwned(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        `SELECT t.*
           FROM custom_topics t
           JOIN custom_courses c ON c.id = t.course_id
          WHERE t.id = $1 AND c.owner_id = $2`,
        [id, ownerId],
      );
      return topicRow(result.rows[0]);
    },

    async findReadyOwnedByTopicId(ownerId, topicId) {
      assertUuid(ownerId);
      const result = await queryable.query(
        `SELECT t.*
           FROM custom_topics t
           JOIN custom_courses c ON c.id = t.course_id
          WHERE t.topic_id = $1 AND t.status = 'ready' AND c.owner_id = $2`,
        [topicId, ownerId],
      );
      return topicRow(result.rows[0]);
    },

    async listReadyByOwner(ownerId) {
      assertUuid(ownerId);
      const result = await queryable.query(
        `SELECT t.*
           FROM custom_topics t
           JOIN custom_courses c ON c.id = t.course_id
          WHERE t.status = 'ready' AND c.owner_id = $1
          ORDER BY t.published_at DESC NULLS LAST, t.updated_at DESC`,
        [ownerId],
      );
      return result.rows.map(topicRow);
    },

    async listReadyByCourse(courseId) {
      assertUuid(courseId);
      const result = await queryable.query(
        `SELECT * FROM custom_topics
          WHERE course_id = $1 AND status = 'ready'
          ORDER BY published_at, created_at`,
        [courseId],
      );
      return result.rows.map(topicRow);
    },

    async updateDraft(id, payload, qualityIssues) {
      assertUuid(id);
      const result = await queryable.query(
        `UPDATE custom_topics
            SET payload = $2::jsonb,
                quality_issues = $3::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND status = 'draft'
          RETURNING *`,
        [id, JSON.stringify(payload), JSON.stringify(qualityIssues)],
      );
      return topicRow(result.rows[0]);
    },

    async discardDraft(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        `WITH archived AS (
           UPDATE custom_topics t
              SET status = 'archived', updated_at = NOW()
             FROM custom_courses c
            WHERE t.id = $1
              AND t.course_id = c.id
              AND c.owner_id = $2
              AND t.status = 'draft'
            RETURNING t.*
         ), closed_job AS (
           UPDATE custom_compile_jobs j
              SET status = 'failed',
                  error_code = 'teacher-discarded',
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  updated_at = NOW()
             FROM archived t
            WHERE j.topic_id = t.id
              AND j.status = 'needs_review'
            RETURNING j.id
         )
         SELECT a.*, (SELECT COUNT(*) FROM closed_job) AS closed_jobs
           FROM archived a`,
        [id, ownerId],
      );
      return topicRow(result.rows[0]);
    },

    async publishValidated(id, expectedPayload, verifiedPayload) {
      assertUuid(id);
      const result = await queryable.query(
        `WITH published AS (
           UPDATE custom_topics
              SET payload = $3::jsonb,
                  quality_issues = '[]'::jsonb,
                  status = 'ready',
                  published_at = NOW(),
                  updated_at = NOW()
            WHERE id = $1
              AND status = 'draft'
              AND payload = $2::jsonb
            RETURNING *
         ), completed_job AS (
           UPDATE custom_compile_jobs
              SET status = 'done',
                  error_code = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  updated_at = NOW()
            WHERE topic_id = $1
              AND status = 'needs_review'
              AND EXISTS (SELECT 1 FROM published)
         )
         SELECT * FROM published`,
        [id, JSON.stringify(expectedPayload), JSON.stringify(verifiedPayload)],
      );
      return topicRow(result.rows[0]);
    },
  });

  const jobs = Object.freeze({
    async create({ courseId, assetIds, requestedTitle }) {
      const id = uuid();
      assertUuid(id);
      assertUuid(courseId);
      for (const assetId of assetIds) assertUuid(assetId);
      return withTransaction(async (client) => {
        const course = await client.query('SELECT id FROM custom_courses WHERE id=$1 AND archived_at IS NULL FOR SHARE', [courseId]);
        if (!course.rows.length) return null;
        const selected = await client.query(
          `SELECT id
             FROM custom_assets
            WHERE EXISTS(SELECT 1 FROM custom_course_assets ca JOIN custom_courses c ON c.id=ca.course_id WHERE ca.course_id=$1 AND ca.asset_id=custom_assets.id AND c.owner_id=custom_assets.owner_id)
              AND id = ANY($2::uuid[])
              AND parse_status = 'completed'
            ORDER BY id
            FOR UPDATE`,
          [courseId, assetIds],
        );
        if (selected.rows.length !== assetIds.length) return null;
        const result = await client.query(
          `INSERT INTO custom_compile_jobs
             (id, course_id, asset_ids, requested_title, status)
           VALUES ($1, $2, $3::uuid[], $4, 'queued')
           RETURNING *`,
          [id, courseId, assetIds, requestedTitle ?? null],
        );
        return jobRow(result.rows[0]);
      });
    },

    async createDraftAndAttach({
      jobId,
      leaseToken,
      topicId,
      courseId,
      payload,
      qualityIssues,
      promptVersion,
    }) {
      const id = uuid();
      assertUuid(id);
      assertUuid(jobId);
      assertUuid(leaseToken);
      assertUuid(courseId);
      const result = await queryable.query(
        `WITH claimed_job AS MATERIALIZED (
           SELECT id, course_id
             FROM custom_compile_jobs
            WHERE id = $1
              AND course_id = $4
              AND status = 'running'
              AND lease_token = $8
            FOR UPDATE
         ), attached_topic AS (
           INSERT INTO custom_topics
             (id, topic_id, course_id, status, payload, quality_issues, prompt_version)
           SELECT $2, $3, $4, 'draft', $5::jsonb, $6::jsonb, $7
             FROM claimed_job
           ON CONFLICT (topic_id) DO UPDATE
             SET topic_id = EXCLUDED.topic_id
             WHERE custom_topics.course_id = EXCLUDED.course_id
           RETURNING *
         ), attached_job AS (
           UPDATE custom_compile_jobs j
              SET status = 'needs_review',
                  topic_id = t.id,
                  error_code = NULL,
                  lease_token = NULL,
                  lease_expires_at = NULL,
                  updated_at = NOW()
             FROM attached_topic t, claimed_job c
            WHERE c.id = j.id
              AND j.status = 'running'
              AND j.lease_token = $8
            RETURNING j.*
         )
         SELECT row_to_json(t) AS topic, row_to_json(j) AS job
           FROM attached_topic t
           JOIN attached_job j ON j.topic_id = t.id`,
        [
          jobId, id, topicId, courseId, JSON.stringify(payload),
          JSON.stringify(qualityIssues), promptVersion, leaseToken,
        ],
      );
      const row = result.rows[0];
      return row ? { topic: topicRow(row.topic), job: jobRow(row.job) } : null;
    },

    async findOwned(ownerId, id) {
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        `SELECT j.*
           FROM custom_compile_jobs j
           JOIN custom_courses c ON c.id = j.course_id
          WHERE j.id = $1 AND c.owner_id = $2`,
        [id, ownerId],
      );
      return jobRow(result.rows[0]);
    },

    async findById(id) {
      assertUuid(id);
      const result = await queryable.query('SELECT * FROM custom_compile_jobs WHERE id = $1', [id]);
      return jobRow(result.rows[0]);
    },

    async listClaimable() {
      const result = await queryable.query(
        `SELECT * FROM custom_compile_jobs
          WHERE status = 'queued'
             OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
          ORDER BY created_at`,
      );
      return result.rows.map(jobRow);
    },

    async claimForRun(id, leaseToken) {
      assertUuid(id);
      assertUuid(leaseToken);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET status = 'running',
                lease_token = $2,
                lease_expires_at = NOW() + INTERVAL '10 minutes',
                error_code = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND (
              status = 'queued'
              OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= NOW()))
            )
          RETURNING *`,
        [id, leaseToken],
      );
      return jobRow(result.rows[0]);
    },

    async renewLease(id, leaseToken) {
      assertUuid(id);
      assertUuid(leaseToken);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET lease_expires_at = NOW() + INTERVAL '10 minutes'
          WHERE id = $1 AND status = 'running' AND lease_token = $2
            AND lease_expires_at > NOW()
          RETURNING *`,
        [id, leaseToken],
      );
      return jobRow(result.rows[0]);
    },

    async findOpenByCourse(courseId) {
      assertUuid(courseId);
      const result = await queryable.query(
        `SELECT * FROM custom_compile_jobs
          WHERE course_id = $1 AND status IN ('queued', 'running', 'needs_review')
          ORDER BY created_at DESC
          LIMIT 1`,
        [courseId],
      );
      return jobRow(result.rows[0]);
    },

    async transitionClaimed(id, leaseToken, { status, topicId = null, errorCode = null }) {
      assertUuid(id);
      assertUuid(leaseToken);
      if (topicId) assertUuid(topicId);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET status = $3,
                topic_id = COALESCE($4, topic_id),
                error_code = $5,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'running'
            AND lease_token = $2
          RETURNING *`,
        [id, leaseToken, status, topicId, errorCode],
      );
      return jobRow(result.rows[0]);
    },

    async markDoneForTopic(topicId) {
      assertUuid(topicId);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET status = 'done',
                error_code = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE topic_id = $1 AND status = 'needs_review'
          RETURNING *`,
        [topicId],
      );
      return jobRow(result.rows[0]);
    },
  });

  return Object.freeze({ courses, assets, topics, jobs });
}
