export function pageInput(url) {
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
      ? pageSize : 20,
  };
}

export function safeInvitation(value) {
  if (!value) return null;
  return {
    id: value.id,
    accountId: value.accountId,
    email: value.email,
    displayName: value.displayName ?? '',
    expiresAt: value.expiresAt,
    consumedAt: value.consumedAt,
    revokedAt: value.revokedAt,
    sentAt: value.sentAt,
    createdAt: value.createdAt,
  };
}

export function safeOperator(value) {
  return {
    id: value.id,
    email: value.email,
    displayName: value.displayName ?? '',
    status: value.status,
    isOwner: value.isOwner === true,
    roles: value.roles ?? [],
    activatedAt: value.activatedAt,
    lastLoginAt: value.lastLoginAt,
    createdAt: value.createdAt,
  };
}

export function requireReason(value) {
  if (typeof value !== 'string') throw new Error('invalid-reason');
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > 500 || normalized.includes('\0')) {
    throw new Error('invalid-reason');
  }
  return normalized;
}

export function requireIdempotencyKey(value) {
  if (typeof value !== 'string') throw new Error('invalid-idempotency-key');
  const key = value.normalize('NFC').trim();
  if (key.length < 16 || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error('invalid-idempotency-key');
  }
  return key;
}

export function publicError(error) {
  const code = error instanceof Error ? error.message : 'internal-error';
  if (code === 'body-too-large') return { status: 413, code };
  if (code === 'body-timeout') return { status: 408, code };
  if (code === 'bad-json') return { status: 400, code };
  if (code === 'invalid-json-content-type') return { status: 415, code: 'json-required' };
  if (code === 'invalid-credentials') return { status: 401, code };
  if (code === 'login-required' || code === 'admin-session-expired') {
    return { status: 401, code: 'login-required' };
  }
  if (code === 'permission-denied' || code === 'owner-required'
      || code === 'account-suspended') {
    return { status: 403, code };
  }
  if (code === 'origin-required' || code === 'csrf-invalid') {
    return { status: 403, code };
  }
  if (code === 'too-many-attempts' || code === 'auth-busy') {
    return { status: 429, code, retryAfter: error.retryAfter ?? 1 };
  }
  if (code === 'cdk-export-expired') return { status: 410, code };
  if (code.includes('not-found')) return { status: 404, code };
  if (code.includes('conflict') || code.includes('already')
      || code.includes('protected') || code === 'insufficient-points'
      || code === 'point-balance-overflow') {
    return { status: 409, code };
  }
  if (code.includes('unavailable') || code.includes('not-configured')) {
    return { status: 503, code };
  }
  if (code.startsWith('invalid-') || code.startsWith('unknown-')
      || code.startsWith('weak-') || code === 'password-too-long'
      || code.startsWith('future-') || code.startsWith('multiple-')) {
    return { status: 400, code };
  }
  return { status: 500, code: 'internal-error' };
}

export function permission(principal, key) {
  if (!principal.permissions.includes(key)) throw new Error('permission-denied');
}

export function pathParts(pathname, prefix) {
  const suffix = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  return suffix ? suffix.split('/').map((item) => decodeURIComponent(item)) : [];
}
