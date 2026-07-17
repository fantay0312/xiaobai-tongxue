import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPasswordOverrides,
  updatePassword,
  validatePasswordOverrides,
} from './password-credentials.mjs';
import { PASSWORD_SCHEME_CURRENT } from './credential-format.mjs';

const OLD_SALT = 'a'.repeat(32);
const OLD_HASH = 'b'.repeat(128);
const NEW_SALT = 'c'.repeat(32);
const NEW_HASH = 'd'.repeat(128);
const CHANGED_AT = '2026-07-15T03:04:05.000Z';

function user(name, extra = {}) {
  return { name, salt: OLD_SALT, hash: OLD_HASH, ...extra };
}

function override(name = 'Teacher', extra = {}) {
  return { name, salt: NEW_SALT, hash: NEW_HASH, changedAt: CHANGED_AT, ...extra };
}

test('validates the exact password override shape and returns a detached record', () => {
  const raw = [override()];
  const result = validatePasswordOverrides([user('Teacher')], raw);
  assert.deepEqual(result, raw);
  assert.notEqual(result[0], raw[0]);
  assert.throws(
    () => validatePasswordOverrides([user('Teacher')], [{ ...override(), extra: true }]),
    /bad-shape/,
  );
  const { changedAt: _removed, ...missing } = override();
  assert.throws(() => validatePasswordOverrides([user('Teacher')], [missing]), /bad-shape/);
  assert.throws(() => validatePasswordOverrides([user('Teacher')], [null]), /expected-object/);
});

test('requires arrays and valid configured-user records', () => {
  assert.throws(() => validatePasswordOverrides({}, []), /config\.users: expected-array/);
  assert.throws(() => validatePasswordOverrides([], {}), /password-overrides\.json: expected-array/);
  assert.throws(() => validatePasswordOverrides([null], []), /expected-object/);
  assert.throws(() => validatePasswordOverrides([user(' T ')], []), /bad-name/);
  assert.throws(() => validatePasswordOverrides([user('Teacher', { salt: 'bad' })], []), /bad-salt/);
  assert.throws(
    () => validatePasswordOverrides([user('Teacher'), user('teacher')], []),
    /duplicate-name/,
  );
});

test('override names must uniquely and exactly identify configured accounts', () => {
  const configured = [user('Teacher')];
  assert.throws(() => validatePasswordOverrides(configured, [override('teacher')]), /noncanonical-name/);
  assert.throws(() => validatePasswordOverrides(configured, [override('Student')]), /unknown-config-user/);
  assert.throws(
    () => validatePasswordOverrides(configured, [override(), override()]),
    /duplicate-name/,
  );
  assert.throws(() => validatePasswordOverrides(configured, [override(' Teacher ')]), /bad-name/);
});

test('override credentials and timestamps use strict persisted formats', () => {
  const configured = [user('Teacher')];
  for (const bad of [
    override('Teacher', { salt: 'A'.repeat(32) }),
    override('Teacher', { salt: 'a'.repeat(31) }),
    override('Teacher', { hash: 'D'.repeat(128) }),
    override('Teacher', { hash: 'd'.repeat(127) }),
  ]) {
    assert.throws(() => validatePasswordOverrides(configured, [bad]), /bad-(salt|hash)/);
  }
  for (const changedAt of ['2026-07-15T03:04:05Z', 'not-a-date', 123]) {
    assert.throws(
      () => validatePasswordOverrides(configured, [override('Teacher', { changedAt })]),
      /bad-changed-at/,
    );
  }
});

test('versioned password credentials accept the current scheme and reject unknown schemes', () => {
  const configured = [user('Teacher')];
  const versioned = override('Teacher', { passwordScheme: PASSWORD_SCHEME_CURRENT });
  assert.deepEqual(validatePasswordOverrides(configured, [versioned]), [versioned]);
  assert.throws(
    () => validatePasswordOverrides(configured, [
      override('Teacher', { passwordScheme: 'scrypt-future' }),
    ]),
    /bad-password-scheme/,
  );
  assert.throws(
    () => validatePasswordOverrides(configured, [override('Teacher', { passwordScheme: null })]),
    /bad-password-scheme/,
  );
});

test('applies overrides without mutating configured users or leaking metadata', () => {
  const configured = [user('Teacher', { role: 'coach' }), user('学生')];
  const result = applyPasswordOverrides(configured, [override()]);
  assert.deepEqual(result[0], {
    name: 'Teacher', salt: NEW_SALT, hash: NEW_HASH, role: 'coach',
  });
  assert.deepEqual(result[1], configured[1]);
  assert.notEqual(result[0], configured[0]);
  assert.notEqual(result[1], configured[1]);
  assert.equal(result[0].changedAt, undefined);
  assert.equal(configured[0].salt, OLD_SALT);
});

test('configured password updates append and replace durable overrides', () => {
  const configured = [user('Teacher'), user('学生')];
  const registrations = [user('Registered', { email: 'r@example.com' })];
  const first = updatePassword(
    configured, registrations, [], 'teacher', { salt: NEW_SALT, hash: NEW_HASH }, CHANGED_AT,
  );
  assert.equal(first.source, 'overrides');
  assert.deepEqual(first.overrides, [override()]);
  assert.equal(first.users[0].hash, NEW_HASH);
  assert.deepEqual(first.registrations, registrations);
  assert.notEqual(first.registrations[0], registrations[0]);

  const newerAt = '2026-07-16T03:04:05.000Z';
  const second = updatePassword(
    configured, registrations, first.overrides, 'Teacher',
    { salt: 'e'.repeat(32), hash: 'f'.repeat(128) }, newerAt,
  );
  assert.equal(second.overrides.length, 1);
  assert.deepEqual(second.overrides[0], {
    name: 'Teacher', salt: 'e'.repeat(32), hash: 'f'.repeat(128), changedAt: newerAt,
  });
});

test('registered password updates preserve account fields and record the change time', () => {
  const configured = [user('Teacher')];
  const registrations = [user('Registered', {
    email: 'student@example.com',
    emailVerifiedAt: '2026-07-14T00:00:00.000Z',
    createdAt: '2026-07-14T00:00:00.000Z',
    profile: { streak: 3 },
  })];
  const currentOverride = override();
  const result = updatePassword(
    configured, registrations, [currentOverride], 'REGISTERED',
    { salt: NEW_SALT, hash: NEW_HASH }, CHANGED_AT,
  );
  assert.equal(result.source, 'registrations');
  assert.deepEqual(result.overrides, [currentOverride]);
  assert.notEqual(result.overrides[0], currentOverride);
  assert.deepEqual(result.registrations[0], {
    ...registrations[0], salt: NEW_SALT, hash: NEW_HASH, passwordChangedAt: CHANGED_AT,
  });
  assert.deepEqual(result.registrations[0].profile, registrations[0].profile);
  assert.equal(result.users[0].hash, NEW_HASH);
  assert.equal(registrations[0].hash, OLD_HASH);
});

test('updates reject unknown users, malformed credentials, and malformed timestamps', () => {
  const configured = [user('Teacher')];
  const credentials = { salt: NEW_SALT, hash: NEW_HASH };
  assert.throws(
    () => updatePassword(configured, [], [], 'Missing', credentials, CHANGED_AT),
    /user-not-found/,
  );
  assert.throws(
    () => updatePassword(configured, [], [], '', credentials, CHANGED_AT),
    /bad-name/,
  );
  assert.throws(
    () => updatePassword(configured, [], [], 'Teacher', { ...credentials, extra: true }, CHANGED_AT),
    /bad-shape/,
  );
  assert.throws(
    () => updatePassword(configured, [], [], 'Teacher', { ...credentials, salt: 'bad' }, CHANGED_AT),
    /bad-salt/,
  );
  assert.throws(
    () => updatePassword(configured, [], [], 'Teacher', credentials, '2026-07-15T03:04:05Z'),
    /bad-changed-at/,
  );
});

test('updates require valid arrays and globally unique canonical account names', () => {
  const credentials = { salt: NEW_SALT, hash: NEW_HASH };
  assert.throws(
    () => updatePassword([user('Teacher')], {}, [], 'Teacher', credentials, CHANGED_AT),
    /registered-users\.json: expected-array/,
  );
  assert.throws(
    () => updatePassword([user('Teacher')], [], {}, 'Teacher', credentials, CHANGED_AT),
    /password-overrides\.json: expected-array/,
  );
  assert.throws(
    () => updatePassword(
      [user('Teacher')], [user('teacher')], [], 'Teacher', credentials, CHANGED_AT,
    ),
    /duplicate-name-with-config\.users/,
  );
  assert.throws(
    () => updatePassword([user('Teacher')], [null], [], 'Teacher', credentials, CHANGED_AT),
    /expected-object/,
  );
});
