import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authTransportAllowed,
  bindVerifiedEmail,
  canonicalName,
  changeVerifiedEmail,
  createAuthGate,
  createPasswordService,
  encodedIdentityMatches,
  ipRateKey,
  maskEmail,
  protectedAccessError,
  revokeUserSessions,
  userHasVerifiedEmail,
  validateUserSets,
} from './auth-security.mjs';
import { PASSWORD_SCHEME_CURRENT } from './credential-format.mjs';

function user(name, email) {
  return {
    name,
    salt: 'a'.repeat(32),
    hash: 'b'.repeat(128),
    ...(email ? { email, emailVerifiedAt: '2026-07-14T00:00:00.000Z' } : {}),
  };
}

test('user validation is strict while legacy users may omit email', () => {
  const result = validateUserSets([user('老师')], [user('旧用户')]);
  assert.equal(result.users.length, 1);
  assert.equal(result.registrations.length, 1);
  assert.throws(() => validateUserSets({}, []), /expected-array/);
  assert.throws(() => validateUserSets([], [{ name: '坏用户' }]), /bad-salt/);
  assert.throws(() => validateUserSets([], [
    { ...user('新用户', 'a@example.com'), emailVerifiedAt: undefined },
  ]), /bad-email-verification/);
  assert.throws(() => validateUserSets([
    { ...user('预置用户'), email: 'configured@example.com' },
  ], []), /bad-email-verification/);
});

test('canonical name and email uniqueness spans configured and registered users', () => {
  assert.equal(canonicalName('Teacher'), 'teacher');
  assert.throws(() => validateUserSets([user('Teacher')], [user('teacher')]), /duplicate-name/);
  assert.throws(() => validateUserSets(
    [user('老师', 'A@Example.com')],
    [user('学生', 'a@example.com')],
  ), /duplicate-email/);
});

test('configured-user email overlay is strict, merged, and globally unique', () => {
  const configured = [user('老师')];
  const registered = [user('学生', 'student@example.com')];
  const bindings = [{
    name: '老师', email: 'teacher@example.com', emailVerifiedAt: '2026-07-14T01:00:00.000Z',
  }];
  const result = validateUserSets(configured, registered, bindings);
  assert.equal(result.users[0].email, 'teacher@example.com');
  assert.equal(result.bindings[0].name, '老师');
  assert.throws(() => validateUserSets(configured, registered, [{ ...bindings[0], extra: true }]), /bad-shape/);
  assert.throws(() => validateUserSets(configured, registered, [{ ...bindings[0], name: '无此用户' }]), /unknown-config-user/);
  assert.throws(() => validateUserSets([user('Teacher')], [], [{
    ...bindings[0], name: 'teacher',
  }]), /noncanonical-name/);
  assert.throws(() => validateUserSets(configured, registered, [{
    ...bindings[0], email: 'student@example.com',
  }]), /duplicate-email/);
});

test('verified binding persists through overlay for configured users and registry for legacy users', () => {
  const configured = [user('老师')];
  const registered = [user('旧学生')];
  const verifiedAt = '2026-07-14T02:00:00.000Z';
  const configuredUpdate = bindVerifiedEmail(
    configured, registered, [], '老师', 'Teacher@Example.com', verifiedAt,
  );
  assert.equal(configuredUpdate.source, 'bindings');
  assert.equal(configuredUpdate.bindings[0].email, 'teacher@example.com');
  assert.equal(validateUserSets(configured, registered, configuredUpdate.bindings).users[0].email,
    'teacher@example.com');

  const registeredUpdate = bindVerifiedEmail(
    configured, registered, [], '旧学生', 'legacy@example.com', verifiedAt,
  );
  assert.equal(registeredUpdate.source, 'registrations');
  assert.equal(registeredUpdate.registrations[0].emailVerifiedAt, verifiedAt);
  assert.equal(validateUserSets(configured, registeredUpdate.registrations).registrations[0].email,
    'legacy@example.com');
});

test('binding rejects already-bound users and globally owned email addresses', () => {
  const verifiedAt = '2026-07-14T02:00:00.000Z';
  assert.throws(() => bindVerifiedEmail(
    [user('老师', 'teacher@example.com')], [], [], '老师', 'new@example.com', verifiedAt,
  ), /email-already-bound/);
  assert.throws(() => bindVerifiedEmail(
    [user('老师')], [user('学生', 'student@example.com')], [], '老师', 'student@example.com', verifiedAt,
  ), /email-taken/);
  assert.equal(maskEmail('Teacher.Name@example.com'), 't***@example.com');
  assert.equal(maskEmail('bad-address'), null);
  assert.equal(userHasVerifiedEmail(user('老师', 'teacher@example.com')), true);
  assert.equal(userHasVerifiedEmail(user('旧老师')), false);
  assert.equal(protectedAccessError(user('旧老师')), 'email-verification-required');
  assert.equal(protectedAccessError(user('老师', 'teacher@example.com')), null);
});

test('verified email change updates the correct durable source and remains valid after reload', () => {
  const configured = [user('老师', 'config-default@example.com')];
  const registered = [user('学生', 'student-old@example.com')];
  const firstAt = '2026-07-14T02:00:00.000Z';
  const changedAt = '2026-07-15T02:00:00.000Z';
  const bindings = [{ name: '老师', email: 'config-old@example.com', emailVerifiedAt: firstAt }];

  const configuredUpdate = changeVerifiedEmail(
    configured, registered, bindings, '老师', 'Config-New@Example.com', changedAt,
  );
  assert.equal(configuredUpdate.source, 'bindings');
  assert.deepEqual(configuredUpdate.bindings, [{
    name: '老师', email: 'config-new@example.com', emailVerifiedAt: changedAt,
  }]);
  assert.equal(validateUserSets(configured, registered, configuredUpdate.bindings).users[0].email,
    'config-new@example.com');

  const registeredUpdate = changeVerifiedEmail(
    configured, registered, bindings, '学生', 'student-new@example.com', changedAt,
  );
  assert.equal(registeredUpdate.source, 'registrations');
  assert.equal(registeredUpdate.registrations[0].email, 'student-new@example.com');
  assert.equal(validateUserSets(
    configured, registeredUpdate.registrations, bindings,
  ).registrations[0].email, 'student-new@example.com');
});

test('verified email change rejects unbound, unchanged, and globally owned targets', () => {
  const verifiedAt = '2026-07-15T02:00:00.000Z';
  const configured = [user('老师', 'teacher@example.com'), user('旧师')];
  const registered = [user('学生', 'student@example.com')];
  assert.throws(() => changeVerifiedEmail(
    configured, registered, [], '旧师', 'new@example.com', verifiedAt,
  ), /email-not-bound/);
  assert.throws(() => changeVerifiedEmail(
    configured, registered, [], '老师', 'Teacher@Example.com', verifiedAt,
  ), /email-unchanged/);
  assert.throws(() => changeVerifiedEmail(
    configured, registered, [], '老师', 'student@example.com', verifiedAt,
  ), /email-taken/);
});

test('two legacy accounts racing for one email can persist only one owner', () => {
  const configured = [user('甲账号'), user('乙账号')];
  const verifiedAt = '2026-07-14T02:00:00.000Z';
  const winner = bindVerifiedEmail(
    configured, [], [], '甲账号', 'one-owner@example.com', verifiedAt,
  );
  assert.throws(() => bindVerifiedEmail(
    configured, winner.registrations, winner.bindings,
    '乙账号', 'one-owner@example.com', verifiedAt,
  ), /email-taken/);
  assert.equal(winner.users[0].email, 'one-owner@example.com');
  assert.equal(winner.users[1].email, undefined);
});

test('binding upgrade revokes every prior session for that canonical account only', () => {
  const sessions = new Map([
    ['old-a', { name: 'Teacher' }],
    ['old-b', { name: 'teacher' }],
    ['other', { name: '学生' }],
  ]);
  assert.equal(revokeUserSessions(sessions, 'TEACHER'), 2);
  assert.deepEqual([...sessions.keys()], ['other']);
});

test('encoded expected identity must canonically match the cookie user', () => {
  assert.equal(encodedIdentityMatches(encodeURIComponent('小白同学'), '小白同学'), true);
  assert.equal(encodedIdentityMatches('Teacher', 'teacher'), true);
  assert.equal(encodedIdentityMatches(encodeURIComponent('用户A'), '用户B'), false);
  assert.equal(encodedIdentityMatches(undefined, '小白同学'), false);
  assert.equal(encodedIdentityMatches('%E0%A4%A', '小白同学'), false);
  assert.equal(encodedIdentityMatches('小白同学', '小白同学'), false);
});

test('password service performs the same derivation for known and unknown users', async () => {
  let calls = 0;
  const derive = async (_password, _salt, length) => { calls += 1; return Buffer.alloc(length, 9); };
  const service = createPasswordService({ derive, dummyHash: Buffer.alloc(64, 4) });
  const known = { salt: 'a'.repeat(32), hash: Buffer.alloc(64, 9).toString('hex') };
  assert.equal(await service.verify(known, 'password'), true);
  assert.equal(await service.verify(null, 'password'), false);
  assert.equal(calls, 4);
});

test('password service preserves legacy verification and versions stronger new hashes', async () => {
  const calls = [];
  const derive = async (_password, _salt, length, parameters) => {
    calls.push(parameters);
    return Buffer.alloc(length, 7);
  };
  const service = createPasswordService({ derive, dummyHash: Buffer.alloc(64, 4) });
  const legacy = { salt: 'a'.repeat(32), hash: Buffer.alloc(64, 7).toString('hex') };
  const current = { ...legacy, passwordScheme: PASSWORD_SCHEME_CURRENT };

  assert.equal(await service.verify(legacy, 'password'), true);
  assert.equal(await service.verify(current, 'password'), true);
  assert.equal(service.needsRehash(legacy), true);
  assert.equal(service.needsRehash(current), false);
  assert.equal(calls[0].N, 2 ** 14);
  assert.ok(calls[1].N > calls[0].N);
  assert.equal(calls[2].N, calls[0].N);
  assert.equal(calls[3].N, calls[1].N);

  const hashed = await service.hash('new-password');
  assert.equal(hashed.passwordScheme, PASSWORD_SCHEME_CURRENT);
  assert.match(hashed.salt, /^[0-9a-f]{32}$/);
  assert.match(hashed.hash, /^[0-9a-f]{128}$/);
  assert.ok(calls.at(-1).N > 2 ** 14);
});

test('auth gate enforces concurrency and minute budgets atomically', () => {
  let at = 0;
  const gate = createAuthGate({ now: () => at, maxConcurrent: 1, maxPerMinute: 2 });
  const first = gate.enter();
  assert.equal(first.ok, true);
  assert.equal(gate.enter().error, 'auth-busy');
  first.release();
  const second = gate.enter();
  assert.equal(second.ok, true);
  second.release();
  assert.equal(gate.enter().error, 'too-many-attempts');
  at += 60_001;
  assert.equal(gate.enter().ok, true);
});

test('per-IP rejection before global admission neither drains the budget nor leaks a slot', () => {
  const gate = createAuthGate({ maxConcurrent: 1, maxPerMinute: 2 });

  function attempt(perIpAdmission) {
    const permit = gate.acquireConcurrency();
    if (!permit.ok) return permit;
    try {
      if (!perIpAdmission.ok) return perIpAdmission;
      return gate.admitGlobal();
    } finally {
      permit.release();
    }
  }

  const blockedIp = { ok: false, error: 'too-many-attempts' };
  for (let index = 0; index < 20; index += 1) {
    assert.equal(attempt(blockedIp).error, 'too-many-attempts');
  }
  assert.equal(attempt({ ok: true }).ok, true);
  assert.equal(attempt({ ok: true }).ok, true);
  assert.equal(attempt({ ok: true }).error, 'too-many-attempts');
});

test('IPv6 addresses are grouped by /64 while IPv4 stays exact', () => {
  assert.equal(ipRateKey('2001:0db8:1234:5678::1'), '2001:db8:1234:5678::/64');
  assert.equal(ipRateKey('2001:db8:1234:5678:ffff::2'), '2001:db8:1234:5678::/64');
  assert.equal(ipRateKey('::ffff:192.0.2.4'), '192.0.2.4');
  assert.equal(ipRateKey('192.0.2.5'), '192.0.2.5');
  assert.equal(ipRateKey('not-an-ip'), 'unknown');
});

test('auth transport is HTTPS-only unless local/test override is explicit', () => {
  const localHttps = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-proto': 'https' },
  };
  const localHttp = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-proto': 'http' },
  };
  const remoteSpoof = {
    socket: { remoteAddress: '203.0.113.7' },
    headers: { 'x-forwarded-proto': 'https' },
  };
  assert.equal(authTransportAllowed(localHttps), true);
  assert.equal(authTransportAllowed(localHttp), false);
  assert.equal(authTransportAllowed(remoteSpoof), false);
  assert.equal(authTransportAllowed(localHttp, true), true);
});
