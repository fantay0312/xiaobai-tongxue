import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { jsonValue, mapRow, validDate } from './repository-utils.mjs';
import { createSubscriptionAssignmentRepository } from './subscription-assignments.mjs';
const STATUSES = new Set(['trialing', 'active', 'past_due', 'cancelled', 'expired', 'revoked']);
const SOURCES = new Set(['admin', 'cdk', 'payment', 'system']);
const GRANT_SOURCES = new Set(['admin', 'cdk', 'system']);
const STATUS_TRANSITIONS = new Map([
  ['trialing', new Set(['trialing', 'active', 'cancelled', 'expired', 'revoked'])],
  ['active', new Set(['active', 'past_due', 'cancelled', 'expired', 'revoked'])],
  ['past_due', new Set(['past_due', 'active', 'cancelled', 'expired', 'revoked'])],
  ['cancelled', new Set(['cancelled'])],
  ['expired', new Set(['expired'])],
  ['revoked', new Set(['revoked'])],
]);

function pageValues(page, pageSize) {
  const selectedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const selectedSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
    ? pageSize : 20;
  return { page: selectedPage, pageSize: selectedSize, offset: (selectedPage - 1) * selectedSize };
}

function entitlementEnabled(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return value !== '';
  return value !== null && value !== undefined;
}

function validTypedValue(type, value) {
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'string') return typeof value === 'string';
  return type === 'json' && value !== undefined;
}

async function effectiveEntitlements(queryable, userId) {
  const result = await queryable.query(`
    SELECT e.entitlement_key, e.name, e.value_type, e.value,
           s.ends_at AS expires_at, s.starts_at, s.id AS source_id, 1 AS priority
    FROM user_subscription_entitlements e
    JOIN user_subscriptions s ON s.id = e.subscription_id
    WHERE s.user_id = $1 AND s.status IN ('trialing', 'active')
      AND s.starts_at <= NOW() AND (s.ends_at IS NULL OR s.ends_at > NOW())
    UNION ALL
    SELECT g.entitlement_key, g.name, g.value_type, g.value,
           g.expires_at, g.starts_at, g.id AS source_id, 2 AS priority
    FROM user_entitlement_grants g
    WHERE g.user_id = $1 AND g.revoked_at IS NULL
      AND g.starts_at <= NOW() AND (g.expires_at IS NULL OR g.expires_at > NOW())
    ORDER BY priority, starts_at, source_id
  `, [userId]);
  const values = new Map();
  for (const row of result.rows) values.set(row.entitlement_key, mapRow(row));
  return [...values.values()];
}

export function createSubscriptionRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    ...createSubscriptionAssignmentRepository(queryable, { uuid }),
    async create(input) {
      const userId = assertUuid(input.userId, 'user-id');
      const planId = assertUuid(input.planId, 'plan-id');
      const actorId = input.assignedBy ? assertUuid(input.assignedBy, 'actor-id') : null;
      const plan = await queryable.query(`
        SELECT p.*, v.name, v.tagline, v.description, v.version_number
        FROM subscription_plans p
        JOIN subscription_plan_versions v ON v.id = p.current_version_id
        WHERE p.id = $1 AND p.status = 'active' AND v.status = 'published'
        FOR SHARE
      `, [planId]);
      if (!plan.rows[0]) throw new Error('active-plan-not-found');
      let price = null;
      if (input.priceId) {
        const selected = await queryable.query(`
          SELECT * FROM subscription_prices
          WHERE id = $1 AND plan_version_id = $2 AND status = 'active'
        `, [assertUuid(input.priceId, 'price-id'), plan.rows[0].current_version_id]);
        if (!selected.rows[0]) throw new Error('price-not-found');
        price = selected.rows[0];
      }
      const startsAt = input.startsAt ? validDate(input.startsAt, 'subscription-start') : new Date();
      if (startsAt.getTime() > Date.now() + 1_000) {
        throw new Error('future-subscription-not-supported');
      }
      const lockedUser = await queryable.query(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!lockedUser.rows[0]) throw new Error('user-not-found');
      let endsAt = input.endsAt ? validDate(input.endsAt, 'subscription-end') : null;
      if (!endsAt && price?.duration_days) {
        endsAt = new Date(startsAt.getTime() + Number(price.duration_days) * 86_400_000);
      }
      if (endsAt && endsAt <= startsAt) throw new Error('invalid-subscription-end');
      const status = input.status ?? 'active';
      if (!STATUSES.has(status)) throw new Error('invalid-subscription-status');
      const source = input.source ?? 'admin';
      if (!SOURCES.has(source)) throw new Error('invalid-subscription-source');
      const entitlementRows = await queryable.query(`
        SELECT d.entitlement_key, d.name, d.value_type, e.value
        FROM plan_entitlements e
        JOIN entitlement_definitions d ON d.id = e.entitlement_id
        WHERE e.plan_version_id = $1
        ORDER BY d.entitlement_key
      `, [plan.rows[0].current_version_id]);
      const snapshot = {
        planCode: plan.rows[0].code,
        planName: plan.rows[0].name,
        tagline: plan.rows[0].tagline,
        description: plan.rows[0].description,
        versionNumber: plan.rows[0].version_number,
        price: price ? {
          id: price.id,
          billingPeriod: price.billing_period,
          currency: price.currency,
          amountMinor: String(price.amount_minor),
          durationDays: price.duration_days,
          bonusPoints: String(price.bonus_points),
        } : null,
        entitlements: entitlementRows.rows.map((row) => ({
          key: row.entitlement_key,
          name: row.name,
          valueType: row.value_type,
          value: row.value,
        })),
      };
      await queryable.query(`
        UPDATE user_subscriptions
        SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND status IN ('trialing', 'active')
      `, [userId]);
      const id = uuid();
      const result = await queryable.query(`
        INSERT INTO user_subscriptions (
          id, user_id, plan_id, plan_version_id, price_id,
          status, source, starts_at, ends_at, snapshot, assigned_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::JSONB, $11)
        RETURNING *
      `, [
        id,
        userId,
        planId,
        plan.rows[0].current_version_id,
        price?.id ?? null,
        status,
        source,
        startsAt,
        endsAt,
        jsonValue(snapshot, 'subscription-snapshot'),
        actorId,
      ]);
      for (const row of entitlementRows.rows) {
        await queryable.query(`
          INSERT INTO user_subscription_entitlements (
            subscription_id, entitlement_key, name, value_type, value
          )
          VALUES ($1, $2, $3, $4, $5::JSONB)
        `, [id, row.entitlement_key, row.name, row.value_type, jsonValue(row.value, 'value')]);
      }
      return {
        subscription: mapRow(result.rows[0]),
        snapshot,
        bonusPoints: price ? String(price.bonus_points) : '0',
      };
    },
    async update(rawId, input) {
      const id = assertUuid(rawId, 'subscription-id');
      if (!STATUSES.has(input.status)) throw new Error('invalid-subscription-status');
      const current = await queryable.query(
        'SELECT * FROM user_subscriptions WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!current.rows[0]) throw new Error('subscription-not-found');
      if (!STATUS_TRANSITIONS.get(current.rows[0].status)?.has(input.status)) {
        throw new Error('invalid-subscription-transition');
      }
      const endsAt = input.endsAt ? validDate(input.endsAt, 'subscription-end') : null;
      if (endsAt && endsAt <= new Date(current.rows[0].starts_at)) {
        throw new Error('invalid-subscription-end');
      }
      const result = await queryable.query(`
        UPDATE user_subscriptions
        SET status = $2, ends_at = COALESCE($3, ends_at),
            revoked_at = CASE WHEN $2 = 'revoked' THEN COALESCE(revoked_at, NOW()) ELSE revoked_at END,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, input.status, endsAt]);
      return mapRow(result.rows[0]);
    },

    async list({ page, pageSize, userId = null }) {
      const selected = pageValues(page, pageSize);
      const user = userId ? assertUuid(userId, 'user-id') : null;
      const [rows, count] = await Promise.all([
        queryable.query(`
          SELECT s.*, u.username, v.name AS plan_name, p.code AS plan_code
          FROM user_subscriptions s
          JOIN users u ON u.id = s.user_id
          JOIN subscription_plans p ON p.id = s.plan_id
          JOIN subscription_plan_versions v ON v.id = s.plan_version_id
          WHERE ($1::UUID IS NULL OR s.user_id = $1)
          ORDER BY s.created_at DESC
          LIMIT $2 OFFSET $3
        `, [user, selected.pageSize, selected.offset]),
        queryable.query(
          'SELECT COUNT(*)::INTEGER AS total FROM user_subscriptions WHERE ($1::UUID IS NULL OR user_id = $1)',
          [user],
        ),
      ]);
      return {
        items: rows.rows.map(mapRow),
        total: count.rows[0].total,
        page: selected.page,
        pageSize: selected.pageSize,
      };
    },

    async activeForUser(rawUserId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const result = await queryable.query(`
        SELECT s.*, v.name AS plan_name, p.code AS plan_code
        FROM user_subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        JOIN subscription_plan_versions v ON v.id = s.plan_version_id
        WHERE s.user_id = $1 AND s.status IN ('trialing', 'active')
          AND s.starts_at <= NOW() AND (s.ends_at IS NULL OR s.ends_at > NOW())
        ORDER BY s.starts_at DESC LIMIT 1
      `, [userId]);
      return mapRow(result.rows[0]);
    },

    async effectiveEntitlements(rawUserId) {
      const userId = assertUuid(rawUserId, 'user-id');
      return effectiveEntitlements(queryable, userId);
    },
    async effectiveFeatures(rawUserId, providedEntitlements = null) {
      const userId = assertUuid(rawUserId, 'user-id');
      const entitlements = Array.isArray(providedEntitlements)
        ? providedEntitlements : await effectiveEntitlements(queryable, userId);
      const byKey = new Map(entitlements.map((item) => [item.entitlementKey, item.value]));
      const features = await queryable.query(`
        SELECT f.*, d.entitlement_key AS required_entitlement_key
        FROM commerce_features f
        LEFT JOIN entitlement_definitions d ON d.id = f.required_entitlement_id
        ORDER BY f.feature_key
      `);
      return features.rows.map((row) => {
        const required = row.required_entitlement_key;
        const allowed = row.enabled && (!required || entitlementEnabled(byKey.get(required)));
        return {
          key: row.feature_key,
          name: row.name,
          enabled: allowed,
          reason: allowed
            ? ''
            : row.public_reason || (row.enabled ? 'entitlement-required' : 'disabled'),
        };
      });
    },

    async grantEntitlement(input) {
      const key = typeof input.key === 'string' ? input.key.trim().toLowerCase() : '';
      const definition = await queryable.query(`
        SELECT * FROM entitlement_definitions
        WHERE entitlement_key = $1 AND status = 'active'
      `, [key]);
      if (!definition.rows[0]) throw new Error('unknown-entitlement');
      if (!validTypedValue(definition.rows[0].value_type, input.value)) {
        throw new Error('invalid-entitlement-value');
      }
      if (!GRANT_SOURCES.has(input.source)) throw new Error('invalid-entitlement-source');
      const expiresAt = input.expiresAt ? validDate(input.expiresAt, 'grant-expiry') : null;
      if (expiresAt && expiresAt <= new Date()) throw new Error('invalid-grant-expiry');
      const result = await queryable.query(`
        INSERT INTO user_entitlement_grants (
          id, user_id, entitlement_key, name, value_type, value,
          source, source_reference, starts_at, expires_at, granted_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7, $8, NOW(), $9, $10)
        RETURNING *
      `, [
        uuid(),
        assertUuid(input.userId, 'user-id'),
        definition.rows[0].entitlement_key,
        definition.rows[0].name,
        definition.rows[0].value_type,
        jsonValue(input.value, 'grant-value'),
        input.source,
        input.sourceReference ?? null,
        expiresAt,
        input.grantedBy ? assertUuid(input.grantedBy, 'actor-id') : null,
      ]);
      return mapRow(result.rows[0]);
    },
  });
}
