import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  copyRuntimeModules,
  login,
  openPort,
  stopChild,
  waitForReady,
} from './integration.test-harness.mjs';

function legacyUser(name, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { name, salt, hash };
}

test('legacy configured and registered accounts receive restricted sessions', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-binding-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  await copyRuntimeModules(root);
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
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  for (const [name, password] of [
    [configured.name, 'configured-password'],
    [registered.name, 'registered-password'],
  ]) {
    const signedIn = await login(base, name, password, name, { legacyUsername: true });
    assert.equal(signedIn.payload.emailBindingRequired, true);
    assert.equal(signedIn.payload.emailMasked, null);
    const { cookie } = signedIn;
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
