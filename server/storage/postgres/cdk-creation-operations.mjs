import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { mapRow, requireText } from './repository-utils.mjs';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;

function identity(input) {
  const key = requireText(input.idempotencyKey, 'idempotency-key', 160);
  if (!KEY_PATTERN.test(key)) throw new Error('invalid-idempotency-key');
  if (typeof input.requestHash !== 'string' || !HASH_PATTERN.test(input.requestHash)) {
    throw new Error('invalid-request-hash');
  }
  return {
    actorId: assertUuid(input.actorId, 'actor-id'),
    key,
    hash: input.requestHash,
  };
}

function encrypted(value, label, length = null) {
  if (!Buffer.isBuffer(value) || value.length < 1
      || (length !== null && value.length !== length)) {
    throw new Error(`invalid-${label}`);
  }
  return value;
}

function replay(row, expected) {
  if (!row) return { replayed: false };
  const operation = mapRow(row);
  if (operation.createdBy !== expected.actorId
      || operation.requestHash !== expected.hash) {
    throw new Error('idempotency-conflict');
  }
  if (!operation.completedAt || !operation.campaignId || !operation.exportExpiresAt) {
    throw new Error('idempotency-incomplete');
  }
  return { replayed: true, ...operation };
}

export function createCdkCreationOperationRepository(
  queryable,
  { uuid = stableUuid } = {},
) {
  return Object.freeze({
    async lockCampaignCreation(input) {
      const expected = identity(input);
      await queryable.query(`
        SELECT pg_advisory_xact_lock(
          hashtextextended('cdk-campaign-create:' || $1::TEXT || ':' || $2, 0)
        )
      `, [expected.actorId, expected.key]);
      const result = await queryable.query(`
        SELECT * FROM cdk_campaign_creation_operations
        WHERE created_by = $1 AND idempotency_key = $2
        FOR UPDATE
      `, [expected.actorId, expected.key]);
      return replay(result.rows[0], expected);
    },

    async reserveCampaignCreation(input) {
      const expected = identity(input);
      await queryable.query(`
        INSERT INTO cdk_campaign_creation_operations (
          id, created_by, idempotency_key, request_hash
        )
        VALUES ($1, $2, $3, $4)
      `, [uuid(), expected.actorId, expected.key, expected.hash]);
    },

    async completeCampaignCreation(input) {
      const expected = identity(input);
      const result = await queryable.query(`
        UPDATE cdk_campaign_creation_operations
        SET campaign_id = $4,
            export_nonce = $5,
            export_tag = $6,
            export_ciphertext = $7,
            export_expires_at = NOW() + INTERVAL '15 minutes',
            completed_at = NOW()
        WHERE created_by = $1 AND idempotency_key = $2
          AND request_hash = $3 AND completed_at IS NULL
        RETURNING *
      `, [
        expected.actorId,
        expected.key,
        expected.hash,
        assertUuid(input.campaignId, 'cdk-campaign-id'),
        encrypted(input.nonce, 'cdk-export-nonce', 12),
        encrypted(input.tag, 'cdk-export-tag', 16),
        encrypted(input.ciphertext, 'cdk-export-ciphertext'),
      ]);
      if (!result.rows[0]) throw new Error('idempotency-conflict');
      return mapRow(result.rows[0]);
    },

    async expireCampaignCreation(input) {
      const expected = identity(input);
      const result = await queryable.query(`
        UPDATE cdk_campaign_creation_operations
        SET export_nonce = NULL, export_tag = NULL, export_ciphertext = NULL
        WHERE created_by = $1 AND idempotency_key = $2
          AND request_hash = $3 AND completed_at IS NOT NULL
          AND export_expires_at <= NOW() AND export_ciphertext IS NOT NULL
        RETURNING id
      `, [expected.actorId, expected.key, expected.hash]);
      return Boolean(result.rows[0]);
    },

    async clearExpiredCampaignExports() {
      const result = await queryable.query(`
        WITH expired AS (
          SELECT id FROM cdk_campaign_creation_operations
          WHERE export_expires_at <= NOW() AND export_ciphertext IS NOT NULL
          ORDER BY export_expires_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        )
        UPDATE cdk_campaign_creation_operations o
        SET export_nonce = NULL, export_tag = NULL, export_ciphertext = NULL
        FROM expired
        WHERE o.id = expired.id
        RETURNING o.id
      `);
      return result.rows.length;
    },
  });
}
