import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  CAPTCHA_TEST_ENV,
  authHeaders,
  captchaRequests,
  codeFor,
  copyRuntimeModules,
  createCaptchaProof,
  installFakeResend,
  launchGateway,
  openPort,
  postJson,
  resendMessages,
  sessionCookie,
  stopChild,
} from './integration.test-harness.mjs';

const VERIFIED_AT = '2026-07-24T00:00:00.000Z';
const USERS = [
  passwordUser('EmailLoginUser', 'EmailLogin!1', 'email-login@example.test'),
  passwordUser('PasswordLoginUser', 'PasswordLogin!1', 'password-login@example.test'),
  passwordUser('ResetUser', 'ResetPassword!1', 'reset@example.test'),
  passwordUser('AccountUser', 'AccountPassword!1', 'account@example.test'),
];

let fixture;

function passwordUser(name, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { name, salt, hash, email, emailVerifiedAt: VERIFIED_AT };
}

async function challenge(base, scene) {
  return postJson(`${base}/api/captcha/challenge`, { scene });
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-captcha-test-'));
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
  const captchaLog = path.join(root, 'captcha.log');
  await mkdir(path.join(root, 'dist'));
  await mkdir(data);
  await writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await installFakeResend(root);
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    inviteCode: 'captcha-test-invite',
    users: USERS,
  }));
  const child = await launchGateway(root, resendLog, { CAPTCHA_TEST_LOG: captchaLog });
  return {
    root,
    resendLog,
    captchaLog,
    child,
    base: `http://127.0.0.1:${port}`,
  };
}

test.before(async () => {
  fixture = await createFixture();
});

test.after(async () => {
  await stopChild(fixture?.child);
  if (fixture?.root) await rm(fixture.root, { recursive: true, force: true });
});

test('captcha challenges are scene-bound, unique, and never cacheable', async () => {
  const first = await challenge(fixture.base, 'email');
  const second = await challenge(fixture.base, 'email');
  const login = await challenge(fixture.base, 'login');

  for (const result of [first, second, login]) {
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.equal(result.payload.aidEncryptedType, 'gcm');
    assert.ok(Number.isInteger(result.payload.expiresIn));
    assert.ok(result.payload.expiresIn > 0);
    assert.match(result.payload.aidEncrypted, /^[A-Za-z0-9+/]+=*$/);
  }
  assert.equal(String(first.payload.captchaAppId), CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_EMAIL_APP_ID);
  assert.equal(String(login.payload.captchaAppId), CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_LOGIN_APP_ID);
  assert.equal(first.payload.scene, 'email');
  assert.equal(login.payload.scene, 'login');
  assert.notEqual(first.payload.aidEncrypted, second.payload.aidEncrypted);
  assert.notEqual(first.payload.aidEncrypted, login.payload.aidEncrypted);
});

test('email-code routes require one-time valid proofs before sending mail', { timeout: 20_000 }, async () => {
  const { base, resendLog } = fixture;
  const emailCodeUrl = `${base}/api/auth/email-code`;
  const loginEmailBody = { email: USERS[0].email, purpose: 'login' };

  const missing = await postJson(emailCodeUrl, { ...loginEmailBody, captcha: null });
  assert.equal(missing.response.status, 428);
  assert.deepEqual(missing.payload, { error: 'captcha-required' });
  assert.equal((await resendMessages(resendLog)).length, 0);

  const missingReset = await postJson(`${base}/api/auth/password-code`, {
    email: USERS[2].email,
    captcha: null,
  });
  assert.equal(missingReset.response.status, 428);
  assert.deepEqual(missingReset.payload, { error: 'captcha-required' });
  assert.equal((await resendMessages(resendLog)).length, 0);

  const invalidCaptcha = await createCaptchaProof(base, 'email', {
    ticket: 'test-invalid-ticket',
  });
  const invalid = await postJson(emailCodeUrl, {
    ...loginEmailBody,
    captcha: invalidCaptcha,
  });
  assert.equal(invalid.response.status, 403);
  assert.deepEqual(invalid.payload, { error: 'captcha-failed' });
  assert.equal((await resendMessages(resendLog)).length, 0);

  const timeoutCaptcha = await createCaptchaProof(base, 'email', {
    ticket: 'test-timeout-ticket',
  });
  const timedOut = await postJson(emailCodeUrl, {
    ...loginEmailBody,
    captcha: timeoutCaptcha,
  });
  assert.equal(timedOut.response.status, 503);
  assert.deepEqual(timedOut.payload, { error: 'captcha-unavailable' });
  assert.equal((await resendMessages(resendLog)).length, 0);

  const resetCaptcha = await createCaptchaProof(base, 'email');
  const resetBody = { email: USERS[2].email, captcha: resetCaptcha };
  const resetCode = await postJson(`${base}/api/auth/password-code`, resetBody);
  assert.equal(resetCode.response.status, 200);
  assert.equal((await resendMessages(resendLog)).length, 1);
  const replay = await postJson(`${base}/api/auth/password-code`, resetBody);
  assert.equal(replay.response.status, 403);
  assert.deepEqual(replay.payload, { error: 'captcha-failed' });
  assert.equal((await resendMessages(resendLog)).length, 1);

  const passwordLogin = await postJson(`${base}/api/login`, {
    identifier: USERS[3].name,
    password: 'AccountPassword!1',
  });
  const accountCookie = sessionCookie(passwordLogin.response);
  assert.equal(passwordLogin.response.status, 200);
  assert.ok(accountCookie);
  const missingAccount = await postJson(`${base}/api/account/email-code`, {
    email: 'account-new@example.test',
    currentPassword: 'AccountPassword!1',
    captcha: null,
  }, authHeaders(USERS[3], accountCookie));
  assert.equal(missingAccount.response.status, 428);
  assert.deepEqual(missingAccount.payload, { error: 'captcha-required' });
  assert.equal((await resendMessages(resendLog)).length, 1);

  const accountCaptcha = await createCaptchaProof(base, 'email');
  const accountCode = await postJson(`${base}/api/account/email-code`, {
    email: 'account-new@example.test',
    currentPassword: 'AccountPassword!1',
    captcha: accountCaptcha,
  }, authHeaders(USERS[3], accountCookie));
  assert.equal(accountCode.response.status, 200);
  assert.equal((await resendMessages(resendLog)).length, 2);
});

test('valid login proofs cover password and email login while risky proofs sign no session', async () => {
  const { base, resendLog, captchaLog } = fixture;
  const missingPasswordLogin = await postJson(`${base}/api/login`, {
    identifier: USERS[1].email,
    password: 'PasswordLogin!1',
    captcha: null,
  });
  assert.equal(missingPasswordLogin.response.status, 428);
  assert.deepEqual(missingPasswordLogin.payload, { error: 'captcha-required' });
  assert.equal(sessionCookie(missingPasswordLogin.response), null);

  const passwordCaptcha = await createCaptchaProof(base, 'login');
  const passwordLogin = await postJson(`${base}/api/login`, {
    identifier: USERS[1].email,
    password: 'PasswordLogin!1',
    captcha: passwordCaptcha,
  });
  assert.equal(passwordLogin.response.status, 200);
  assert.equal(passwordLogin.payload.user.name, USERS[1].name);
  assert.ok(sessionCookie(passwordLogin.response));

  const emailCaptcha = await createCaptchaProof(base, 'email');
  const codeRequest = await postJson(`${base}/api/auth/email-code`, {
    email: USERS[0].email,
    purpose: 'login',
    captcha: emailCaptcha,
  });
  assert.equal(codeRequest.response.status, 200);
  const { code } = await codeFor(resendLog, USERS[0].email);
  const missingEmailLogin = await postJson(`${base}/api/login/email`, {
    email: USERS[0].email,
    code,
    captcha: null,
  });
  assert.equal(missingEmailLogin.response.status, 428);
  assert.deepEqual(missingEmailLogin.payload, { error: 'captcha-required' });
  assert.equal(sessionCookie(missingEmailLogin.response), null);

  const emailLoginCaptcha = await createCaptchaProof(base, 'login');
  const emailLogin = await postJson(`${base}/api/login/email`, {
    email: USERS[0].email,
    code,
    captcha: emailLoginCaptcha,
  });
  assert.equal(emailLogin.response.status, 200);
  assert.equal(emailLogin.payload.user.name, USERS[0].name);
  assert.ok(sessionCookie(emailLogin.response));

  const riskyCaptcha = await createCaptchaProof(base, 'login', {
    ticket: 'test-risk-ticket',
  });
  const riskyLogin = await postJson(`${base}/api/login`, {
    identifier: USERS[1].name,
    password: 'PasswordLogin!1',
    captcha: riskyCaptcha,
  }, { 'X-Real-IP': '203.0.113.77' });
  assert.equal(riskyLogin.response.status, 403);
  assert.deepEqual(riskyLogin.payload, { error: 'captcha-failed' });
  assert.equal(sessionCookie(riskyLogin.response), null);

  const requests = await captchaRequests(captchaLog);
  assert.ok(requests.length >= 8);
  for (const request of requests) {
    assert.equal(request.url, 'https://captcha.tencentcloudapi.com');
    assert.equal(request.headers['x-tc-action'], 'DescribeCaptchaResult');
    assert.equal(request.headers['x-tc-version'], '2019-07-22');
    assert.equal(request.headers['x-tc-region'], undefined);
    assert.match(request.headers.authorization, /Credential=AKID-test-only-captcha\//);
    assert.equal(request.body.CaptchaType, 9);
    assert.equal(request.body.NeedGetCaptchaTime, 1);
    assert.equal(typeof request.body.UserIp, 'string');
  }
  assert.ok(requests.some((request) => (
    String(request.body.CaptchaAppId) === CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_EMAIL_APP_ID
    && request.body.AppSecretKey === CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_EMAIL_SECRET
  )));
  assert.ok(requests.some((request) => (
    String(request.body.CaptchaAppId) === CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_LOGIN_APP_ID
    && request.body.AppSecretKey === CAPTCHA_TEST_ENV.TENCENT_CAPTCHA_LOGIN_SECRET
  )));
  assert.equal(
    requests.find((request) => request.body.Ticket === 'test-risk-ticket')?.body.UserIp,
    '203.0.113.77',
  );
});
