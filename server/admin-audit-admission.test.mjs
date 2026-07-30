import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIT_ADMISSION_LIMITS,
  createAuditAdmission,
} from './admin/audit-admission.mjs';
import { createAdminRouter } from './admin/router.mjs';

const ORIGIN = 'https://admin.example.com';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';

function rateHarness() {
  const calls = [];
  const counts = new Map();
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

function principal(id, { owner = false, permissions = [] } = {}) {
  return {
    session: { id: `${id.slice(0, 24)}4aaa-8aaa-aaaaaaaaaaaa`.slice(0, 36) },
    account: {
      id,
      email: owner ? 'owner@example.com' : 'member@example.com',
      status: 'active',
      isOwner: owner,
    },
    roles: [],
    permissions,
  };
}

function request(pathname, method = 'POST', {
  origin = ORIGIN,
  contentType = 'application/json',
  ip = '198.51.100.10',
  payload = {},
} = {}) {
  return {
    url: pathname,
    method,
    payload,
    headers: {
      origin,
      'content-type': contentType,
      'x-csrf-token': 'csrf-token',
    },
    socket: { remoteAddress: ip },
    resume() {},
  };
}

function response() {
  return { headersSent: false, status: null, payload: null, headers: {} };
}

function send(res, status, payload, headers = {}) {
  Object.assign(res, { headersSent: true, status, payload, headers });
}

function routerHarness({
  current = null,
  admitAudit,
  login = async () => { throw new Error('too-many-attempts'); },
  enterRequest = async () => ({ release() {} }),
} = {}) {
  const audits = [];
  const writes = [];
  const calls = { body: 0, invite: 0, resend: 0 };
  const service = {
    config: { origin: ORIGIN, sessionTtlMs: 60_000 },
    current: async () => current,
    verifyCsrf: async () => true,
    enterRequest,
    admitAudit,
    login,
    activate: async () => { throw new Error('invalid-or-expired-invitation'); },
    revokeSession: async () => {},
    audit: async (_req, _current, event) => { audits.push(event); },
    inviteOperator: async () => { calls.invite += 1; return {}; },
    resendInvitation: async () => { calls.resend += 1; return {}; },
  };
  const postgres = {
    async withTransaction(work) { return work(this); },
    userAccess: {
      setDisabled: async (id, disabled) => {
        writes.push({ id, disabled });
        return { id, username: 'student', disabledAt: disabled ? new Date() : null };
      },
    },
  };
  const router = createAdminRouter({
    service,
    postgres,
    commerce: {},
    readJson: async (req) => { calls.body += 1; return req.payload; },
    send,
    getCookie: () => 'admin-session',
    hasJsonContentType: (req) => req.headers['content-type'] === 'application/json',
    onUserAccessChanged: async () => {},
  });
  return { router, audits, writes, calls };
}

test('distributed audit quotas isolate anonymous, member, and Owner traffic', async () => {
  const anonymousRates = rateHarness();
  const admitAnonymous = createAuditAdmission({
    rateLimit: anonymousRates.rateLimit,
    clientIp: (req) => req.socket.remoteAddress,
  });
  for (let index = 0; index < AUDIT_ADMISSION_LIMITS.anonymousGlobal; index += 1) {
    assert.equal(await admitAnonymous(
      request('/api/admin/v1/auth/login', 'POST', { ip: `198.51.100.${index + 1}` }),
      null,
      { action: 'admin.auth.login', outcome: 'failure', error: `error-${index}` },
    ), true);
  }
  assert.equal(await admitAnonymous(
    request('/api/admin/v1/auth/login', 'POST', { ip: '203.0.113.250' }),
    null,
    { action: 'admin.auth.login', outcome: 'failure', error: 'overflow' },
  ), false);
  assert.equal(await admitAnonymous(
    request('/api/admin/v1/users', 'POST'),
    principal(OWNER_ID, { owner: true }),
    { action: 'user.suspend', outcome: 'attempt' },
  ), true);

  const memberRates = rateHarness();
  const admitMember = createAuditAdmission({
    rateLimit: memberRates.rateLimit,
    clientIp: (req) => req.socket.remoteAddress,
  });
  const member = principal(MEMBER_ID);
  for (let index = 0; index < AUDIT_ADMISSION_LIMITS.memberSession; index += 1) {
    assert.equal(await admitMember(
      request('/api/admin/v1/users', 'POST'),
      member,
      { action: 'user.suspend', outcome: 'attempt' },
    ), true);
  }
  assert.equal(await admitMember(
    request('/api/admin/v1/users', 'POST'),
    member,
    { action: 'user.suspend', outcome: 'attempt' },
  ), false);
  assert.equal(await admitMember(
    request('/api/admin/v1/users', 'POST'),
    principal(OWNER_ID, { owner: true }),
    { action: 'user.suspend', outcome: 'attempt' },
  ), true);
});

test('bad auth traffic produces bounded audits and wrong methods produce none', async () => {
  const rates = rateHarness();
  const admitAudit = createAuditAdmission({
    rateLimit: rates.rateLimit,
    clientIp: (req) => req.socket.remoteAddress,
  });
  const { router, audits } = routerHarness({ admitAudit });
  const path = '/api/admin/v1/auth/login';

  for (let index = 0; index < 40; index += 1) {
    await router.handle(request(path, 'PUT'), response(), path);
    await router.handle(
      request(path, 'POST', { origin: 'https://evil.example.com' }),
      response(),
      path,
    );
    await router.handle(
      request(path, 'POST', { contentType: 'text/plain' }),
      response(),
      path,
    );
    await router.handle(request(path), response(), path);
  }

  assert.deepEqual(
    audits.map((event) => event.details.error).sort(),
    ['invalid-json-content-type', 'origin-required', 'too-many-attempts'],
  );
  assert.equal(
    rates.calls.filter((call) => call.scope === 'admin-audit-anonymous-global').length,
    3,
  );
});

test('pre-auth ingress denial cannot fall through to PostgreSQL audit', async () => {
  let auditAdmissions = 0;
  const setup = routerHarness({
    enterRequest: async () => { throw new Error('too-many-attempts'); },
    admitAudit: async () => { auditAdmissions += 1; return true; },
  });
  const path = '/api/admin/v1/auth/login';
  const res = response();
  await setup.router.handle(request(path), res, path);
  assert.equal(res.status, 429);
  assert.equal(auditAdmissions, 0);
  assert.equal(setup.audits.length, 0);
});

test('one mutation admission covers intent and result, and denial is fail-closed', async () => {
  const owner = principal(OWNER_ID, {
    owner: true,
    permissions: ['users.restrict'],
  });
  let admissions = 0;
  const admitted = routerHarness({
    current: owner,
    admitAudit: async () => { admissions += 1; return true; },
  });
  const path = `/api/admin/v1/users/${USER_ID}/status`;
  const accepted = response();
  await admitted.router.handle(request(path, 'POST', {
    payload: { disabled: true, reason: '风控复核' },
  }), accepted, path);
  assert.equal(accepted.status, 200);
  assert.equal(admissions, 1);
  assert.deepEqual(admitted.audits.map((event) => event.outcome), ['attempt', 'success']);
  assert.equal(admitted.writes.length, 1);

  const denied = routerHarness({
    current: owner,
    admitAudit: async () => false,
  });
  const rejected = response();
  await denied.router.handle(request(path, 'POST', {
    payload: { disabled: true, reason: '风控复核' },
  }), rejected, path);
  assert.equal(rejected.status, 429);
  assert.equal(denied.audits.length, 0);
  assert.equal(denied.writes.length, 0);

  const unavailable = routerHarness({
    current: owner,
    admitAudit: async () => { throw new Error('redis-down'); },
  });
  const unavailableResponse = response();
  await unavailable.router.handle(request(path, 'POST', {
    payload: { disabled: true, reason: '风控复核' },
  }), unavailableResponse, path);
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailable.audits.length, 0);
  assert.equal(unavailable.writes.length, 0);
});

test('non-Owner invitation attempts are rejected before body, audit, or email work', async () => {
  const member = principal(MEMBER_ID);
  let admissions = 0;
  const setup = routerHarness({
    current: member,
    admitAudit: async () => { admissions += 1; return true; },
  });
  const paths = [
    '/api/admin/v1/team/invitations',
    '/api/admin/v1/team/invitations/44444444-4444-4444-8444-444444444444/resend',
  ];
  for (const path of paths) {
    const res = response();
    await setup.router.handle(request(path, 'POST'), res, path);
    assert.equal(res.status, 403);
    assert.equal(res.payload.error, 'owner-required');
  }
  assert.deepEqual(setup.calls, { body: 0, invite: 0, resend: 0 });
  assert.equal(admissions, 0);
  assert.equal(setup.audits.length, 0);
});
