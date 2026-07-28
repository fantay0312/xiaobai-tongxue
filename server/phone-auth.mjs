import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { normalizeMainlandPhone } from './tencent-sms.mjs';

const PURPOSES = new Set(['login', 'bind', 'change-phone', 'reset-password']);
const DEFAULT_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60_000,
  maxCodeAttempts: 5,
  sendCooldownMs: 60_000,
  phoneSendsPerHour: 5,
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

function codeSubject(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
  return value === value.trim() ? value : null;
}

function codeKey(purpose, phone, subject) {
  return JSON.stringify([purpose, phone, subject]);
}

function persistentChallengeId(purpose, phone, subject) {
  return crypto.createHash('sha256')
    .update(`${purpose}\0${phone}\0${subject}`, 'utf8')
    .digest('hex');
}

function persistentSubject(phone, subject) {
  return `${phone}\0${subject}`;
}

function hmacCode(secret, phone, purpose, subject, nonce, code) {
  return crypto.createHmac('sha256', secret)
    .update(`${purpose}\0${phone}\0${subject}\0${nonce}\0${code}`)
    .digest();
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

function takeWindows(specs, now, maxEntries) {
  const additions = new Map();
  for (const { map, key } of specs) {
    if (map.has(key)) continue;
    const keys = additions.get(map) ?? new Set();
    keys.add(key);
    additions.set(map, keys);
  }
  for (const [map, keys] of additions) {
    if (map.size + keys.size > maxEntries) return { ok: false, retryAfter: 60 };
  }
  const inspected = specs.map((spec) => inspectWindow(spec, now));
  const blocked = inspected.find((item) => !item.ok);
  if (blocked) return blocked;
  for (const item of inspected) item.map.set(item.key, item.next);
  return { ok: true, retryAfter: 0 };
}

function cleanupMap(map, predicate) {
  for (const [key, value] of map) if (predicate(value)) map.delete(key);
}

function cleanupState(state, at = state.now()) {
  cleanupMap(state.codes, (item) => item.expiresAt <= at);
  cleanupMap(state.cooldowns, (until) => until <= at);
  for (const map of [state.phoneWindows, state.ipWindows, state.globalWindows, state.verifyWindows]) {
    cleanupMap(map, (item) => item.resetAt <= at);
  }
}

function takeSendLimits(state, phone, ip, at) {
  const { limits } = state;
  return takeWindows([
    { map: state.phoneWindows, key: phone, limit: limits.phoneSendsPerHour, windowMs: 3600_000 },
    { map: state.ipWindows, key: ip, limit: limits.ipSendsPerHour, windowMs: 3600_000 },
    { map: state.globalWindows, key: 'second', limit: limits.globalSendsPerSecond, windowMs: 1_000 },
    { map: state.globalWindows, key: 'hour', limit: limits.globalSendsPerHour, windowMs: 3600_000 },
    { map: state.globalWindows, key: 'day', limit: limits.globalSendsPerDay, windowMs: 86_400_000 },
  ], at, limits.maxEntries);
}

function responseDelay(state) {
  const minimum = Math.max(0, Math.trunc(Number(state.limits.sendResponseMinDelayMs) || 0));
  const jitter = Math.max(0, Math.trunc(Number(state.limits.sendResponseJitterMs) || 0));
  return minimum + (jitter ? state.jitterRandomInt(0, jitter + 1) : 0);
}

async function padResponse(state, startedAt, targetMs) {
  const elapsed = Math.max(0, state.elapsedNow() - startedAt);
  if (targetMs > elapsed) await state.sleep(targetMs - elapsed);
}

async function deliverCode(state, input) {
  const code = String(state.randomInt(0, 1_000_000)).padStart(6, '0');
  const nonce = crypto.randomBytes(16).toString('hex');
  await state.sendCode({
    phone: input.phone,
    code,
    purpose: input.purpose,
    expiresInMinutes: Math.ceil(state.limits.codeTtlMs / 60_000),
    idempotencyKey: `xiaobai-sms-otp-${nonce}`,
  });
  if (state.otpStore) {
    await state.otpStore.issue({
      challengeId: persistentChallengeId(input.purpose, input.phone, input.subject),
      subject: persistentSubject(input.phone, input.subject),
      code,
      purpose: input.purpose,
      ttlSeconds: Math.ceil(state.limits.codeTtlMs / 1_000),
      maxAttempts: state.limits.maxCodeAttempts,
    });
    return;
  }
  state.codes.set(input.key, {
    nonce,
    digest: hmacCode(
      state.secret, input.phone, input.purpose, input.subject, nonce, code,
    ),
    expiresAt: state.now() + state.limits.codeTtlMs,
    attempts: 0,
  });
}

function reportSendFailure(state, error) {
  try { state.onSendError(error); } catch { /* diagnostics must not affect auth */ }
}

async function opaqueDelivery(state, input, startedAt, targetMs, success) {
  if (input.deliver === false) {
    await padResponse(state, startedAt, targetMs);
    state.pendingPhones.delete(input.phone);
    return success;
  }
  void deliverCode(state, input)
    .catch((error) => reportSendFailure(state, error))
    .finally(() => state.pendingPhones.delete(input.phone));
  await padResponse(state, startedAt, targetMs);
  return success;
}

async function takePersistentSendLimits(state, phone, ip) {
  if (!state.otpStore) return { ok: true };
  const limits = [
    ['sms-send-phone', phone, state.limits.phoneSendsPerHour, 3_600],
    ['sms-send-ip', ip, state.limits.ipSendsPerHour, 3_600],
    ['sms-send-global-second', 'global', state.limits.globalSendsPerSecond, 1],
    ['sms-send-global-hour', 'global', state.limits.globalSendsPerHour, 3_600],
    ['sms-send-global-day', 'global', state.limits.globalSendsPerDay, 86_400],
  ];
  for (const [scope, subject, limit, windowSeconds] of limits) {
    const result = await state.otpStore.rateLimit({ scope, subject, limit, windowSeconds });
    if (!result.allowed) {
      return {
        ok: false,
        retryAfter: Math.max(1, result.retryAfterSeconds),
      };
    }
  }
  return { ok: true };
}

async function requestCode(state, input) {
  const phone = normalizeMainlandPhone(input?.phone);
  const purpose = input?.purpose;
  const subject = codeSubject(input?.subject);
  const ip = String(input?.ip || 'unknown');
  if (!phone) return { ok: false, error: 'bad-phone' };
  if (!PURPOSES.has(purpose)) return { ok: false, error: 'bad-purpose' };
  if (subject === null) return { ok: false, error: 'bad-subject' };
  const at = state.now();
  cleanupState(state, at);
  const until = state.cooldowns.get(phone) ?? 0;
  if (state.pendingPhones.has(phone) || until > at) {
    return {
      ok: false,
      error: 'send-too-frequent',
      retryAfter: Math.max(1, Math.ceil((until - at) / 1000)),
    };
  }
  const persistentLimited = await takePersistentSendLimits(state, phone, ip);
  if (!persistentLimited.ok) {
    return {
      ok: false,
      error: 'too-many-attempts',
      retryAfter: persistentLimited.retryAfter,
    };
  }
  const limited = takeSendLimits(state, phone, ip, at);
  if (!limited.ok) return { ok: false, error: 'too-many-attempts', retryAfter: limited.retryAfter };
  const key = codeKey(purpose, phone, subject);
  if (!state.otpStore && state.codes.size >= state.limits.maxEntries && !state.codes.has(key)) {
    return { ok: false, error: 'sms-auth-busy', retryAfter: 60 };
  }
  state.cooldowns.set(phone, at + state.limits.sendCooldownMs);
  state.pendingPhones.add(phone);
  const success = { ok: true, retryAfter: Math.ceil(state.limits.sendCooldownMs / 1000) };
  const startedAt = state.elapsedNow();
  const targetMs = responseDelay(state);
  const delivery = { ...input, phone, purpose, subject, key };
  if (input?.opaqueDelivery) {
    return opaqueDelivery(state, delivery, startedAt, targetMs, success);
  }
  try {
    if (input?.deliver !== false) await deliverCode(state, delivery);
    return success;
  } catch (error) {
    reportSendFailure(state, error);
    return { ok: false, error: 'sms-unavailable' };
  } finally {
    await padResponse(state, startedAt, targetMs);
    state.pendingPhones.delete(phone);
  }
}

async function consumePersistentCode(state, { phone, purpose, code, subject, ip }) {
  const limited = await state.otpStore.rateLimit({
    scope: 'sms-verify-ip',
    subject: ip,
    limit: state.limits.verifyAttemptsPerWindow,
    windowSeconds: Math.ceil(state.limits.verifyWindowMs / 1_000),
  });
  if (!limited.allowed) {
    return {
      ok: false,
      error: 'too-many-attempts',
      retryAfter: Math.max(1, limited.retryAfterSeconds),
    };
  }
  const result = await state.otpStore.consume({
    challengeId: persistentChallengeId(purpose, phone, subject),
    subject: persistentSubject(phone, subject),
    code,
    purpose,
  });
  return result.consumed
    ? { ok: true, phone }
    : { ok: false, error: 'invalid-or-expired-code' };
}

function consumeCode(state, input) {
  const phone = normalizeMainlandPhone(input?.phone);
  const { purpose, code } = input ?? {};
  const subject = codeSubject(input?.subject);
  const ip = String(input?.ip || 'unknown');
  if (!phone || !PURPOSES.has(purpose) || subject === null || !/^\d{6}$/.test(code ?? '')) {
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  if (state.otpStore) {
    return consumePersistentCode(state, { phone, purpose, code, subject, ip });
  }
  const at = state.now();
  cleanupState(state, at);
  const limited = takeWindows([{
    map: state.verifyWindows,
    key: ip,
    limit: state.limits.verifyAttemptsPerWindow,
    windowMs: state.limits.verifyWindowMs,
  }], at, state.limits.maxEntries);
  if (!limited.ok) {
    return { ok: false, error: 'too-many-attempts', retryAfter: limited.retryAfter };
  }
  const key = codeKey(purpose, phone, subject);
  const record = state.codes.get(key);
  if (!record || record.expiresAt <= at) {
    state.codes.delete(key);
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  const candidate = hmacCode(state.secret, phone, purpose, subject, record.nonce, code);
  if (!crypto.timingSafeEqual(record.digest, candidate)) {
    record.attempts += 1;
    if (record.attempts >= state.limits.maxCodeAttempts) state.codes.delete(key);
    return { ok: false, error: 'invalid-or-expired-code' };
  }
  state.codes.delete(key);
  return { ok: true, phone };
}

export function createPhoneAuth(options) {
  if (typeof options?.sendCode !== 'function') throw new Error('send-code-required');
  const secret = options.secret ? Buffer.from(options.secret) : crypto.randomBytes(32);
  if (secret.length < 32) throw new Error('auth-code-secret-too-short');
  const state = {
    sendCode: options.sendCode,
    secret,
    now: options.now ?? Date.now,
    randomInt: options.randomInt ?? crypto.randomInt,
    elapsedNow: options.elapsedNow ?? (() => performance.now()),
    jitterRandomInt: options.jitterRandomInt ?? crypto.randomInt,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    onSendError: typeof options.onSendError === 'function' ? options.onSendError : () => {},
    otpStore: options.otpStore ?? null,
    limits: { ...DEFAULT_LIMITS, ...(options.limits ?? {}) },
    codes: new Map(),
    cooldowns: new Map(),
    phoneWindows: new Map(),
    ipWindows: new Map(),
    globalWindows: new Map(),
    verifyWindows: new Map(),
    pendingPhones: new Set(),
  };
  return {
    requestCode: (input) => requestCode(state, input),
    consumeCode: (input) => consumeCode(state, input),
    cleanup: (at) => cleanupState(state, at),
  };
}
