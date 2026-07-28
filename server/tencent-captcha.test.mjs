import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createAidEncrypted,
  createTc3Headers,
  createTencentCaptcha,
} from './tencent-captcha.mjs';

const NOW_SECONDS = 1_711_444_972;
const NOW_MS = NOW_SECONDS * 1000;
const APP_SECRET = '1234567891011121314151516';

function configuredEnv(overrides = {}) {
  return {
    TENCENT_CAPTCHA_EMAIL_APP_ID: '123456789',
    TENCENT_CAPTCHA_EMAIL_SECRET: APP_SECRET,
    TENCENT_CAPTCHA_LOGIN_APP_ID: '987654321',
    TENCENT_CAPTCHA_LOGIN_SECRET: 'login-secret-123456789012',
    TENCENTCLOUD_SECRET_ID: 'AKIDEXAMPLE',
    TENCENTCLOUD_SECRET_KEY: 'test-secret-key',
    ...overrides,
  };
}

function successResponse(evilLevel = 0) {
  return new Response(JSON.stringify({
    Response: { CaptchaCode: 1, EvilLevel: evilLevel, RequestId: 'request-id' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function proof(challenge, ticket = 'ticket-ok') {
  return { ticket, randstr: '@rand', aidEncrypted: challenge.aidEncrypted };
}

function repeatedAesKey(secret) {
  const source = Buffer.from(secret);
  const key = Buffer.alloc(32);
  for (let index = 0; index < key.length; index += 1) {
    key[index] = source[index % source.length];
  }
  return key;
}

test('aidEncrypted uses repeated 32-byte key and IV+ciphertext+GCM tag layout', () => {
  const iv = Buffer.from('012345678901');
  const encrypted = createAidEncrypted('123456789', APP_SECRET, {
    nowSeconds: NOW_SECONDS,
    ttlSeconds: 120,
    iv,
  });
  const packed = Buffer.from(encrypted, 'base64');
  assert.deepEqual(packed.subarray(0, 12), iv);
  const decipher = crypto.createDecipheriv('aes-256-gcm', repeatedAesKey(APP_SECRET), iv);
  decipher.setAuthTag(packed.subarray(-16));
  const plaintext = Buffer.concat([
    decipher.update(packed.subarray(12, -16)),
    decipher.final(),
  ]).toString('utf8');
  assert.equal(plaintext, '123456789&1711444972&120');
});

test('TC3 headers match a stable vector and omit Region', () => {
  const payload = JSON.stringify({
    CaptchaType: 9,
    Ticket: 'ticket-ok',
    UserIp: '203.0.113.8',
    Randstr: '@abc',
    CaptchaAppId: 123456789,
    AppSecretKey: APP_SECRET,
    NeedGetCaptchaTime: 1,
  });
  const headers = createTc3Headers(payload, {
    secretId: 'AKIDEXAMPLE',
    secretKey: 'Gu5t9xGARNpq86cd98joQYCN3X1FAKEKEY',
    token: '',
  }, 1_551_113_065);
  assert.equal(headers.Authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2019-02-25/captcha/tc3_request, '
    + 'SignedHeaders=content-type;host, '
    + 'Signature=a93b823292643fd97acad007d2ca13c16d29d188da233690a0aea129133eef0d');
  assert.equal(headers['X-TC-Action'], 'DescribeCaptchaResult');
  assert.equal(headers['X-TC-Version'], '2019-07-22');
  assert.equal(headers['X-TC-Region'], undefined);
});

test('challenge exposes no secret and successful proof sends the fixed API payload', async () => {
  let captured;
  const captcha = createTencentCaptcha({
    env: configuredEnv(),
    now: () => NOW_MS,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return successResponse();
    },
  });
  const challenge = captcha.issueChallenge('email');
  assert.deepEqual(Object.keys(challenge).sort(), [
    'aidEncrypted', 'aidEncryptedType', 'captchaAppId', 'expiresIn', 'ok', 'scene',
  ]);
  assert.equal(challenge.captchaAppId, '123456789');
  assert.equal(challenge.aidEncryptedType, 'gcm');
  assert.deepEqual(await captcha.verify('email', proof(challenge), '203.0.113.8'), { ok: true });
  assert.equal(captured.url, 'https://captcha.tencentcloudapi.com');
  assert.equal(captured.init.headers['X-TC-Region'], undefined);
  assert.deepEqual(JSON.parse(captured.init.body), {
    CaptchaType: 9,
    Ticket: 'ticket-ok',
    UserIp: '203.0.113.8',
    Randstr: '@rand',
    CaptchaAppId: 123456789,
    AppSecretKey: APP_SECRET,
    NeedGetCaptchaTime: 1,
  });
});

test('challenge is consumed before await so replay and concurrent replay fail closed', async () => {
  let resolveFetch;
  let calls = 0;
  const captcha = createTencentCaptcha({
    env: configuredEnv(),
    now: () => NOW_MS,
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const challenge = captcha.issueChallenge('login');
  const first = captcha.verify('login', proof(challenge), '198.51.100.4');
  const replay = await captcha.verify('login', proof(challenge), '198.51.100.4');
  assert.deepEqual(replay, { ok: false, error: 'captcha-failed' });
  resolveFetch(successResponse());
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
});

test('missing fields consume a supplied challenge and trerror never reaches Tencent', async () => {
  let calls = 0;
  const captcha = createTencentCaptcha({
    env: configuredEnv(),
    now: () => NOW_MS,
    fetchImpl: async () => { calls += 1; return successResponse(); },
  });
  const incomplete = captcha.issueChallenge('email');
  assert.deepEqual(await captcha.verify('email', {
    ticket: 'ticket-ok',
    aidEncrypted: incomplete.aidEncrypted,
  }, '203.0.113.1'), { ok: false, error: 'captcha-required' });
  assert.deepEqual(await captcha.verify('email', proof(incomplete), '203.0.113.1'),
    { ok: false, error: 'captcha-failed' });
  const disaster = captcha.issueChallenge('email');
  assert.deepEqual(await captcha.verify('email', proof(disaster, 'trerror_1001_fake'), '203.0.113.1'),
    { ok: false, error: 'captcha-failed' });
  assert.equal(calls, 0);
});

test('risk rejection is failed while HTTP, API and timeout faults are unavailable', async (t) => {
  const cases = [
    ['evil', async () => successResponse(100), 'captcha-failed'],
    ['ticket rejection', async () => new Response(JSON.stringify({
      Response: { CaptchaCode: 7, EvilLevel: 0 },
    })), 'captcha-failed'],
    ['HTTP', async () => new Response('{}', { status: 503 }), 'captcha-unavailable'],
    ['API', async () => new Response(JSON.stringify({
      Response: { Error: { Code: 'AuthFailure', Message: 'redacted' } },
    })), 'captcha-unavailable'],
    ['bad JSON', async () => new Response('{'), 'captcha-unavailable'],
    ['timeout', (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }), 'captcha-unavailable'],
    ['body timeout', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"Response":'));
      },
    })), 'captcha-unavailable'],
    ['oversized body', async () => new Response('x'.repeat(33 * 1024)), 'captcha-unavailable'],
  ];
  for (const [name, fetchImpl, expected] of cases) {
    await t.test(name, async () => {
      const captcha = createTencentCaptcha({
        env: configuredEnv(),
        now: () => NOW_MS,
        fetchImpl,
        requestTimeoutMs: 5,
      });
      const challenge = captcha.issueChallenge('email');
      assert.deepEqual(await captcha.verify('email', proof(challenge), '203.0.113.2'),
        { ok: false, error: expected });
    });
  }
});

test('CVM role credentials are cached and temporary token is sent', async () => {
  let metadataCalls = 0;
  let apiCalls = 0;
  const env = configuredEnv({
    TENCENTCLOUD_SECRET_ID: '',
    TENCENTCLOUD_SECRET_KEY: '',
    TENCENTCLOUD_CVM_ROLE_NAME: 'captcha-role',
  });
  const captcha = createTencentCaptcha({
    env,
    now: () => NOW_MS,
    fetchImpl: async (url, init) => {
      if (url.includes('/meta-data/cam/security-credentials/')) {
        metadataCalls += 1;
        return new Response(JSON.stringify({
          Code: 'Success',
          TmpSecretId: 'TMPID',
          TmpSecretKey: 'TMPKEY',
          Token: 'TMPTOKEN',
          ExpiredTime: NOW_SECONDS + 3600,
        }));
      }
      apiCalls += 1;
      assert.equal(init.headers['X-TC-Token'], 'TMPTOKEN');
      assert.match(init.headers.Authorization, /Credential=TMPID\//);
      return successResponse();
    },
  });
  for (const scene of ['email', 'login']) {
    const challenge = captcha.issueChallenge(scene);
    assert.deepEqual(await captcha.verify(scene, proof(challenge), '192.0.2.10'), { ok: true });
  }
  assert.equal(metadataCalls, 1);
  assert.equal(apiCalls, 2);
});

test('incomplete configuration never issues a challenge', () => {
  const captcha = createTencentCaptcha({
    env: configuredEnv({ TENCENT_CAPTCHA_LOGIN_SECRET: '' }),
  });
  assert.equal(captcha.available, false);
  assert.deepEqual(captcha.issueChallenge('email'),
    { ok: false, error: 'captcha-unavailable' });

  const sharedApp = createTencentCaptcha({
    env: configuredEnv({ TENCENT_CAPTCHA_LOGIN_APP_ID: '123456789' }),
  });
  assert.equal(sharedApp.available, false);
  assert.deepEqual(sharedApp.issueChallenge('login'),
    { ok: false, error: 'captcha-unavailable' });
});
