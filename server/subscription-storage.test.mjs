import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSubscriptionRepository } from './storage/postgres/subscriptions.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const PRICE_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const SUBSCRIPTION_ID = '66666666-6666-4666-8666-666666666666';

class SubscriptionQueryable {
  calls = [];
  snapshot = null;
  copiedEntitlements = [];

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (/FROM subscription_plans p/.test(text) && /FOR SHARE/.test(text)) {
      return { rows: [{
        id: PLAN_ID,
        code: 'pro',
        status: 'active',
        current_version_id: VERSION_ID,
        name: '专业版',
        tagline: '完整能力',
        description: '商业订阅',
        version_number: 4,
      }] };
    }
    if (/FROM subscription_prices/.test(text)) {
      return { rows: [{
        id: PRICE_ID,
        plan_version_id: VERSION_ID,
        billing_period: 'monthly',
        currency: 'CNY',
        amount_minor: '1990',
        duration_days: 30,
        bonus_points: '500',
        status: 'active',
      }] };
    }
    if (/SELECT id FROM users/.test(text)) return { rows: [{ id: USER_ID }] };
    if (/FROM plan_entitlements e/.test(text)) {
      return { rows: [{
        entitlement_key: 'chat.pro',
        name: '专业对话',
        value_type: 'boolean',
        value: true,
      }] };
    }
    if (/UPDATE user_subscriptions/.test(text)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO user_subscriptions/.test(text)) {
      this.snapshot = JSON.parse(values[9]);
      return { rows: [{
        id: values[0],
        user_id: values[1],
        plan_id: values[2],
        plan_version_id: values[3],
        price_id: values[4],
        status: values[5],
        source: values[6],
        starts_at: values[7],
        ends_at: values[8],
        snapshot: this.snapshot,
      }] };
    }
    if (/INSERT INTO user_subscription_entitlements/.test(text)) {
      this.copiedEntitlements.push({
        subscriptionId: values[0],
        key: values[1],
        name: values[2],
        valueType: values[3],
        value: JSON.parse(values[4]),
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected-query:${text.trim().slice(0, 70)}`);
  }
}

test('subscription assignment locks the user, revokes the prior slot, and snapshots versioned rights', async () => {
  const queryable = new SubscriptionQueryable();
  const repository = createSubscriptionRepository(queryable, {
    uuid: () => SUBSCRIPTION_ID,
  });
  const result = await repository.create({
    userId: USER_ID,
    planId: PLAN_ID,
    priceId: PRICE_ID,
    status: 'active',
    source: 'admin',
    assignedBy: ADMIN_ID,
  });
  assert.equal(result.subscription.id, SUBSCRIPTION_ID);
  assert.equal(result.bonusPoints, '500');
  assert.deepEqual(queryable.snapshot, {
    planCode: 'pro',
    planName: '专业版',
    tagline: '完整能力',
    description: '商业订阅',
    versionNumber: 4,
    price: {
      id: PRICE_ID,
      billingPeriod: 'monthly',
      currency: 'CNY',
      amountMinor: '1990',
      durationDays: 30,
      bonusPoints: '500',
    },
    entitlements: [{
      key: 'chat.pro',
      name: '专业对话',
      valueType: 'boolean',
      value: true,
    }],
  });
  assert.deepEqual(queryable.copiedEntitlements, [{
    subscriptionId: SUBSCRIPTION_ID,
    key: 'chat.pro',
    name: '专业对话',
    valueType: 'boolean',
    value: true,
  }]);
  const userLock = queryable.calls.findIndex((call) => /users.*FOR UPDATE/s.test(call.text));
  const revoke = queryable.calls.findIndex((call) => /UPDATE user_subscriptions/.test(call.text));
  const insert = queryable.calls.findIndex((call) => /INSERT INTO user_subscriptions/.test(call.text));
  assert.ok(userLock >= 0 && userLock < revoke && revoke < insert);
  assert.match(queryable.calls[userLock].text, /FOR UPDATE/);
});

test('subscription scheduling fails closed and entitlement overrides are deterministic', async () => {
  const future = new SubscriptionQueryable();
  const repository = createSubscriptionRepository(future, { uuid: () => SUBSCRIPTION_ID });
  await assert.rejects(
    repository.create({
      userId: USER_ID,
      planId: PLAN_ID,
      startsAt: new Date(Date.now() + 60_000),
      source: 'admin',
    }),
    /future-subscription-not-supported/,
  );
  assert.equal(future.calls.some((call) => /UPDATE user_subscriptions/.test(call.text)), false);

  let entitlementSql = '';
  const effective = createSubscriptionRepository({
    async query(text) {
      entitlementSql = text;
      return { rows: [
        {
          entitlement_key: 'chat.pro', name: 'Plan', value: false,
          starts_at: '2026-01-01', source_id: PLAN_ID, priority: 1,
        },
        {
          entitlement_key: 'chat.pro', name: 'Grant', value: true,
          starts_at: '2026-02-01', source_id: VERSION_ID, priority: 2,
        },
      ] };
    },
  });
  const items = await effective.effectiveEntitlements(USER_ID);
  assert.equal(items.length, 1);
  assert.equal(items[0].value, true);
  assert.match(entitlementSql, /ORDER BY priority, starts_at, source_id/);
});

test('commercial migration defines independent auth, immutable ledgers, and defensive guards', async () => {
  const migration = await readFile(
    new URL('./storage/postgres/migrations/002_commercial_admin.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'admin_accounts',
    'admin_sessions',
    'admin_invitations',
    'admin_audit_events',
    'subscription_plans',
    'subscription_plan_versions',
    'subscription_prices',
    'entitlement_definitions',
    'commerce_features',
    'user_subscriptions',
    'user_restrictions',
    'point_wallets',
    'point_operations',
    'point_postings',
    'cdk_campaigns',
    'cdk_codes',
    'cdk_redemptions',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /admin_accounts_owner_guard/);
  assert.match(migration, /admin_audit_events_immutable_guard/);
  assert.match(migration, /subscription_plan_versions_immutable_guard/);
  assert.match(migration, /subscription_prices_immutable_guard/);
  assert.match(migration, /entitlement_definitions_type_guard/);
  assert.match(migration, /point_operations_immutable_guard/);
  assert.match(migration, /point_postings_immutable_guard/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /code_hash CHAR\(64\) NOT NULL UNIQUE/);
  assert.doesNotMatch(migration, /\braw_code\b|\bcode_plaintext\b/i);
  assert.ok(
    migration.indexOf('CREATE OR REPLACE FUNCTION protect_referenced_entitlement_type')
      > migration.indexOf('CREATE TABLE IF NOT EXISTS user_entitlement_grants'),
  );
});
