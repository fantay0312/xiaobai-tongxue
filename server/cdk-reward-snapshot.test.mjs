import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cdkHash, normalizeCdk } from './admin/config.mjs';
import { createCommerceService } from './commerce/service.mjs';
import { createCdkRepository } from './storage/postgres/cdk.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAMPAIGN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CODE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';
function rewardRequest() {
  return {
    schemaVersion: 1,
    items: [
      { type: 'points', amount: '25', label: '25 积分' },
      { type: 'subscription', planId: PLAN_ID, durationDays: 30, label: '专业版 30 天' },
      {
        type: 'entitlement',
        key: 'vision.pro',
        value: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        label: '视觉能力',
      },
    ],
  };
}
test('campaign creation resolves and persists immutable plan and entitlement snapshots', async () => {
  let storedRewards;
  const queryable = {
    async query(sql, params = []) {
      if (sql.includes('SELECT p.id AS plan_id')) {
        return { rows: [{
          plan_id: PLAN_ID,
          code: 'pro',
          plan_version_id: VERSION_ID,
          version_number: 7,
          name: '专业版',
          tagline: '完整能力',
          description: '冻结版本',
        }] };
      }
      if (sql.includes('FROM plan_entitlements e')) {
        return { rows: [{
          entitlement_key: 'chat.pro',
          name: '专业对话',
          value_type: 'boolean',
          status: 'active',
          value: true,
        }] };
      }
      if (sql.includes('FROM entitlement_definitions')
          && sql.includes('status = \'active\'')) {
        return { rows: [{
          entitlement_key: 'vision.pro',
          name: '视觉能力',
          value_type: 'boolean',
        }] };
      }
      if (sql.includes('INSERT INTO cdk_campaigns')) {
        storedRewards = JSON.parse(params[3]);
        return { rows: [{ id: CAMPAIGN_ID, rewards: storedRewards }] };
      }
      if (sql.includes('INSERT INTO cdk_codes')) return { rows: [] };
      throw new Error(`unexpected-query:${sql}`);
    },
  };
  const ids = [CAMPAIGN_ID, CODE_ID];
  const repository = createCdkRepository(queryable, { uuid: () => ids.shift() });
  const campaign = await repository.createCampaign({
    name: 'Launch',
    keyVersion: 2,
    rewards: rewardRequest(),
    codes: [{ hash: 'a'.repeat(64), hint: 'XB-TEST…000001' }],
    expiresAt: null,
    createdBy: OWNER_ID,
  });

  assert.equal(storedRewards.schemaVersion, 1);
  assert.equal(Array.isArray(campaign.rewards), true);
  const subscription = storedRewards.items.find((item) => item.type === 'subscription');
  assert.equal(subscription.planVersionId, VERSION_ID);
  assert.equal(subscription.snapshot.versionNumber, 7);
  assert.deepEqual(subscription.snapshot.entitlements, [{
    key: 'chat.pro', name: '专业对话', valueType: 'boolean', value: true,
  }]);
  const entitlement = storedRewards.items.find((item) => item.type === 'entitlement');
  assert.deepEqual(
    { key: entitlement.key, name: entitlement.name, valueType: entitlement.valueType },
    { key: 'vision.pro', name: '视觉能力', valueType: 'boolean' },
  );
});
function frozenRewards() {
  return {
    schemaVersion: 1,
    items: [{
      type: 'subscription',
      planId: PLAN_ID,
      planVersionId: VERSION_ID,
      durationDays: 30,
      snapshot: {
        planCode: 'pro',
        planName: '专业版（冻结）',
        tagline: '旧版权益',
        description: '兑换不得读取 current_version',
        versionNumber: 7,
        price: null,
        entitlements: [{
          key: 'chat.pro', name: '专业对话', valueType: 'boolean', value: true,
        }],
      },
      label: '专业版 30 天',
    }, {
      type: 'entitlement',
      key: 'vision.pro',
      name: '视觉能力（冻结）',
      valueType: 'boolean',
      value: true,
      expiresAt: null,
      label: '视觉能力',
    }],
  };
}
function redeemStore(rewards, {
  status = 'active',
  redemption = null,
  summaryError = false,
} = {}) {
  const key = Buffer.alloc(32, 7);
  const rawCode = 'XB-ABCDEF-123456-ABCDEF-123456';
  const calls = { subscription: null, entitlement: null, redemption: null, points: 0 };
  const repositories = {
    cdk: {
      lockCode: async () => ({
        id: CODE_ID,
        campaignId: CAMPAIGN_ID,
        keyVersion: 4,
        codeHash: cdkHash(key, 4, normalizeCdk(rawCode)),
        status,
        campaignStatus: status === 'redeemed' ? 'completed' : 'active',
        campaignExpiresAt: null,
        rewards,
      }),
      findRedemptionByCode: async () => redemption,
      createFrozenSubscription: async (input) => {
        calls.subscription = input;
        return { id: SUBSCRIPTION_ID };
      },
      grantFrozenEntitlement: async (input) => { calls.entitlement = input; },
      completeRedemption: async (input) => { calls.redemption = input; },
      completeCampaignIfExhausted: async () => {},
    },
    points: {
      post: async () => { calls.points += 1; },
      getWallet: async () => ({ available: '0' }),
    },
    subscriptions: {
      create: async () => { throw new Error('current-plan-path-used'); },
      grantEntitlement: async () => { throw new Error('live-entitlement-path-used'); },
      activeForUser: async () => {
        if (summaryError) throw new Error('summary-read-model-down');
        return null;
      },
      effectiveEntitlements: async () => [],
      effectiveFeatures: async () => [],
    },
  };
  return {
    rawCode,
    calls,
    service: createCommerceService({
      postgres: {
        ...repositories,
        withTransaction: async (work) => work(repositories),
      },
      cdkKeys: new Map([[4, key]]),
      currentCdkVersion: 4,
    }),
  };
}

test('redemption uses only the frozen plan version and entitlement definition', async () => {
  const { service, rawCode, calls } = redeemStore(frozenRewards());
  await service.redeem({ id: USER_ID }, rawCode);
  assert.equal(calls.subscription.reward.planVersionId, VERSION_ID);
  assert.equal(calls.subscription.reward.snapshot.planName, '专业版（冻结）');
  assert.equal(calls.entitlement.reward.name, '视觉能力（冻结）');
  assert.equal(calls.redemption.subscriptionId, SUBSCRIPTION_ID);
  assert.deepEqual(calls.redemption.rewards, frozenRewards());
  assert.equal(calls.points, 0);
});

test('legacy and malformed reward payloads fail before any value is issued', async () => {
  for (const rewards of [
    [{ type: 'points', amount: '10', label: 'legacy' }],
    { schemaVersion: 1, items: [{ type: 'subscription', planId: PLAN_ID }] },
    { schemaVersion: 2, items: [{ type: 'points', amount: '10', label: 'wrong version' }] },
  ]) {
    const { service, rawCode, calls } = redeemStore(rewards);
    await assert.rejects(
      service.redeem({ id: USER_ID }, rawCode),
      /invalid-cdk-reward-snapshot/,
    );
    assert.equal(calls.points, 0);
    assert.equal(calls.subscription, null);
    assert.equal(calls.entitlement, null);
    assert.equal(calls.redemption, null);
  }
});

test('same-user redemption replay is successful but a different user is rejected', async () => {
  const snapshot = frozenRewards();
  snapshot.items[1].expiresAt = '2020-01-01T00:00:00.000Z';
  const prior = { userId: USER_ID, rewardsSnapshot: snapshot };
  const { service, rawCode, calls } = redeemStore(snapshot, {
    status: 'redeemed',
    redemption: prior,
  });
  const replay = await service.redeem({ id: USER_ID }, rawCode);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.rewards, snapshot.items.map(({ type, label }) => ({ type, label })));
  assert.equal(calls.subscription, null);
  assert.equal(calls.entitlement, null);
  assert.equal(calls.redemption, null);

  await assert.rejects(
    service.redeem({ id: OWNER_ID }, rawCode),
    /cdk-already-used/,
  );
});

test('summary outage cannot turn an already committed redemption into a failure', async () => {
  const { service, rawCode, calls } = redeemStore(frozenRewards(), { summaryError: true });
  const result = await service.redeem({ id: USER_ID }, rawCode);
  assert.equal(result.ok, true);
  assert.equal(result.commerce, null);
  assert.equal(calls.redemption.userId, USER_ID);
});

test('repository assigns the exact frozen version and can read a prior redemption', async () => {
  const queries = [];
  const snapshot = frozenRewards();
  const queryable = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('FROM subscription_plan_versions')) return { rows: [{ id: VERSION_ID }] };
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: USER_ID }] };
      if (sql.includes('UPDATE user_subscriptions')) return { rows: [] };
      if (sql.includes('INSERT INTO user_subscriptions')) {
        return { rows: [{ id: SUBSCRIPTION_ID }] };
      }
      if (sql.includes('INSERT INTO user_subscription_entitlements')) return { rows: [] };
      if (sql.includes('FROM cdk_redemptions')) {
        return { rows: [{
          id: OWNER_ID,
          code_id: CODE_ID,
          campaign_id: CAMPAIGN_ID,
          user_id: USER_ID,
          rewards_snapshot: snapshot,
        }] };
      }
      throw new Error(`unexpected-query:${sql}`);
    },
  };
  const repository = createCdkRepository(queryable, { uuid: () => SUBSCRIPTION_ID });
  const startsAt = new Date();
  const reward = snapshot.items[0];
  const assigned = await repository.createFrozenSubscription({
    userId: USER_ID,
    reward,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 86_400_000),
  });
  assert.equal(assigned.id, SUBSCRIPTION_ID);
  const versionQuery = queries.find((entry) => (
    entry.sql.includes('FROM subscription_plan_versions')
  ));
  assert.deepEqual(versionQuery.params, [VERSION_ID, PLAN_ID]);
  assert.doesNotMatch(versionQuery.sql, /current_version_id/);

  const redemption = await repository.findRedemptionByCode(CODE_ID);
  assert.equal(redemption.userId, USER_ID);
  assert.deepEqual(redemption.rewardsSnapshot, snapshot);
});

test('migration constrains and protects campaign snapshots', async () => {
  const migration = await readFile(new URL(
    './storage/postgres/migrations/002_commercial_admin.sql',
    import.meta.url,
  ), 'utf8');
  assert.match(migration, /cdk_campaigns_rewards_snapshot_check/);
  assert.match(migration, /rewards ->> 'schemaVersion' = '1'/);
  assert.match(migration, /cdk-campaign-snapshot-immutable/);
  assert.match(migration, /BEFORE UPDATE OF rewards, key_version ON cdk_campaigns/);
});
