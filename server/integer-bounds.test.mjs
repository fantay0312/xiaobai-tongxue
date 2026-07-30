import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRewardRequest } from './commerce/cdk-rewards.mjs';
import {
  PG_INT64_MAX,
  pgBigIntString,
} from './integer-bounds.mjs';
import { createCatalogRepository } from './storage/postgres/catalog.mjs';
import { createPointRepository } from './storage/postgres/points.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('PostgreSQL BIGINT boundaries are checked before SQL casts', () => {
  assert.equal(
    pgBigIntString(PG_INT64_MAX.toString(), 'amount'),
    PG_INT64_MAX.toString(),
  );
  assert.equal(
    pgBigIntString((-PG_INT64_MAX).toString(), 'amount', {
      allowNegative: true,
      symmetric: true,
    }),
    (-PG_INT64_MAX).toString(),
  );
  assert.throws(
    () => pgBigIntString((PG_INT64_MAX + 1n).toString(), 'amount'),
    /invalid-amount/,
  );
  assert.throws(
    () => pgBigIntString('9'.repeat(100_000), 'amount'),
    /invalid-amount/,
  );
});

test('point operations reject out-of-range postings before querying storage', async () => {
  let queries = 0;
  const points = createPointRepository({
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
  });
  await assert.rejects(points.post({
    userId: USER_ID,
    amount: (PG_INT64_MAX + 1n).toString(),
    kind: 'admin_adjustment',
    idempotencyKey: 'points-boundary-test',
    reason: '边界测试',
  }), /invalid-point-amount/);
  assert.equal(queries, 0);
});

test('CDK point rewards reject both individual and aggregate overflow', () => {
  assert.doesNotThrow(() => validateRewardRequest([{
    type: 'points',
    amount: PG_INT64_MAX.toString(),
    label: '最大积分',
  }]));
  assert.throws(() => validateRewardRequest([{
    type: 'points',
    amount: (PG_INT64_MAX + 1n).toString(),
    label: '越界积分',
  }]), /invalid-point-amount/);
  assert.throws(() => validateRewardRequest([{
    type: 'points',
    amount: PG_INT64_MAX.toString(),
    label: '最大积分',
  }, {
    type: 'points',
    amount: '1',
    label: '额外积分',
  }]), /invalid-point-amount/);
});

test('plan price duration is capped before its INTEGER SQL cast', async () => {
  const catalog = createCatalogRepository({
    query: async () => ({ rows: [] }),
  }, { uuid: () => USER_ID });
  await assert.rejects(catalog.createPlan({
    code: 'too-long',
    name: 'Too long',
    prices: [{
      billingPeriod: 'custom',
      currency: 'CNY',
      amountMinor: '0',
      durationDays: 2_147_483_648,
      bonusPoints: '0',
    }],
    entitlements: [],
  }, ADMIN_ID), /invalid-duration-days/);
});
