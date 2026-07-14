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

function legacyUser(name, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { name, salt, hash };
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

async function login(base, name, password) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.name, name);
  assert.equal(payload.emailBindingRequired, true);
  assert.equal(payload.emailMasked, null);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  return cookie;
}

test('legacy configured and registered accounts receive restricted sessions', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-binding-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  for (const file of ['index.mjs', 'email-auth.mjs', 'auth-security.mjs', 'password-credentials.mjs']) {
    await copyFile(path.join(HERE, file), path.join(root, file));
  }
  const configured = legacyUser('预置旧账号', 'configured-password');
  const registered = legacyUser('注册旧账号', 'registered-password');
  await writeFile(path.join(data, 'registered-users.json'), JSON.stringify([registered]));
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

  for (const [name, password] of [
    [configured.name, 'configured-password'],
    [registered.name, 'registered-password'],
  ]) {
    const cookie = await login(base, name, password);
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).emailBindingRequired, true);
    const headers = { Cookie: cookie, 'X-Xiaobai-User': encodeURIComponent(name) };
    for (const [pathname, method] of [
      ['/api/chat', 'POST'],
      ['/api/asr', 'POST'],
      ['/api/state', 'GET'],
      ['/api/state', 'PUT'],
    ]) {
      const wrongIdentity = await fetch(`${base}${pathname}`, {
        method,
        headers: { Cookie: cookie, 'X-Xiaobai-User': encodeURIComponent('其他账号') },
      });
      assert.equal(wrongIdentity.status, 401, `${method} ${pathname} wrong identity`);
      assert.deepEqual(await wrongIdentity.json(), { error: 'identity-mismatch' });
      const response = await fetch(`${base}${pathname}`, { method, headers });
      assert.equal(response.status, 403, `${method} ${pathname}`);
      assert.deepEqual(await response.json(), { error: 'email-verification-required' });
    }
  }
});
