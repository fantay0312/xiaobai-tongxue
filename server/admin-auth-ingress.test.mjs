import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminService } from './admin/service.mjs';

function setup(rateLimit) {
  const calls = [];
  const service = createAdminService({
    postgres: {
      withTransaction: async () => { throw new Error('unexpected-transaction'); },
      adminRbac: {},
      adminAuth: {
        findAccountByEmail: async () => {
          calls.push('find-account');
          return null;
        },
        invitationIsUsable: async () => {
          calls.push('find-invitation');
          return true;
        },
      },
    },
    config: {
      tokenKey: Buffer.alloc(32, 4),
      ownerEmail: 'owner@example.com',
    },
    passwordService: {
      verify: async () => { calls.push('verify'); return false; },
      hash: async () => { calls.push('hash'); return {}; },
    },
    sendInvitation: async () => {},
    rateLimit,
    clientIp: () => '198.51.100.20',
    authGate: {
      acquireConcurrency: () => ({ ok: true, release() {} }),
      admitGlobal: () => ({ ok: true }),
    },
  });
  return { service, calls };
}

test('admin login identity ingress rejects before account lookup or KDF', async () => {
  const scopes = [];
  const { service, calls } = setup(async ({ scope }) => {
    scopes.push(scope);
    return { allowed: scope !== 'admin-login-id' };
  });
  await assert.rejects(service.login({
    email: 'randomized@example.com',
    password: 'valid-shape-password',
  }, { headers: {} }), /too-many-attempts/);
  assert.deepEqual(scopes, ['admin-login-id']);
  assert.deepEqual(calls, []);
});

test('admin activation invitation ingress rejects before lookup or KDF', async () => {
  const scopes = [];
  const { service, calls } = setup(async ({ scope }) => {
    scopes.push(scope);
    return { allowed: scope !== 'admin-activate-invitation' };
  });
  await assert.rejects(service.activate({
    token: 'x'.repeat(48),
    password: 'valid-shape-password',
  }, { headers: {} }), /too-many-attempts/);
  assert.deepEqual(scopes, ['admin-activate-invitation']);
  assert.deepEqual(calls, []);
});

test('admin auth Redis outage fails closed before PostgreSQL', async () => {
  for (const action of ['login', 'activate']) {
    const { service, calls } = setup(async () => { throw new Error('redis-down'); });
    const input = action === 'login'
      ? { email: 'randomized@example.com', password: 'valid-shape-password' }
      : { token: 'x'.repeat(48), password: 'valid-shape-password' };
    await assert.rejects(
      service[action](input, { headers: {} }),
      /admin-ingress-unavailable/,
    );
    assert.deepEqual(calls, []);
  }
});
