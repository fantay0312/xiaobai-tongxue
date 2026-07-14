import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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

async function passwordLogin(base, body, realIp) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(realIp ? { 'X-Real-IP': realIp } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('password login accepts account or verified email without weakening legacy binding', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-password-login-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  for (const file of ['index.mjs', 'email-auth.mjs', 'auth-security.mjs', 'password-credentials.mjs']) {
    await copyFile(path.join(HERE, file), path.join(root, file));
  }

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
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  const configEmail = await passwordLogin(base, {
    identifier: '  CONFIG@EXAMPLE.COM  ', password: 'configured-password',
  });
  assert.equal(configEmail.response.status, 200);
  assert.deepEqual(configEmail.payload, {
    user: { name: configured.name },
    emailBindingRequired: false,
    emailMasked: 'c***@example.com',
  });
  assert.ok(configEmail.response.headers.get('set-cookie'));

  const registeredEmail = await passwordLogin(base, {
    identifier: 'REGISTERED@EXAMPLE.COM', password: 'registered-password',
  });
  assert.equal(registeredEmail.response.status, 200);
  assert.equal(registeredEmail.payload.user.name, registered.name);
  assert.equal(registeredEmail.payload.emailBindingRequired, false);

  const accountIdentifier = await passwordLogin(base, {
    identifier: 'registeredone', password: 'registered-password',
  });
  assert.equal(accountIdentifier.response.status, 200);
  assert.equal(accountIdentifier.payload.user.name, registered.name);

  const legacyUsername = await passwordLogin(base, {
    username: legacy.name, password: 'legacy-password',
  });
  assert.equal(legacyUsername.response.status, 200);
  assert.deepEqual(legacyUsername.payload, {
    user: { name: legacy.name },
    emailBindingRequired: true,
    emailMasked: null,
  });

  const genericFailure = { error: 'invalid-credentials' };
  for (const body of [
    { identifier: 'CONFIG@example.com', password: 'wrong-password' },
    { identifier: 'missing@example.com', password: 'configured-password' },
    { identifier: 'legacyone@example.com', password: 'legacy-password' },
  ]) {
    const failed = await passwordLogin(base, body);
    assert.equal(failed.response.status, 401);
    assert.deepEqual(failed.payload, genericFailure);
    assert.equal(failed.response.headers.get('set-cookie'), null);
  }

  const ambiguous = await passwordLogin(base, {
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
    const failed = await passwordLogin(base, {
      identifier: `missing-${attempt}@example.com`, password: 'wrong-password',
    }, rateIp);
    assert.equal(failed.response.status, 401);
  }
  const successBeforeLimit = await passwordLogin(base, {
    identifier: configured.name, password: 'configured-password',
  }, rateIp);
  assert.equal(successBeforeLimit.response.status, 200);
  const tenthFailure = await passwordLogin(base, {
    identifier: 'last-missing@example.com', password: 'wrong-password',
  }, rateIp);
  assert.equal(tenthFailure.response.status, 401);
  const blockedAfterSuccess = await passwordLogin(base, {
    identifier: configured.name, password: 'configured-password',
  }, rateIp);
  assert.equal(blockedAfterSuccess.response.status, 429);
  assert.deepEqual(blockedAfterSuccess.payload, { error: 'too-many-attempts' });
  assert.equal(blockedAfterSuccess.response.headers.get('set-cookie'), null);
});
