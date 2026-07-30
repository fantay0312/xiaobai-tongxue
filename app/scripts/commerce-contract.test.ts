import assert from 'node:assert/strict';
import {
  decodeCommerceCatalog,
  decodeCommerceRedemption,
  decodeCommerceSummary,
} from '../src/lib/commerce-types';
import { CommerceApiError, commerceErrorMessage } from '../src/lib/commerce';

const catalog = decodeCommerceCatalog({
  plans: [{
    id: 'plan-basic',
    code: 'basic',
    name: '基础学伴',
    tagline: '适合日常学习',
    description: '每月包含基础用量积分。',
    status: 'active',
    prices: [{
      id: 'price-monthly',
      billingPeriod: 'monthly',
      currency: 'CNY',
      amountMinor: '2900',
      durationDays: 30,
      bonusPoints: '3000',
    }],
    entitlements: [{
      key: 'ai_tutor',
      name: 'AI 学伴',
      value: { dailyLimit: 20 },
      expiresAt: null,
    }],
  }],
});

assert.equal(catalog.plans[0]?.prices[0]?.amountMinor, '2900');
assert.deepEqual(catalog.plans[0]?.entitlements[0]?.value, { dailyLimit: 20 });

const summary = decodeCommerceSummary({
  wallet: { available: '1280' },
  subscription: {
    id: 'subscription-1',
    planName: '基础学伴',
    status: 'active',
    startsAt: '2026-07-30T00:00:00.000Z',
    endsAt: null,
  },
  entitlements: [],
  features: [{
    key: 'ai_tutor',
    name: 'AI 学伴',
    enabled: true,
    reason: null,
  }],
});

assert.equal(summary.wallet.available, '1280');
assert.equal(summary.subscription?.planName, '基础学伴');
assert.equal(summary.features[0]?.enabled, true);

const redemption = decodeCommerceRedemption({
  ok: true,
  rewards: [{ type: 'points', label: '1,000 用量积分' }],
  commerce: {
    wallet: { available: '2280' },
    subscription: null,
    entitlements: [],
    features: [],
  },
});

assert.equal(redemption.rewards[0]?.type, 'points');
assert.equal(redemption.commerce?.wallet.available, '2280');
assert.equal(decodeCommerceRedemption({
  ok: true,
  rewards: [{ type: 'points', label: '已到账' }],
  commerce: null,
}).commerce, null);
assert.throws(
  () => decodeCommerceRedemption({ ok: false }),
  /invalid-redemption-response/,
);
assert.match(
  commerceErrorMessage(new CommerceApiError('cdk-already-used', 409)),
  /已使用/,
);

const safeFallback = decodeCommerceSummary(null);
assert.equal(safeFallback.wallet.available, '0');
assert.equal(safeFallback.subscription, null);
assert.deepEqual(safeFallback.entitlements, []);

console.log('commerce API contract: all assertions passed');
