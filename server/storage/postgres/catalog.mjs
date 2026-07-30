import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { pgBigIntString } from '../../integer-bounds.mjs';
import { jsonValue, mapRow, optionalText, requireText } from './repository-utils.mjs';

const VALUE_TYPES = new Set(['boolean', 'integer', 'string', 'json']);
const PLAN_STATUSES = new Set(['draft', 'active', 'archived']);
const BILLING_PERIODS = new Set(['free', 'monthly', 'quarterly', 'yearly', 'lifetime', 'custom']);

function keyValue(value, label) {
  const key = requireText(value, label, 100).toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(key)) throw new Error(`invalid-${label}`);
  return key;
}

function typedValue(type, value) {
  if (!VALUE_TYPES.has(type)) throw new Error('invalid-entitlement-value-type');
  if (type === 'boolean' && typeof value !== 'boolean') throw new Error('invalid-entitlement-value');
  if (type === 'integer' && (!Number.isSafeInteger(value))) throw new Error('invalid-entitlement-value');
  if (type === 'string' && typeof value !== 'string') throw new Error('invalid-entitlement-value');
  if (value === undefined) throw new Error('invalid-entitlement-value');
  return value;
}

function integerString(value, label, { positive = false } = {}) {
  return pgBigIntString(value, label, { positive });
}

async function replaceVersionDetails(queryable, versionId, prices, entitlements, uuid) {
  if (!Array.isArray(prices) || prices.length > 50) throw new Error('invalid-plan-prices');
  for (const price of prices) {
    if (!BILLING_PERIODS.has(price.billingPeriod)) throw new Error('invalid-billing-period');
    const currency = requireText(price.currency, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('invalid-currency');
    const durationDays = price.durationDays == null ? null : Number(price.durationDays);
    if (durationDays !== null && (
      !Number.isSafeInteger(durationDays) || durationDays <= 0 || durationDays > 3650
    )) {
      throw new Error('invalid-duration-days');
    }
    await queryable.query(`
      INSERT INTO subscription_prices (
        id, plan_version_id, billing_period, currency,
        amount_minor, duration_days, bonus_points
      )
      VALUES ($1, $2, $3, $4, $5::BIGINT, $6, $7::BIGINT)
    `, [
      uuid(),
      versionId,
      price.billingPeriod,
      currency,
      integerString(price.amountMinor, 'amount-minor'),
      durationDays,
      integerString(price.bonusPoints ?? '0', 'bonus-points'),
    ]);
  }
  if (!Array.isArray(entitlements) || entitlements.length > 200) {
    throw new Error('invalid-plan-entitlements');
  }
  for (const item of entitlements) {
    const key = keyValue(item.key, 'entitlement-key');
    const definition = await queryable.query(
      'SELECT * FROM entitlement_definitions WHERE entitlement_key = $1 AND status = $2',
      [key, 'active'],
    );
    if (!definition.rows[0]) throw new Error(`unknown-entitlement:${key}`);
    typedValue(definition.rows[0].value_type, item.value);
    await queryable.query(`
      INSERT INTO plan_entitlements (plan_version_id, entitlement_id, value)
      VALUES ($1, $2, $3::JSONB)
    `, [versionId, definition.rows[0].id, jsonValue(item.value, 'entitlement-value')]);
  }
}

export function createCatalogRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async listEntitlements() {
      const result = await queryable.query(
        'SELECT * FROM entitlement_definitions ORDER BY entitlement_key',
      );
      return result.rows.map(mapRow);
    },

    async createEntitlement(input, actorId) {
      const type = input.valueType;
      const defaultValue = typedValue(type, input.defaultValue);
      const result = await queryable.query(`
        INSERT INTO entitlement_definitions (
          id, entitlement_key, name, description, value_type, default_value, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7)
        RETURNING *
      `, [
        uuid(),
        keyValue(input.key, 'entitlement-key'),
        requireText(input.name, 'entitlement-name', 120),
        optionalText(input.description, 'entitlement-description', 2_000) ?? '',
        type,
        jsonValue(defaultValue, 'default-value'),
        assertUuid(actorId, 'actor-id'),
      ]);
      return mapRow(result.rows[0]);
    },

    async updateEntitlement(rawId, input) {
      const id = assertUuid(rawId, 'entitlement-id');
      const version = Number(input.version);
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid-version');
      const value = typedValue(input.valueType, input.defaultValue);
      const status = input.status ?? 'active';
      if (!['active', 'archived'].includes(status)) throw new Error('invalid-entitlement-status');
      const current = await queryable.query(
        'SELECT * FROM entitlement_definitions WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!current.rows[0]) throw new Error('entitlement-conflict-or-not-found');
      if (current.rows[0].value_type !== input.valueType) {
        const usage = await queryable.query(`
          SELECT 1 FROM plan_entitlements WHERE entitlement_id = $1
          UNION ALL
          SELECT 1 FROM commerce_features WHERE required_entitlement_id = $1
          UNION ALL
          SELECT 1 FROM user_subscription_entitlements WHERE entitlement_key = $2
          UNION ALL
          SELECT 1 FROM user_entitlement_grants WHERE entitlement_key = $2
          LIMIT 1
        `, [id, current.rows[0].entitlement_key]);
        if (usage.rows[0]) throw new Error('entitlement-type-in-use');
      }
      const result = await queryable.query(`
        UPDATE entitlement_definitions
        SET name = $2, description = $3, value_type = $4, default_value = $5::JSONB,
            status = $6, version = version + 1, updated_at = NOW()
        WHERE id = $1 AND version = $7
        RETURNING *
      `, [
        id,
        requireText(input.name, 'entitlement-name', 120),
        optionalText(input.description, 'entitlement-description', 2_000) ?? '',
        input.valueType,
        jsonValue(value, 'default-value'),
        status,
        version,
      ]);
      if (!result.rows[0]) throw new Error('entitlement-conflict-or-not-found');
      return mapRow(result.rows[0]);
    },

    async listPlans({ activeOnly = false } = {}) {
      const plans = await queryable.query(`
        SELECT p.*, v.version_number, v.name, v.tagline, v.description,
               v.status AS version_status, v.published_at
        FROM subscription_plans p
        JOIN subscription_plan_versions v ON v.id = p.current_version_id
        WHERE ($1::BOOLEAN = FALSE OR p.status = 'active')
        ORDER BY p.created_at, p.code
      `, [activeOnly]);
      const items = [];
      for (const raw of plans.rows) {
        const prices = await queryable.query(`
          SELECT * FROM subscription_prices
          WHERE plan_version_id = $1 AND ($2::BOOLEAN = FALSE OR status = 'active')
          ORDER BY amount_minor, billing_period
        `, [raw.current_version_id, activeOnly]);
        const entitlements = await queryable.query(`
          SELECT d.entitlement_key, d.name, d.value_type, e.value
          FROM plan_entitlements e
          JOIN entitlement_definitions d ON d.id = e.entitlement_id
          WHERE e.plan_version_id = $1
          ORDER BY d.entitlement_key
        `, [raw.current_version_id]);
        items.push({
          ...mapRow(raw),
          prices: prices.rows.map(mapRow),
          entitlements: entitlements.rows.map(mapRow),
        });
      }
      return items;
    },

    async createPlan(input, actorId) {
      const planId = uuid();
      const versionId = uuid();
      const code = keyValue(input.code, 'plan-code');
      const status = input.status ?? 'draft';
      if (!PLAN_STATUSES.has(status)) throw new Error('invalid-plan-status');
      const actor = assertUuid(actorId, 'actor-id');
      await queryable.query(`
        INSERT INTO subscription_plans (id, code, status, created_by)
        VALUES ($1, $2, $3, $4)
      `, [planId, code, status, actor]);
      await queryable.query(`
        INSERT INTO subscription_plan_versions (
          id, plan_id, version_number, name, tagline, description,
          status, published_at, created_by
        )
        VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)
      `, [
        versionId,
        planId,
        requireText(input.name, 'plan-name', 120),
        optionalText(input.tagline, 'plan-tagline', 240) ?? '',
        optionalText(input.description, 'plan-description', 10_000) ?? '',
        'draft',
        null,
        actor,
      ]);
      await replaceVersionDetails(
        queryable, versionId, input.prices ?? [], input.entitlements ?? [], uuid,
      );
      if (status === 'active') {
        await queryable.query(`
          UPDATE subscription_plan_versions
          SET status = 'published', published_at = NOW()
          WHERE id = $1 AND status = 'draft'
        `, [versionId]);
      }
      await queryable.query(
        'UPDATE subscription_plans SET current_version_id = $2 WHERE id = $1',
        [planId, versionId],
      );
      return { id: planId };
    },

    async updatePlan(rawId, input, actorId) {
      const id = assertUuid(rawId, 'plan-id');
      const expectedVersion = Number(input.version);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error('invalid-plan-version');
      }
      const locked = await queryable.query(
        'SELECT * FROM subscription_plans WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rows[0] || locked.rows[0].version !== expectedVersion) {
        throw new Error('plan-conflict-or-not-found');
      }
      const status = input.status ?? locked.rows[0].status;
      if (!PLAN_STATUSES.has(status)) throw new Error('invalid-plan-status');
      const number = await queryable.query(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM subscription_plan_versions WHERE plan_id = $1',
        [id],
      );
      const versionId = uuid();
      await queryable.query(`
        INSERT INTO subscription_plan_versions (
          id, plan_id, version_number, name, tagline, description,
          status, published_at, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        versionId,
        id,
        number.rows[0].next,
        requireText(input.name, 'plan-name', 120),
        optionalText(input.tagline, 'plan-tagline', 240) ?? '',
        optionalText(input.description, 'plan-description', 10_000) ?? '',
        'draft',
        null,
        assertUuid(actorId, 'actor-id'),
      ]);
      await replaceVersionDetails(
        queryable, versionId, input.prices ?? [], input.entitlements ?? [], uuid,
      );
      if (status === 'active') {
        await queryable.query(`
          UPDATE subscription_plan_versions
          SET status = 'published', published_at = NOW()
          WHERE id = $1 AND status = 'draft'
        `, [versionId]);
      }
      await queryable.query(`
        UPDATE subscription_plans
        SET status = $2, current_version_id = $3, version = version + 1, updated_at = NOW()
        WHERE id = $1
      `, [id, status, versionId]);
      return { id };
    },
  });
}
