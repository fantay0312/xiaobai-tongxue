import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { jsonValue, mapRow, optionalText, requireText } from './repository-utils.mjs';

export const MANAGED_FEATURE_KEYS = Object.freeze([
  'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce',
]);
const MANAGED_FEATURE_SET = new Set(MANAGED_FEATURE_KEYS);

function featureKey(value) {
  const key = requireText(value, 'feature-key', 100).toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(key)) throw new Error('invalid-feature-key');
  if (!MANAGED_FEATURE_SET.has(key)) throw new Error('unknown-feature-key');
  return key;
}

export function createFeatureRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async list() {
      const result = await queryable.query(`
        SELECT f.*, d.entitlement_key AS required_entitlement_key
        FROM commerce_features f
        LEFT JOIN entitlement_definitions d ON d.id = f.required_entitlement_id
        ORDER BY f.feature_key
      `);
      return result.rows.map(mapRow);
    },

    async upsert(keyInput, input, actorId) {
      const key = featureKey(keyInput);
      const actor = assertUuid(actorId, 'actor-id');
      const requiredKey = input.requiredEntitlementKey
        ? requireText(input.requiredEntitlementKey, 'required-entitlement-key', 100).toLowerCase()
        : null;
      let entitlementId = null;
      if (requiredKey) {
        const definition = await queryable.query(
          'SELECT id FROM entitlement_definitions WHERE entitlement_key = $1 AND status = $2',
          [requiredKey, 'active'],
        );
        if (!definition.rows[0]) throw new Error('unknown-entitlement');
        entitlementId = definition.rows[0].id;
      }
      const expectedVersion = input.version == null ? null : Number(input.version);
      if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
        throw new Error('invalid-feature-version');
      }
      const result = await queryable.query(`
        INSERT INTO commerce_features (
          id, feature_key, name, description, enabled,
          required_entitlement_id, public_reason, config, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, $9)
        ON CONFLICT (feature_key) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          enabled = EXCLUDED.enabled,
          required_entitlement_id = EXCLUDED.required_entitlement_id,
          public_reason = EXCLUDED.public_reason,
          config = EXCLUDED.config,
          version = commerce_features.version + 1,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        WHERE $10::INTEGER IS NULL OR commerce_features.version = $10
        RETURNING *
      `, [
        uuid(),
        key,
        requireText(input.name, 'feature-name', 120),
        optionalText(input.description, 'feature-description', 2_000) ?? '',
        input.enabled === true,
        entitlementId,
        optionalText(input.publicReason, 'feature-public-reason', 500) ?? '',
        jsonValue(input.config ?? {}, 'feature-config'),
        actor,
        expectedVersion,
      ]);
      if (!result.rows[0]) throw new Error('feature-conflict');
      return mapRow(result.rows[0]);
    },
  });
}
