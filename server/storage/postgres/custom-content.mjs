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

function assetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    assetRole: row.asset_role,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    cosKey: row.cos_key,
    wkKnowledgeId: row.wk_knowledge_id,
    parseStatus: row.parse_status,
    enableStatus: row.enable_status,
    errorMessage: row.error_message,
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
    async create({ ownerId, title, wkDocKbId, wkFaqKbId }) {
      const id = uuid();
      assertUuid(ownerId);
      assertUuid(id);
      const result = await queryable.query(
        `INSERT INTO custom_courses
           (id, owner_id, title, wk_doc_kb_id, wk_faq_kb_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, ownerId, title, wkDocKbId, wkFaqKbId ?? null],
      );
      return courseRow(result.rows[0]);
    },

    async listByOwner(ownerId) {
      assertUuid(ownerId);
      const result = await queryable.query(
        `SELECT c.*,
                COUNT(DISTINCT a.id)::int AS asset_count,
                COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'ready')::int AS topic_count
           FROM custom_courses c
           LEFT JOIN custom_assets a ON a.course_id = c.id
           LEFT JOIN custom_topics t ON t.course_id = c.id
          WHERE c.owner_id = $1
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
        'SELECT * FROM custom_courses WHERE id = $1 AND owner_id = $2',
        [courseId, ownerId],
      );
      return courseRow(result.rows[0]);
    },

    async findById(courseId) {
      assertUuid(courseId);
      const result = await queryable.query('SELECT * FROM custom_courses WHERE id = $1', [courseId]);
      return courseRow(result.rows[0]);
    },
  });

  const assets = Object.freeze({
    async create(input) {
      const id = uuid();
      assertUuid(id);
      assertUuid(input.courseId);
      const result = await queryable.query(
        `INSERT INTO custom_assets
           (id, course_id, asset_role, filename, content_type, byte_size, sha256,
            cos_key, wk_knowledge_id, parse_status, enable_status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          id, input.courseId, input.assetRole, input.filename, input.contentType,
          input.byteSize, input.sha256, input.cosKey, input.wkKnowledgeId, input.parseStatus,
          input.enableStatus ?? 'disabled', input.errorMessage ?? null,
        ],
      );
      return assetRow(result.rows[0]);
    },

    async listOwned(ownerId, courseId) {
      assertUuid(ownerId);
      assertUuid(courseId);
      const result = await queryable.query(
        `SELECT a.*
           FROM custom_assets a
           JOIN custom_courses c ON c.id = a.course_id
          WHERE a.course_id = $1 AND c.owner_id = $2
          ORDER BY a.created_at DESC`,
        [courseId, ownerId],
      );
      return result.rows.map(assetRow);
    },

    async findOwned(ownerId, assetId) {
      assertUuid(ownerId);
      assertUuid(assetId);
      const result = await queryable.query(
        `SELECT a.*
           FROM custom_assets a
           JOIN custom_courses c ON c.id = a.course_id
          WHERE a.id = $1 AND c.owner_id = $2`,
        [assetId, ownerId],
      );
      return assetRow(result.rows[0]);
    },

    async findManyOwned(ownerId, courseId, assetIds) {
      assertUuid(ownerId);
      assertUuid(courseId);
      for (const id of assetIds) assertUuid(id);
      const result = await queryable.query(
        `SELECT a.*
           FROM custom_assets a
           JOIN custom_courses c ON c.id = a.course_id
          WHERE a.course_id = $1 AND c.owner_id = $2 AND a.id = ANY($3::uuid[])
          ORDER BY a.created_at`,
        [courseId, ownerId, assetIds],
      );
      return result.rows.map(assetRow);
    },

    async findManyByCourse(courseId, assetIds) {
      assertUuid(courseId);
      for (const id of assetIds) assertUuid(id);
      const result = await queryable.query(
        `SELECT * FROM custom_assets
          WHERE course_id = $1 AND id = ANY($2::uuid[])
          ORDER BY created_at`,
        [courseId, assetIds],
      );
      return result.rows.map(assetRow);
    },

    async updateStatus(id, { parseStatus, enableStatus, errorMessage }) {
      assertUuid(id);
      const result = await queryable.query(
        `UPDATE custom_assets
            SET parse_status = $2,
                enable_status = $3,
                error_message = $4,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, parseStatus, enableStatus ?? 'disabled', errorMessage ?? null],
      );
      return assetRow(result.rows[0]);
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
             JOIN custom_courses c ON c.id = a.course_id
            WHERE a.id = $1
              AND c.owner_id = $2
              AND a.parse_status <> 'deleting'
            FOR UPDATE OF a`,
          [id, ownerId],
        );
        if (!locked.rows[0]) return null;
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
                WHERE j.course_id = $3
                  AND j.status IN ('queued', 'running', 'needs_review')
                  AND $1 = ANY(j.asset_ids)
             )
           ) AS referenced`,
          [id, source, locked.rows[0].course_id],
        );
        if (referenced.rows[0]?.referenced === true) return null;
        const result = await client.query(
          `UPDATE custom_assets
              SET parse_status = 'deleting',
                  enable_status = 'disabled',
                  error_message = NULL,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [id],
        );
        return assetRow(result.rows[0]);
      });
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
              WHERE j.course_id = custom_assets.course_id
                AND j.status IN ('queued', 'running', 'needs_review')
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

    async publish(id) {
      assertUuid(id);
      const result = await queryable.query(
        `WITH published AS (
           UPDATE custom_topics
              SET status = 'ready', published_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'draft'
            RETURNING *
         ), completed_job AS (
           UPDATE custom_compile_jobs
              SET status = 'done', error_code = NULL, updated_at = NOW()
            WHERE topic_id = $1
              AND status = 'needs_review'
              AND EXISTS (SELECT 1 FROM published)
         )
         SELECT * FROM published`,
        [id],
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
        const selected = await client.query(
          `SELECT id
             FROM custom_assets
            WHERE course_id = $1
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
      topicId,
      courseId,
      payload,
      qualityIssues,
      promptVersion,
    }) {
      const id = uuid();
      assertUuid(id);
      assertUuid(jobId);
      assertUuid(courseId);
      const result = await queryable.query(
        `WITH attached_topic AS (
           INSERT INTO custom_topics
             (id, topic_id, course_id, status, payload, quality_issues, prompt_version)
           VALUES ($2, $3, $4, 'draft', $5::jsonb, $6::jsonb, $7)
           ON CONFLICT (topic_id) DO UPDATE
             SET topic_id = EXCLUDED.topic_id
             WHERE custom_topics.course_id = EXCLUDED.course_id
           RETURNING *
         ), attached_job AS (
           UPDATE custom_compile_jobs j
              SET status = 'needs_review',
                  topic_id = t.id,
                  error_code = NULL,
                  updated_at = NOW()
             FROM attached_topic t
            WHERE j.id = $1
              AND j.course_id = $4
              AND j.status IN ('queued', 'running')
            RETURNING j.*
         )
         SELECT row_to_json(t) AS topic, row_to_json(j) AS job
           FROM attached_topic t
           JOIN attached_job j ON j.topic_id = t.id`,
        [
          jobId, id, topicId, courseId, JSON.stringify(payload),
          JSON.stringify(qualityIssues), promptVersion,
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

    async listResumable() {
      const result = await queryable.query(
        `SELECT * FROM custom_compile_jobs
          WHERE status IN ('queued', 'running')
          ORDER BY created_at`,
      );
      return result.rows.map(jobRow);
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

    async transitionActive(id, { status, topicId = null, errorCode = null }) {
      assertUuid(id);
      if (topicId) assertUuid(topicId);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET status = $2, topic_id = COALESCE($3, topic_id), error_code = $4, updated_at = NOW()
          WHERE id = $1
            AND status IN ('queued', 'running')
          RETURNING *`,
        [id, status, topicId, errorCode],
      );
      return jobRow(result.rows[0]);
    },

    async markDoneForTopic(topicId) {
      assertUuid(topicId);
      const result = await queryable.query(
        `UPDATE custom_compile_jobs
            SET status = 'done', error_code = NULL, updated_at = NOW()
          WHERE topic_id = $1 AND status = 'needs_review'
          RETURNING *`,
        [topicId],
      );
      return jobRow(result.rows[0]);
    },
  });

  return Object.freeze({ courses, assets, topics, jobs });
}
