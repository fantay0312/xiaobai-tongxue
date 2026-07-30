import { createResponseConcurrencyGate } from './commerce/response-concurrency-gate.mjs';

export function createCommercialAccessController({
  cookieName,
  sessions,
  getCookie,
  findUser,
  commerceService = null,
  rateLimit = null,
  clientIp = null,
  identityMatches,
  rejectLegacyRestriction,
  send,
  protectedMaxConcurrent = 64,
} = {}) {
  if (!cookieName || !(sessions instanceof Map) || !getCookie || !findUser
      || !identityMatches || !rejectLegacyRestriction || !send) {
    throw new Error('commercial-access-dependencies-required');
  }
  if (commerceService && (!rateLimit || !clientIp)) {
    throw new Error('commercial-ingress-dependencies-required');
  }
  const suspendedSessions = new Map();
  const preflightMarker = Symbol('commercial-preflight');
  const protectedGate = createResponseConcurrencyGate({
    limit: protectedMaxConcurrent,
  });

  function currentUser(req) {
    const token = getCookie(req, cookieName);
    if (!token) return null;
    const active = sessions.get(token);
    const suspended = suspendedSessions.get(token);
    const session = active ?? suspended;
    if (!session || session.expires < Date.now()) {
      sessions.delete(token);
      suspendedSessions.delete(token);
      return null;
    }
    const user = findUser(session.name);
    const version = Number.isSafeInteger(user?.sessionVersion) ? user.sessionVersion : 1;
    if (!user) {
      sessions.delete(token);
      suspendedSessions.delete(token);
      return null;
    }
    if (user.disabledAt) {
      return {
        token,
        name: session.name,
        userId: user.id ?? null,
        sessionVersion: version,
        suspended: true,
      };
    }
    if (suspended || version !== session.sessionVersion) {
      sessions.delete(token);
      suspendedSessions.delete(token);
      return null;
    }
    return {
      token,
      name: session.name,
      userId: user.id ?? null,
      sessionVersion: version,
    };
  }

  async function commercialAccess(user, scope, request = null) {
    if (user?.disabledAt) {
      return { allowed: false, error: 'account-restricted', reason: 'account-suspended' };
    }
    if (!commerceService || !user?.id) return { allowed: true };
    return commerceService.accessDecision(user, scope, request);
  }

  function sendAccessDecision(res, decision) {
    send(res, 403, {
      error: decision.error,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.expiresAt ? { expiresAt: decision.expiresAt } : {}),
    });
  }

  async function admitLimit(res, input) {
    let result;
    try {
      result = await rateLimit(input);
      if (typeof result?.allowed !== 'boolean') throw new Error('invalid-rate-limit-result');
    } catch {
      send(res, 503, { error: 'commerce-ingress-unavailable' });
      return false;
    }
    if (result.allowed) return true;
    const retryAfter = Math.max(1, Number(result.retryAfterSeconds) || 1);
    send(res, 429, { error: 'too-many-attempts', retryAfter }, {
      'Retry-After': String(retryAfter),
    });
    return false;
  }

  async function admitIngress(req, res, user) {
    if (!commerceService) return true;
    if (!await admitLimit(res, {
      scope: 'commerce-ingress-user',
      subject: String(user.id ?? user.name),
      limit: 240,
      windowSeconds: 60,
    })) return false;
    let ip;
    try {
      ip = clientIp(req);
    } catch {
      send(res, 503, { error: 'commerce-ingress-unavailable' });
      return false;
    }
    if (!await admitLimit(res, {
      scope: 'commerce-ingress-ip',
      subject: ip,
      limit: 600,
      windowSeconds: 60,
    })) return false;
    return admitLimit(res, {
      scope: 'commerce-ingress-global',
      subject: 'protected-api',
      limit: 6_000,
      windowSeconds: 60,
    });
  }

  async function preflightUser(req, res) {
    const session = currentUser(req);
    if (!session) {
      send(res, 401, { error: 'login-required' });
      return null;
    }
    if (!identityMatches(req, session)) {
      send(res, 401, { error: 'identity-mismatch' });
      return null;
    }
    const user = findUser(session.name);
    const permit = protectedGate.acquire(req, res);
    if (!permit.allowed) {
      send(res, 503, { error: permit.error });
      return null;
    }
    if (!await admitIngress(req, res, user)) return null;
    return { marker: preflightMarker, request: req, session, user };
  }

  async function protectedUser(
    req,
    res,
    scope = 'all',
    { allowUnverified = false, preflight = null } = {},
  ) {
    const admitted = preflight?.marker === preflightMarker && preflight.request === req
      ? preflight
      : await preflightUser(req, res);
    if (!admitted) return null;
    const session = currentUser(req);
    if (!session || session.token !== admitted.session.token) {
      send(res, 401, { error: 'login-required' });
      return null;
    }
    const user = findUser(session.name);
    const decision = await commercialAccess(user, scope, req);
    if (!decision.allowed) {
      sendAccessDecision(res, decision);
      return null;
    }
    if (!allowUnverified && rejectLegacyRestriction(res, session)) return null;
    return user;
  }

  function suspendUserSessions(name, matches) {
    for (const [token, session] of sessions) {
      if (!matches(session.name, name)) continue;
      suspendedSessions.set(token, session);
      sessions.delete(token);
    }
  }

  function clearSuspendedSessions(name, matches) {
    for (const [token, session] of suspendedSessions) {
      if (matches(session.name, name)) suspendedSessions.delete(token);
    }
  }

  function deleteSession(token) {
    sessions.delete(token);
    suspendedSessions.delete(token);
  }

  function pruneExpired(now = Date.now()) {
    for (const [token, session] of suspendedSessions) {
      if (session.expires < now) suspendedSessions.delete(token);
    }
  }

  return Object.freeze({
    currentUser,
    commercialAccess,
    sendAccessDecision,
    preflightUser,
    protectedUser,
    suspendUserSessions,
    clearSuspendedSessions,
    deleteSession,
    pruneExpired,
  });
}
