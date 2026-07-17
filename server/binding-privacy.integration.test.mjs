import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  accountHeaders,
  codeFor,
  copyRuntimeModules,
  installFakeResend,
  launchGateway,
  login,
  openPort,
  postJson,
  stopChild,
} from './integration.test-harness.mjs';
import { PASSWORD_SCHEME_CURRENT } from './credential-format.mjs';

const VERIFIED_AT = '2026-07-14T00:00:00.000Z';

function passwordUser(name, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {
    name,
    salt,
    hash,
    ...(email ? { email, emailVerifiedAt: VERIFIED_AT } : {}),
  };
}

test('binding endpoints suppress occupied-email enumeration and still consume limits', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-binding-privacy-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await installFakeResend(root);

  const legacy = passwordUser('LegacyBinder', 'legacy-password');
  const existing = passwordUser('ExistingUser', 'existing-password', 'owned@example.com');
  const registerOwner = passwordUser(
    'RegisterOwner', 'register-password', 'register-owned@example.com',
  );
  await writeFile(path.join(data, 'registered-users.json'), JSON.stringify([existing, registerOwner]));
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    inviteCode: 'test-invite',
    users: [legacy],
  }));

  const child = await launchGateway(root, resendLog, {
    RESEND_FAIL_EMAILS: 'failure@example.com,register-failure@example.com',
  });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;

  const loginResult = await login(base, legacy.name, 'legacy-password', legacy.name);
  const authHeaders = accountHeaders(loginResult.cookie, legacy.name);

  const occupied = await postJson(`${base}/api/account/email-code`, {
    email: 'OWNED@EXAMPLE.COM',
    currentPassword: 'legacy-password',
  }, authHeaders);
  assert.equal(occupied.response.status, 200);
  assert.deepEqual(occupied.payload, { ok: true, retryAfter: 60 });
  assert.equal(await readFile(resendLog, 'utf8').catch(() => ''), '');

  const occupiedAgain = await postJson(`${base}/api/account/email-code`, {
    email: 'owned@example.com',
    currentPassword: 'legacy-password',
  }, authHeaders);
  assert.equal(occupiedAgain.response.status, 429);
  assert.equal(occupiedAgain.payload.error, 'send-too-frequent');

  const available = await postJson(`${base}/api/account/email-code`, {
    email: 'available@example.com',
    currentPassword: 'legacy-password',
  }, authHeaders);
  assert.equal(available.response.status, 200);
  assert.deepEqual(available.payload, occupied.payload);
  assert.equal((await readFile(resendLog, 'utf8')).trim().split('\n').length, 1);

  const senderFailure = await postJson(`${base}/api/account/email-code`, {
    email: 'failure@example.com',
    currentPassword: 'legacy-password',
  }, authHeaders);
  assert.equal(senderFailure.response.status, 200);
  assert.deepEqual(senderFailure.payload, occupied.payload);
  assert.equal((await readFile(resendLog, 'utf8')).trim().split('\n').length, 2);

  const finishOccupied = await postJson(`${base}/api/account/email`, {
    email: 'owned@example.com',
    code: '000000',
    currentPassword: 'legacy-password',
  }, authHeaders);
  assert.equal(finishOccupied.response.status, 400);
  assert.deepEqual(finishOccupied.payload, { error: 'invalid-or-expired-code' });

  const messagesBeforeRegister = (await readFile(resendLog, 'utf8')).trim().split('\n').length;
  const occupiedRegister = await postJson(`${base}/api/auth/email-code`, {
    email: 'REGISTER-OWNED@EXAMPLE.COM', purpose: 'register', invite: 'test-invite',
  });
  assert.equal(occupiedRegister.response.status, 200);
  assert.deepEqual(occupiedRegister.payload, { ok: true, retryAfter: 60 });
  assert.equal((await readFile(resendLog, 'utf8')).trim().split('\n').length, messagesBeforeRegister);

  const occupiedRegisterAgain = await postJson(`${base}/api/auth/email-code`, {
    email: 'register-owned@example.com', purpose: 'register', invite: 'test-invite',
  });
  assert.equal(occupiedRegisterAgain.response.status, 429);
  assert.equal(occupiedRegisterAgain.payload.error, 'send-too-frequent');

  const failedRegister = await postJson(`${base}/api/auth/email-code`, {
    email: 'register-failure@example.com', purpose: 'register', invite: 'test-invite',
  });
  assert.equal(failedRegister.response.status, 200);
  assert.deepEqual(failedRegister.payload, occupiedRegister.payload);
  assert.equal(
    (await readFile(resendLog, 'utf8')).trim().split('\n').length,
    messagesBeforeRegister + 1,
  );
  const failedRegistrationPassword = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
  const failedRegistration = await postJson(`${base}/api/register`, {
    username: 'MustNotRegister',
    password: failedRegistrationPassword,
    email: 'register-failure@example.com',
    code: '000000',
    invite: 'test-invite',
  });
  assert.equal(failedRegistration.response.status, 400);
  assert.deepEqual(failedRegistration.payload, { error: 'invalid-or-expired-code' });

  const availableRegister = await postJson(`${base}/api/auth/email-code`, {
    email: 'register-available@example.com', purpose: 'register', invite: 'test-invite',
  });
  assert.equal(availableRegister.response.status, 200);
  assert.deepEqual(availableRegister.payload, occupiedRegister.payload);
  assert.equal(
    (await readFile(resendLog, 'utf8')).trim().split('\n').length,
    messagesBeforeRegister + 2,
  );
  const availableCode = await codeFor(resendLog, 'register-available@example.com');
  const registrationPassword = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
  const registration = await postJson(`${base}/api/register`, {
    username: 'FreshTeacher',
    password: registrationPassword,
    email: 'register-available@example.com',
    code: availableCode.code,
    invite: 'test-invite',
  });
  assert.equal(registration.response.status, 200);
  assert.equal(registration.payload.user.name, 'FreshTeacher');
  await login(base, 'FreshTeacher', registrationPassword, 'FreshTeacher');
  const registrations = JSON.parse(await readFile(
    path.join(data, 'registered-users.json'), 'utf8',
  ));
  assert.equal(
    registrations.find((user) => user.name === 'FreshTeacher').passwordScheme,
    PASSWORD_SCHEME_CURRENT,
  );
});
