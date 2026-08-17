import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  accountHeaders,
  codeFor,
  copyRuntimeModules,
  installFakeResend,
  launchGateway,
  login,
  me,
  openPort,
  postJson,
  sessionCookie,
  smsCodeFor,
  smsRequests,
  stopChild,
} from './integration.test-harness.mjs';

const VERIFIED_AT = '2026-08-17T00:00:00.000Z';
const CURRENT_PASSWORD = 'StepUpOld!1';
const NEXT_PASSWORD = ['StepUp', 'New!', '2'].join('');

function passwordUser() {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(CURRENT_PASSWORD, salt, 64).toString('hex');
  return {
    name: 'StepUpUser',
    salt,
    hash,
    email: 'step-up-old@example.com',
    emailVerifiedAt: VERIFIED_AT,
    phone: '+8613811111111',
    phoneVerifiedAt: VERIFIED_AT,
  };
}

async function waitForSms(file, phone, timeoutMs = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await smsRequests(file)).some((item) => item.body?.PhoneNumberSet?.[0] === phone)) {
      return smsCodeFor(file, phone);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`SMS was not sent to ${phone}`);
}

async function verify(base, cookie, name, action, password = CURRENT_PASSWORD) {
  return postJson(`${base}/api/account/verify-password`, {
    action,
    currentPassword: password,
  }, accountHeaders(cookie, name));
}

test('account changes require a session-bound two-step verification grant', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-account-step-up-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
  const smsLog = path.join(root, 'sms.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await installFakeResend(root);
  const user = passwordUser();
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true, users: [user],
  }));
  const child = await launchGateway(root, resendLog, { SMS_TEST_LOG: smsLog });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const first = await login(base, user.name, CURRENT_PASSWORD, user.name);
  const second = await login(base, user.email, CURRENT_PASSWORD, user.name);

  const badAction = await verify(base, first.cookie, user.name, 'bind-phone');
  assert.equal(badAction.response.status, 400);
  assert.deepEqual(badAction.payload, { error: 'bad-verification-action' });
  const wrongPassword = await verify(base, first.cookie, user.name, 'change-phone', 'wrong-password');
  assert.equal(wrongPassword.response.status, 401);
  assert.deepEqual(wrongPassword.payload, { error: 'invalid-credentials' });

  const phoneGrant = await verify(base, first.cookie, user.name, 'change-phone');
  assert.equal(phoneGrant.response.status, 200);
  assert.match(phoneGrant.payload.verificationToken, /^[0-9a-f]{64}$/);
  assert.equal(phoneGrant.payload.expiresIn, 600);
  assert.equal(phoneGrant.response.headers.get('cache-control'), 'no-store');

  const wrongAction = await postJson(`${base}/api/account/password`, {
    verificationToken: phoneGrant.payload.verificationToken,
    newPassword: 'MustNotChange!2',
  }, accountHeaders(first.cookie, user.name));
  assert.equal(wrongAction.response.status, 403);
  assert.deepEqual(wrongAction.payload, { error: 'account-verification-required' });
  const wrongSession = await postJson(`${base}/api/account/phone-code`, {
    phone: '+8613833333333',
    verificationToken: phoneGrant.payload.verificationToken,
  }, accountHeaders(second.cookie, user.name));
  assert.equal(wrongSession.response.status, 403);

  const phoneCodeRequest = await postJson(`${base}/api/account/phone-code`, {
    phone: '+8613833333333',
    verificationToken: phoneGrant.payload.verificationToken,
  }, accountHeaders(first.cookie, user.name));
  assert.equal(phoneCodeRequest.response.status, 200);
  const phoneCode = await waitForSms(smsLog, '+8613833333333');
  const phoneChanged = await postJson(`${base}/api/account/phone`, {
    phone: '+8613833333333', code: phoneCode.code,
    verificationToken: phoneGrant.payload.verificationToken,
  }, accountHeaders(first.cookie, user.name));
  assert.equal(phoneChanged.response.status, 200);
  assert.equal(phoneChanged.payload.phoneMasked, '+86138****3333');
  const phoneCookie = sessionCookie(phoneChanged.response);
  assert.ok(phoneCookie);
  assert.equal((await me(base, first.cookie)).user, null);
  assert.equal((await me(base, second.cookie)).user, null);

  const emailGrant = await verify(base, phoneCookie, user.name, 'change-email');
  assert.equal(emailGrant.response.status, 200);
  const emailCodeRequest = await postJson(`${base}/api/account/email-code`, {
    email: 'step-up-new@example.com',
    verificationToken: emailGrant.payload.verificationToken,
  }, accountHeaders(phoneCookie, user.name));
  assert.equal(emailCodeRequest.response.status, 200);
  const emailCode = await codeFor(resendLog, 'step-up-new@example.com');
  const emailChanged = await postJson(`${base}/api/account/email`, {
    email: 'step-up-new@example.com', code: emailCode.code,
    verificationToken: emailGrant.payload.verificationToken,
  }, accountHeaders(phoneCookie, user.name));
  assert.equal(emailChanged.response.status, 200);
  const emailCookie = sessionCookie(emailChanged.response);
  assert.ok(emailCookie);

  const passwordGrant = await verify(base, emailCookie, user.name, 'change-password');
  assert.equal(passwordGrant.response.status, 200);
  const unchanged = await postJson(`${base}/api/account/password`, {
    verificationToken: passwordGrant.payload.verificationToken,
    newPassword: CURRENT_PASSWORD,
  }, accountHeaders(emailCookie, user.name));
  assert.equal(unchanged.response.status, 409);
  assert.deepEqual(unchanged.payload, { error: 'password-unchanged' });
  const passwordChanged = await postJson(`${base}/api/account/password`, {
    verificationToken: passwordGrant.payload.verificationToken,
    newPassword: NEXT_PASSWORD,
  }, accountHeaders(emailCookie, user.name));
  assert.equal(passwordChanged.response.status, 200);
  const passwordCookie = sessionCookie(passwordChanged.response);
  assert.ok(passwordCookie);
  assert.equal((await me(base, emailCookie)).user, null);
  await login(base, 'step-up-new@example.com', NEXT_PASSWORD, user.name);
});
