import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { jsonValue, mapRow, requireText } from './repository-utils.mjs';

const FILE_PURPOSES = new Set(['transcript', 'email_attachment']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function expectedRevision(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid-revision');
  return parsed;
}

export function createLearningStateRepository(queryable) {
  return Object.freeze({
    async put({ userId: rawUserId, key, state, expectedRevision: expected }) {
      const userId = assertUuid(rawUserId, 'user-id');
      const stateKey = requireText(key, 'state-key', 120);
      const revision = expectedRevision(expected);
      const result = await queryable.query(`
        INSERT INTO learning_states (user_id, state_key, state, revision)
        VALUES ($1, $2, $3::JSONB, 1)
        ON CONFLICT (user_id, state_key) DO UPDATE SET
          state = EXCLUDED.state,
          revision = learning_states.revision + 1,
          updated_at = NOW()
        WHERE $4::BIGINT IS NULL OR learning_states.revision = $4
        RETURNING *
      `, [userId, stateKey, jsonValue(state, 'learning-state'), revision]);
      if (!result.rows[0]) throw new Error('learning-state-conflict');
      return mapRow(result.rows[0]);
    },

    async get(rawUserId, key) {
      const userId = assertUuid(rawUserId, 'user-id');
      const stateKey = requireText(key, 'state-key', 120);
      const result = await queryable.query(
        'SELECT * FROM learning_states WHERE user_id = $1 AND state_key = $2',
        [userId, stateKey],
      );
      return mapRow(result.rows[0]);
    },

    async list(rawUserId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const result = await queryable.query(
        'SELECT * FROM learning_states WHERE user_id = $1 ORDER BY state_key',
        [userId],
      );
      return result.rows.map(mapRow);
    },
  });
}

export function createUserFileRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async create(input) {
      const id = assertUuid(input.id ?? uuid(), 'file-id');
      const userId = assertUuid(input.userId, 'user-id');
      const inboundEmailId = input.inboundEmailId
        ? assertUuid(input.inboundEmailId, 'inbound-email-id')
        : null;
      if (!FILE_PURPOSES.has(input.purpose)) throw new Error('invalid-file-purpose');
      const cosKey = requireText(input.cosKey, 'cos-key', 1_024);
      const originalName = requireText(input.originalName, 'original-name', 512);
      const contentType = requireText(input.contentType, 'content-type', 255);
      if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
        throw new Error('invalid-byte-size');
      }
      if (typeof input.sha256 !== 'string' || !SHA256_PATTERN.test(input.sha256)) {
        throw new Error('invalid-sha256');
      }
      const result = await queryable.query(`
        INSERT INTO user_files (
          id, user_id, inbound_email_id, purpose, cos_key,
          original_name, content_type, byte_size, sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        id,
        userId,
        inboundEmailId,
        input.purpose,
        cosKey,
        originalName,
        contentType,
        input.byteSize,
        input.sha256.toLowerCase(),
      ]);
      return mapRow(result.rows[0]);
    },

    async findById(rawUserId, rawFileId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const fileId = assertUuid(rawFileId, 'file-id');
      const result = await queryable.query(`
        SELECT * FROM user_files
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      `, [fileId, userId]);
      return mapRow(result.rows[0]);
    },

    async list(rawUserId, purpose = null) {
      const userId = assertUuid(rawUserId, 'user-id');
      if (purpose !== null && !FILE_PURPOSES.has(purpose)) throw new Error('invalid-file-purpose');
      const result = await queryable.query(`
        SELECT * FROM user_files
        WHERE user_id = $1 AND deleted_at IS NULL
          AND ($2::VARCHAR IS NULL OR purpose = $2)
        ORDER BY created_at DESC
      `, [userId, purpose]);
      return result.rows.map(mapRow);
    },

    async markDeleted(rawUserId, rawFileId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const fileId = assertUuid(rawFileId, 'file-id');
      const result = await queryable.query(`
        UPDATE user_files SET deleted_at = COALESCE(deleted_at, NOW())
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `, [fileId, userId]);
      return mapRow(result.rows[0]);
    },
  });
}
