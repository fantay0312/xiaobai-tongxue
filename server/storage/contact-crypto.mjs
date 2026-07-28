import crypto from 'node:crypto';
import { requireBase64Key } from './config.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTACT_KINDS = new Set(['email', 'phone']);

export function assertUuid(value, label = 'id') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`invalid-${label}`);
  }
  return value.toLowerCase();
}

export function stableUuid(randomUUID = crypto.randomUUID) {
  return assertUuid(randomUUID(), 'generated-id');
}

function normalizeEmail(value) {
  const normalized = String(value ?? '').trim().normalize('NFC').toLowerCase();
  if (normalized.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error('invalid-contact');
  }
  return normalized;
}

function normalizePhone(value, defaultCountryCode) {
  let normalized = String(value ?? '').trim().replace(/[\s()-]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (/^1[3-9]\d{9}$/.test(normalized)) normalized = `+${defaultCountryCode}${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error('invalid-contact');
  return normalized;
}

export function normalizeContact(kind, value, defaultCountryCode = '86') {
  if (!CONTACT_KINDS.has(kind)) throw new Error('invalid-contact-kind');
  return kind === 'email' ? normalizeEmail(value) : normalizePhone(value, defaultCountryCode);
}

function aadFor(userId, kind) {
  return Buffer.from(`xiaobai-contact-v1\0${userId}\0${kind}`, 'utf8');
}

export function createContactProtector({ key, defaultCountryCode = '86' } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('contact-key-required');
  if (!/^[1-9]\d{0,3}$/.test(defaultCountryCode)) throw new Error('invalid-country-code');
  const encryptionKey = Buffer.from(
    crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'xiaobai/contact-encryption/v1', 32),
  );
  const lookupKey = Buffer.from(
    crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'xiaobai/contact-lookup/v1', 32),
  );

  function protect({ userId: rawUserId, kind, value }) {
    const userId = assertUuid(rawUserId, 'user-id');
    const normalized = normalizeContact(kind, value, defaultCountryCode);
    const lookupHash = crypto.createHmac('sha256', lookupKey)
      .update(`${kind}\0${normalized}`, 'utf8')
      .digest('hex');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(aadFor(userId, kind));
    const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    return { lookupHash, ciphertext, nonce, authTag: cipher.getAuthTag() };
  }

  function reveal({ userId: rawUserId, kind, ciphertext, nonce, authTag }) {
    const userId = assertUuid(rawUserId, 'user-id');
    if (!CONTACT_KINDS.has(kind)) throw new Error('invalid-contact-kind');
    if (![ciphertext, nonce, authTag].every(Buffer.isBuffer)) throw new Error('invalid-ciphertext');
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error('invalid-ciphertext');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, nonce);
      decipher.setAAD(aadFor(userId, kind));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('contact-decryption-failed');
    }
  }

  function hash(kind, value) {
    const normalized = normalizeContact(kind, value, defaultCountryCode);
    return crypto.createHmac('sha256', lookupKey)
      .update(`${kind}\0${normalized}`, 'utf8')
      .digest('hex');
  }

  const normalize = (kind, value) => normalizeContact(kind, value, defaultCountryCode);
  return Object.freeze({ protect, reveal, hash, normalize });
}

export function createContactProtectorFromEnv(env = process.env) {
  return createContactProtector({
    key: requireBase64Key(env, 'CONTACT_ENCRYPTION_KEY'),
    defaultCountryCode: env.CONTACT_DEFAULT_COUNTRY_CODE || '86',
  });
}
