import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  accountHeaders,
  copyRuntimeModules,
  login,
  me,
  openPort,
  postJson,
  sessionCookie,
  smsCodeFor,
  smsRequests,
  stopChild,
  waitForReady,
} from './integration.test-harness.mjs';

const VERIFIED_AT = '2026-07-28T00:00:00.000Z';

function passwordUser(name, password, email, phone) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {
    name,
    salt,
    hash,
    email,
    emailVerifiedAt: VERIFIED_AT,
    ...(phone ? { phone, phoneVerifiedAt: VERIFIED_AT } : {}),
  };
}

async function waitForSms(file, phone, timeoutMs = 2_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = (await smsRequests(file))
      .some((item) => item.body?.PhoneNumberSet?.[0] === phone);
    if (found) return smsCodeFor(file, phone);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`SMS was not sent to ${phone}`);
}

test('phone login, forced binding, opaque sends, and phone password reset are durable', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-phone-auth-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const smsLog = path.join(root, 'sms.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);

  const bindingUser = passwordUser(
    'NeedsPhone', 'binding-password', 'binding@example.com',
  );
  const owner = passwordUser(
    'PhoneOwner', 'owner-password', 'owner@example.com', '+8613811111111',
  );
  const resetUser = passwordUser(
    'PhoneReset', 'reset-old-password', 'reset@example.com', '+8613822222222',
  );
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    users: [bindingUser, owner, resetUser],
  }));
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    env: { ...process.env, SMS_TEST_LOG: smsLog },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  const knownCodeRequest = await postJson(`${base}/api/auth/sms-code`, {
    phone: '13811111111',
    purpose: 'login',
  });
  assert.equal(knownCodeRequest.response.status, 200);
  const loginCode = await waitForSms(smsLog, owner.phone);
  assert.equal(loginCode.request.body.SmsSdkAppId, '1401167280');
  assert.deepEqual(loginCode.request.body.TemplateParamSet, [loginCode.code, '10']);
  assert.match(loginCode.request.headers.authorization, /^TC3-HMAC-SHA256 /);
  const beforeUnknown = (await smsRequests(smsLog)).length;
  const unknownCodeRequest = await postJson(`${base}/api/auth/sms-code`, {
    phone: '+8613899999999',
    purpose: 'login',
  });
  assert.equal(unknownCodeRequest.response.status, 200);
  assert.deepEqual(unknownCodeRequest.payload, knownCodeRequest.payload);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await smsRequests(smsLog)).length, beforeUnknown);

  const signedInByPhone = await postJson(`${base}/api/login/phone`, {
    phone: owner.phone,
    code: loginCode.code,
  });
  assert.equal(signedInByPhone.response.status, 200);
  assert.equal(signedInByPhone.payload.user.name, owner.name);
  assert.equal(signedInByPhone.payload.phoneBindingRequired, false);
  assert.equal(signedInByPhone.payload.phoneMasked, '+86138****1111');
  assert.ok(sessionCookie(signedInByPhone.response));
  const replayLogin = await postJson(`${base}/api/login/phone`, {
    phone: owner.phone,
    code: loginCode.code,
  });
  assert.equal(replayLogin.response.status, 401);
  assert.deepEqual(replayLogin.payload, { error: 'invalid-or-expired-code' });

  const restricted = await login(
    base, bindingUser.name, 'binding-password', bindingUser.name,
  );
  assert.equal(restricted.payload.emailBindingRequired, false);
  assert.equal(restricted.payload.phoneBindingRequired, true);
  const restrictedHeaders = accountHeaders(restricted.cookie, bindingUser.name);
  const blockedState = await fetch(`${base}/api/state`, { headers: restrictedHeaders });
  assert.equal(blockedState.status, 403);
  assert.deepEqual(await blockedState.json(), { error: 'phone-verification-required' });
  const bindingCodeRequest = await postJson(`${base}/api/account/phone-code`, {
    phone: '13833333333',
    currentPassword: 'binding-password',
  }, restrictedHeaders);
  assert.equal(bindingCodeRequest.response.status, 200);
  const bindingCode = await waitForSms(smsLog, '+8613833333333');
  const bound = await postJson(`${base}/api/account/phone`, {
    phone: '008613833333333',
    code: bindingCode.code,
    currentPassword: 'binding-password',
  }, restrictedHeaders);
  assert.equal(bound.response.status, 200);
  assert.equal(bound.payload.phoneBindingRequired, false);
  assert.equal(bound.payload.phoneMasked, '+86138****3333');
  const boundCookie = sessionCookie(bound.response);
  assert.ok(boundCookie);
  assert.equal((await me(base, restricted.cookie)).user, null);
  const storedBindings = JSON.parse(
    await readFile(path.join(data, 'phone-bindings.json'), 'utf8'),
  );
  assert.deepEqual(storedBindings.map(({ name, phone }) => ({ name, phone })), [{
    name: bindingUser.name,
    phone: '+8613833333333',
  }]);
  const allowedState = await fetch(`${base}/api/state`, {
    headers: accountHeaders(boundCookie, bindingUser.name),
  });
  assert.equal(allowedState.status, 200);

  const resetSessionA = await login(
    base, resetUser.name, 'reset-old-password', resetUser.name,
  );
  const resetSessionB = await login(
    base, resetUser.email, 'reset-old-password', resetUser.name,
  );
  const resetCodeRequest = await postJson(`${base}/api/auth/sms-code`, {
    phone: resetUser.phone,
    purpose: 'reset-password',
  });
  assert.equal(resetCodeRequest.response.status, 200);
  const resetCode = await waitForSms(smsLog, resetUser.phone);
  const reset = await postJson(`${base}/api/auth/password-reset/phone`, {
    phone: resetUser.phone,
    code: resetCode.code,
    newPassword: 'reset-new-password',
  });
  assert.equal(reset.response.status, 200);
  const resetCookie = sessionCookie(reset.response);
  assert.ok(resetCookie);
  assert.equal((await me(base, resetSessionA.cookie)).user, null);
  assert.equal((await me(base, resetSessionB.cookie)).user, null);
  assert.equal((await me(base, resetCookie)).user.name, resetUser.name);
  const replayReset = await postJson(`${base}/api/auth/password-reset/phone`, {
    phone: resetUser.phone,
    code: resetCode.code,
    newPassword: 'must-not-win-password',
  });
  assert.equal(replayReset.response.status, 400);
  assert.deepEqual(replayReset.payload, { error: 'invalid-or-expired-code' });
  const oldPassword = await postJson(`${base}/api/login`, {
    identifier: resetUser.name,
    password: 'reset-old-password',
  });
  assert.equal(oldPassword.response.status, 401);
  const newPassword = await login(
    base, resetUser.name, 'reset-new-password', resetUser.name,
  );
  assert.equal(newPassword.payload.phoneBindingRequired, false);
});
