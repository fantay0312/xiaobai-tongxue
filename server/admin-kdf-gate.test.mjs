import assert from 'node:assert/strict';
import test from 'node:test';
import { createPasswordService } from './auth-security.mjs';
import { publicError } from './admin/http.mjs';
import { createAdminService } from './admin/service.mjs';
import { credentials } from './admin/service-utils.mjs';
import { createAuthGate } from './auth-security.mjs';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const account = {
  id: ACCOUNT_ID,
  email: 'owner@example.com',
  status: 'active',
  passwordHash: 'stored-hash',
  passwordSalt: 'stored-salt',
  passwordScheme: 'scrypt-v2',
  sessionVersion: 1,
};

function serviceWith({
  passwordService,
  authGate,
  invitationIsUsable,
  findAccountByEmail,
} = {}) {
  return createAdminService({
    postgres: {
      withTransaction: async (work) => work({
        adminAuth: {
          activate: async () => account,
          createSession: async () => {},
        },
        adminRbac: { accountAccess: async () => ({ roles: [], permissions: [] }) },
      }),
      adminAuth: {
        findAccountByEmail: findAccountByEmail ?? (async () => account),
        invitationIsUsable: invitationIsUsable ?? (async () => true),
      },
      adminRbac: {},
    },
    config: {
      tokenKey: Buffer.alloc(32, 1),
      sessionTtlMs: 60_000,
      invitationTtlMs: 60_000,
      origin: 'https://admin.example.com',
    },
    passwordService,
    sendInvitation: async () => {},
    rateLimit: async () => ({ allowed: true }),
    clientIp: () => '127.0.0.1',
    authGate,
  });
}

test('admin login shares the process KDF concurrency and minute budgets', async () => {
  const gate = createAuthGate({ maxConcurrent: 1, maxPerMinute: 1 });
  let resolveVerify;
  let started;
  const verifyStarted = new Promise((resolve) => { started = resolve; });
  let verifyCalls = 0;
  let lookups = 0;
  const service = serviceWith({
    authGate: gate,
    findAccountByEmail: async () => { lookups += 1; return account; },
    passwordService: {
      verify: async () => {
        verifyCalls += 1;
        started();
        return new Promise((resolve) => { resolveVerify = resolve; });
      },
    },
  });
  const input = { email: account.email, password: 'valid-password-value' };
  const req = { headers: {} };
  const first = service.login(input, req);
  await verifyStarted;
  await assert.rejects(service.login(input, req), /auth-busy/);
  assert.equal(lookups, 1);
  resolveVerify(false);
  await assert.rejects(first, /invalid-credentials/);
  await assert.rejects(service.login(input, req), /too-many-attempts/);
  assert.equal(lookups, 1);
  assert.equal(verifyCalls, 1);
});

test('admin account lookup runs only after the local KDF permit', async () => {
  const events = [];
  const service = serviceWith({
    authGate: {
      acquireConcurrency: () => {
        events.push('acquire');
        return { ok: true, release: () => events.push('release') };
      },
      admitGlobal: () => {
        events.push('admit');
        return { ok: true };
      },
    },
    findAccountByEmail: async () => {
      events.push('account-lookup');
      return account;
    },
    passwordService: {
      verify: async () => {
        events.push('verify');
        return false;
      },
    },
  });
  await assert.rejects(service.login({
    email: account.email,
    password: 'valid-password-value',
  }, { headers: {} }), /invalid-credentials/);
  assert.deepEqual(events, ['acquire', 'admit', 'account-lookup', 'verify', 'release']);
});

test('activation hashes only inside a releasable KDF permit', async () => {
  const events = [];
  const service = serviceWith({
    authGate: {
      acquireConcurrency: () => ({
        ok: true,
        release: () => events.push('release'),
      }),
      admitGlobal: () => {
        events.push('admit');
        return { ok: true };
      },
    },
    invitationIsUsable: async () => {
      events.push('invitation-lookup');
      return true;
    },
    passwordService: {
      hash: async () => {
        events.push('hash');
        throw new Error('kdf-failed');
      },
    },
  });
  await assert.rejects(service.activate({
    token: 'x'.repeat(48),
    password: 'long-enough-password',
  }, { headers: {} }), /kdf-failed/);
  assert.deepEqual(events, ['admit', 'invitation-lookup', 'hash', 'release']);
});

test('pending and unknown admin accounts perform identical dummy derivations', async () => {
  let derivations = 0;
  const passwordService = createPasswordService({
    derive: async (_password, _salt, length) => {
      derivations += 1;
      return Buffer.alloc(length, 7);
    },
    dummyHash: Buffer.alloc(64, 3),
  });
  const pending = {
    passwordHash: null,
    passwordSalt: null,
    passwordScheme: null,
  };
  assert.equal(credentials(pending), null);
  assert.equal(credentials({
    passwordHash: 'malformed',
    passwordSalt: 'malformed',
    passwordScheme: 'scrypt-v2',
  }), null);
  assert.equal(await passwordService.verify(credentials(pending), 'valid-password'), false);
  assert.equal(await passwordService.verify(credentials(null), 'valid-password'), false);
  assert.equal(derivations, 4);
});

test('admin overload and slow bodies have explicit public responses', () => {
  const busy = new Error('auth-busy');
  busy.retryAfter = 7;
  assert.deepEqual(publicError(busy), {
    status: 429,
    code: 'auth-busy',
    retryAfter: 7,
  });
  assert.deepEqual(publicError(new Error('body-timeout')), {
    status: 408,
    code: 'body-timeout',
  });
});
