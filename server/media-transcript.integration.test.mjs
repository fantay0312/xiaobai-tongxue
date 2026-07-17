import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIED_AT = '2026-07-17T00:00:00.000Z';
const FILE_LIMIT = 8 * 1024 * 1024;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-test-body'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-test-body')]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x10, 0x00, 0x00, 0x00]), Buffer.from('WEBPwebp-test-body'),
]);
const PDF = Buffer.from('%PDF-1.7\ntranscript-test\n%%EOF');

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

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

async function childExitCode(child) {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = await once(child, 'exit');
  return code;
}

async function login(base, user, password) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user.name, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  return cookie;
}

function authHeaders(user, cookie, extra = {}) {
  return {
    Cookie: cookie,
    'X-Xiaobai-User': encodeURIComponent(user.name),
    ...extra,
  };
}

async function expectJson(response, status, payload) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), payload);
}

async function openSlowUpload(port, pathname, headers, firstChunk) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let raw = '';
  let settled = false;
  const response = new Promise((resolve, reject) => {
    socket.on('data', (chunk) => {
      if (settled) return;
      raw += chunk.toString('latin1');
      if (!raw.includes('\r\n\r\n')) return;
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
      if (!match) return;
      settled = true;
      resolve(Number(match[1]));
      socket.destroy();
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      reject(new Error('slow-upload-closed-without-response'));
    });
  });
  await once(socket, 'connect');
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  const method = pathname === '/api/transcript' ? 'PUT' : 'POST';
  socket.write([
    `${method} ${pathname} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    ...headerLines,
    'Transfer-Encoding: chunked',
    'Connection: close',
    '',
    '',
  ].join('\r\n'));
  socket.write(`${firstChunk.length.toString(16)}\r\n`);
  socket.write(firstChunk);
  socket.write('\r\n');
  return { socket, response };
}

test('vision and transcript APIs enforce protected media boundaries and account isolation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-media-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  const visionLog = path.join(root, 'vision.log');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  for (const file of ['index.mjs', 'email-auth.mjs', 'auth-security.mjs', 'password-credentials.mjs']) {
    await copyFile(path.join(HERE, file), path.join(root, file));
  }
  await writeFile(path.join(root, 'fake-vision.cjs'), `
const { appendFileSync } = require('node:fs');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url === 'https://vision.example/v1/chat/completions') {
    appendFileSync(process.env.VISION_TEST_LOG, JSON.stringify({
      url,
      authorization: init?.headers?.Authorization,
      body: JSON.parse(String(init?.body ?? '{}')),
    }) + '\\n');
    return new Response(JSON.stringify({ choices: [{ message: { content: '图中是一张带公式的课堂板书。' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return nativeFetch(input, init);
};
`);

  const alice = passwordUser('AliceMedia', 'alice-password', 'alice@example.com');
  const bob = passwordUser('BobMedia', 'bob-password', 'bob@example.com');
  const carol = passwordUser('CarolMedia', 'carol-password', 'carol@example.com');
  const dave = passwordUser('DaveMedia', 'dave-password', 'dave@example.com');
  const eve = passwordUser('EveMedia', 'eve-password', 'eve@example.com');
  const legacy = passwordUser('LegacyMedia', 'legacy-password');
  const port = await openPort();
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    port,
    distDir: './dist',
    dataDir: data,
    allowInsecureAuth: true,
    testMediaBodyTimeoutMs: 800,
    upstreamBaseUrl: 'https://vision.example/main',
    apiKey: 'vision-test-key',
    visionUpstreamUrl: 'https://vision.example/v1',
    upstreamModelVision: 'vision-test-model',
    users: [alice, bob, carol, dave, eve, legacy],
  }));

  const child = spawn(process.execPath, ['--require', './fake-vision.cjs', 'index.mjs'], {
    cwd: root,
    env: { ...process.env, VISION_TEST_LOG: visionLog },
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
  const aliceCookie = await login(base, alice, 'alice-password');
  const bobCookie = await login(base, bob, 'bob-password');
  const carolCookie = await login(base, carol, 'carol-password');
  const daveCookie = await login(base, dave, 'dave-password');
  const eveCookie = await login(base, eve, 'eve-password');
  const legacyCookie = await login(base, legacy, 'legacy-password');
  const aliceHeaders = authHeaders(alice, aliceCookie);
  const bobHeaders = authHeaders(bob, bobCookie);
  const carolHeaders = authHeaders(carol, carolCookie);
  const daveHeaders = authHeaders(dave, daveCookie);
  const eveHeaders = authHeaders(eve, eveCookie);

  await expectJson(await fetch(`${base}/api/vision`, { method: 'POST', body: PNG }), 401, {
    error: 'login-required',
  });
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: authHeaders(alice, aliceCookie, { 'X-Xiaobai-User': encodeURIComponent(bob.name) }),
    body: PNG,
  }), 401, { error: 'identity-mismatch' });
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: authHeaders(legacy, legacyCookie),
    body: PNG,
  }), 403, { error: 'email-verification-required' });
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST', headers: aliceHeaders, body: Buffer.from('not-an-image'),
  }), 415, { error: 'unsupported-file-type' });
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: { ...aliceHeaders, 'Content-Type': 'image/jpeg' },
    body: PNG,
  }), 415, { error: 'content-type-mismatch' });
  const oversizedPng = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(FILE_LIMIT - 7)]);
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST', headers: aliceHeaders, body: oversizedPng,
  }), 413, { error: 'body-too-large' });

  const vision = await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: { ...aliceHeaders, 'Content-Type': 'image/png' },
    body: PNG,
  });
  await expectJson(vision, 200, { description: '图中是一张带公式的课堂板书。' });
  const visionCall = JSON.parse((await readFile(visionLog, 'utf8')).trim());
  assert.equal(visionCall.url, 'https://vision.example/v1/chat/completions');
  assert.equal(visionCall.authorization, 'Bearer vision-test-key');
  assert.equal(visionCall.body.model, 'vision-test-model');
  assert.match(visionCall.body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);

  const slowVisionUploads = await Promise.all(Array.from({ length: 5 }, () => openSlowUpload(
    port,
    '/api/vision',
    { ...carolHeaders, 'Content-Type': 'image/png' },
    PNG.subarray(0, 8),
  )));
  const visionSlowStatuses = await Promise.all(slowVisionUploads.map(({ response }) => response));
  assert.deepEqual(visionSlowStatuses.sort(), [408, 408, 408, 408, 503]);
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST', headers: { ...carolHeaders, 'Content-Type': 'image/png' }, body: PNG,
  }), 200, { description: '图中是一张带公式的课堂板书。' });

  await expectJson(await fetch(`${base}/api/transcript`), 401, { error: 'login-required' });
  await expectJson(await fetch(`${base}/api/transcript`, {
    headers: authHeaders(alice, aliceCookie, { 'X-Xiaobai-User': encodeURIComponent(bob.name) }),
  }), 401, { error: 'identity-mismatch' });
  await expectJson(await fetch(`${base}/api/transcript`, {
    headers: authHeaders(legacy, legacyCookie),
  }), 403, { error: 'email-verification-required' });
  await expectJson(await fetch(`${base}/api/transcript`, { headers: aliceHeaders }), 200, { file: null });
  await expectJson(await fetch(`${base}/api/transcript`, {
    method: 'PUT', headers: aliceHeaders, body: Buffer.from('plain text'),
  }), 415, { error: 'unsupported-file-type' });
  await expectJson(await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: { ...aliceHeaders, 'Content-Type': 'image/jpeg' },
    body: PNG,
  }), 415, { error: 'content-type-mismatch' });
  await expectJson(await fetch(`${base}/api/transcript`, {
    method: 'PUT', headers: aliceHeaders, body: oversizedPng,
  }), 413, { error: 'body-too-large' });

  const firstUpload = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: {
      ...aliceHeaders,
      'Content-Type': 'image/png',
      'X-File-Name': encodeURIComponent('../../first\u202e-report.html.  '),
    },
    body: PNG,
  });
  assert.equal(firstUpload.status, 200);
  const firstMeta = (await firstUpload.json()).file;
  assert.equal(firstMeta.name, 'first-report.png');
  assert.equal(firstMeta.type, 'image/png');
  assert.equal(firstMeta.size, PNG.length);
  assert.match(firstMeta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual((await (await fetch(`${base}/api/transcript`, { headers: aliceHeaders })).json()).file, firstMeta);

  const aliceDownload = await fetch(`${base}/api/transcript/file`, { headers: aliceHeaders });
  assert.equal(aliceDownload.status, 200);
  assert.equal(aliceDownload.headers.get('content-type'), 'image/png');
  assert.match(aliceDownload.headers.get('content-disposition') ?? '', /first-report\.png/);
  assert.deepEqual(Buffer.from(await aliceDownload.arrayBuffer()), PNG);
  await expectJson(await fetch(`${base}/api/transcript`, { headers: bobHeaders }), 200, { file: null });

  const bobUpload = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: {
      ...bobHeaders,
      'Content-Type': 'image/jpeg',
      'X-File-Name': encodeURIComponent('bob-score.jpg'),
    },
    body: JPEG,
  });
  assert.equal(bobUpload.status, 200);
  const bobWebp = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: {
      ...bobHeaders,
      'Content-Type': 'image/webp',
      'X-File-Name': encodeURIComponent('bob-score.webp'),
    },
    body: WEBP,
  });
  assert.equal(bobWebp.status, 200);
  assert.equal((await bobWebp.json()).file.type, 'image/webp');
  const replace = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: {
      ...aliceHeaders,
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('final-score.pdf'),
    },
    body: PDF,
  });
  assert.equal(replace.status, 200);
  const replacedMeta = (await replace.json()).file;
  assert.equal(replacedMeta.name, 'final-score.pdf');
  assert.equal(replacedMeta.type, 'application/pdf');
  const replacedDownload = await fetch(`${base}/api/transcript/file`, { headers: aliceHeaders });
  assert.deepEqual(Buffer.from(await replacedDownload.arrayBuffer()), PDF);

  const stored = await readdir(path.join(data, 'transcripts'));
  assert.equal(stored.length, 4);
  assert.ok(stored.every((name) => /^[a-f0-9]{64}\.(?:bin|json)$/.test(name)));
  assert.ok(stored.every((name) => !name.includes('score') && !name.includes('report')));
  for (const name of stored) {
    const mode = (await stat(path.join(data, 'transcripts', name))).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  const perUserSlowUploads = await Promise.all(['first', 'second'].map((label) => openSlowUpload(
    port,
    '/api/transcript',
    { ...carolHeaders, 'Content-Type': 'image/png', 'X-File-Name': `${label}-slow.png` },
    PNG.subarray(0, 8),
  )));
  const perUserSlowStatuses = await Promise.all(perUserSlowUploads.map(({ response }) => response));
  assert.deepEqual(perUserSlowStatuses.sort(), [408, 503]);
  const perUserReleased = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: { ...carolHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'released.png' },
    body: PNG,
  });
  assert.equal(perUserReleased.status, 200);
  const perUserReleasedMeta = (await perUserReleased.json()).file;
  assert.equal(perUserReleasedMeta.name, 'released.png');
  assert.equal(perUserReleasedMeta.type, 'image/png');
  assert.equal(perUserReleasedMeta.size, PNG.length);
  assert.match(perUserReleasedMeta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const globalSlowUploads = await Promise.all([
    [aliceHeaders, 'alice-slow.png'],
    [bobHeaders, 'bob-slow.png'],
    [carolHeaders, 'carol-slow.png'],
    [daveHeaders, 'dave-slow.png'],
    [eveHeaders, 'eve-slow.png'],
  ].map(([headers, name]) => openSlowUpload(
    port,
    '/api/transcript',
    { ...headers, 'Content-Type': 'image/png', 'X-File-Name': name },
    PNG.subarray(0, 8),
  )));
  const globalSlowStatuses = await Promise.all(globalSlowUploads.map(({ response }) => response));
  assert.deepEqual(globalSlowStatuses.sort(), [408, 408, 408, 408, 503]);
  const releasedUpload = await fetch(`${base}/api/transcript`, {
    method: 'PUT',
    headers: { ...eveHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'global-released.png' },
    body: PNG,
  });
  assert.equal(releasedUpload.status, 200);
  assert.equal((await releasedUpload.json()).file.name, 'global-released.png');

  await expectJson(await fetch(`${base}/api/transcript`, {
    method: 'DELETE', headers: aliceHeaders,
  }), 200, { ok: true });
  await expectJson(await fetch(`${base}/api/transcript`, { headers: aliceHeaders }), 200, { file: null });
  await expectJson(await fetch(`${base}/api/transcript/file`, { headers: aliceHeaders }), 404, {
    error: 'not-found',
  });
  const bobDownload = await fetch(`${base}/api/transcript/file`, { headers: bobHeaders });
  assert.equal(bobDownload.status, 200);
  assert.deepEqual(Buffer.from(await bobDownload.arrayBuffer()), WEBP);
});

test('vision configuration keeps main credentials same-origin and rejects insecure transports', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-vision-config-test-'));
  const dist = path.join(root, 'dist');
  const data = path.join(root, 'data');
  await mkdir(dist);
  await mkdir(data);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>test</title>');
  for (const file of ['index.mjs', 'email-auth.mjs', 'auth-security.mjs', 'password-credentials.mjs']) {
    await copyFile(path.join(HERE, file), path.join(root, file));
  }
  const children = [];
  t.after(async () => {
    for (const child of children) await stopChild(child);
    await rm(root, { recursive: true, force: true });
  });

  const user = passwordUser('VisionConfig', 'vision-password', 'vision-config@example.com');
  const port = await openPort();
  const baseConfig = {
    port,
    distDir: './dist',
    dataDir: data,
    upstreamBaseUrl: 'https://main.example/v1',
    apiKey: 'main-secret-must-not-cross-origin',
    users: [user],
  };

  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    ...baseConfig,
    allowInsecureAuth: true,
    visionUpstreamUrl: 'https://other.example/v1',
  }));
  const disabledChild = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(disabledChild);
  await waitForReady(disabledChild);
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base, user, 'vision-password');
  await expectJson(await fetch(`${base}/api/vision`, {
    method: 'POST',
    headers: authHeaders(user, cookie, { 'Content-Type': 'image/png' }),
    body: PNG,
  }), 503, { error: 'vision-disabled' });
  await stopChild(disabledChild);

  async function expectRejectedTransport(config, expected) {
    await writeFile(path.join(root, 'config.json'), JSON.stringify(config));
    const child = spawn(process.execPath, ['index.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const code = await childExitCode(child);
    assert.equal(code, 2);
    assert.match(stderr, expected);
  }

  await expectRejectedTransport({
    ...baseConfig,
    allowInsecureAuth: false,
    visionUpstreamUrl: 'http://127.0.0.1:9/v1',
    visionApiKey: 'vision-key',
  }, /visionUpstreamUrl.*HTTPS/);
  await expectRejectedTransport({
    ...baseConfig,
    allowInsecureAuth: true,
    visionUpstreamUrl: 'http://vision.example/v1',
    visionApiKey: 'vision-key',
  }, /visionUpstreamUrl.*HTTPS/);

  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    ...baseConfig,
    allowInsecureAuth: true,
    visionUpstreamUrl: 'http://127.0.0.1:9/v1',
    visionApiKey: 'vision-key',
  }));
  const loopbackChild = spawn(process.execPath, ['index.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(loopbackChild);
  await waitForReady(loopbackChild);
  await stopChild(loopbackChild);
});
