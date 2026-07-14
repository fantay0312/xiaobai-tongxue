import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAuth, createResendSender, normalizeEmail } from './email-auth.mjs';

const TEST_SECRET = Buffer.alloc(32, 7);

function harness(options = {}) {
  let at = 1_000_000;
  const sent = [];
  const codes = [...(options.codes ?? [123456])];
  const sendCode = options.sendCode ?? (async (message) => { sent.push(message); });
  const rawAuth = createEmailAuth({
    sendCode,
    secret: TEST_SECRET,
    now: () => at,
    randomInt: () => codes.shift() ?? 999999,
    elapsedNow: options.elapsedNow ?? (() => 0),
    jitterRandomInt: options.jitterRandomInt ?? (() => 0),
    sleep: options.sleep ?? (async () => {}),
    limits: { sendCooldownMs: 1_000, ...(options.limits ?? {}) },
  });
  const withOwnerSubject = (input) => (
    (input?.purpose === 'login' || input?.purpose === 'reset-password')
      && !Object.hasOwn(input, 'subject')
      ? { ...input, subject: `test-owner:${input.purpose}` }
      : input
  );
  const auth = {
    ...rawAuth,
    requestCode: (input) => rawAuth.requestCode(withOwnerSubject(input)),
    consumeCode: (input) => rawAuth.consumeCode(withOwnerSubject(input)),
  };
  return { auth, sent, advance: (ms) => { at += ms; } };
}

test('normalizeEmail accepts conservative addresses and canonicalizes case', () => {
  assert.equal(normalizeEmail(' Teacher.Name+os@Example.COM '), 'teacher.name+os@example.com');
  assert.equal(normalizeEmail('a@sub.example.com'), 'a@sub.example.com');
  for (const invalid of ['', 'a@localhost', '.a@example.com', 'a..b@example.com', 'a@@example.com']) {
    assert.equal(normalizeEmail(invalid), null);
  }
});

test('Resend adapter sends fixed transactional payload and required headers', async () => {
  let request;
  const sender = createResendSender({
    apiKey: 'test-secret',
    from: '小白同学 <noreply@mail.tradingvane.com>',
    fetchImpl: async (url, init) => { request = { url, init }; return { ok: true }; },
  });
  await sender({
    email: 'teacher@example.com', code: '012345', purpose: 'login', idempotencyKey: 'otp-1',
  });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.init.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.init.headers['User-Agent'], 'xiaobai-gateway/1.0');
  assert.equal(request.init.headers['Idempotency-Key'], 'otp-1');
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.to, ['teacher@example.com']);
  assert.match(body.text, /012345/);
});

test('code is bound to email and purpose, then consumed exactly once', async () => {
  const { auth, sent } = harness();
  assert.equal((await auth.requestCode({ email: 'A@Example.com', purpose: 'register', ip: 'ip-1' })).ok, true);
  const code = sent[0].code;
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'login', code, ip: 'ip-1' }).ok, false);
  assert.equal(auth.consumeCode({ email: 'b@example.com', purpose: 'register', code, ip: 'ip-1' }).ok, false);
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'register', code, ip: 'ip-1' }).ok, true);
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'register', code, ip: 'ip-1' }).ok, false);
});

test('binding code is additionally bound to the canonical session subject', async () => {
  const { auth, sent } = harness();
  assert.equal((await auth.requestCode({
    email: 'bind@example.com', purpose: 'bind', subject: 'legacy-user', ip: 'ip-1',
  })).ok, true);
  assert.equal(auth.consumeCode({
    email: 'bind@example.com', purpose: 'bind', subject: 'other-user', code: sent[0].code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'bind@example.com', purpose: 'bind', subject: 'legacy-user', code: sent[0].code, ip: 'ip-1',
  }).ok, true);
  assert.equal((await auth.requestCode({
    email: 'other@example.com', purpose: 'bind', ip: 'ip-1',
  })).error, 'bad-subject');
});

test('login code cannot cross an email ownership-version change', async () => {
  const { auth, sent } = harness();
  assert.equal((await auth.requestCode({
    email: 'login@example.com', purpose: 'login', subject: 'owner:account-a:v1', ip: 'ip-1',
  })).ok, true);
  const code = sent[0].code;
  assert.equal(auth.consumeCode({
    email: 'login@example.com', purpose: 'login', subject: 'owner:account-b:v2', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'login@example.com', purpose: 'login', subject: 'owner:account-a:v1', code, ip: 'ip-1',
  }).ok, true);
});

test('email-change code is bound to account, purpose, and target email, then consumed once', async () => {
  const { auth, sent } = harness();
  assert.equal((await auth.requestCode({
    email: 'new@example.com', purpose: 'change-email', subject: 'teacher', ip: 'ip-1',
  })).ok, true);
  const code = sent[0].code;
  assert.equal(auth.consumeCode({
    email: 'new@example.com', purpose: 'bind', subject: 'teacher', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'new@example.com', purpose: 'change-email', subject: 'student', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'other@example.com', purpose: 'change-email', subject: 'teacher', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'new@example.com', purpose: 'change-email', subject: 'teacher', code, ip: 'ip-1',
  }).ok, true);
  assert.equal(auth.consumeCode({
    email: 'new@example.com', purpose: 'change-email', subject: 'teacher', code, ip: 'ip-1',
  }).ok, false);
});

test('password-reset code is bound to the owner and credential revision', async () => {
  const { auth, sent } = harness();
  assert.equal((await auth.requestCode({
    email: 'teacher@example.com', purpose: 'reset-password', subject: 'owner:revision-1', ip: 'ip-1',
  })).ok, true);
  const code = sent[0].code;
  assert.match(sent[0].purpose, /reset-password/);
  assert.equal(auth.consumeCode({
    email: 'teacher@example.com', purpose: 'login', subject: 'owner:revision-1', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'other@example.com', purpose: 'reset-password', subject: 'owner:revision-1', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'teacher@example.com', purpose: 'reset-password', subject: 'owner:revision-2', code, ip: 'ip-1',
  }).ok, false);
  assert.equal(auth.consumeCode({
    email: 'teacher@example.com', purpose: 'reset-password', subject: 'owner:revision-1', code, ip: 'ip-1',
  }).ok, true);
});

test('code expires after ten minutes', async () => {
  const { auth, sent, advance } = harness();
  await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  advance(10 * 60_000 + 1);
  const result = auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: sent[0].code, ip: 'ip-1' });
  assert.deepEqual(result, { ok: false, error: 'invalid-or-expired-code' });
});

test('five wrong attempts invalidate the current code', async () => {
  const { auth, sent } = harness();
  await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: '000000', ip: 'ip-1' }).ok, false);
  }
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: sent[0].code, ip: 'ip-1' }).ok, false);
});

test('successful resend invalidates the previous code', async () => {
  const { auth, sent, advance } = harness({ codes: [111111, 222222] });
  await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  advance(1_001);
  await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: sent[0].code, ip: 'ip-1' }).ok, false);
  assert.equal(auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: sent[1].code, ip: 'ip-1' }).ok, true);
});

test('failed resend keeps the previously delivered code valid', async () => {
  const sent = [];
  let shouldFail = false;
  const setup = harness({
    codes: [111111, 222222],
    sendCode: async (message) => {
      if (shouldFail) throw new Error('upstream');
      sent.push(message);
    },
  });
  await setup.auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  shouldFail = true;
  setup.advance(1_001);
  const resend = await setup.auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  assert.equal(resend.error, 'email-unavailable');
  assert.equal(setup.auth.consumeCode({ email: 'a@example.com', purpose: 'login', code: sent[0].code, ip: 'ip-1' }).ok, true);
});

test('in-flight send locks the email against concurrent requests', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { auth } = harness({ sendCode: async () => waiting });
  const first = auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  await Promise.resolve();
  const second = await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' });
  assert.equal(second.error, 'send-too-frequent');
  release();
  assert.equal((await first).ok, true);
});

test('global sender limit protects Resend from distributed bursts', async () => {
  const { auth } = harness({
    limits: { sendCooldownMs: 0, globalSendsPerSecond: 1, emailSendsPerHour: 10, ipSendsPerHour: 10 },
  });
  assert.equal((await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' })).ok, true);
  const limited = await auth.requestCode({ email: 'b@example.com', purpose: 'login', ip: 'ip-2' });
  assert.equal(limited.error, 'too-many-attempts');
});

test('suppressed login request has the same response without sending or storing a code', async () => {
  let delayed = 0;
  const { auth, sent } = harness({ sleep: async (ms) => { delayed = ms; } });
  const result = await auth.requestCode({
    email: 'missing@example.com', purpose: 'login', ip: 'ip-1', deliver: false,
  });
  assert.deepEqual(result, { ok: true, retryAfter: 1 });
  assert.equal(delayed, 400);
  assert.equal(sent.length, 0);
  assert.equal(auth.consumeCode({
    email: 'missing@example.com', purpose: 'login', code: '123456', ip: 'ip-1',
  }).ok, false);
});

test('delivered and suppressed requests share one jittered minimum response duration', async () => {
  let elapsed = 0;
  const sleeps = [];
  const sent = [];
  const { auth } = harness({
    sendCode: async (message) => { sent.push(message); elapsed += 180; },
    elapsedNow: () => elapsed,
    jitterRandomInt: (minimum, maximum) => {
      assert.equal(minimum, 0);
      assert.equal(maximum, 201);
      return 75;
    },
    sleep: async (ms) => { sleeps.push(ms); elapsed += ms; },
  });

  const deliveredStart = elapsed;
  const delivered = await auth.requestCode({
    email: 'known@example.com', purpose: 'login', ip: 'ip-1', deliver: true,
  });
  assert.equal(elapsed - deliveredStart, 475);

  const suppressedStart = elapsed;
  const suppressed = await auth.requestCode({
    email: 'missing@example.com', purpose: 'login', ip: 'ip-2', deliver: false,
  });
  assert.equal(elapsed - suppressedStart, 475);
  assert.deepEqual(delivered, suppressed);
  assert.deepEqual(sleeps, [295, 475]);
  assert.equal(sent.length, 1);
});

test('slow sender is not delayed again after exceeding the jittered minimum', async () => {
  let elapsed = 0;
  const sleeps = [];
  const { auth } = harness({
    sendCode: async () => { elapsed += 650; },
    elapsedNow: () => elapsed,
    jitterRandomInt: () => 100,
    sleep: async (ms) => { sleeps.push(ms); elapsed += ms; },
  });

  const result = await auth.requestCode({
    email: 'slow@example.com', purpose: 'login', ip: 'ip-1', deliver: true,
  });
  assert.equal(result.ok, true);
  assert.equal(elapsed, 650);
  assert.deepEqual(sleeps, []);
});

test('fast sender failure is padded to the same jittered minimum', async () => {
  let elapsed = 0;
  const sleeps = [];
  const { auth } = harness({
    sendCode: async () => { elapsed += 50; throw new Error('upstream'); },
    elapsedNow: () => elapsed,
    jitterRandomInt: () => 75,
    sleep: async (ms) => { sleeps.push(ms); elapsed += ms; },
  });

  const result = await auth.requestCode({
    email: 'failure@example.com', purpose: 'login', ip: 'ip-1', deliver: true,
  });
  assert.deepEqual(result, { ok: false, error: 'email-unavailable' });
  assert.equal(elapsed, 475);
  assert.deepEqual(sleeps, [425]);
});

test('failed later dimension does not pollute earlier rate-limit dimensions', async () => {
  const { auth, advance } = harness({
    limits: {
      sendCooldownMs: 0,
      emailSendsPerHour: 1,
      ipSendsPerHour: 1,
      globalSendsPerSecond: 20,
      globalSendsPerHour: 20,
      globalSendsPerDay: 20,
    },
  });
  assert.equal((await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' })).ok, true);
  advance(1);
  assert.equal((await auth.requestCode({ email: 'b@example.com', purpose: 'login', ip: 'ip-1' })).ok, false);
  advance(1);
  assert.equal((await auth.requestCode({ email: 'b@example.com', purpose: 'login', ip: 'ip-2' })).ok, true);
});

test('global hourly and daily budgets cap distributed senders', async () => {
  const { auth, advance } = harness({
    limits: {
      sendCooldownMs: 0,
      emailSendsPerHour: 10,
      ipSendsPerHour: 10,
      globalSendsPerSecond: 10,
      globalSendsPerHour: 1,
      globalSendsPerDay: 2,
    },
  });
  assert.equal((await auth.requestCode({ email: 'a@example.com', purpose: 'login', ip: 'ip-1' })).ok, true);
  advance(1_001);
  assert.equal((await auth.requestCode({ email: 'b@example.com', purpose: 'login', ip: 'ip-2' })).ok, false);
  advance(3600_000);
  assert.equal((await auth.requestCode({ email: 'b@example.com', purpose: 'login', ip: 'ip-2' })).ok, true);
  advance(3600_000);
  assert.equal((await auth.requestCode({ email: 'c@example.com', purpose: 'login', ip: 'ip-3' })).ok, false);
});
