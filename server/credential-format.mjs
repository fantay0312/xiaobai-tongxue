const NAME_RE = /^[\p{Script=Han}A-Za-z0-9_-]{2,20}$/u;
const SALT_RE = /^[0-9a-f]{32}$/;
const HASH_RE = /^[0-9a-f]{128}$/;

const SCRYPT_SCHEME_PREFIX = ['scrypt', 'v'].join('-');
export const PASSWORD_SCHEME_LEGACY = `${SCRYPT_SCHEME_PREFIX}1`;
export const PASSWORD_SCHEME_CURRENT = `${SCRYPT_SCHEME_PREFIX}2`;
const PASSWORD_SCHEMES = new Set([PASSWORD_SCHEME_LEGACY, PASSWORD_SCHEME_CURRENT]);

export function canonicalName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC');
  return NAME_RE.test(normalized) ? normalized.toLowerCase() : null;
}

export function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected-object`);
  }
  return value;
}

export function requireExactKeys(value, expected, label) {
  if (Object.keys(value).sort().join(',') !== expected) {
    throw new Error(`${label}: bad-shape`);
  }
}

export function passwordSchemeOf(value) {
  const scheme = value && Object.hasOwn(value, 'passwordScheme')
    ? value.passwordScheme
    : PASSWORD_SCHEME_LEGACY;
  return PASSWORD_SCHEMES.has(scheme) ? scheme : null;
}

export function requireCredentials(value, label, exact = false) {
  const record = requireRecord(value, label);
  if (exact) {
    const keys = record.passwordScheme === undefined ? 'hash,salt' : 'hash,passwordScheme,salt';
    requireExactKeys(record, keys, label);
  }
  const passwordScheme = passwordSchemeOf(record);
  if (!passwordScheme) throw new Error(`${label}: bad-password-scheme`);
  if (typeof record.salt !== 'string' || !SALT_RE.test(record.salt)) {
    throw new Error(`${label}: bad-salt`);
  }
  if (typeof record.hash !== 'string' || !HASH_RE.test(record.hash)) {
    throw new Error(`${label}: bad-hash`);
  }
  return {
    salt: record.salt,
    hash: record.hash,
    ...(record.passwordScheme === undefined ? {} : { passwordScheme }),
  };
}

export function requireStoredName(value, label) {
  const record = requireRecord(value, label);
  const normalized = typeof record.name === 'string' ? record.name.trim().normalize('NFC') : '';
  const canonical = canonicalName(record.name);
  if (!canonical || record.name !== normalized) throw new Error(`${label}: bad-name`);
  return { canonical, name: record.name };
}
