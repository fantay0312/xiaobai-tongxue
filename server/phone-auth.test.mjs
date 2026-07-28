import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneAuth } from './phone-auth.mjs';

function fixture(overrides = {}) {
  let at = 1_000;
  let nextCode = 123456;
  const sent = [];
  const auth = createPhoneAuth({
    secret: Buffer.alloc(32, 7),
    now: () => at,
    elapsedNow: () => at,
    sleep: async (ms) => { at += ms; },
    randomInt: () => nextCode,
    jitterRandomInt: () => 0,
    sendCode: async (message) => { sent.push(message); },
    limits: {
      sendCooldownMs: 0,
      sendResponseMinDelayMs: 0,
      sendResponseJitterMs: 0,
      ...overrides,
    },
  });
  return {
    auth,
    sent,
    advance: (ms) => { at += ms; },
    setCode: (value) => { nextCode = value; },
  };
}

const INPUT = Object.freeze({
  phone: '+8613800138000',
  purpose: 'login',
  subject: 'owner:subject',
  ip: '192.0.2.1',
});

test('phone OTP is bound to phone, purpose, and subject then consumed once', async () => {
  const { auth, sent } = fixture();
  assert.equal((await auth.requestCode(INPUT)).ok, true);
  assert.equal(sent[0].code, '123456');
  assert.equal(sent[0].expiresInMinutes, 10);
  assert.equal(auth.consumeCode({ ...INPUT, code: '123456', subject: 'owner:other' }).ok, false);
  assert.deepEqual(auth.consumeCode({ ...INPUT, code: '123456' }), {
    ok: true,
    phone: '+8613800138000',
  });
  assert.equal(auth.consumeCode({ ...INPUT, code: '123456' }).ok, false);
});

test('phone OTP expires and five wrong attempts invalidate it', async () => {
  const expiring = fixture({ codeTtlMs: 600_000 });
  await expiring.auth.requestCode(INPUT);
  expiring.advance(600_001);
  assert.equal(expiring.auth.consumeCode({ ...INPUT, code: '123456' }).ok, false);

  const attempted = fixture({ maxCodeAttempts: 5 });
  await attempted.auth.requestCode(INPUT);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(attempted.auth.consumeCode({ ...INPUT, code: '000000' }).ok, false);
  }
  assert.equal(attempted.auth.consumeCode({ ...INPUT, code: '123456' }).ok, false);
});

test('successful resend replaces the old code and suppressed delivery stores nothing', async () => {
  const current = fixture();
  await current.auth.requestCode(INPUT);
  current.setCode(654321);
  await current.auth.requestCode(INPUT);
  assert.equal(current.auth.consumeCode({ ...INPUT, code: '123456' }).ok, false);
  assert.equal(current.auth.consumeCode({ ...INPUT, code: '654321' }).ok, true);

  const suppressed = fixture();
  const result = await suppressed.auth.requestCode({
    ...INPUT,
    deliver: false,
    opaqueDelivery: true,
  });
  assert.equal(result.ok, true);
  assert.equal(suppressed.sent.length, 0);
  assert.equal(suppressed.auth.consumeCode({ ...INPUT, code: '123456' }).ok, false);
});

test('production OTP store persists codes and distributed limits across process restarts', async () => {
  const issued = [];
  const rateScopes = [];
  const otpStore = {
    async issue(input) {
      issued.push(input);
      return { issued: true };
    },
    async rateLimit(input) {
      rateScopes.push(input.scope);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async consume(input) {
      assert.equal(input.challengeId, issued[0].challengeId);
      assert.equal(input.subject, issued[0].subject);
      assert.equal(input.purpose, issued[0].purpose);
      return { consumed: input.code === issued[0].code };
    },
  };
  const sent = [];
  const auth = createPhoneAuth({
    otpStore,
    sendCode: async (message) => sent.push(message),
    randomInt: () => 246810,
    jitterRandomInt: () => 0,
    sleep: async () => {},
    limits: {
      sendCooldownMs: 0,
      sendResponseMinDelayMs: 0,
      sendResponseJitterMs: 0,
    },
  });

  assert.equal((await auth.requestCode(INPUT)).ok, true);
  assert.equal(sent[0].code, '246810');
  assert.equal(issued[0].code, '246810');
  assert.equal((await auth.consumeCode({ ...INPUT, code: '246810' })).ok, true);
  assert.ok(rateScopes.includes('sms-send-phone'));
  assert.ok(rateScopes.includes('sms-send-global-day'));
  assert.ok(rateScopes.includes('sms-verify-ip'));
});
