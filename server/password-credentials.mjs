import { canonicalName } from './auth-security.mjs';

const SALT_RE = /^[0-9a-f]{32}$/;
const HASH_RE = /^[0-9a-f]{128}$/;
const CREDENTIAL_KEYS = 'hash,salt';
const OVERRIDE_KEYS = 'changedAt,hash,name,salt';

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected-object`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  if (Object.keys(value).sort().join(',') !== expected) {
    throw new Error(`${label}: bad-shape`);
  }
}

function requireCredentials(value, label, exact = false) {
  const record = requireRecord(value, label);
  if (exact) requireExactKeys(record, CREDENTIAL_KEYS, label);
  if (typeof record.salt !== 'string' || !SALT_RE.test(record.salt)) {
    throw new Error(`${label}: bad-salt`);
  }
  if (typeof record.hash !== 'string' || !HASH_RE.test(record.hash)) {
    throw new Error(`${label}: bad-hash`);
  }
  return { salt: record.salt, hash: record.hash };
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}: bad-changed-at`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label}: bad-changed-at`);
  }
  return value;
}

function requireStoredName(user, label) {
  const record = requireRecord(user, label);
  const normalized = typeof record.name === 'string' ? record.name.trim().normalize('NFC') : '';
  const canonical = canonicalName(record.name);
  if (!canonical || record.name !== normalized) throw new Error(`${label}: bad-name`);
  return { canonical, name: record.name };
}

function validateUsers(value, source) {
  if (!Array.isArray(value)) throw new Error(`${source}: expected-array`);
  const seen = new Set();
  return value.map((user, index) => {
    const label = `${source}[${index}]`;
    const identity = requireStoredName(user, label);
    if (seen.has(identity.canonical)) throw new Error(`${label}: duplicate-name`);
    seen.add(identity.canonical);
    requireCredentials(user, label);
    return { user, ...identity };
  });
}

function validateGlobalUsers(configUsers, registrations) {
  const configured = validateUsers(configUsers, 'config.users');
  const registered = validateUsers(registrations, 'registered-users.json');
  const seen = new Map(configured.map((item) => [item.canonical, 'config.users']));
  for (const [index, item] of registered.entries()) {
    if (seen.has(item.canonical)) {
      throw new Error(`registered-users.json[${index}]: duplicate-name-with-${seen.get(item.canonical)}`);
    }
    seen.set(item.canonical, 'registered-users.json');
  }
  return { configured, registered };
}

export function validatePasswordOverrides(configUsers, raw) {
  const configured = validateUsers(configUsers, 'config.users');
  if (!Array.isArray(raw)) throw new Error('password-overrides.json: expected-array');
  const targets = new Map(configured.map((item) => [item.canonical, item.name]));
  const seen = new Set();
  return raw.map((candidate, index) => {
    const label = `password-overrides.json[${index}]`;
    const record = requireRecord(candidate, label);
    requireExactKeys(record, OVERRIDE_KEYS, label);
    const identity = requireStoredName(record, label);
    if (seen.has(identity.canonical)) throw new Error(`${label}: duplicate-name`);
    seen.add(identity.canonical);
    const targetName = targets.get(identity.canonical);
    if (!targetName) throw new Error(`${label}: unknown-config-user`);
    if (record.name !== targetName) throw new Error(`${label}: noncanonical-name`);
    const credentials = requireCredentials(record, label);
    const changedAt = requireIsoTimestamp(record.changedAt, label);
    return { name: targetName, ...credentials, changedAt };
  });
}

export function applyPasswordOverrides(configUsers, overrides) {
  const validated = validatePasswordOverrides(configUsers, overrides);
  const byName = new Map(validated.map((item) => [canonicalName(item.name), item]));
  return configUsers.map((user) => {
    const override = byName.get(canonicalName(user.name));
    return override ? { ...user, salt: override.salt, hash: override.hash } : { ...user };
  });
}

function makeResult(configUsers, registrations, overrides, source) {
  return {
    source,
    users: applyPasswordOverrides(configUsers, overrides),
    registrations,
    overrides,
  };
}

export function updatePassword(
  configUsers, registrations, overrides, nameValue, credentialsValue, changedAtValue,
) {
  const { configured, registered } = validateGlobalUsers(configUsers, registrations);
  const currentOverrides = validatePasswordOverrides(configUsers, overrides);
  const targetName = canonicalName(nameValue);
  if (!targetName) throw new Error('bad-name');
  const credentials = requireCredentials(credentialsValue, 'credentials', true);
  const changedAt = requireIsoTimestamp(changedAtValue, 'changedAt');
  const configuredTarget = configured.find((item) => item.canonical === targetName);
  const registeredIndex = registered.findIndex((item) => item.canonical === targetName);
  if (!configuredTarget && registeredIndex < 0) throw new Error('user-not-found');

  if (configuredTarget) {
    const replacement = { name: configuredTarget.name, ...credentials, changedAt };
    const index = currentOverrides.findIndex((item) => canonicalName(item.name) === targetName);
    const next = index < 0
      ? [...currentOverrides, replacement]
      : currentOverrides.map((item, itemIndex) => itemIndex === index ? replacement : item);
    return makeResult(configUsers, registrations.map((user) => ({ ...user })), next, 'overrides');
  }

  const nextRegistrations = registrations.map((user, index) => index === registeredIndex
    ? { ...user, ...credentials, passwordChangedAt: changedAt }
    : { ...user });
  return makeResult(configUsers, nextRegistrations, currentOverrides, 'registrations');
}
