import crypto from 'node:crypto';
import { hmacHex, randomToken } from './config.mjs';

const SESSION_PATTERN = /^v1\.([om])\.([0-9a-z]+)\.([A-Za-z0-9_-]{32,80})\.([0-9a-f]{64})$/;
const PUBLIC_AUTH_PATHS = new Map([
  ['/api/admin/v1/auth/login', 'login'],
  ['/api/admin/v1/auth/activate', 'activate'],
]);

export const ADMIN_INGRESS_LIMITS = Object.freeze({
  anonymous: Object.freeze({
    local: 32, ip: 60, token: 20, global: 300,
  }),
  member: Object.freeze({
    local: 64, ip: 240, token: 120, global: 2_000,
    session: 120, actor: 180,
  }),
  owner: Object.freeze({
    local: 32, ip: 600, token: 600, global: 2_000,
    session: 600, actor: 900,
  }),
});

function signaturesMatch(actual, expected) {
  return actual.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function createAdminSessionToken(
  tokenKey,
  { isOwner, expiresAt, random = randomToken() },
) {
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) {
    throw new Error('invalid-admin-session-expiry');
  }
  const payload = `v1.${isOwner === true ? 'o' : 'm'}.${expiry.toString(36)}.${random}`;
  return `${payload}.${hmacHex(tokenKey, 'admin-session-envelope', payload)}`;
}

export function readAdminSessionToken(tokenKey, value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match = value.match(SESSION_PATTERN);
  if (!match) return null;
  const payload = value.slice(0, value.lastIndexOf('.'));
  const expected = hmacHex(tokenKey, 'admin-session-envelope', payload);
  if (!signaturesMatch(match[4], expected)) return null;
  const expiresAt = Number.parseInt(match[2], 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  return {
    className: match[1] === 'o' ? 'owner' : 'member',
    isOwner: match[1] === 'o',
    expiresAt,
  };
}

function createLocalGate(limit) {
  let active = 0;
  return function acquire() {
    if (active >= limit) return null;
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
    };
  };
}

function busyError() {
  const error = new Error('auth-busy');
  error.retryAfter = 1;
  return error;
}

function routeClass(pathname) {
  return PUBLIC_AUTH_PATHS.get(pathname) ?? 'admin';
}

export function createAdminIngress({
  rateLimit,
  clientIp,
  tokenKey,
  limits = ADMIN_INGRESS_LIMITS,
} = {}) {
  if (typeof rateLimit !== 'function' || typeof clientIp !== 'function'
      || !Buffer.isBuffer(tokenKey) || tokenKey.length !== 32) {
    throw new Error('admin-ingress-dependencies-required');
  }
  const gates = Object.fromEntries(
    Object.entries(limits).map(([name, value]) => [name, createLocalGate(value.local)]),
  );

  async function requireRate(scope, subject, limit, windowSeconds = 60) {
    let result;
    try {
      result = await rateLimit({ scope, subject, limit, windowSeconds });
    } catch {
      throw new Error('admin-ingress-unavailable');
    }
    if (result?.allowed !== true) throw new Error('too-many-attempts');
  }

  function tokenFingerprint(rawToken, route) {
    if (typeof rawToken !== 'string' || rawToken.length < 1 || rawToken.length > 200) {
      return null;
    }
    return hmacHex(tokenKey, `admin-ingress-cookie:${route}`, rawToken);
  }

  async function enter(req, rawToken, pathname) {
    const route = routeClass(pathname);
    const metadata = route === 'admin'
      ? readAdminSessionToken(tokenKey, rawToken) : null;
    const className = metadata?.className ?? 'anonymous';
    const selected = limits[className];
    const release = gates[className]();
    if (!release) throw busyError();
    try {
      const ip = clientIp(req);
      await requireRate(`admin-ingress-${className}-${route}-ip`, ip, selected.ip);
      const fingerprint = tokenFingerprint(rawToken, route);
      if (fingerprint) {
        await requireRate(
          `admin-ingress-${className}-${route}-token`,
          fingerprint,
          selected.token,
        );
      }
      await requireRate(
        `admin-ingress-${className}-${route}-global`,
        'global',
        selected.global,
      );
      return { className, metadata, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  async function admitPrincipal(req, principal) {
    const className = principal.account.isOwner === true ? 'owner' : 'member';
    const selected = limits[className];
    const sessionId = principal.session.id;
    await requireRate(
      `admin-ingress-${className}-session`,
      `${sessionId}\0${clientIp(req)}`,
      selected.session,
    );
    await requireRate(
      `admin-ingress-${className}-actor`,
      principal.account.id,
      selected.actor,
    );
  }

  return Object.freeze({
    enter,
    admitPrincipal,
    issueSessionToken: (input) => createAdminSessionToken(tokenKey, input),
    readSessionToken: (token) => readAdminSessionToken(tokenKey, token),
  });
}
