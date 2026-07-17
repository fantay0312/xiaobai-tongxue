import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  copyRuntimeModules,
  openPort,
  postJson,
  stopChild,
  waitForReady,
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

test('password login accepts account or verified email without weakening legacy binding', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-password-login-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);

  const configured = passwordUser('ConfigTeacher', 'configured-password', 'config@example.com');
  const registered = passwordUser('RegisteredOne', 'registered-password', 'registered@example.com');
  const legacy = passwordUser('LegacyOne', 'legacy-password');
  await writeFile(path.join(data, 'registered-users.json'), JSON.stringify([registered, legacy]));
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    users: [configured],
  }));

  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  const configEmail = await postJson(`${base}/api/login`, {
    identifier: '  CONFIG@EXAMPLE.COM  ', password: 'configured-password',
  });
  assert.equal(configEmail.response.status, 200);
  assert.deepEqual(configEmail.payload, {
    user: { name: configured.name },
    emailBindingRequired: false,
    emailMasked: 'c***@example.com',
  });
  assert.ok(configEmail.response.headers.get('set-cookie'));
  const overrides = JSON.parse(await readFile(path.join(data, 'password-overrides.json'), 'utf8'));
  assert.equal(overrides[0].name, configured.name);
  assert.equal(overrides[0].passwordScheme, PASSWORD_SCHEME_CURRENT);
  assert.notEqual(overrides[0].hash, configured.hash);

  const registeredEmail = await postJson(`${base}/api/login`, {
    identifier: 'REGISTERED@EXAMPLE.COM', password: 'registered-password',
  });
  assert.equal(registeredEmail.response.status, 200);
  assert.equal(registeredEmail.payload.user.name, registered.name);
  assert.equal(registeredEmail.payload.emailBindingRequired, false);
  let persistedRegistrations = JSON.parse(
    await readFile(path.join(data, 'registered-users.json'), 'utf8'),
  );
  assert.equal(
    persistedRegistrations.find((user) => user.name === registered.name).passwordScheme,
    PASSWORD_SCHEME_CURRENT,
  );

  const accountIdentifier = await postJson(`${base}/api/login`, {
    identifier: 'registeredone', password: 'registered-password',
  });
  assert.equal(accountIdentifier.response.status, 200);
  assert.equal(accountIdentifier.payload.user.name, registered.name);

  const legacyUsername = await postJson(`${base}/api/login`, {
    username: legacy.name, password: 'legacy-password',
  });
  assert.equal(legacyUsername.response.status, 200);
  assert.deepEqual(legacyUsername.payload, {
    user: { name: legacy.name },
    emailBindingRequired: true,
    emailMasked: null,
  });
  persistedRegistrations = JSON.parse(
    await readFile(path.join(data, 'registered-users.json'), 'utf8'),
  );
  assert.equal(
    persistedRegistrations.find((user) => user.name === legacy.name).passwordScheme,
    PASSWORD_SCHEME_CURRENT,
  );

  const genericFailure = { error: 'invalid-credentials' };
  for (const body of [
    { identifier: 'CONFIG@example.com', password: 'wrong-password' },
    { identifier: 'missing@example.com', password: 'configured-password' },
    { identifier: 'legacyone@example.com', password: 'legacy-password' },
  ]) {
    const failed = await postJson(`${base}/api/login`, body);
    assert.equal(failed.response.status, 401);
    assert.deepEqual(failed.payload, genericFailure);
    assert.equal(failed.response.headers.get('set-cookie'), null);
  }

  const ambiguous = await postJson(`${base}/api/login`, {
    identifier: 7,
    username: configured.name,
    password: 'configured-password',
  });
  assert.equal(ambiguous.response.status, 401);
  assert.deepEqual(ambiguous.payload, genericFailure);

  // 使用独立代理 IP 累积 9 次失败；中间一次成功不得清空整个 IP 窗口，
  // 第 10 次失败后，即便凭据正确也必须被 10 次/15 分钟门禁挡住。
  const rateIp = '198.51.100.42';
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const failed = await postJson(`${base}/api/login`, {
      identifier: `missing-${attempt}@example.com`, password: 'wrong-password',
    }, { 'X-Real-IP': rateIp });
    assert.equal(failed.response.status, 401);
  }
  const successBeforeLimit = await postJson(`${base}/api/login`, {
    identifier: configured.name, password: 'configured-password',
  }, { 'X-Real-IP': rateIp });
  assert.equal(successBeforeLimit.response.status, 200);
  const tenthFailure = await postJson(`${base}/api/login`, {
    identifier: 'last-missing@example.com', password: 'wrong-password',
  }, { 'X-Real-IP': rateIp });
  assert.equal(tenthFailure.response.status, 401);
  const blockedAfterSuccess = await postJson(`${base}/api/login`, {
    identifier: configured.name, password: 'configured-password',
  }, { 'X-Real-IP': rateIp });
  assert.equal(blockedAfterSuccess.response.status, 429);
  assert.deepEqual(blockedAfterSuccess.payload, { error: 'too-many-attempts' });
  assert.equal(blockedAfterSuccess.response.headers.get('set-cookie'), null);
});
