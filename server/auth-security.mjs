import crypto from 'node:crypto';
import net from 'node:net';
import { promisify } from 'node:util';
import { normalizeEmail } from './email-auth.mjs';
import {
  PASSWORD_SCHEME_CURRENT,
  PASSWORD_SCHEME_LEGACY,
  canonicalName,
  passwordSchemeOf,
  requireCredentials,
  requireStoredName,
} from './credential-format.mjs';

export { canonicalName };

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_PARAMETERS = Object.freeze({
  [PASSWORD_SCHEME_LEGACY]: Object.freeze({ N: 2 ** 14, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }),
  // 提高 N 并用 p=3 增加 CPU 成本，同时把单次内存控制在约 32MiB，避免 8 路鉴权并发耗尽主机。
  [PASSWORD_SCHEME_CURRENT]: Object.freeze({ N: 2 ** 15, r: 8, p: 3, maxmem: 40 * 1024 * 1024 }),
});

export function encodedIdentityMatches(value, currentName) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (!/^[\x21-\x7e]+$/.test(value)) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  const expected = canonicalName(decoded);
  const actual = canonicalName(currentName);
  return expected !== null && actual !== null && expected === actual;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateUser(user, source, index) {
  const label = `${source}[${index}]`;
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error(`${label}: bad-user`);
  requireStoredName(user, label);
  requireCredentials(user, label);
  if (user.email === undefined) {
    if (user.emailVerifiedAt !== undefined) throw new Error(`${label}: verification-without-email`);
    return user;
  }
  const email = normalizeEmail(user.email);
  if (!email) throw new Error(`${label}: bad-email`);
  if (!validTimestamp(user.emailVerifiedAt)) throw new Error(`${label}: bad-email-verification`);
  return { ...user, email };
}

function validateList(value, source) {
  if (!Array.isArray(value)) throw new Error(`${source}: expected-array`);
  return value.map((user, index) => validateUser(user, source, index));
}

function validateBindings(value, users) {
  if (!Array.isArray(value)) throw new Error('email-bindings.json: expected-array');
  const configured = new Map(users.map((user) => [canonicalName(user.name), user]));
  const seen = new Set();
  return value.map((binding, index) => {
    const label = `email-bindings.json[${index}]`;
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      throw new Error(`${label}: bad-binding`);
    }
    const keys = Object.keys(binding).sort();
    if (keys.join(',') !== 'email,emailVerifiedAt,name') throw new Error(`${label}: bad-shape`);
    const normalizedName = typeof binding.name === 'string' ? binding.name.trim().normalize('NFC') : '';
    const name = canonicalName(binding.name);
    if (!name || binding.name !== normalizedName) throw new Error(`${label}: bad-name`);
    if (seen.has(name)) throw new Error(`${label}: duplicate-name`);
    seen.add(name);
    const target = configured.get(name);
    if (!target) throw new Error(`${label}: unknown-config-user`);
    if (binding.name !== target.name) throw new Error(`${label}: noncanonical-name`);
    const email = normalizeEmail(binding.email);
    if (!email || email !== binding.email) throw new Error(`${label}: bad-email`);
    if (!validTimestamp(binding.emailVerifiedAt)) throw new Error(`${label}: bad-email-verification`);
    return { name: target.name, email, emailVerifiedAt: binding.emailVerifiedAt };
  });
}

function ensureUniqueUsers(users, registrations) {
  const names = new Map();
  const emails = new Map();
  for (const [source, list] of [['config.users', users], ['registered-users.json', registrations]]) {
    for (const [index, user] of list.entries()) {
      const location = `${source}[${index}]`;
      const name = canonicalName(user.name);
      if (names.has(name)) throw new Error(`${location}: duplicate-name-with-${names.get(name)}`);
      names.set(name, location);
      if (!user.email) continue;
      const email = normalizeEmail(user.email);
      if (emails.has(email)) throw new Error(`${location}: duplicate-email-with-${emails.get(email)}`);
      emails.set(email, location);
    }
  }
}

export function validateUserSets(configured, registered, emailBindings = []) {
  const configuredUsers = validateList(configured, 'config.users');
  const registrations = validateList(registered, 'registered-users.json');
  const bindings = validateBindings(emailBindings, configuredUsers);
  const byName = new Map(bindings.map((binding) => [canonicalName(binding.name), binding]));
  const users = configuredUsers.map((user) => {
    const binding = byName.get(canonicalName(user.name));
    return binding ? { ...user, email: binding.email, emailVerifiedAt: binding.emailVerifiedAt } : user;
  });
  ensureUniqueUsers(users, registrations);
  return { users, registrations, bindings };
}

function updateVerifiedEmail(configured, registered, emailBindings, nameValue, emailValue, verifiedAt, mode) {
  const current = validateUserSets(configured, registered, emailBindings);
  const name = canonicalName(nameValue);
  const email = normalizeEmail(emailValue);
  if (!name) throw new Error('bad-name');
  if (!email) throw new Error('bad-email');
  if (!validTimestamp(verifiedAt)) throw new Error('bad-email-verification');
  const configIndex = current.users.findIndex((user) => canonicalName(user.name) === name);
  const registeredIndex = current.registrations.findIndex((user) => canonicalName(user.name) === name);
  const target = configIndex >= 0 ? current.users[configIndex] : current.registrations[registeredIndex];
  if (!target) throw new Error('user-not-found');
  if (mode === 'bind' && target.email) throw new Error('email-already-bound');
  if (mode === 'change' && !target.email) throw new Error('email-not-bound');
  if (mode === 'change' && normalizeEmail(target.email) === email) throw new Error('email-unchanged');
  const owner = [...current.users, ...current.registrations]
    .find((user) => normalizeEmail(user.email) === email);
  if (owner) throw new Error('email-taken');

  if (configIndex >= 0) {
    const replacement = { name: target.name, email, emailVerifiedAt: verifiedAt };
    const bindingIndex = current.bindings.findIndex((item) => canonicalName(item.name) === name);
    const bindings = bindingIndex < 0
      ? [...current.bindings, replacement]
      : current.bindings.map((item, index) => index === bindingIndex ? replacement : item);
    return { ...validateUserSets(configured, current.registrations, bindings), source: 'bindings' };
  }
  const registrations = current.registrations.map((user, index) => index === registeredIndex
    ? { ...user, email, emailVerifiedAt: verifiedAt }
    : user);
  return { ...validateUserSets(configured, registrations, current.bindings), source: 'registrations' };
}

export function bindVerifiedEmail(configured, registered, emailBindings, nameValue, emailValue, verifiedAt) {
  return updateVerifiedEmail(
    configured, registered, emailBindings, nameValue, emailValue, verifiedAt, 'bind',
  );
}

export function changeVerifiedEmail(configured, registered, emailBindings, nameValue, emailValue, verifiedAt) {
  return updateVerifiedEmail(
    configured, registered, emailBindings, nameValue, emailValue, verifiedAt, 'change',
  );
}

export function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return null;
  const at = email.lastIndexOf('@');
  return `${email[0]}***${email.slice(at)}`;
}

export function userHasVerifiedEmail(user) {
  return Boolean(normalizeEmail(user?.email) && validTimestamp(user?.emailVerifiedAt));
}

export function protectedAccessError(user) {
  return userHasVerifiedEmail(user) ? null : 'email-verification-required';
}

export function revokeUserSessions(sessions, nameValue) {
  const name = canonicalName(nameValue);
  if (!(sessions instanceof Map) || !name) return 0;
  let revoked = 0;
  for (const [token, session] of sessions) {
    if (canonicalName(session?.name) !== name) continue;
    sessions.delete(token);
    revoked += 1;
  }
  return revoked;
}

async function defaultDerive(password, salt, length, parameters) {
  return Buffer.from(await scryptAsync(password, salt, length, parameters));
}

export function createPasswordService(options = {}) {
  const derive = options.derive ?? defaultDerive;
  const dummy = {
    salt: options.dummySalt ?? crypto.randomBytes(16).toString('hex'),
    hash: (options.dummyHash ?? crypto.randomBytes(64)).toString('hex'),
    passwordScheme: PASSWORD_SCHEME_CURRENT,
  };

  async function verify(user, password) {
    const target = user ?? dummy;
    try {
      const scheme = passwordSchemeOf(target);
      if (!scheme) return false;
      const expected = Buffer.from(target.hash, 'hex');
      // 每次都顺序执行 legacy + current，两类账号和未知账号的 KDF 工作量保持同形；
      // 渐进迁移期间不能用耗时差反向枚举“账号是否存在/是否已升级”。
      const legacyActual = await derive(
        password, target.salt, expected.length, SCRYPT_PARAMETERS[PASSWORD_SCHEME_LEGACY],
      );
      const currentActual = await derive(
        password, target.salt, expected.length, SCRYPT_PARAMETERS[PASSWORD_SCHEME_CURRENT],
      );
      const actual = scheme === PASSWORD_SCHEME_CURRENT ? currentActual : legacyActual;
      const equal = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
      return Boolean(user) && equal;
    } catch {
      return false;
    }
  }

  async function hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await derive(password, salt, 64, SCRYPT_PARAMETERS[PASSWORD_SCHEME_CURRENT]);
    return {
      salt,
      hash: Buffer.from(derived).toString('hex'),
      passwordScheme: PASSWORD_SCHEME_CURRENT,
    };
  }

  const needsRehash = (user) => Boolean(user)
    && passwordSchemeOf(user) !== PASSWORD_SCHEME_CURRENT;

  return { verify, hash, needsRehash };
}

export function createAuthGate(options = {}) {
  const now = options.now ?? Date.now;
  const maxConcurrent = options.maxConcurrent ?? 8;
  const maxPerMinute = options.maxPerMinute ?? 120;
  let inflight = 0;
  let count = 0;
  let resetAt = now() + 60_000;

  function acquireConcurrency() {
    if (inflight >= maxConcurrent) return { ok: false, error: 'auth-busy', retryAfter: 1 };
    inflight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        inflight -= 1;
      },
    };
  }

  function admitGlobal() {
    const at = now();
    if (resetAt <= at) { count = 0; resetAt = at + 60_000; }
    if (count >= maxPerMinute) {
      return { ok: false, error: 'too-many-attempts', retryAfter: Math.max(1, Math.ceil((resetAt - at) / 1000)) };
    }
    count += 1;
    return { ok: true };
  }

  // Compatibility path for callers that still need one atomic-looking operation.
  // New integrations should run their per-IP admission before admitGlobal().
  function enter() {
    const permit = acquireConcurrency();
    if (!permit.ok) return permit;
    const admission = admitGlobal();
    if (admission.ok) return permit;
    permit.release();
    return admission;
  }

  return { acquireConcurrency, admitGlobal, enter };
}

export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requestUsesTrustedHttps(req) {
  if (req?.socket?.encrypted) return true;
  if (!isLoopbackAddress(req?.socket?.remoteAddress)) return false;
  const proto = req?.headers?.['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',', 1)[0].trim().toLowerCase() === 'https';
}

export function authTransportAllowed(req, allowInsecure = false) {
  return allowInsecure || requestUsesTrustedHttps(req);
}

function ipv4TailToHex(address) {
  const marker = address.lastIndexOf(':');
  const tail = address.slice(marker + 1);
  if (net.isIP(tail) !== 4) return address;
  const octets = tail.split('.').map(Number);
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  return `${address.slice(0, marker)}:${high}:${low}`;
}

function expandIpv6(address) {
  const converted = ipv4TailToHex(address);
  const halves = converted.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const segments = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (segments.length !== 8 || segments.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return segments.map((part) => Number.parseInt(part, 16));
}

export function ipRateKey(value) {
  if (typeof value !== 'string') return 'unknown';
  let address = value.trim().replace(/^\[|\]$/g, '').split('%', 1)[0].toLowerCase();
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && net.isIP(mapped[1]) === 4) address = mapped[1];
  const family = net.isIP(address);
  if (family === 4) return address;
  if (family !== 6) return 'unknown';
  const segments = expandIpv6(address);
  if (!segments) return 'unknown';
  return `${segments.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
}
