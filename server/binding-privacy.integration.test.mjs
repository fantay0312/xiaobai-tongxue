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

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('binding endpoints suppress occupied-email enumeration and still consume limits', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-binding-privacy-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const resendLog = path.join(root, 'resend.log');
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
    const body = String(init?.body ?? '');
    appendFileSync(process.env.RESEND_TEST_LOG, body + '\\n');
    const status = body.includes('failure@example.com') ? 503 : 200;
    return new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });
  }
  return nativeFetch(input, init);
};
`);

  const legacy = passwordUser('LegacyBinder', 'legacy-password');
  const existing = passwordUser('ExistingUser', 'existing-password', 'owned@example.com');
  await writeFile(path.join(data, 'registered-users.json'), JSON.stringify([existing]));
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    users: [legacy],
  }));

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

  const login = await postJson(`${base}/api/login`, {
    identifier: legacy.name,
    password: 'legacy-password',
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  const authHeaders = {
    Cookie: cookie,
    'X-Xiaobai-User': encodeURIComponent(legacy.name),
  };

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
});
