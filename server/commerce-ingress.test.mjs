import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAdminBusinessRoute } from './admin/business-router.mjs';
import { createCommercialAccessController } from './commercial-access.mjs';
import { createCommerceRouter } from './commerce/router.mjs';
import { createCommerceService } from './commerce/service.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'https://admin.example.com';

function responseSink() {
  return {
    send(res, status, payload) {
      Object.assign(res, { status, payload, headersSent: true });
    },
  };
}

test('protected ingress short-circuits local Redis denials before global and PG', async () => {
  const user = {
    id: USER_ID,
    name: 'teacher',
    sessionVersion: 1,
    disabledAt: null,
  };
  const scenarios = [
    {
      deniedScope: 'commerce-ingress-user',
      expected: ['commerce-ingress-user'],
    },
    {
      deniedScope: 'commerce-ingress-ip',
      expected: ['commerce-ingress-user', 'commerce-ingress-ip'],
    },
    {
      deniedScope: 'commerce-ingress-global',
      expected: [
        'commerce-ingress-user',
        'commerce-ingress-ip',
        'commerce-ingress-global',
      ],
    },
  ];
  for (const scenario of scenarios) {
    const scopes = [];
    let accessCalls = 0;
    const responses = [];
    const controller = createCommercialAccessController({
      cookieName: 'sid',
      sessions: new Map([[
        'token',
        { name: user.name, sessionVersion: 1, expires: Date.now() + 60_000 },
      ]]),
      getCookie: () => 'token',
      findUser: () => user,
      commerceService: {
        accessDecision: async () => {
          accessCalls += 1;
          return { allowed: true };
        },
      },
      rateLimit: async (input) => {
        scopes.push(input.scope);
        return {
          allowed: input.scope !== scenario.deniedScope,
          retryAfterSeconds: 12,
        };
      },
      clientIp: () => '198.51.100.8',
      identityMatches: () => true,
      rejectLegacyRestriction: () => false,
      send: (_res, status, payload) => responses.push({ status, payload }),
    });

    assert.equal(await controller.protectedUser({}, {}, 'chat'), null);
    assert.equal(accessCalls, 0);
    assert.deepEqual(scopes, scenario.expected);
    assert.deepEqual(responses, [{
      status: 429,
      payload: { error: 'too-many-attempts', retryAfter: 12 },
    }]);
  }
});

function routerRepositories(calls) {
  return {
    withTransaction: async () => {
      calls.transactions += 1;
      return null;
    },
    catalog: {
      listPlans: async () => {
        calls.listPlans += 1;
        return [];
      },
    },
    points: {
      getWallet: async () => {
        calls.summary += 1;
        return { available: '0' };
      },
    },
    subscriptions: {
      activeForUser: async () => null,
      effectiveEntitlements: async () => [],
      effectiveFeatures: async () => [],
    },
    userAccess: { activeRestriction: async () => null },
  };
}

test('catalog, me, and redeem limits stop listPlans, resolveUser, summary, and writes', async () => {
  const calls = {
    listPlans: 0,
    resolveUser: 0,
    summary: 0,
    transactions: 0,
  };
  let mode = 'catalog';
  const rateScopes = { catalog: [], redeem: [] };
  const service = createCommerceService({ postgres: routerRepositories(calls) });
  const { send } = responseSink();
  const router = createCommerceRouter({
    commerce: service,
    readJson: async () => ({ code: 'XB-TEST' }),
    send,
    hasJsonContentType: (req) => req.headers['content-type'] === 'application/json',
    preflightUser: async (_req, res) => {
      if (mode === 'me') {
        send(res, 429, { error: 'too-many-attempts' });
        return null;
      }
      return { user: { id: USER_ID } };
    },
    resolveUser: async () => {
      calls.resolveUser += 1;
      return { id: USER_ID };
    },
    allowedOrigin: ORIGIN,
    rateLimit: async ({ scope }) => {
      if (rateScopes[mode]) rateScopes[mode].push(scope);
      return {
        allowed: !(mode === 'catalog' && scope === 'commerce-catalog-ip')
          && !(mode === 'redeem' && scope === 'commerce-cdk-redeem-user'),
      };
    },
    clientIp: () => '198.51.100.9',
  });
  const request = (method, headers = {}) => ({ method, headers, resume() {} });

  const catalogResponse = {};
  await router.handle(request('GET'), catalogResponse, '/api/commerce/catalog');
  assert.equal(catalogResponse.status, 429);
  assert.equal(calls.listPlans, 0);
  assert.deepEqual(rateScopes.catalog, ['commerce-catalog-ip']);

  mode = 'me';
  const meResponse = {};
  await router.handle(request('GET'), meResponse, '/api/commerce/me');
  assert.equal(meResponse.status, 429);
  assert.equal(calls.resolveUser, 0);
  assert.equal(calls.summary, 0);

  mode = 'redeem';
  const redeemResponse = {};
  await router.handle(request('POST', {
    origin: ORIGIN,
    'content-type': 'application/json',
  }), redeemResponse, '/api/commerce/cdk/redeem');
  assert.equal(redeemResponse.status, 429);
  assert.equal(calls.resolveUser, 0);
  assert.equal(calls.transactions, 0);
  assert.deepEqual(rateScopes.redeem, ['commerce-cdk-redeem-user']);
});

test('public catalog cache deduplicates promises and supports explicit invalidation', async () => {
  let listCalls = 0;
  let releaseFirst;
  const firstResult = new Promise((resolve) => { releaseFirst = resolve; });
  const service = createCommerceService({
    postgres: {
      withTransaction: async () => null,
      catalog: {
        listPlans: async () => {
          listCalls += 1;
          return listCalls === 1 ? firstResult : [];
        },
      },
    },
  });

  const first = service.catalog();
  const second = service.catalog();
  await Promise.resolve();
  assert.equal(listCalls, 1);
  releaseFirst([]);
  assert.deepEqual(await Promise.all([first, second]), [{ plans: [] }, { plans: [] }]);
  await service.catalog();
  assert.equal(listCalls, 1);

  service.invalidateCatalogCache();
  await service.catalog();
  assert.equal(listCalls, 2);
});

test('admin catalog mutations explicitly invalidate the public cache', async () => {
  let invalidations = 0;
  const plan = {
    id: USER_ID,
    code: 'pro',
    name: 'Pro',
    status: 'draft',
    version: 1,
    prices: [],
    entitlements: [],
  };
  const handled = await handleAdminBusinessRoute({
    req: { method: 'POST' },
    pathname: '/api/admin/v1/plans',
    url: new URL('https://admin.example.com/api/admin/v1/plans'),
    principal: {
      account: { id: USER_ID },
      permissions: ['plans.write'],
    },
    postgres: {
      withTransaction: async (work) => work({
        catalog: { createPlan: async () => ({ id: USER_ID }) },
      }),
      catalog: { listPlans: async () => [plan] },
    },
    commerce: {
      invalidateCatalogCache: () => { invalidations += 1; },
    },
    send: () => {},
    body: async () => ({ code: 'pro', name: 'Pro', reason: '发布套餐' }),
    mutate: async (_audit, work) => work(),
    onUserAccessChanged: async () => {},
  });
  assert.equal(handled, true);
  assert.equal(invalidations, 1);
});

test('accessDecision and summary reuse one request entitlement/feature snapshot', async () => {
  const rights = [{
    entitlementKey: 'chat.pro',
    name: '专业对话',
    value: true,
    expiresAt: null,
  }];
  const calls = { entitlements: 0, features: 0 };
  const service = createCommerceService({
    postgres: {
      withTransaction: async () => null,
      userAccess: { activeRestriction: async () => null },
      points: { getWallet: async () => ({ available: '5' }) },
      subscriptions: {
        activeForUser: async () => null,
        effectiveEntitlements: async () => {
          calls.entitlements += 1;
          return rights;
        },
        effectiveFeatures: async (_userId, provided) => {
          calls.features += 1;
          assert.equal(provided, rights);
          return [{ key: 'commerce', name: '商业中心', enabled: true, reason: '' }];
        },
      },
    },
  });
  const request = {};
  assert.deepEqual(
    await service.accessDecision({ id: USER_ID }, 'commerce', request),
    { allowed: true },
  );
  const summary = await service.summary({ id: USER_ID }, request);
  assert.equal(summary.wallet.available, '5');
  assert.equal(calls.entitlements, 1);
  assert.equal(calls.features, 1);
});
