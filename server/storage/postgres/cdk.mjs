import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { jsonValue, mapRow, requireText, validDate } from './repository-utils.mjs';
import { freezeRewardRequest } from '../../commerce/cdk-rewards.mjs';
import { createCdkCreationOperationRepository } from './cdk-creation-operations.mjs';
function pageValues(page, pageSize) {
  const selectedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const selectedSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
    ? pageSize : 20;
  return { page: selectedPage, pageSize: selectedSize, offset: (selectedPage - 1) * selectedSize };
}
function mapCampaign(row) {
  const campaign = mapRow(row);
  if (!campaign) return null;
  const snapshot = campaign.rewards;
  return {
    ...campaign,
    rewards: snapshot?.schemaVersion === 1 && Array.isArray(snapshot.items)
      ? snapshot.items : [],
  };
}
async function loadPlan(queryable, rawPlanId) {
  const planId = assertUuid(rawPlanId, 'cdk-plan-id');
  const plan = await queryable.query(`
    SELECT p.id AS plan_id, p.code, v.id AS plan_version_id, v.version_number,
           v.name, v.tagline, v.description
    FROM subscription_plans p
    JOIN subscription_plan_versions v ON v.id = p.current_version_id
    WHERE p.id = $1 AND p.status = 'active' AND v.status = 'published'
    FOR SHARE OF p, v
  `, [planId]);
  if (!plan.rows[0]) return null;
  const entitlements = await queryable.query(`
    SELECT d.entitlement_key, d.name, d.value_type, d.status, e.value
    FROM plan_entitlements e
    JOIN entitlement_definitions d ON d.id = e.entitlement_id
    WHERE e.plan_version_id = $1
    ORDER BY d.entitlement_key
  `, [plan.rows[0].plan_version_id]);
  return {
    planVersionId: plan.rows[0].plan_version_id,
    snapshot: {
      planCode: plan.rows[0].code,
      planName: plan.rows[0].name,
      tagline: plan.rows[0].tagline,
      description: plan.rows[0].description,
      versionNumber: plan.rows[0].version_number,
      price: null,
      entitlements: entitlements.rows.map((entry) => ({
        key: entry.entitlement_key,
        name: entry.name,
        valueType: entry.value_type,
        value: entry.value,
        status: entry.status,
      })),
    },
  };
}

async function loadEntitlement(queryable, key) {
  const result = await queryable.query(`
    SELECT entitlement_key, name, value_type
    FROM entitlement_definitions
    WHERE entitlement_key = $1 AND status = 'active'
    FOR SHARE
  `, [key]);
  const definition = result.rows[0];
  return definition ? {
    key: definition.entitlement_key,
    name: definition.name,
    valueType: definition.value_type,
  } : null;
}
export function createCdkRepository(queryable, { uuid = stableUuid } = {}) {
  const creationOperations = createCdkCreationOperationRepository(queryable, { uuid });
  return Object.freeze({
    ...creationOperations,
    async createCampaign(input) {
      const id = uuid();
      const count = input.codes.length;
      if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
        throw new Error('invalid-cdk-quantity');
      }
      const rewards = await freezeRewardRequest(input.rewards, {
        loadPlan: (planId) => loadPlan(queryable, planId),
        loadEntitlement: (key) => loadEntitlement(queryable, key),
      });
      const result = await queryable.query(`
        INSERT INTO cdk_campaigns (
          id, name, key_version, rewards, code_count, expires_at, created_by
        )
        VALUES ($1, $2, $3, $4::JSONB, $5, $6, $7)
        RETURNING *
      `, [
        id,
        requireText(input.name, 'cdk-campaign-name', 160),
        input.keyVersion,
        jsonValue(rewards, 'cdk-rewards'),
        count,
        input.expiresAt ? validDate(input.expiresAt, 'cdk-expiry') : null,
        assertUuid(input.createdBy, 'actor-id'),
      ]);
      for (const code of input.codes) {
        await queryable.query(`
          INSERT INTO cdk_codes (
            id, campaign_id, key_version, code_hash, code_hint
          )
          VALUES ($1, $2, $3, $4, $5)
        `, [uuid(), id, input.keyVersion, code.hash, code.hint]);
      }
      return mapCampaign(result.rows[0]);
    },
    async createFrozenSubscription(input) {
      const userId = assertUuid(input.userId, 'user-id');
      const planId = assertUuid(input.reward?.planId, 'cdk-plan-id');
      const planVersionId = assertUuid(input.reward?.planVersionId, 'cdk-plan-version-id');
      const startsAt = validDate(input.startsAt, 'subscription-start');
      const endsAt = validDate(input.endsAt, 'subscription-end');
      if (startsAt.getTime() > Date.now() + 1_000 || endsAt <= startsAt) {
        throw new Error('invalid-subscription-time');
      }
      const version = await queryable.query(`
        SELECT id FROM subscription_plan_versions
        WHERE id = $1 AND plan_id = $2 AND status = 'published'
        FOR SHARE
      `, [planVersionId, planId]);
      if (!version.rows[0]) throw new Error('cdk-frozen-plan-version-unavailable');
      const lockedUser = await queryable.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!lockedUser.rows[0]) throw new Error('user-not-found');
      await queryable.query(`
        UPDATE user_subscriptions
        SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND status IN ('trialing', 'active')
      `, [userId]);
      const id = uuid();
      const result = await queryable.query(`
        INSERT INTO user_subscriptions (
          id, user_id, plan_id, plan_version_id, status, source,
          starts_at, ends_at, snapshot
        )
        VALUES ($1, $2, $3, $4, 'active', 'cdk', $5, $6, $7::JSONB)
        RETURNING *
      `, [
        id, userId, planId, planVersionId, startsAt, endsAt,
        jsonValue(input.reward.snapshot, 'cdk-subscription-snapshot'),
      ]);
      for (const entry of input.reward.snapshot.entitlements) {
        await queryable.query(`
          INSERT INTO user_subscription_entitlements (
            subscription_id, entitlement_key, name, value_type, value
          )
          VALUES ($1, $2, $3, $4, $5::JSONB)
        `, [id, entry.key, entry.name, entry.valueType, jsonValue(entry.value, 'value')]);
      }
      return mapRow(result.rows[0]);
    },

    async grantFrozenEntitlement(input) {
      const reward = input.reward;
      const expiresAt = reward.expiresAt
        ? validDate(reward.expiresAt, 'grant-expiry') : null;
      if (expiresAt && expiresAt <= new Date()) throw new Error('invalid-grant-expiry');
      const result = await queryable.query(`
        INSERT INTO user_entitlement_grants (
          id, user_id, entitlement_key, name, value_type, value,
          source, source_reference, starts_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::JSONB, 'cdk', $7, NOW(), $8)
        RETURNING *
      `, [
        uuid(),
        assertUuid(input.userId, 'user-id'),
        requireText(reward.key, 'entitlement-key', 100),
        requireText(reward.name, 'entitlement-name', 120),
        reward.valueType,
        jsonValue(reward.value, 'grant-value'),
        assertUuid(input.sourceReference, 'cdk-code-id'),
        expiresAt,
      ]);
      return mapRow(result.rows[0]);
    },

    async listCampaigns({ page, pageSize }) {
      const selected = pageValues(page, pageSize);
      const [rows, count] = await Promise.all([
        queryable.query(`
          SELECT c.*,
            COUNT(k.id)::INTEGER AS generated_count,
            COUNT(k.id) FILTER (WHERE k.status = 'redeemed')::INTEGER AS redeemed_count,
            COUNT(k.id) FILTER (WHERE k.status = 'active')::INTEGER AS active_count
          FROM cdk_campaigns c
          LEFT JOIN cdk_codes k ON k.campaign_id = c.id
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT $1 OFFSET $2
        `, [selected.pageSize, selected.offset]),
        queryable.query('SELECT COUNT(*)::INTEGER AS total FROM cdk_campaigns'),
      ]);
      return {
        items: rows.rows.map(mapCampaign),
        total: count.rows[0].total,
        page: selected.page,
        pageSize: selected.pageSize,
      };
    },

    async revokeCampaign(rawId, actorId) {
      const id = assertUuid(rawId, 'cdk-campaign-id');
      const actor = assertUuid(actorId, 'actor-id');
      const result = await queryable.query(`
        UPDATE cdk_campaigns
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), revoked_by = $2
        WHERE id = $1 AND status = 'active'
        RETURNING *
      `, [id, actor]);
      if (!result.rows[0]) throw new Error('cdk-campaign-not-active');
      await queryable.query(`
        UPDATE cdk_codes SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW())
        WHERE campaign_id = $1 AND status = 'active'
      `, [id]);
      return mapCampaign(result.rows[0]);
    },

    async lockCode(candidateHashes) {
      if (!Array.isArray(candidateHashes) || candidateHashes.length === 0) {
        throw new Error('invalid-cdk-candidates');
      }
      const result = await queryable.query(`
        SELECT k.*, c.status AS campaign_status, c.rewards, c.expires_at AS campaign_expires_at
        FROM cdk_codes k
        JOIN cdk_campaigns c ON c.id = k.campaign_id
        WHERE k.code_hash = ANY($1::TEXT[])
        FOR UPDATE OF k, c
      `, [candidateHashes]);
      return mapRow(result.rows[0]);
    },

    async findRedemptionByCode(rawCodeId) {
      const codeId = assertUuid(rawCodeId, 'cdk-code-id');
      const result = await queryable.query(`
        SELECT id, code_id, campaign_id, user_id, rewards_snapshot,
               point_operation_id, subscription_id, redeemed_at
        FROM cdk_redemptions
        WHERE code_id = $1
      `, [codeId]);
      return mapRow(result.rows[0]);
    },

    async completeRedemption(input) {
      const codeId = assertUuid(input.codeId, 'cdk-code-id');
      const campaignId = assertUuid(input.campaignId, 'cdk-campaign-id');
      const userId = assertUuid(input.userId, 'user-id');
      const updated = await queryable.query(`
        UPDATE cdk_codes
        SET status = 'redeemed', redeemed_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING *
      `, [codeId]);
      if (!updated.rows[0]) throw new Error('cdk-already-used');
      const result = await queryable.query(`
        INSERT INTO cdk_redemptions (
          id, code_id, campaign_id, user_id, rewards_snapshot,
          point_operation_id, subscription_id
        )
        SELECT $1, $2, $3, $4, c.rewards, $5, $6
        FROM cdk_codes k
        JOIN cdk_campaigns c ON c.id = k.campaign_id
        WHERE k.id = $2 AND c.id = $3
        RETURNING *
      `, [
        uuid(),
        codeId,
        campaignId,
        userId,
        input.pointOperationId ? assertUuid(input.pointOperationId, 'point-operation-id') : null,
        input.subscriptionId ? assertUuid(input.subscriptionId, 'subscription-id') : null,
      ]);
      if (!result.rows[0]) throw new Error('cdk-redemption-campaign-mismatch');
      return mapRow(result.rows[0]);
    },

    async completeCampaignIfExhausted(rawCampaignId) {
      const campaignId = assertUuid(rawCampaignId, 'cdk-campaign-id');
      const result = await queryable.query(`
        UPDATE cdk_campaigns c
        SET status = 'completed'
        WHERE c.id = $1 AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM cdk_codes k
            WHERE k.campaign_id = c.id AND k.status = 'active'
          )
        RETURNING *
      `, [campaignId]);
      return mapRow(result.rows[0]);
    },
  });
}
