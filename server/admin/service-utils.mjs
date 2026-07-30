import { requireCredentials } from '../credential-format.mjs';

export function credentials(account) {
  if (!account || typeof account.passwordScheme !== 'string') return null;
  try {
    return requireCredentials({
      hash: account.passwordHash,
      salt: account.passwordSalt,
      passwordScheme: account.passwordScheme,
    }, 'admin-credentials', true);
  } catch {
    return null;
  }
}

export function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12) throw new Error('weak-password');
  if (value.length > 128) throw new Error('password-too-long');
  return value;
}

export function safeAdmin(account) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName ?? '',
    status: account.status,
    isOwner: account.isOwner === true,
  };
}

function gateError(result) {
  const error = new Error(result.error ?? 'auth-busy');
  error.retryAfter = result.retryAfter ?? 1;
  return error;
}

export function createKdfRunner(authGate) {
  return async function runKdf(work) {
    const permit = authGate.acquireConcurrency();
    if (!permit.ok) throw gateError(permit);
    try {
      const admission = authGate.admitGlobal();
      if (!admission.ok) throw gateError(admission);
      return await work();
    } finally {
      permit.release();
    }
  };
}
