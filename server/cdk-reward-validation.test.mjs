import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freezeRewardRequest,
  readFrozenRewards,
  validateRewardRequest,
} from './commerce/cdk-rewards.mjs';

const duplicated = [
  { type: 'entitlement', key: 'vision.pro', value: true, label: '视觉一' },
  { type: 'entitlement', key: 'vision.pro', value: false, label: '视觉二' },
];

test('CDK requests reject duplicate standalone entitlement keys', async () => {
  assert.throws(
    () => validateRewardRequest(duplicated),
    /invalid-entitlement-reward/,
  );
  await assert.rejects(
    freezeRewardRequest({ schemaVersion: 1, items: duplicated }, {
      loadPlan: async () => null,
      loadEntitlement: async (key) => ({
        key,
        name: '视觉能力',
        valueType: 'boolean',
      }),
    }),
    /invalid-entitlement-reward/,
  );
});

test('frozen CDK snapshots reject duplicate standalone entitlement keys', () => {
  assert.throws(() => readFrozenRewards({
    schemaVersion: 1,
    items: duplicated.map((item) => ({
      ...item,
      name: '视觉能力',
      valueType: 'boolean',
      expiresAt: null,
    })),
  }), /invalid-cdk-reward-snapshot/);
});
