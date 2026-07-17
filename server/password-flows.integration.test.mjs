import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import net from 'node:net';
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
  me,
  openPort,
  postJson,
  resendMessages,
  sessionCookie,
  stopChild,
} from './integration.test-harness.mjs';
import { PASSWORD_SCHEME_CURRENT } from './credential-format.mjs';

const VERIFIED_AT = '2026-07-14T00:00:00.000Z';
const REGISTERED_NEW = 'NewPass8';
const CONFIG_NEW = 'C'.repeat(128);
function passwordUser(name, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { name, salt, hash, email, emailVerifiedAt: VERIFIED_AT };
}
async function expectSlowAuthBodyClosed(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.on('error', () => { /* 服务端超时主动 reset 是预期结果 */ });
  await once(socket, 'connect');
  const startedAt = Date.now();
  socket.write('POST /api/login HTTP/1.1\r\nHost: 127.0.0.1\r\n'
    + 'Content-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{');
  const timeout = setTimeout(() => socket.destroy(), 7_000);
  await new Promise((resolve) => socket.once('close', resolve));
  clearTimeout(timeout);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 4_500, `auth body closed too early: ${elapsed}ms`);
  assert.ok(elapsed < 7_000, `auth body timeout did not fire: ${elapsed}ms`);
}
async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-password-flows-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
  await installFakeResend(root);
  return { root, dist, data, resendLog };
}

test('password reset and authenticated password change are durable and revoke prior sessions', async (t) => {
  const fixture = await createFixture();
  const { root, data, resendLog } = fixture;
  const registeredPath = path.join(data, 'registered-users.json');
  const overridesPath = path.join(data, 'password-overrides.json');
  const configured = passwordUser('ConfigUser', 'ConfigOld!1', 'config-reset@example.com');
  const registered = passwordUser('RegisteredUser', 'RegisteredOld!1', 'registered-reset@example.com');
  await writeFile(registeredPath, JSON.stringify([registered]));
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true, users: [configured],
  }));
  let child = await launchGateway(root, resendLog);
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await expectSlowAuthBodyClosed(port);
  const registeredSession = await login(base, registered.name, 'RegisteredOld!1', registered.name);
  const registeredOtherSession = await login(
    base, registered.email, 'RegisteredOld!1', registered.name,
  );

  const knownCodeRequest = await postJson(`${base}/api/auth/password-code`, {
    email: '  REGISTERED-RESET@EXAMPLE.COM  ',
  });
  assert.equal(knownCodeRequest.response.status, 200);
  assert.equal(knownCodeRequest.payload.ok, true);
  const messagesAfterKnown = await resendMessages(resendLog);
  assert.equal(messagesAfterKnown.length, 1);
  assert.match(messagesAfterKnown[0].subject, /重置密码/);
  const unknownCodeRequest = await postJson(`${base}/api/auth/password-code`, {
    email: 'unknown-reset@example.com',
  });
  assert.equal(unknownCodeRequest.response.status, 200);
  assert.deepEqual(unknownCodeRequest.payload, knownCodeRequest.payload);
  assert.equal((await resendMessages(resendLog)).length, 1);
  const resetCode = await codeFor(resendLog, registered.email);
  for (const [newPassword, expectedError] of [
    ['short7', 'weak-password'],
    ['x'.repeat(129), 'password-too-long'],
  ]) {
    const invalid = await postJson(`${base}/api/auth/password-reset`, {
      email: registered.email,
      code: resetCode.code,
      newPassword,
    });
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(invalid.payload, { error: expectedError });
    assert.equal(sessionCookie(invalid.response), null);
  }

  const reset = await postJson(`${base}/api/auth/password-reset`, {
    email: registered.email,
    code: resetCode.code,
    newPassword: REGISTERED_NEW,
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.payload.user.name, registered.name);
  const resetCookie = sessionCookie(reset.response);
  assert.ok(resetCookie);
  assert.equal((await me(base, registeredSession.cookie)).user, null);
  assert.equal((await me(base, registeredOtherSession.cookie)).user, null);
  assert.equal((await me(base, resetCookie)).user.name, registered.name);

  const replay = await postJson(`${base}/api/auth/password-reset`, {
    email: registered.email,
    code: resetCode.code,
    newPassword: 'MustNotReplace!3',
  });
  assert.equal(replay.response.status, 400);
  assert.deepEqual(replay.payload, { error: 'invalid-or-expired-code' });
  assert.equal(sessionCookie(replay.response), null);

  const oldRegisteredLogin = await postJson(`${base}/api/login`, {
    identifier: registered.name,
    password: 'RegisteredOld!1',
  });
  assert.equal(oldRegisteredLogin.response.status, 401);
  await login(base, registered.email, REGISTERED_NEW, registered.name);

  const configSession = await login(base, configured.name, 'ConfigOld!1', configured.name);
  const configOtherSession = await login(base, configured.email, 'ConfigOld!1', configured.name);
  const staleResetRequest = await postJson(`${base}/api/auth/password-code`, {
    email: configured.email,
  });
  assert.equal(staleResetRequest.response.status, 200);
  const staleResetCode = await codeFor(resendLog, configured.email);
  const unauthenticated = await postJson(`${base}/api/account/password`, {
    currentPassword: 'ConfigOld!1',
    newPassword: CONFIG_NEW,
  }, { 'X-Xiaobai-User': encodeURIComponent(configured.name) });
  assert.equal(unauthenticated.response.status, 401);
  assert.deepEqual(unauthenticated.payload, { error: 'login-required' });

  const missingIdentity = await postJson(`${base}/api/account/password`, {
    currentPassword: 'ConfigOld!1',
    newPassword: CONFIG_NEW,
  }, { Cookie: configSession.cookie });
  assert.equal(missingIdentity.response.status, 401);
  assert.deepEqual(missingIdentity.payload, { error: 'identity-mismatch' });

  const wrongCurrent = await postJson(`${base}/api/account/password`, {
    currentPassword: 'not-the-current-password',
    newPassword: CONFIG_NEW,
  }, accountHeaders(configSession.cookie, configured.name));
  assert.equal(wrongCurrent.response.status, 401);
  assert.deepEqual(wrongCurrent.payload, { error: 'invalid-credentials' });
  assert.equal(sessionCookie(wrongCurrent.response), null);

  const changed = await postJson(`${base}/api/account/password`, {
    currentPassword: 'ConfigOld!1',
    newPassword: CONFIG_NEW,
  }, accountHeaders(configSession.cookie, configured.name));
  assert.equal(changed.response.status, 200);
  assert.equal(changed.payload.user.name, configured.name);
  const changedCookie = sessionCookie(changed.response);
  assert.ok(changedCookie);
  assert.equal((await me(base, configSession.cookie)).user, null);
  assert.equal((await me(base, configOtherSession.cookie)).user, null);
  assert.equal((await me(base, changedCookie)).user.name, configured.name);

  const staleReset = await postJson(`${base}/api/auth/password-reset`, {
    email: configured.email,
    code: staleResetCode.code,
    newPassword: 'MustNotReplace!4',
  });
  assert.equal(staleReset.response.status, 400);
  assert.deepEqual(staleReset.payload, { error: 'invalid-or-expired-code' });
  assert.equal(sessionCookie(staleReset.response), null);

  const overrides = JSON.parse(await readFile(overridesPath, 'utf8'));
  assert.equal(overrides.length, 1);
  assert.deepEqual(
    Object.keys(overrides[0]).sort(),
    ['changedAt', 'hash', 'name', 'passwordScheme', 'salt'],
  );
  assert.equal(overrides[0].passwordScheme, PASSWORD_SCHEME_CURRENT);
  assert.equal(overrides[0].name, configured.name);
  assert.match(overrides[0].salt, /^[0-9a-f]{32}$/);
  assert.match(overrides[0].hash, /^[0-9a-f]{128}$/);
  assert.equal(new Date(overrides[0].changedAt).toISOString(), overrides[0].changedAt);

  const oldConfigLogin = await postJson(`${base}/api/login`, {
    identifier: configured.name,
    password: 'ConfigOld!1',
  });
  assert.equal(oldConfigLogin.response.status, 401);
  await login(base, configured.email, CONFIG_NEW, configured.name);

  await stopChild(child);
  child = await launchGateway(root, resendLog);
  await login(base, registered.email, REGISTERED_NEW, registered.name);
  await login(base, configured.email, CONFIG_NEW, configured.name);
  for (const [identifier, password] of [
    [registered.name, 'RegisteredOld!1'],
    [configured.name, 'ConfigOld!1'],
  ]) {
    const stale = await postJson(`${base}/api/login`, { identifier, password });
    assert.equal(stale.response.status, 401);
  }
});

test('credential mutations serialize and stale reset codes cannot win a password-change race', async (t) => {
  const fixture = await createFixture();
  const { root, data, resendLog } = fixture;
  const configured = passwordUser('RaceUser', 'RaceOld!1', 'race-reset@example.com');
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true, users: [configured],
  }));
  const child = await launchGateway(root, resendLog, { UV_THREADPOOL_SIZE: '1' });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const sessions = await Promise.all([
    login(base, configured.name, 'RaceOld!1', configured.name),
    login(base, configured.email, 'RaceOld!1', configured.name),
    login(base, configured.name, 'RaceOld!1', configured.name),
  ]);
  const candidates = ['RaceNewA!1', 'RaceNewB!1', 'RaceNewC!1'];
  const changes = await Promise.all(candidates.map((newPassword, index) => postJson(
    `${base}/api/account/password`,
    { currentPassword: 'RaceOld!1', newPassword },
    accountHeaders(sessions[index].cookie, configured.name),
  )));
  const winners = changes
    .map((result, index) => ({ ...result, index }))
    .filter((result) => result.response.status === 200);
  assert.equal(winners.length, 1, 'only one request may commit from the same credential revision');
  for (const result of changes) assert.ok([200, 401].includes(result.response.status));
  for (const session of sessions) assert.equal((await me(base, session.cookie)).user, null);
  const winningPassword = candidates[winners[0].index];
  const winningCookie = sessionCookie(winners[0].response);
  assert.ok(winningCookie);
  assert.equal((await me(base, winningCookie)).user.name, configured.name);

  const staleCodeRequest = await postJson(`${base}/api/auth/password-code`, {
    email: configured.email,
  });
  assert.equal(staleCodeRequest.response.status, 200);
  const staleCode = await codeFor(resendLog, configured.email);
  const finalPassword = 'RaceFinal!2';
  const inFlightChange = postJson(`${base}/api/account/password`, {
    currentPassword: winningPassword,
    newPassword: finalPassword,
  }, accountHeaders(winningCookie, configured.name));
  // 让改密请求先进入账号锁；单线程 scrypt 使 hash 边界稳定可复现。
  await new Promise((resolve) => setTimeout(resolve, 50));
  const racingReset = postJson(`${base}/api/auth/password-reset`, {
    email: configured.email,
    code: staleCode.code,
    newPassword: 'RaceMustNotWin!3',
  });
  const [changed, reset] = await Promise.all([inFlightChange, racingReset]);
  assert.equal(changed.response.status, 200);
  assert.equal(reset.response.status, 400);
  assert.deepEqual(reset.payload, { error: 'invalid-or-expired-code' });
  assert.equal(sessionCookie(reset.response), null);
  await login(base, configured.email, finalPassword, configured.name);
  const staleWinner = await postJson(`${base}/api/login`, {
    identifier: configured.email,
    password: 'RaceMustNotWin!3',
  });
  assert.equal(staleWinner.response.status, 401);
});

test('malformed password-overrides.json fails closed during gateway startup', async (t) => {
  const { root, data } = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const configured = passwordUser('ConfigUser', 'ConfigOld!1', 'config@example.com');
  const port = await openPort();
  await writeFile(path.join(data, 'password-overrides.json'), JSON.stringify([{
    name: configured.name,
    salt: configured.salt,
    hash: configured.hash,
    changedAt: 'not-an-iso-timestamp',
  }]));
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port, distDir: './dist', dataDir: data, allowInsecureAuth: true, users: [configured],
  }));

  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  const [code] = await once(child, 'exit');
  clearTimeout(timeout);
  assert.equal(code, 2);
  assert.match(stderr, /password-overrides|密码覆盖|用户.*校验失败/i);
});

test('session TTL configuration rejects non-numeric and out-of-range values', async () => {
  for (const sessionTtlHours of [0, 721, '72']) {
    const { root, data } = await createFixture();
    try {
      const port = await openPort();
      await writeFile(path.join(root, 'config.json'), JSON.stringify({
        port,
        distDir: './dist',
        dataDir: data,
        allowInsecureAuth: true,
        sessionTtlHours,
        users: [],
      }));
      const child = spawn(process.execPath, ['index.mjs'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
      const [code] = await once(child, 'exit');
      clearTimeout(timeout);
      assert.equal(code, 2);
      assert.match(stderr, /sessionTtlHours/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
