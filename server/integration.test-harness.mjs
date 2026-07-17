import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_HELPERS = new Set(['integration.test-harness.mjs', 'check-runtime.mjs']);

export async function copyRuntimeModules(root) {
  const files = await readdir(SERVER_DIR);
  const runtimeModules = files.filter((file) => (
    file.endsWith('.mjs')
    && !file.endsWith('.test.mjs')
    && !TEST_HELPERS.has(file)
  ));
  await Promise.all(runtimeModules.map((file) => (
    copyFile(path.join(SERVER_DIR, file), path.join(root, file))
  )));
}

export async function openPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export async function waitForReady(child, timeoutMs = 5_000) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    const onData = (chunk) => {
      if (!chunk.toString().includes('网关已启动')) return;
      cleanup();
      resolve();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`gateway-exited-${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('gateway-start-timeout'));
    }, timeoutMs);
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

export async function childExitCode(child) {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = await once(child, 'exit');
  return code;
}

export async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

export function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
}

export function accountHeaders(cookie, name) {
  return { Cookie: cookie, 'X-Xiaobai-User': encodeURIComponent(name) };
}

export function authHeaders(user, cookie, extra = {}) {
  const name = typeof user === 'string' ? user : user.name;
  return { ...accountHeaders(cookie, name), ...extra };
}

export async function login(base, identifier, password, expectedName = identifier, options = {}) {
  const body = options.legacyUsername
    ? { username: identifier, password }
    : { identifier, password };
  const result = await postJson(`${base}/api/login`, body, options.headers);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.user.name, expectedName);
  const cookie = sessionCookie(result.response);
  assert.ok(cookie);
  return { ...result, cookie };
}

export async function me(base, cookie) {
  const response = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

export async function resendMessages(file) {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

export async function codeFor(file, email) {
  const message = (await resendMessages(file)).findLast((item) => item.to?.[0] === email);
  assert.ok(message, `missing Resend message for ${email}`);
  const match = message.text.match(/\b(\d{6})\b/);
  assert.ok(match);
  return { code: match[1], message };
}

export async function installFakeResend(root) {
  await writeFile(path.join(root, 'fake-resend.cjs'), `
const { appendFileSync } = require('node:fs');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url === 'https://api.resend.com/emails') {
    const body = String(init?.body ?? '');
    appendFileSync(process.env.RESEND_TEST_LOG, body + '\\n');
    const failures = String(process.env.RESEND_FAIL_EMAILS ?? '').split(',').filter(Boolean);
    const status = failures.some((email) => body.includes(email)) ? 503 : 200;
    return new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });
  }
  return nativeFetch(input, init);
};
`);
}

export async function launchGateway(root, resendLog, extraEnv = {}) {
  const child = spawn(process.execPath, ['--require', './fake-resend.cjs', 'index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      RESEND_API_KEY: 'test-only-key',
      RESEND_FROM: '小白同学 <noreply@example.com>',
      RESEND_TEST_LOG: resendLog,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForReady(child);
    return child;
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}
