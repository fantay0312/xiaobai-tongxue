import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountVerificationGrants,
  isAccountVerificationAction,
} from './account-verification.mjs';

test('account verification grants are session, action, account and revision bound', () => {
  let sequence = 0;
  const grants = createAccountVerificationGrants({
    ttlMs: 5_000,
    createToken: () => `token-${String(++sequence).padStart(40, '0')}`,
  });
  const issued = grants.issue({
    sessionToken: 'sid-a', name: 'teacher', action: 'change-email', revision: 'rev-1', now: 100,
  });
  assert.ok(issued);
  assert.equal(issued.expiresIn, 5);
  const input = {
    token: issued.token,
    sessionToken: 'sid-a',
    name: 'teacher',
    action: 'change-email',
    revision: 'rev-1',
    now: 101,
  };
  assert.equal(grants.authorize(input), true);
  assert.equal(grants.authorize({ ...input, sessionToken: 'sid-b' }), false);
  assert.equal(grants.authorize({ ...input, name: 'student' }), false);
  assert.equal(grants.authorize({ ...input, action: 'change-phone' }), false);
  assert.equal(grants.authorize({ ...input, revision: 'rev-2' }), false);
  assert.equal(grants.authorize({ ...input, consume: true }), true);
  assert.equal(grants.authorize(input), false);
});

test('account verification grants expire and newer grants replace the same action', () => {
  let sequence = 0;
  const grants = createAccountVerificationGrants({
    ttlMs: 1_000,
    createToken: () => `token-${String(++sequence).padStart(40, '0')}`,
  });
  const first = grants.issue({
    sessionToken: 'sid', name: 'teacher', action: 'change-password', revision: 'rev', now: 10,
  });
  const second = grants.issue({
    sessionToken: 'sid', name: 'teacher', action: 'change-password', revision: 'rev', now: 20,
  });
  const base = {
    sessionToken: 'sid', name: 'teacher', action: 'change-password', revision: 'rev', now: 21,
  };
  assert.equal(grants.authorize({ ...base, token: first.token }), false);
  assert.equal(grants.authorize({ ...base, token: second.token }), true);
  assert.equal(grants.authorize({ ...base, token: second.token, now: 1_020 }), false);
  assert.equal(isAccountVerificationAction('change-phone'), true);
  assert.equal(isAccountVerificationAction('bind-phone'), false);
});
