import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createCommercialAccessController } from './commercial-access.mjs';
import { createCommerceRouter } from './commerce/router.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function lifecycleResponse() {
  return Object.assign(new EventEmitter(), { headersSent: false });
}

function send(res, status, payload) {
  Object.assign(res, { status, payload, headersSent: true });
}

test('protected concurrency permit is per request and reusable after finish', async () => {
  const user = {
    id: USER_ID,
    name: 'teacher',
    sessionVersion: 1,
    disabledAt: null,
  };
  let accessCalls = 0;
  let rateCalls = 0;
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
    rateLimit: async () => {
      rateCalls += 1;
      return { allowed: true };
    },
    clientIp: () => '198.51.100.10',
    identityMatches: () => true,
    rejectLegacyRestriction: () => false,
    send,
    protectedMaxConcurrent: 1,
  });

  const firstRequest = {};
  const firstResponse = lifecycleResponse();
  const firstPreflight = await controller.preflightUser(firstRequest, firstResponse);
  assert.ok(firstPreflight);
  assert.ok(await controller.preflightUser(firstRequest, firstResponse));

  const deniedResponse = lifecycleResponse();
  assert.equal(await controller.protectedUser({}, deniedResponse, 'commerce'), null);
  assert.equal(deniedResponse.status, 503);
  assert.equal(deniedResponse.payload.error, 'commerce-busy');
  assert.equal(accessCalls, 0);
  assert.equal(rateCalls, 6);

  assert.equal(await controller.protectedUser(
    firstRequest,
    firstResponse,
    'commerce',
    { preflight: firstPreflight },
  ), user);
  assert.equal(accessCalls, 1);
  firstResponse.emit('finish');

  const nextResponse = lifecycleResponse();
  assert.equal(await controller.protectedUser({}, nextResponse, 'commerce'), user);
  assert.equal(accessCalls, 2);
  nextResponse.emit('close');
});

test('catalog concurrency gate rejects before PG and releases on finish', async () => {
  let catalogCalls = 0;
  let rateCalls = 0;
  const router = createCommerceRouter({
    commerce: {
      catalog: async () => {
        catalogCalls += 1;
        return { plans: [] };
      },
    },
    readJson: async () => ({}),
    send,
    hasJsonContentType: () => true,
    preflightUser: async () => null,
    resolveUser: async () => null,
    rateLimit: async () => {
      rateCalls += 1;
      return { allowed: true };
    },
    clientIp: () => '198.51.100.11',
    catalogMaxConcurrent: 1,
  });
  const request = () => ({ method: 'GET', headers: {}, resume() {} });

  const firstResponse = lifecycleResponse();
  await router.handle(request(), firstResponse, '/api/commerce/catalog');
  assert.equal(firstResponse.status, 200);
  assert.equal(catalogCalls, 1);

  const deniedResponse = lifecycleResponse();
  await router.handle(request(), deniedResponse, '/api/commerce/catalog');
  assert.equal(deniedResponse.status, 503);
  assert.equal(deniedResponse.payload.error, 'commerce-busy');
  assert.equal(catalogCalls, 1);
  assert.equal(rateCalls, 2);

  firstResponse.emit('finish');
  const nextResponse = lifecycleResponse();
  await router.handle(request(), nextResponse, '/api/commerce/catalog');
  assert.equal(nextResponse.status, 200);
  assert.equal(catalogCalls, 2);
  nextResponse.emit('finish');
});
