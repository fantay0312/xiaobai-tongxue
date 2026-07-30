import assert from 'node:assert/strict';
import test from 'node:test';
import { readAdminConfig } from './admin/config.mjs';
import { createAdminRouter } from './admin/router.mjs';
import { createAdminService } from './admin/service.mjs';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://admin.example.com';

function principal({ owner = true, permissions = [] } = {}) {
  return {
    session: { id: '33333333-3333-4333-8333-333333333333', csrfHash: 'a'.repeat(64) },
    account: {
      id: OWNER_ID,
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
      isOwner: owner,
      sessionVersion: 1,
    },
    roles: [],
    permissions,
  };
}

function request(pathname, method, payload = {}, headers = {}) {
  return {
    url: pathname,
    method,
    payload,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-token-value-for-tests',
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
    resume() {},
  };
}

function response() {
  return {
    headersSent: false,
    status: null,
    payload: null,
    headers: {},
  };
}

function send(res, status, payload, headers = {}) {
  res.status = status;
  res.payload = payload;
  res.headers = headers;
  res.headersSent = true;
}

function routerWith({ current, service: overrides = {}, postgres: overridesPg = {} }) {
  const audits = [];
  const service = {
    config: { origin: ORIGIN, sessionTtlMs: 3_600_000 },
    current: async () => current,
    verifyCsrf: async () => true,
    rotateCsrf: async () => ({
      admin: current.account,
      roles: current.roles,
      permissions: current.permissions,
      csrfToken: 'rotated-csrf-token',
    }),
    login: async () => ({
      token: 'raw-session-token',
      payload: {
        admin: current.account,
        roles: current.roles,
        permissions: current.permissions,
        csrfToken: 'raw-csrf-token',
      },
    }),
    activate: async () => ({
      token: 'raw-activation-session',
      payload: {
        admin: current.account,
        roles: [],
        permissions: current.permissions,
        csrfToken: 'activation-csrf',
      },
    }),
    revokeSession: async () => true,
    enterRequest: async () => ({ release() {} }),
    admitAudit: async () => true,
    audit: async (_req, _principal, input) => { audits.push(input); },
    ...overrides,
  };
  const postgres = {
    async withTransaction(work) { return work(this); },
    catalog: {
      createPlan: async () => ({ id: PLAN_ID }),
      listPlans: async () => [{
        id: PLAN_ID,
        code: 'pro',
        name: 'Pro',
        status: 'draft',
        version: 1,
        prices: [],
        entitlements: [],
      }],
    },
    adminRbac: { createRole: async () => ({ id: PLAN_ID }) },
    ...overridesPg,
  };
  return {
    audits,
    router: createAdminRouter({
      service,
      postgres,
      commerce: {},
      readJson: async (req) => req.payload,
      send,
      getCookie: () => 'raw-session-token',
      hasJsonContentType: () => true,
      onUserAccessChanged: async () => {},
    }),
  };
}

test('admin configuration is fail-closed and keeps independent HMAC keys', () => {
  assert.equal(readAdminConfig({}), null);
  assert.throws(
    () => readAdminConfig({ ADMIN_TOKEN_HMAC_KEY: Buffer.alloc(32).toString('base64') }),
    /ADMIN_OWNER_EMAIL/,
  );
  const config = readAdminConfig({
    ADMIN_OWNER_EMAIL: 'Owner@Example.com',
    ADMIN_PUBLIC_ORIGIN: ORIGIN,
    ADMIN_TOKEN_HMAC_KEY: Buffer.alloc(32, 1).toString('base64'),
    CDK_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
    CDK_HMAC_KEY_VERSION: '7',
  });
  assert.equal(config.ownerEmail, 'owner@example.com');
  assert.equal(config.origin, ORIGIN);
  assert.equal(config.commerceOrigin, ORIGIN);
  assert.equal(config.currentCdkVersion, 7);
  assert.notDeepEqual(config.tokenKey, config.cdkKeys.get(7));
  const splitOrigin = readAdminConfig({
    ADMIN_OWNER_EMAIL: 'owner@example.com',
    ADMIN_PUBLIC_ORIGIN: 'https://admin.example.com',
    COMMERCE_PUBLIC_ORIGIN: 'https://app.example.com',
    ADMIN_TOKEN_HMAC_KEY: Buffer.alloc(32, 1).toString('base64'),
  });
  assert.equal(splitOrigin.commerceOrigin, 'https://app.example.com');
  assert.throws(
    () => readAdminConfig({
      ADMIN_OWNER_EMAIL: 'owner@example.com',
      ADMIN_PUBLIC_ORIGIN: 'http://admin.example.com',
      ADMIN_TOKEN_HMAC_KEY: Buffer.alloc(32).toString('base64'),
    }),
    /ADMIN_PUBLIC_ORIGIN/,
  );
});

test('admin login uses an independent strict cookie and auth endpoints are audited', async () => {
  const current = principal({ permissions: ['overview.read'] });
  const { router, audits } = routerWith({ current });
  const loginResponse = response();
  await router.handle(
    request('/api/admin/v1/auth/login', 'POST', {
      email: 'owner@example.com',
      password: 'correct horse battery staple',
    }),
    loginResponse,
    '/api/admin/v1/auth/login',
  );
  assert.equal(loginResponse.status, 200);
  assert.match(
    loginResponse.headers['Set-Cookie'],
    /^__Host-xiaobai_admin_sid=raw-session-token; HttpOnly; SameSite=Strict; Path=\/;/,
  );
  assert.match(loginResponse.headers['Set-Cookie'], /; Secure$/);
  assert.equal(loginResponse.payload.csrfToken, 'raw-csrf-token');
  assert.equal(audits[0].action, 'admin.auth.login');
  assert.equal(audits[0].outcome, 'success');

  const meResponse = response();
  await router.handle(
    request('/api/admin/v1/auth/me', 'GET'),
    meResponse,
    '/api/admin/v1/auth/me',
  );
  assert.equal(meResponse.payload.csrfToken, 'rotated-csrf-token');
});

test('CSRF and a missing durable audit intent both block mutations', async () => {
  const current = principal({ permissions: ['plans.write'] });
  let writes = 0;
  const postgres = {
    async withTransaction(work) { return work(this); },
    catalog: {
      createPlan: async () => { writes += 1; return { id: PLAN_ID }; },
      listPlans: async () => [{
        id: PLAN_ID, name: 'Pro', code: 'pro', status: 'draft',
        version: 1, prices: [], entitlements: [],
      }],
    },
  };
  const denied = routerWith({
    current,
    postgres,
    service: { verifyCsrf: async () => false },
  }).router;
  const deniedResponse = response();
  await denied.handle(
    request('/api/admin/v1/plans', 'POST'),
    deniedResponse,
    '/api/admin/v1/plans',
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal(deniedResponse.payload.error, 'csrf-invalid');
  assert.equal(writes, 0);

  const blocked = routerWith({
    current,
    postgres,
    service: { audit: async () => { throw new Error('audit-down'); } },
  }).router;
  const blockedResponse = response();
  await blocked.handle(
    request('/api/admin/v1/plans', 'POST', {
      code: 'pro', name: 'Pro', prices: [], entitlements: [], reason: '发布审批',
    }),
    blockedResponse,
    '/api/admin/v1/plans',
  );
  assert.equal(blockedResponse.status, 500);
  assert.equal(writes, 0);
});

test('role writes and operator creation remain Owner-only regardless of delegated keys', async () => {
  const member = principal({ owner: false, permissions: ['team.read', 'team.roles'] });
  let roleWrites = 0;
  const { router } = routerWith({
    current: member,
    postgres: {
      adminRbac: {
        createRole: async () => { roleWrites += 1; return {}; },
      },
    },
  });
  const roleResponse = response();
  await router.handle(
    request('/api/admin/v1/team/roles', 'POST', {
      code: 'support', name: 'Support', permissionKeys: [],
    }),
    roleResponse,
    '/api/admin/v1/team/roles',
  );
  assert.equal(roleResponse.status, 403);
  assert.equal(roleResponse.payload.error, 'owner-required');
  assert.equal(roleWrites, 0);

  const service = createAdminService({
    postgres: { withTransaction: async () => {}, adminAuth: {}, adminRbac: {} },
    config: { tokenKey: Buffer.alloc(32), ownerEmail: 'owner@example.com' },
    passwordService: {},
    sendInvitation: async () => {},
    rateLimit: async () => ({ allowed: true }),
    clientIp: () => '127.0.0.1',
    authGate: { acquireConcurrency: () => ({ ok: true, release() {} }), admitGlobal: () => ({ ok: true }) },
  });
  await assert.rejects(
    service.inviteOperator(member, { email: 'member@example.com', roleIds: [] }),
    /owner-required/,
  );
});

test('activation rate limiting happens before invitation lookup and password hashing', async () => {
  let lookups = 0;
  let hashes = 0;
  const service = createAdminService({
    postgres: {
      withTransaction: async () => {},
      adminRbac: {},
      adminAuth: {
        invitationIsUsable: async () => { lookups += 1; return true; },
      },
    },
    config: { tokenKey: Buffer.alloc(32), ownerEmail: 'owner@example.com' },
    passwordService: {
      hash: async () => { hashes += 1; return {}; },
    },
    sendInvitation: async () => {},
    rateLimit: async () => ({ allowed: false }),
    clientIp: () => '127.0.0.1',
    authGate: { acquireConcurrency: () => ({ ok: true, release() {} }), admitGlobal: () => ({ ok: true }) },
  });
  await assert.rejects(
    service.activate({ token: 'x'.repeat(48), password: 'long-enough-password' }, {
      headers: {},
    }),
    /too-many-attempts/,
  );
  assert.equal(lookups, 0);
  assert.equal(hashes, 0);
});
