const WINDOW_SECONDS = 60;
const SECURITY_WINDOW_SECONDS = 15 * 60;

export const AUDIT_ADMISSION_LIMITS = Object.freeze({
  anonymousEvent: 1,
  anonymousIp: 10,
  anonymousGlobal: 120,
  memberSession: 30,
  memberActor: 60,
  memberGlobal: 2_000,
  ownerSession: 180,
  ownerActor: 300,
  ownerGlobal: 2_000,
});

function eventToken(value, fallback) {
  const selected = typeof value === 'string' ? value : '';
  return /^[a-z0-9][a-z0-9.-]{0,99}$/.test(selected) ? selected : fallback;
}

async function consume(rateLimit, {
  scope, subject, limit, windowSeconds = WINDOW_SECONDS,
}) {
  const result = await rateLimit({ scope, subject, limit, windowSeconds });
  if (typeof result?.allowed !== 'boolean') throw new Error('audit-admission-unavailable');
  return result.allowed;
}

function authenticatedDimensions(principal, ip) {
  const owner = principal.account.isOwner === true;
  const prefix = owner ? 'owner' : 'member';
  const sessionId = principal.session?.id ?? 'no-session';
  return [
    {
      scope: `admin-audit-${prefix}-session`,
      subject: `${principal.account.id}\0${sessionId}\0${ip}`,
      limit: AUDIT_ADMISSION_LIMITS[`${prefix}Session`],
    },
    {
      scope: `admin-audit-${prefix}-actor`,
      subject: principal.account.id,
      limit: AUDIT_ADMISSION_LIMITS[`${prefix}Actor`],
    },
    {
      scope: `admin-audit-${prefix}-global`,
      subject: 'global',
      limit: AUDIT_ADMISSION_LIMITS[`${prefix}Global`],
    },
  ];
}

function anonymousDimensions(ip) {
  return [
    {
      scope: 'admin-audit-anonymous-ip',
      subject: ip,
      limit: AUDIT_ADMISSION_LIMITS.anonymousIp,
      windowSeconds: SECURITY_WINDOW_SECONDS,
    },
    {
      scope: 'admin-audit-anonymous-global',
      subject: 'global',
      limit: AUDIT_ADMISSION_LIMITS.anonymousGlobal,
    },
  ];
}

export function createAuditAdmission({ rateLimit, clientIp } = {}) {
  if (typeof rateLimit !== 'function' || typeof clientIp !== 'function') {
    throw new Error('audit-admission-dependencies-required');
  }

  return async function admitAudit(req, principal, event = {}) {
    const ip = clientIp(req);
    const actorId = principal?.account?.id;
    const dimensions = [];
    if (event.outcome === 'failure') {
      const identity = actorId ? `${actorId}\0${ip}` : ip;
      dimensions.push({
        scope: 'admin-audit-security-event',
        subject: `${identity}\0${eventToken(event.action, 'unknown-action')}`
          + `\0${eventToken(event.error, 'unknown-error')}`,
        limit: AUDIT_ADMISSION_LIMITS.anonymousEvent,
        windowSeconds: SECURITY_WINDOW_SECONDS,
      });
    }
    dimensions.push(...(actorId
      ? authenticatedDimensions(principal, ip)
      : anonymousDimensions(ip)));
    for (const dimension of dimensions) {
      if (!await consume(rateLimit, dimension)) return false;
    }
    return true;
  };
}
