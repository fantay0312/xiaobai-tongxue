import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminIngress,
  createAdminSessionToken,
  readAdminSessionToken,
} from './admin/ingress.mjs';
import { createAdminRouter } from './admin/router.mjs';
import { createAdminService } from './admin/service.mjs';
const TOKEN_KEY = Buffer.alloc(32, 9);
const ORIGIN = 'https://admin.example.com';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
function countedRateLimit() {
  const counts = new Map();
  const calls = [];
  return {
    calls,
    rateLimit: async (input) => {
      calls.push(input);
      const key = `${input.scope}\0${input.subject}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: count <= input.limit };
    },
  };
}
function request(cookie, ip = '198.51.100.40') {
  return {
    url: '/api/admin/v1/auth/me',
    method: 'GET',
    cookie,
    headers: {},
    socket: { remoteAddress: ip },
    resume() {},
  };
}
function response() {
  return { headersSent: false, status: null, payload: null };
}
function adminHarness({ isOwner, rateLimit }) {
  const counters = {
    findSession: 0,
    accountAccess: 0,
    rotateCsrf: 0,
    revokeSession: 0,
  };
  const accountId = isOwner ? OWNER_ID : MEMBER_ID;
  const session = {
    id: SESSION_ID,
    accountId,
    email: isOwner ? 'owner@example.com' : 'member@example.com',
    displayName: isOwner ? 'Owner' : 'Member',
    status: 'active',
    isOwner,
    sessionVersion: 1,
    accountSessionVersion: 1,
    csrfHash: 'a'.repeat(64),
  };
  const postgres = {
    async withTransaction(work) { return work(this); },
    adminAuth: {
      findSession: async () => {
        counters.findSession += 1;
        return session;
      },
      revokeSession: async () => {
        counters.revokeSession += 1;
        return true;
      },
      rotateCsrf: async () => {
        counters.rotateCsrf += 1;
        return {};
      },
    },
    adminRbac: {
      accountAccess: async () => {
        counters.accountAccess += 1;
        return { roles: [], permissions: [] };
      },
      recordAudit: async () => {},
    },
  };
  const service = createAdminService({
    postgres,
    config: {
      tokenKey: TOKEN_KEY,
      origin: ORIGIN,
      ownerEmail: 'owner@example.com',
      sessionTtlMs: 60_000,
      invitationTtlMs: 60_000,
    },
    passwordService: {},
    sendInvitation: async () => {},
    rateLimit,
    clientIp: (req) => req.socket.remoteAddress,
    authGate: {
      acquireConcurrency: () => ({ ok: true, release() {} }),
      admitGlobal: () => ({ ok: true }),
    },
  });
  const router = createAdminRouter({
    service,
    postgres,
    commerce: {},
    readJson: async () => ({}),
    send: (res, status, payload) => {
      Object.assign(res, { headersSent: true, status, payload });
    },
    getCookie: (req) => req.cookie,
    hasJsonContentType: () => true,
    onUserAccessChanged: async () => {},
  });
  return { service, router, counters };
}
test('signed admin sessions authenticate class and expiry before storage', () => {
  const expiresAt = Date.now() + 60_000;
  const token = createAdminSessionToken(TOKEN_KEY, {
    isOwner: true,
    expiresAt,
    random: 'a'.repeat(43),
  });
  assert.deepEqual(readAdminSessionToken(TOKEN_KEY, token, expiresAt - 1), {
    className: 'owner',
    isOwner: true,
    expiresAt,
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal(readAdminSessionToken(TOKEN_KEY, tampered), null);
  assert.equal(readAdminSessionToken(TOKEN_KEY, token, expiresAt), null);
  assert.equal(readAdminSessionToken(TOKEN_KEY, 'random-cookie'), null);
});
test('random cookies stay at zero session SQL and cannot consume Owner capacity', async () => {
  const rates = countedRateLimit();
  const setup = adminHarness({ isOwner: true, rateLimit: rates.rateLimit });
  for (let index = 0; index < 61; index += 1) {
    const res = response();
    await setup.router.handle(
      request(`random-cookie-${index}`),
      res,
      '/api/admin/v1/auth/me',
    );
    assert.equal(res.status, index < 60 ? 401 : 429);
  }
  assert.equal(setup.counters.findSession, 0);
  assert.equal(setup.counters.accountAccess, 0);
  assert.equal(setup.counters.rotateCsrf, 0);
  assert.equal(setup.counters.revokeSession, 0);

  const ownerToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: true,
    expiresAt: Date.now() + 60_000,
  });
  const ownerResponse = response();
  await setup.router.handle(
    request(ownerToken),
    ownerResponse,
    '/api/admin/v1/auth/me',
  );
  assert.equal(ownerResponse.status, 200);
  assert.deepEqual(setup.counters, {
    findSession: 1,
    accountAccess: 1,
    rotateCsrf: 1,
    revokeSession: 0,
  });
});
test('member pre-auth and actor quotas stop downstream PostgreSQL work', async () => {
  const memberToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: false,
    expiresAt: Date.now() + 60_000,
  });
  const preDenied = adminHarness({
    isOwner: false,
    rateLimit: async ({ scope }) => ({
      allowed: scope !== 'admin-ingress-member-admin-token',
    }),
  });
  const preResponse = response();
  await preDenied.router.handle(
    request(memberToken),
    preResponse,
    '/api/admin/v1/auth/me',
  );
  assert.equal(preResponse.status, 429);
  assert.deepEqual(preDenied.counters, {
    findSession: 0,
    accountAccess: 0,
    rotateCsrf: 0,
    revokeSession: 0,
  });

  const actorDenied = adminHarness({
    isOwner: false,
    rateLimit: async ({ scope }) => ({
      allowed: scope !== 'admin-ingress-member-session',
    }),
  });
  const actorResponse = response();
  await actorDenied.router.handle(
    request(memberToken),
    actorResponse,
    '/api/admin/v1/auth/me',
  );
  assert.equal(actorResponse.status, 429);
  assert.deepEqual(actorDenied.counters, {
    findSession: 1,
    accountAccess: 0,
    rotateCsrf: 0,
    revokeSession: 0,
  });
});
test('session envelope class mismatch revokes before RBAC or rotation', async () => {
  const setup = adminHarness({
    isOwner: true,
    rateLimit: async () => ({ allowed: true }),
  });
  const memberToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: false,
    expiresAt: Date.now() + 60_000,
  });
  const res = response();
  await setup.router.handle(request(memberToken), res, '/api/admin/v1/auth/me');
  assert.equal(res.status, 401);
  assert.deepEqual(setup.counters, {
    findSession: 1,
    accountAccess: 0,
    rotateCsrf: 0,
    revokeSession: 1,
  });
});
test('local concurrency gates reserve independent Owner capacity', async () => {
  const limits = {
    anonymous: { local: 2, ip: 10, token: 10, global: 10 },
    member: {
      local: 2, ip: 10, token: 10, global: 10, session: 10, actor: 10,
    },
    owner: {
      local: 1, ip: 10, token: 10, global: 10, session: 10, actor: 10,
    },
  };
  const ingress = createAdminIngress({
    rateLimit: async () => ({ allowed: true }),
    clientIp: (req) => req.socket.remoteAddress,
    tokenKey: TOKEN_KEY,
    limits,
  });
  const first = await ingress.enter(request(null), null, '/api/admin/v1/auth/me');
  const second = await ingress.enter(request(null), null, '/api/admin/v1/auth/me');
  await assert.rejects(
    ingress.enter(request(null), null, '/api/admin/v1/auth/me'),
    /auth-busy/,
  );
  const memberToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: false,
    expiresAt: Date.now() + 60_000,
  });
  const members = await Promise.all([
    ingress.enter(request(memberToken), memberToken, '/api/admin/v1/auth/me'),
    ingress.enter(request(memberToken), memberToken, '/api/admin/v1/auth/me'),
  ]);
  await assert.rejects(
    ingress.enter(request(memberToken), memberToken, '/api/admin/v1/auth/me'),
    /auth-busy/,
  );
  const ownerToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: true,
    expiresAt: Date.now() + 60_000,
  });
  const owner = await ingress.enter(
    request(ownerToken),
    ownerToken,
    '/api/admin/v1/auth/me',
  );
  owner.release();
  members.forEach((permit) => permit.release());
  first.release();
  second.release();

  let redisDown = true;
  const recoverable = createAdminIngress({
    rateLimit: async () => {
      if (redisDown) throw new Error('redis-down');
      return { allowed: true };
    },
    clientIp: (req) => req.socket.remoteAddress,
    tokenKey: TOKEN_KEY,
    limits,
  });
  await assert.rejects(
    recoverable.enter(request(null), null, '/api/admin/v1/auth/me'),
    /admin-ingress-unavailable/,
  );
  redisDown = false;
  (await recoverable.enter(request(null), null, '/api/admin/v1/auth/me')).release();
});
