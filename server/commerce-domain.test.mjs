import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommercialAccessController } from './commercial-access.mjs';
import { createCommerceRouter } from './commerce/router.mjs';
import { createCommerceService } from './commerce/service.mjs';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAMPAIGN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CODE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OPERATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ORIGIN = 'https://admin.example.com';

function summaryRepositories() {
  return {
    points: { getWallet: async () => ({ available: 125n }) },
    subscriptions: {
      activeForUser: async () => ({
        id: 'sub-1',
        planName: '专业版',
        status: 'active',
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z',
      }),
      effectiveEntitlements: async () => [{
        entitlementKey: 'chat.pro',
        name: '专业对话',
        value: true,
        expiresAt: null,
      }],
      effectiveFeatures: async () => [{
        key: 'chat',
        name: '课堂对话',
        enabled: true,
        reason: '',
      }],
    },
  };
}

test('commerce catalog and me preserve the exact public contract and BIGINT strings', async () => {
  const repositories = summaryRepositories();
  const service = createCommerceService({
    postgres: {
      ...repositories,
      withTransaction: async (work) => work(repositories),
      userAccess: { activeRestriction: async () => null },
      catalog: {
        listPlans: async () => [{
          id: PLAN_ID,
          code: 'pro',
          name: '专业版',
          tagline: '完整能力',
          description: '商业订阅',
          status: 'active',
          prices: [{
            id: PRICE_ID,
            billingPeriod: 'monthly',
            currency: 'CNY',
            amountMinor: 1990n,
            durationDays: 30,
            bonusPoints: 500n,
          }],
          entitlements: [{
            entitlementKey: 'chat.pro',
            name: '专业对话',
            value: true,
          }],
        }],
      },
    },
  });
  assert.deepEqual(await service.catalog(), {
    plans: [{
      id: PLAN_ID,
      code: 'pro',
      name: '专业版',
      tagline: '完整能力',
      description: '商业订阅',
      status: 'active',
      prices: [{
        id: PRICE_ID,
        billingPeriod: 'monthly',
        currency: 'CNY',
        amountMinor: '1990',
        durationDays: 30,
        bonusPoints: '500',
      }],
      entitlements: [{ key: 'chat.pro', name: '专业对话', value: true }],
    }],
  });
  assert.deepEqual(await service.summary({ id: USER_ID }), {
    wallet: { available: '125' },
    subscription: {
      id: 'sub-1',
      planName: '专业版',
      status: 'active',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
    },
    entitlements: [{
      key: 'chat.pro', name: '专业对话', value: true, expiresAt: null,
    }],
    features: [{
      key: 'chat', name: '课堂对话', enabled: true, reason: '',
    }],
  });
});

test('restriction and feature decisions are enforced by the shared API access controller', async () => {
  const calls = [];
  const user = {
    id: USER_ID,
    name: 'teacher',
    sessionVersion: 1,
    disabledAt: null,
  };
  const sessions = new Map([[
    'sid',
    { name: user.name, sessionVersion: 1, expires: Date.now() + 60_000 },
  ]]);
  const responses = [];
  const controller = createCommercialAccessController({
    cookieName: 'sid',
    sessions,
    getCookie: () => 'sid',
    findUser: () => user,
    commerceService: {
      accessDecision: async (_user, scope) => {
        calls.push(scope);
        return scope === 'vision'
          ? { allowed: false, error: 'feature-disabled', reason: 'plan-required' }
          : { allowed: true };
      },
    },
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    clientIp: () => '127.0.0.1',
    identityMatches: () => true,
    rejectLegacyRestriction: () => false,
    send: (_res, status, payload) => responses.push({ status, payload }),
  });
  for (const scope of ['all', 'login', 'chat', 'asr', 'state', 'transcript', 'commerce']) {
    assert.equal(await controller.protectedUser({}, {}, scope), user);
  }
  assert.equal(await controller.protectedUser({}, {}, 'vision'), null);
  assert.deepEqual(calls, [
    'all', 'login', 'chat', 'asr', 'state', 'transcript', 'commerce', 'vision',
  ]);
  assert.deepEqual(responses.pop(), {
    status: 403,
    payload: { error: 'feature-disabled', reason: 'plan-required' },
  });

  user.disabledAt = '2026-07-30T00:00:00.000Z';
  controller.suspendUserSessions(user.name, (left, right) => left === right);
  assert.equal(sessions.size, 0);
  assert.equal(await controller.protectedUser({}, {}, 'chat'), null);
  assert.deepEqual(responses.pop(), {
    status: 403,
    payload: { error: 'account-restricted', reason: 'account-suspended' },
  });
});

function cdkStore() {
  const state = { campaign: null, code: null, creation: null, pointPosts: 0 };
  let transactionTail = Promise.resolve();
  const repositories = {
    ...summaryRepositories(),
    catalog: { listPlans: async () => [] },
    userAccess: { activeRestriction: async () => null },
    cdk: {
      lockCampaignCreation: async (input) => {
        if (!state.creation) return { replayed: false };
        if (state.creation.actorId !== input.actorId
            || state.creation.requestHash !== input.requestHash) {
          throw new Error('idempotency-conflict');
        }
        return { replayed: true, ...state.creation };
      },
      reserveCampaignCreation: async (input) => { state.creation = { ...input }; },
      completeCampaignCreation: async (input) => {
        Object.assign(state.creation, {
          campaignId: input.campaignId, exportNonce: input.nonce, exportTag: input.tag,
          exportCiphertext: input.ciphertext, exportExpiresAt: new Date(Date.now() + 900_000),
          completedAt: new Date(),
        });
      },
      expireCampaignCreation: async () => {},
      createCampaign: async (input) => {
        state.campaign = { id: CAMPAIGN_ID, status: 'active', rewards: input.rewards };
        state.code = {
          id: CODE_ID,
          campaignId: CAMPAIGN_ID,
          keyVersion: input.keyVersion,
          codeHash: input.codes[0].hash,
          codeHint: input.codes[0].hint,
          status: 'active',
          campaignStatus: 'active',
          campaignExpiresAt: input.expiresAt,
          rewards: input.rewards,
        };
        return state.campaign;
      },
      lockCode: async (hashes) => (
        state.code && hashes.includes(state.code.codeHash) ? { ...state.code } : null
      ),
      completeRedemption: async () => { state.code.status = 'redeemed'; },
      completeCampaignIfExhausted: async () => { state.campaign.status = 'completed'; },
    },
    points: {
      getWallet: async () => ({ available: '50' }),
      post: async () => {
        state.pointPosts += 1;
        return { operation: { id: OPERATION_ID } };
      },
    },
  };
  const postgres = {
    ...repositories,
    async withTransaction(work) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await work(repositories);
      } finally {
        release();
      }
    },
  };
  return { postgres, state };
}

test('CDK stores HMAC only, redeems once under concurrency, and completes its campaign', async () => {
  const { postgres, state } = cdkStore();
  const service = createCommerceService({
    postgres,
    cdkKeys: new Map([[3, Buffer.alloc(32, 9)]]), currentCdkVersion: 3,
    cdkExportRootKey: Buffer.alloc(32, 8),
  });
  const created = await service.createCampaign({
    name: 'Launch',
    quantity: 1,
    rewards: [{ type: 'points', amount: '50', label: '50 积分' }],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    reason: '商业化发布',
    idempotencyKey: 'campaign:create:launch',
  }, OWNER_ID);
  assert.equal(created.codes.length, 1);
  assert.equal(state.code.codeHash.length, 64);
  assert.equal(state.code.keyVersion, 3);
  assert.equal(JSON.stringify(state.code).includes(created.codes[0]), false);

  const results = await Promise.allSettled([
    service.redeem({ id: USER_ID }, created.codes[0]),
    service.redeem({ id: USER_ID }, created.codes[0]),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.match(rejected.reason.message, /cdk-already-used/);
  assert.equal(state.pointPosts, 1);
  assert.equal(state.code.status, 'redeemed');
  assert.equal(state.campaign.status, 'completed');
});

test('CDK redeem requires exact Origin, JSON, and both user/IP rate budgets', async () => {
  let redeemCalls = 0;
  const router = createCommerceRouter({
    commerce: {
      redeem: async () => { redeemCalls += 1; return { ok: true }; },
      catalog: async () => ({ plans: [] }),
      summary: async () => ({}),
    },
    readJson: async () => ({ code: 'XB-TEST' }),
    send: (res, status, payload) => Object.assign(res, { status, payload, headersSent: true }),
    hasJsonContentType: (req) => req.headers['content-type'] === 'application/json',
    preflightUser: async () => ({ user: { id: USER_ID } }),
    resolveUser: async () => ({ id: USER_ID }),
    allowedOrigin: ORIGIN,
    clientIp: () => '127.0.0.1',
    rateLimit: async ({ scope }) => ({ allowed: scope !== 'commerce-cdk-redeem-user' }),
  });
  const wrongOrigin = { headersSent: false };
  await router.handle({
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    resume() {},
  }, wrongOrigin, '/api/commerce/cdk/redeem');
  assert.equal(wrongOrigin.status, 403);

  const limited = { headersSent: false };
  await router.handle({
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
    resume() {},
  }, limited, '/api/commerce/cdk/redeem');
  assert.equal(limited.status, 429);
  assert.equal(redeemCalls, 0);
});
