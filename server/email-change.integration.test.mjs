import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIED_AT = '2026-07-14T00:00:00.000Z';
function passwordUser(name, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { name, salt, hash, ...(email ? { email, emailVerifiedAt: VERIFIED_AT } : {}) };
}
async function openPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function waitForReady(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway-start-timeout')), 5_000);
    const onData = (chunk) => {
      if (!chunk.toString().includes('网关已启动')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`gateway-exited-${code}`));
    });
  });
}
async function launch(root, resendLog) {
  const child = spawn(process.execPath, ['--require', './fake-resend.cjs', 'index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      RESEND_API_KEY: 'test-only-key',
      RESEND_FROM: '小白同学 <noreply@example.com>',
      RESEND_TEST_LOG: resendLog,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForReady(child);
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}
async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}
function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
}
function accountHeaders(cookie, name) {
  return { Cookie: cookie, 'X-Xiaobai-User': encodeURIComponent(name) };
}
async function login(base, identifier, password, expectedName) {
  const result = await postJson(`${base}/api/login`, { identifier, password });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.user.name, expectedName);
  const cookie = sessionCookie(result.response);
  assert.ok(cookie);
  return { ...result, cookie };
}
async function me(base, cookie) {
  const response = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json();
}
async function resendMessages(file) {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : [];
}
async function codeFor(file, email) {
  const message = (await resendMessages(file)).findLast((item) => item.to?.[0] === email);
  assert.ok(message, `missing Resend message for ${email}`);
  const match = message.text.match(/\b(\d{6})\b/);
  assert.ok(match);
  return { code: match[1], message };
}

test('verified accounts change email safely while legacy first-binding remains supported', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-email-change-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
  const registrationsPath = path.join(data, 'registered-users.json');
  const bindingsPath = path.join(data, 'email-bindings.json');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  for (const file of ['index.mjs', 'email-auth.mjs', 'auth-security.mjs', 'password-credentials.mjs']) {
    await copyFile(path.join(HERE, file), path.join(root, file));
  }
  await writeFile(path.join(root, 'fake-resend.cjs'), `
const { appendFileSync } = require('node:fs');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url === 'https://api.resend.com/emails') {
    appendFileSync(process.env.RESEND_TEST_LOG, String(init?.body ?? '') + '\\n');
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return nativeFetch(input, init);
};
`);

  const configured = passwordUser('ConfigUser', 'config-password', 'config-default@example.com');
  const registered = passwordUser('RegisteredUser', 'registered-password', 'registered-old@example.com');
  const occupied = passwordUser('OtherUser', 'other-password', 'occupied@example.com');
  const legacy = passwordUser('LegacyUser', 'legacy-password');
  await writeFile(registrationsPath, JSON.stringify([registered, occupied, legacy]));
  await writeFile(bindingsPath, JSON.stringify([{
    name: configured.name, email: 'config-old@example.com', emailVerifiedAt: VERIFIED_AT,
  }]));
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true, users: [configured],
  }));

  let child = await launch(root, resendLog);
  t.after(async () => { await stop(child); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;

  const configLogin = await login(base, configured.name, 'config-password', configured.name);
  const configOtherSession = await login(base, configured.name, 'config-password', configured.name);
  assert.equal(configLogin.payload.emailMasked, 'c***@example.com');
  const configHeaders = accountHeaders(configLogin.cookie, configured.name);
  const bindingsBeforeUnchanged = await readFile(bindingsPath, 'utf8');
  const missingStepUp = await postJson(`${base}/api/account/email-code`, {
    email: 'attacker@example.com',
  }, configHeaders);
  assert.equal(missingStepUp.response.status, 401);
  assert.deepEqual(missingStepUp.payload, { error: 'invalid-credentials' });
  assert.equal((await resendMessages(resendLog)).length, 0);
  const unchanged = await postJson(`${base}/api/account/email-code`, {
    email: 'CONFIG-OLD@EXAMPLE.COM',
    currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(unchanged.response.status, 200);
  const unchangedCode = await codeFor(resendLog, 'config-old@example.com');
  const unchangedFinish = await postJson(`${base}/api/account/email`, {
    email: 'config-old@example.com', code: unchangedCode.code, currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(unchangedFinish.response.status, 409);
  assert.deepEqual(unchangedFinish.payload, { error: 'email-unavailable' });
  assert.equal(sessionCookie(unchanged.response), null);
  assert.equal(sessionCookie(unchangedFinish.response), null);
  assert.equal((await me(base, configLogin.cookie)).user.name, configured.name);
  assert.equal((await me(base, configOtherSession.cookie)).user.name, configured.name);
  assert.equal(await readFile(bindingsPath, 'utf8'), bindingsBeforeUnchanged);
  const occupiedRequest = await postJson(`${base}/api/account/email-code`, {
    email: 'occupied@example.com',
    currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(occupiedRequest.response.status, 200);
  assert.deepEqual(occupiedRequest.payload, unchanged.payload);
  assert.equal((await resendMessages(resendLog)).length, 1);
  const occupiedAgain = await postJson(`${base}/api/account/email-code`, {
    email: 'occupied@example.com',
    currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(occupiedAgain.response.status, 429);

  const staleRequest = await postJson(`${base}/api/account/email-code`, {
    email: 'config-stale@example.com',
    currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(staleRequest.response.status, 200);
  const stale = await codeFor(resendLog, 'config-stale@example.com');
  const changeRequest = await postJson(`${base}/api/account/email-code`, {
    email: 'config-new@example.com',
    currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(changeRequest.response.status, 200);
  assert.deepEqual(changeRequest.payload, occupiedRequest.payload);
  const change = await codeFor(resendLog, 'config-new@example.com');
  assert.match(change.message.subject, /换绑邮箱/);

  const wrongCode = change.code === '000000' ? '000001' : '000000';
  const wrong = await postJson(`${base}/api/account/email`, {
    email: 'config-new@example.com', code: wrongCode, currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(wrong.response.status, 400);
  const changed = await postJson(`${base}/api/account/email`, {
    email: 'config-new@example.com', code: change.code, currentPassword: 'config-password',
  }, configHeaders);
  assert.equal(changed.response.status, 200);
  assert.equal(changed.payload.emailMasked, 'c***@example.com');
  const changedCookie = sessionCookie(changed.response);
  assert.ok(changedCookie);
  assert.equal((await me(base, configLogin.cookie)).user, null);
  assert.equal((await me(base, configOtherSession.cookie)).user, null);
  assert.equal((await me(base, changedCookie)).user.name, configured.name);

  for (const [email, code] of [
    ['config-new@example.com', change.code],
    ['config-stale@example.com', stale.code],
  ]) {
    const rejected = await postJson(`${base}/api/account/email`, {
      email, code, currentPassword: 'config-password',
    },
      accountHeaders(changedCookie, configured.name));
    assert.equal(rejected.response.status, 400);
    assert.deepEqual(rejected.payload, { error: 'invalid-or-expired-code' });
  }

  const oldConfigLogin = await postJson(`${base}/api/login`, {
    identifier: 'config-old@example.com', password: 'config-password',
  });
  assert.equal(oldConfigLogin.response.status, 401);
  await login(base, 'config-new@example.com', 'config-password', configured.name);
  await new Promise((resolve) => setTimeout(resolve, 1_050));

  const registeredLogin = await login(base, registered.name, 'registered-password', registered.name);
  const registeredSend = await postJson(`${base}/api/account/email-code`, {
    email: 'registered-new@example.com',
    currentPassword: 'registered-password',
  }, accountHeaders(registeredLogin.cookie, registered.name));
  assert.equal(registeredSend.response.status, 200);
  const registeredCode = await codeFor(resendLog, 'registered-new@example.com');
  const registeredChange = await postJson(`${base}/api/account/email`, {
    email: 'registered-new@example.com', code: registeredCode.code,
    currentPassword: 'registered-password',
  }, accountHeaders(registeredLogin.cookie, registered.name));
  assert.equal(registeredChange.response.status, 200);
  assert.equal((await me(base, registeredLogin.cookie)).user, null);
  const oldRegisteredLogin = await postJson(`${base}/api/login`, {
    identifier: 'registered-old@example.com', password: 'registered-password',
  });
  assert.equal(oldRegisteredLogin.response.status, 401);

  const legacyLogin = await login(base, legacy.name, 'legacy-password', legacy.name);
  assert.equal(legacyLogin.payload.emailBindingRequired, true);
  const legacySend = await postJson(`${base}/api/account/email-code`, {
    email: 'legacy-new@example.com',
    currentPassword: 'legacy-password',
  }, accountHeaders(legacyLogin.cookie, legacy.name));
  assert.equal(legacySend.response.status, 200);
  const legacyCode = await codeFor(resendLog, 'legacy-new@example.com');
  assert.match(legacyCode.message.subject, /绑定邮箱/);
  const legacyBind = await postJson(`${base}/api/account/email`, {
    email: 'legacy-new@example.com', code: legacyCode.code, currentPassword: 'legacy-password',
  }, accountHeaders(legacyLogin.cookie, legacy.name));
  assert.equal(legacyBind.response.status, 200);
  assert.equal(legacyBind.payload.emailBindingRequired, false);
  assert.equal((await me(base, legacyLogin.cookie)).user, null);

  await new Promise((resolve) => setTimeout(resolve, 1_050));
  const currentRegistered = await login(
    base, 'registered-new@example.com', 'registered-password', registered.name,
  );
  const failedTarget = 'must-not-persist@example.com';
  const failedSend = await postJson(`${base}/api/account/email-code`, {
    email: failedTarget, currentPassword: 'registered-password',
  },
    accountHeaders(currentRegistered.cookie, registered.name));
  assert.equal(failedSend.response.status, 200);
  const failedCode = await codeFor(resendLog, failedTarget);
  const registryBeforeFailure = await readFile(registrationsPath, 'utf8');
  await rm(registrationsPath);
  await mkdir(registrationsPath);
  const failedPersist = await postJson(`${base}/api/account/email`, {
    email: failedTarget, code: failedCode.code, currentPassword: 'registered-password',
  }, accountHeaders(currentRegistered.cookie, registered.name));
  assert.equal(failedPersist.response.status, 500);
  assert.deepEqual(failedPersist.payload, { error: 'persist-failed' });
  assert.equal(sessionCookie(failedPersist.response), null);
  assert.equal((await me(base, currentRegistered.cookie)).emailMasked, 'r***@example.com');
  await rm(registrationsPath, { recursive: true });
  await writeFile(registrationsPath, registryBeforeFailure);

  const bindings = JSON.parse(await readFile(bindingsPath, 'utf8'));
  assert.equal(bindings[0].email, 'config-new@example.com');
  const registrations = JSON.parse(await readFile(registrationsPath, 'utf8'));
  assert.equal(registrations.find((user) => user.name === registered.name).email,
    'registered-new@example.com');
  assert.equal(registrations.find((user) => user.name === legacy.name).email,
    'legacy-new@example.com');

  await stop(child);
  child = await launch(root, resendLog);
  await login(base, 'config-new@example.com', 'config-password', configured.name);
  for (const identifier of ['config-old@example.com', 'config-default@example.com']) {
    const oldLogin = await postJson(`${base}/api/login`, {
      identifier, password: 'config-password',
    });
    assert.equal(oldLogin.response.status, 401);
  }
  await login(base, 'registered-new@example.com', 'registered-password', registered.name);
  const oldRegisteredAfterRestart = await postJson(`${base}/api/login`, {
    identifier: 'registered-old@example.com', password: 'registered-password',
  });
  assert.equal(oldRegisteredAfterRestart.response.status, 401);
  await login(base, 'legacy-new@example.com', 'legacy-password', legacy.name);
});
