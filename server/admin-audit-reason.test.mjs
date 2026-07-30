import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminRouter } from './admin/router.mjs';

const ORIGIN = 'https://admin.example.com';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request(payload) {
  return {
    url: `/api/admin/v1/users/${USER_ID}/status`,
    method: 'POST',
    payload,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-token',
    },
  };
}

function response() {
  return { headersSent: false, status: null, payload: null };
}

function harness() {
  const audits = [];
  const writes = [];
  const current = {
    session: { id: ADMIN_ID },
    account: {
      id: ADMIN_ID,
      email: 'owner@example.com',
      status: 'active',
      isOwner: true,
    },
    roles: [],
    permissions: ['users.restrict'],
  };
  const postgres = {
    async withTransaction(work) { return work(this); },
    userAccess: {
      setDisabled: async (id, disabled) => {
        writes.push({ id, disabled });
        return {
          id,
          source: 'postgres',
          username: 'student',
          displayName: 'Student',
          disabledAt: disabled ? '2026-07-30T00:00:00.000Z' : null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
        };
      },
    },
  };
  const router = createAdminRouter({
    service: {
      config: { origin: ORIGIN, sessionTtlMs: 60_000 },
      current: async () => current,
      verifyCsrf: async () => true,
      enterRequest: async () => ({ release() {} }),
      admitAudit: async () => true,
      audit: async (_req, _principal, event) => { audits.push(event); },
    },
    postgres,
    commerce: {},
    readJson: async (req) => req.payload,
    send: (res, status, payload) => {
      Object.assign(res, { status, payload, headersSent: true });
    },
    getCookie: () => 'sid',
    hasJsonContentType: () => true,
    onUserAccessChanged: async () => {},
  });
  return { router, audits, writes };
}

test('user disabled must be a boolean and cannot forge the audit action', async () => {
  const { router, audits, writes } = harness();
  const res = response();
  await router.handle(
    request({ disabled: 'false', reason: '账号状态审批' }),
    res,
    `/api/admin/v1/users/${USER_ID}/status`,
  );
  assert.equal(res.status, 400);
  assert.equal(res.payload.error, 'invalid-disabled');
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test('a normalized durable intent precedes the write and success event', async () => {
  const { router, audits, writes } = harness();
  const res = response();
  await router.handle(
    request({ disabled: true, reason: '  e\u0301  ' }),
    res,
    `/api/admin/v1/users/${USER_ID}/status`,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(writes, [{ id: USER_ID, disabled: true }]);
  assert.deepEqual(audits.map((event) => event.outcome), ['attempt', 'success']);
  assert.deepEqual(audits.map((event) => event.action), ['user.suspend', 'user.suspend']);
  assert.deepEqual(audits.map((event) => event.details.reason), ['é', 'é']);
});

test('blank high-risk reasons are rejected before audit or mutation', async () => {
  const { router, audits, writes } = harness();
  const res = response();
  await router.handle(
    request({ disabled: false, reason: ' \n\t ' }),
    res,
    `/api/admin/v1/users/${USER_ID}/status`,
  );
  assert.equal(res.status, 400);
  assert.equal(res.payload.error, 'invalid-reason');
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});
