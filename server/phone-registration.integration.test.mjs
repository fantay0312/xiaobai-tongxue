import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  accountHeaders, copyRuntimeModules, login, me, openPort, postJson,
  sessionCookie, smsCodeFor, smsRequests, stopChild, waitForReady,
} from './integration.test-harness.mjs';

test('phone registration works without email service and persists a verified phone-only account', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-phone-registration-'));
  const data = path.join(root, 'data');
  const smsLog = path.join(root, 'sms.log');
  await mkdir(data);
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), '<!doctype html><title>registration test</title>');
  await copyRuntimeModules(root);
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true,
    inviteCode: 'test-invite', users: [],
  }));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['index.mjs'], {
      cwd: root,
      env: { ...process.env, RESEND_API_KEY: '', RESEND_FROM: '', SMS_TEST_LOG: smsLog,
        SMS_FAIL_PHONES: '+8613999999999' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(child);
  };
  t.after(async () => { await stopChild(child); await rm(root, { recursive: true, force: true }); });
  await start();
  const base = `http://127.0.0.1:${port}`;
  const capabilities = await me(base, '');
  assert.equal(capabilities.registrationAvailable, true);
  assert.equal(capabilities.smsAuthAvailable, true);
  assert.equal(capabilities.emailAuthAvailable, false);

  const phone = '+8613801234567';
  const request = { phone, purpose: 'register', invite: 'test-invite' };
  const wrongInvite = await postJson(`${base}/api/auth/sms-code`, { ...request, invite: 'wrong' });
  assert.equal(wrongInvite.response.status, 403);
  assert.equal((await smsRequests(smsLog)).length, 0);
  assert.equal((await postJson(`${base}/api/auth/sms-code`, request)).response.status, 200);
  for (let tries = 0; (await smsRequests(smsLog)).length === 0 && tries < 40; tries++) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const { code } = await smsCodeFor(smsLog, phone);
  const registration = { method: 'phone', phone, username: 'PhoneStudent', password: 'phone-test-password', invite: 'test-invite' };
  const badCode = await postJson(`${base}/api/register`, { ...registration, code: '000000' });
  assert.equal(badCode.response.status, 400);
  assert.equal(sessionCookie(badCode.response), null);
  const attempts = await Promise.all([
    postJson(`${base}/api/register`, { ...registration, code }),
    postJson(`${base}/api/register`, { ...registration, username: 'PhoneRacer', code }),
  ]);
  assert.deepEqual(attempts.map(item => item.response.status).sort(), [200, 400]);
  const registered = attempts.find(item => item.response.status === 200);
  const createdName = registered.payload.user.name;
  assert.equal(registered.response.status, 200);
  assert.equal(registered.payload.emailBindingRequired, false);
  assert.equal(registered.payload.phoneBindingRequired, false);
  assert.equal(registered.payload.emailMasked, null);
  assert.equal(registered.payload.phoneMasked, '+86138****4567');
  const cookie = sessionCookie(registered.response);
  assert.ok(cookie);
  const state = await fetch(`${base}/api/state`, { headers: accountHeaders(cookie, createdName) });
  assert.equal(state.status, 200);
  const users = JSON.parse(await readFile(path.join(data, 'registered-users.json'), 'utf8'));
  assert.equal(users.length, 1);
  assert.equal(users[0].phone, phone);
  assert.ok(users[0].phoneVerifiedAt);
  assert.equal(Object.hasOwn(users[0], 'email'), false);
  assert.equal(Object.hasOwn(users[0], 'emailVerifiedAt'), false);
  const replay = await postJson(`${base}/api/register`, { ...registration, username: 'ReplayStudent', code });
  assert.equal(replay.response.status, 400);
  assert.equal(sessionCookie(replay.response), null);

  await stopChild(child);
  await start();
  const signedIn = await login(base, phone, registration.password, createdName);
  assert.equal(signedIn.payload.emailBindingRequired, false);
  assert.equal(signedIn.payload.phoneBindingRequired, false);
  const occupied = await postJson(`${base}/api/auth/sms-code`, request);
  assert.equal(occupied.response.status, 409);
  assert.deepEqual(occupied.payload, { error: 'already-registered' });
  assert.equal((await smsRequests(smsLog)).length, 1);
  const smsLogin = await postJson(`${base}/api/auth/sms-code`, { phone, purpose: 'login' });
  assert.equal(smsLogin.response.status, 200);
  const failedSend = await postJson(`${base}/api/auth/sms-code`, {
    phone: '+8613999999999', purpose: 'register', invite: 'test-invite',
  });
  assert.equal(failedSend.response.status, 502);
  assert.deepEqual(failedSend.payload, { error: 'sms-unavailable' });
});
