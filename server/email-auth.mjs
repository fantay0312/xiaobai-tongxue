import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const PURPOSES = new Set(['login', 'register', 'bind', 'change-email', 'reset-password']);
const DEFAULT_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60_000,
  maxCodeAttempts: 5,
  sendCooldownMs: 60_000,
  emailSendsPerHour: 5,
  ipSendsPerHour: 10,
  globalSendsPerSecond: 4,
  globalSendsPerHour: 200,
  globalSendsPerDay: 500,
  verifyAttemptsPerWindow: 30,
  verifyWindowMs: 15 * 60_000,
  sendResponseMinDelayMs: 400,
  sendResponseJitterMs: 200,
  maxEntries: 5_000,
});

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || email.includes('..')) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at > 64 || at !== email.indexOf('@')) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.startsWith('.') || local.endsWith('.') || domain.length > 253) return null;
  const localOk = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local);
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  return localOk && new RegExp(`^${label}(?:\\.${label})+$`).test(domain) ? email : null;
}

function hmacCode(secret, email, purpose, subject, nonce, code) {
  return crypto.createHmac('sha256', secret)
    .update(`${purpose}\0${email}\0${subject}\0${nonce}\0${code}`)
    .digest();
}

function codeSubject(purpose, value) {
  if (purpose === 'register') return '';
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
  return value === value.trim() ? value : null;
}

function codeKey(purpose, email, subject) {
  return JSON.stringify([purpose, email, subject]);
}

function inspectWindow(spec, now) {
  const { map, key, limit, windowMs } = spec;
  let item = map.get(key);
  if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + windowMs };
  if (item.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((item.resetAt - now) / 1000)) };
  }
  return { ok: true, map, key, next: { count: item.count + 1, resetAt: item.resetAt } };
}

function windowsHaveCapacity(specs, maxEntries) {
  const additions = new Map();
  for (const { map, key } of specs) {
    if (map.has(key)) continue;
    const keys = additions.get(map) ?? new Set();
    keys.add(key);
    additions.set(map, keys);
  }
  for (const [map, keys] of additions) if (map.size + keys.size > maxEntries) return false;
  return true;
}

function takeWindows(specs, now, maxEntries) {
  if (!windowsHaveCapacity(specs, maxEntries)) return { ok: false, retryAfter: 60 };
  const inspected = specs.map((spec) => inspectWindow(spec, now));
  const blocked = inspected.find((item) => !item.ok);
  if (blocked) return blocked;
  for (const item of inspected) item.map.set(item.key, item.next);
  return { ok: true, retryAfter: 0 };
}

function pruneMap(map, predicate) {
  for (const [key, value] of map) if (predicate(value)) map.delete(key);
}

function emailCopy(purpose, code) {
  const action = purpose === 'register' ? '注册'
    : purpose === 'bind' ? '绑定邮箱'
      : purpose === 'change-email' ? '换绑邮箱'
        : purpose === 'reset-password' ? '重置密码' : '登录';
  const description = purpose === 'bind'
    ? '你正在为小白同学账号绑定邮箱。'
    : purpose === 'change-email'
      ? '你正在为小白同学账号更换验证邮箱。'
      : purpose === 'reset-password'
        ? '你正在重置小白同学账号密码。'
        : `你正在${action}小白同学。`;
  const subject = `【小白同学】${action}验证码`;
  const text = `${description}验证码：${code}。验证码 10 分钟内有效，请勿转告他人。`;
  const html = `<div style="font-family:system-ui,sans-serif;color:#24211d">`
    + `<p>${description}</p>`
    + `<p style="font-size:30px;letter-spacing:8px;font-weight:700">${code}</p>`
    + '<p>验证码 10 分钟内有效，请勿转告他人。</p></div>';
  return { subject, text, html };
}

export function createResendSender(options) {
  const {
    apiKey,
    from,
    endpoint = 'https://api.resend.com/emails',
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = options ?? {};
  if (!apiKey || !from || typeof fetchImpl !== 'function') {
    throw new Error('resend-not-configured');
  }

  return async ({ email, code, purpose, idempotencyKey }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'xiaobai-gateway/1.0',
        },
        body: JSON.stringify({ from, to: [email], ...emailCopy(purpose, code) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('resend-request-failed');
    } finally {
      clearTimeout(timer);
    }
  };
}

function cleanupState(state, at = state.now()) {
  pruneMap(state.codes, (item) => item.expiresAt <= at);
  pruneMap(state.cooldowns, (until) => until <= at);
  const windows = [state.emailWindows, state.ipWindows, state.globalWindows, state.verifyIpWindows];
  for (const map of windows) pruneMap(map, (item) => item.resetAt <= at);
}

function takeSendLimits(state, email, ip, at) {
  const { limits } = state;
  const specs = [
    { map: state.emailWindows, key: email, limit: limits.emailSendsPerHour, windowMs: 3600_000 },
    { map: state.ipWindows, key: ip, limit: limits.ipSendsPerHour, windowMs: 3600_000 },
    { map: state.globalWindows, key: 'second', limit: limits.globalSendsPerSecond, windowMs: 1_000 },
    { map: state.globalWindows, key: 'hour', limit: limits.globalSendsPerHour, windowMs: 3600_000 },
    { map: state.globalWindows, key: 'day', limit: limits.globalSendsPerDay, windowMs: 86_400_000 },
  ];
  return takeWindows(specs, at, limits.maxEntries);
}

function responseDelayTarget(state) {
  const minimum = Math.max(0, Math.trunc(Number(state.limits.sendResponseMinDelayMs) || 0));
  const jitter = Math.max(0, Math.trunc(Number(state.limits.sendResponseJitterMs) || 0));
  return minimum + (jitter > 0 ? state.jitterRandomInt(0, jitter + 1) : 0);
}

async function padSendResponse(state, startedAt, targetMs) {
  const measured = state.elapsedNow() - startedAt;
  const elapsed = Number.isFinite(measured) ? Math.max(0, measured) : 0;
  const remaining = targetMs - elapsed;
  if (remaining > 0) await state.sleep(remaining);
}

async function requestCode(state, input) {
  const email = normalizeEmail(input?.email);
  const purpose = input?.purpose;
  const subject = codeSubject(purpose, input?.subject);
  const ip = String(input?.ip || 'unknown');
  if (!email) return { ok: false, error: 'bad-email' };
  if (!PURPOSES.has(purpose)) return { ok: false, error: 'bad-purpose' };
  if (subject === null) return { ok: false, error: 'bad-subject' };
  const at = state.now();
  cleanupState(state, at);
  const until = state.cooldowns.get(email) ?? 0;
  if (state.pendingEmails.has(email) || until > at) {
    return { ok: false, error: 'send-too-frequent', retryAfter: Math.max(1, Math.ceil((until - at) / 1000)) };
  }
  const limited = takeSendLimits(state, email, ip, at);
  if (!limited.ok) return { ok: false, error: 'too-many-attempts', retryAfter: limited.retryAfter };
  const key = codeKey(purpose, email, subject);
  if (state.codes.size >= state.limits.maxEntries && !state.codes.has(key)) {
    return { ok: false, error: 'email-auth-busy', retryAfter: 60 };
  }

  state.cooldowns.set(email, at + state.limits.sendCooldownMs);
  state.pendingEmails.add(email);
  const responseStartedAt = state.elapsedNow();
  const targetDelayMs = responseDelayTarget(state);
  let result;
  try {
    if (input?.deliver === false) {
      result = { ok: true, retryAfter: Math.ceil(state.limits.sendCooldownMs / 1000) };
    } else {
      const code = String(state.randomInt(0, 1_000_000)).padStart(6, '0');
      const nonce = crypto.randomBytes(16).toString('hex');
      await state.sendCode({ email, code, purpose, idempotencyKey: `xiaobai-otp-${nonce}` });
      state.codes.set(key, {
        nonce, digest: hmacCode(state.secret, email, purpose, subject, nonce, code),
        expiresAt: state.now() + state.limits.codeTtlMs, attempts: 0,
      });
      result = { ok: true, retryAfter: Math.ceil(state.limits.sendCooldownMs / 1000) };
    }
  } catch {
    result = { ok: false, error: 'email-unavailable' };
  } finally {
    try {
      await padSendResponse(state, responseStartedAt, targetDelayMs);
    } finally {
      state.pendingEmails.delete(email);
    }
  }
  return result;
}

function consumeCode(state, input) {
  const email = normalizeEmail(input?.email);
  const { purpose, code } = input ?? {};
  const subject = codeSubject(purpose, input?.subject);
  const ip = String(input?.ip || 'unknown');
  if (!email || !PURPOSES.has(purpose) || subject === null
      || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  const at = state.now();
  cleanupState(state, at);
  const limited = takeWindows([{
    map: state.verifyIpWindows,
    key: ip,
    limit: state.limits.verifyAttemptsPerWindow,
    windowMs: state.limits.verifyWindowMs,
  }], at, state.limits.maxEntries);
  if (!limited.ok) return { ok: false, error: 'too-many-attempts', retryAfter: limited.retryAfter };
  const key = codeKey(purpose, email, subject);
  const record = state.codes.get(key);
  if (!record || record.expiresAt <= at) {
    state.codes.delete(key);
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  const candidate = hmacCode(state.secret, email, purpose, subject, record.nonce, code);
  if (!crypto.timingSafeEqual(record.digest, candidate)) {
    record.attempts += 1;
    if (record.attempts >= state.limits.maxCodeAttempts) state.codes.delete(key);
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  state.codes.delete(key);
  return { ok: true, email };
}

export function createEmailAuth(options) {
  const { sendCode, now = Date.now, randomInt = crypto.randomInt } = options ?? {};
  if (typeof sendCode !== 'function') throw new Error('send-code-required');
  const secret = options?.secret ? Buffer.from(options.secret) : crypto.randomBytes(32);
  if (secret.length < 32) throw new Error('auth-code-secret-too-short');
  const state = {
    sendCode, now, randomInt, secret,
    elapsedNow: options?.elapsedNow ?? (() => performance.now()),
    jitterRandomInt: options?.jitterRandomInt ?? crypto.randomInt,
    sleep: options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    limits: { ...DEFAULT_LIMITS, ...(options?.limits ?? {}) },
    codes: new Map(),
    cooldowns: new Map(),
    emailWindows: new Map(),
    ipWindows: new Map(),
    globalWindows: new Map(),
    verifyIpWindows: new Map(),
    pendingEmails: new Set(),
  };
  return {
    requestCode: (input) => requestCode(state, input),
    consumeCode: (input) => consumeCode(state, input),
    cleanup: (at) => cleanupState(state, at),
  };
}
