import crypto from 'node:crypto';

const ACTIONS = new Set(['change-phone', 'change-email', 'change-password']);

export function isAccountVerificationAction(value) {
  return typeof value === 'string' && ACTIONS.has(value);
}

export function createAccountVerificationGrants({
  ttlMs = 10 * 60_000,
  maxEntries = 5_000,
  createToken = () => crypto.randomBytes(32).toString('hex'),
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) throw new Error('invalid-verification-ttl');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('invalid-verification-limit');
  const grants = new Map();

  function cleanup(now = Date.now()) {
    for (const [token, grant] of grants) {
      if (grant.expiresAt <= now) grants.delete(token);
    }
  }

  function issue({ sessionToken, name, action, revision, now = Date.now() }) {
    if (!sessionToken || !name || !revision || !isAccountVerificationAction(action)) return null;
    cleanup(now);
    for (const [token, grant] of grants) {
      if (grant.sessionToken === sessionToken && grant.action === action) grants.delete(token);
    }
    while (grants.size >= maxEntries) grants.delete(grants.keys().next().value);
    const token = createToken();
    if (typeof token !== 'string' || token.length < 32) throw new Error('invalid-verification-token');
    grants.set(token, {
      sessionToken,
      name,
      action,
      revision,
      expiresAt: now + ttlMs,
    });
    return { token, expiresIn: Math.ceil(ttlMs / 1_000) };
  }

  function authorize({ token, sessionToken, name, action, revision, consume = false, now = Date.now() }) {
    if (typeof token !== 'string' || token.length > 256) return false;
    const grant = grants.get(token);
    if (!grant) return false;
    if (grant.expiresAt <= now) {
      grants.delete(token);
      return false;
    }
    const valid = grant.sessionToken === sessionToken
      && grant.name === name
      && grant.action === action
      && grant.revision === revision;
    if (!valid) return false;
    if (consume) grants.delete(token);
    return true;
  }

  return Object.freeze({ authorize, cleanup, issue });
}
