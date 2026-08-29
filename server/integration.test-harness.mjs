import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync } from 'node:fs';
import { copyFile, cp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_HELPERS = new Set(['integration.test-harness.mjs', 'check-runtime.mjs']);
const CAPTCHA_PRELOADER_FLAG = 'XIAOBAI_CAPTCHA_TEST_PRELOADER';
const CAPTCHA_ROUTES = new Map([
  ['/api/login', 'login'],
  ['/api/login/email', 'login'],
  ['/api/login/phone', 'login'],
  ['/api/auth/email-code', 'email'],
  ['/api/auth/password-code', 'email'],
  ['/api/account/email-code', 'email'],
  ['/api/auth/sms-code', 'sms'],
  ['/api/account/phone-code', 'sms'],
]);
let captchaProofSequence = 0;

export const CAPTCHA_TEST_ENV = Object.freeze({
  TENCENT_CAPTCHA_EMAIL_APP_ID: '197000001',
  TENCENT_CAPTCHA_EMAIL_SECRET: 'test-email-captcha-secret',
  TENCENT_CAPTCHA_LOGIN_APP_ID: '190000001',
  TENCENT_CAPTCHA_LOGIN_SECRET: 'test-login-captcha-secret',
  TENCENTCLOUD_SECRET_ID: 'AKID-test-only-captcha',
  TENCENTCLOUD_SECRET_KEY: 'test-only-captcha-secret-key',
});
export const SMS_TEST_ENV = Object.freeze({
  SMS_SDK_APP_ID: '1401167280',
  SMS_SIGN_NAME: '小白验证码',
  SMS_TEMPLATE_ID: '1234567',
  SMS_SECRET_ID: 'AKID-test-only-sms',
  SMS_SECRET_KEY: 'test-only-sms-secret-key',
});

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? String(input);
}

async function requestBody(input, init) {
  if (init?.body !== undefined) return String(init.body);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.clone().text();
  }
  return '';
}

function requestHeaders(input, init) {
  const headers = new Headers(
    typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return Object.fromEntries(headers);
}

function captchaResponse(captchaCode, evilLevel) {
  return new Response(JSON.stringify({
    Response: {
      CaptchaCode: captchaCode,
      CaptchaMsg: captchaCode === 1 ? 'OK' : 'invalid ticket',
      EvilLevel: evilLevel,
      RequestId: randomUUID(),
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function smsResponse(phone) {
  return new Response(JSON.stringify({
    Response: {
      SendStatusSet: [{
        SerialNo: randomUUID(),
        PhoneNumber: phone,
        Fee: 1,
        SessionContext: '',
        Code: 'Ok',
        Message: 'send success',
        IsoCode: 'CN',
      }],
      RequestId: randomUUID(),
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function abortedCaptchaRequest(signal) {
  return new Promise((resolve, reject) => {
    const rejectAbort = () => reject(
      signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'),
    );
    if (signal?.aborted) {
      rejectAbort();
      return;
    }
    signal?.addEventListener('abort', rejectAbort, { once: true });
  });
}

function installFakeTencentServices() {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    const hostname = new URL(url).hostname;
    if (hostname !== 'sms.tencentcloudapi.com'
      && hostname !== 'captcha.tencentcloudapi.com') {
      return nativeFetch(input, init);
    }
    const rawBody = await requestBody(input, init);
    const body = JSON.parse(rawBody);
    const headers = requestHeaders(input, init);
    if (hostname === 'sms.tencentcloudapi.com') {
      const log = process.env.SMS_TEST_LOG;
      if (log) appendFileSync(log, `${JSON.stringify({ url, headers, body })}\n`);
      return smsResponse(body.PhoneNumberSet?.[0]);
    }
    const log = process.env.CAPTCHA_TEST_LOG;
    if (log) appendFileSync(log, `${JSON.stringify({ url, headers, body })}\n`);

    if (body.Ticket === 'test-timeout-ticket') {
      const signal = init?.signal
        ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
      return abortedCaptchaRequest(signal);
    }
    if (body.Ticket === 'test-invalid-ticket') return captchaResponse(7, 0);
    if (body.Ticket === 'test-risk-ticket') return captchaResponse(1, 100);
    return captchaResponse(1, 0);
  };
}

if (process.env[CAPTCHA_PRELOADER_FLAG] === '1') {
  installFakeTencentServices();
} else {
  for (const [key, value] of Object.entries(CAPTCHA_TEST_ENV)) process.env[key] ??= value;
  for (const [key, value] of Object.entries(SMS_TEST_ENV)) process.env[key] ??= value;
  process.env[CAPTCHA_PRELOADER_FLAG] = '1';
  const harnessUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const importOption = `--import=${harnessUrl}`;
  if (!String(process.env.NODE_OPTIONS ?? '').includes(importOption)) {
    process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, importOption].filter(Boolean).join(' ');
  }
}

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
  await Promise.all(['admin', 'commerce', 'custom-content'].map((directory) => cp(
    path.join(SERVER_DIR, directory),
    path.join(root, directory),
    { recursive: true },
  )));
  await symlink(path.join(SERVER_DIR, 'node_modules'), path.join(root, 'node_modules'), 'dir');
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
  const pathname = new URL(url).pathname;
  const scene = CAPTCHA_ROUTES.get(pathname);
  const shouldAttachCaptcha = scene
    && body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && !Object.hasOwn(body, 'captcha');
  const requestPayload = shouldAttachCaptcha
    ? { ...body, captcha: await createCaptchaProof(url, scene, {}, headers) }
    : body;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(requestPayload),
  });
  return { response, payload: await response.json() };
}

export async function createCaptchaProof(base, scene, overrides = {}, headers = {}) {
  captchaProofSequence += 1;
  const sequence = captchaProofSequence;
  const challengeUrl = new URL('/api/captcha/challenge', base);
  const response = await fetch(challengeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      'X-Real-IP': `198.18.${Math.floor(sequence / 254) % 254}.${(sequence % 254) + 1}`,
    },
    body: JSON.stringify({ scene }),
  });
  const challenge = await response.json();
  assert.equal(
    response.status,
    200,
    `captcha challenge failed: ${response.status} ${JSON.stringify(challenge)}`,
  );
  const unique = `${process.pid}-${sequence}-${randomUUID()}`;
  return {
    ticket: `test-ticket-${unique}`,
    randstr: `test-randstr-${unique}`,
    aidEncrypted: challenge.aidEncrypted,
    ...overrides,
  };
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

export async function captchaRequests(file) {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

export async function smsRequests(file) {
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

export async function smsCodeFor(file, phone) {
  const request = (await smsRequests(file))
    .findLast((item) => item.body?.PhoneNumberSet?.[0] === phone);
  assert.ok(request, `missing SMS request for ${phone}`);
  const code = request.body?.TemplateParamSet?.[0];
  assert.match(code ?? '', /^\d{6}$/);
  return { code, request };
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
      ...CAPTCHA_TEST_ENV,
      ...SMS_TEST_ENV,
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
