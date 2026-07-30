import crypto from 'node:crypto';
import { normalizeEmail } from '../email-auth.mjs';

export const ADMIN_PERMISSIONS = Object.freeze([
  ['overview.read', '查看总览'],
  ['users.read', '查看用户'],
  ['users.restrict', '管理用户限制'],
  ['plans.read', '查看套餐'],
  ['plans.write', '管理套餐'],
  ['entitlements.read', '查看权益'],
  ['entitlements.write', '管理权益'],
  ['features.read', '查看功能'],
  ['features.write', '管理功能'],
  ['subscriptions.read', '查看订阅'],
  ['subscriptions.write', '分配订阅'],
  ['points.read', '查看积分'],
  ['points.adjust', '调整积分'],
  ['cdk.read', '查看 CDK'],
  ['cdk.write', '管理 CDK'],
  ['team.read', '查看管理团队'],
  ['team.roles', '管理角色'],
  ['audit.read', '查看审计'],
]);

function base64Key(value, label) {
  if (typeof value !== 'string') throw new Error(`missing-config:${label}`);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error(`invalid-config:${label}`);
  }
  return key;
}

function positiveInteger(value, fallback, label, maximum) {
  const selected = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new Error(`invalid-config:${label}`);
  }
  return selected;
}

function publicOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid-config:${label}`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`invalid-config:${label}`);
  }
  return parsed.origin;
}

function cdkKeys(env) {
  const values = new Map();
  if (env.CDK_HMAC_KEYS) {
    let parsed;
    try {
      parsed = JSON.parse(env.CDK_HMAC_KEYS);
    } catch {
      throw new Error('invalid-config:CDK_HMAC_KEYS');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid-config:CDK_HMAC_KEYS');
    }
    for (const [version, encoded] of Object.entries(parsed)) {
      const number = Number(version);
      if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error('invalid-config:CDK_HMAC_KEYS');
      }
      values.set(number, base64Key(encoded, `CDK_HMAC_KEYS.${version}`));
    }
  } else if (env.CDK_HMAC_KEY) {
    const version = positiveInteger(env.CDK_HMAC_KEY_VERSION, 1, 'CDK_HMAC_KEY_VERSION', 1_000);
    values.set(version, base64Key(env.CDK_HMAC_KEY, 'CDK_HMAC_KEY'));
  }
  return values;
}

export function readAdminConfig(env = process.env) {
  const rawOwner = env.ADMIN_OWNER_EMAIL;
  if (!rawOwner) {
    const partial = [
      'ADMIN_PUBLIC_ORIGIN',
      'COMMERCE_PUBLIC_ORIGIN',
      'ADMIN_TOKEN_HMAC_KEY',
      'CDK_HMAC_KEYS',
      'CDK_HMAC_KEY',
      'CDK_HMAC_KEY_VERSION',
    ].some((key) => Boolean(env[key]));
    if (partial) throw new Error('missing-config:ADMIN_OWNER_EMAIL');
    return null;
  }
  const ownerEmail = normalizeEmail(rawOwner);
  if (!ownerEmail) throw new Error('invalid-config:ADMIN_OWNER_EMAIL');
  const origin = publicOrigin(env.ADMIN_PUBLIC_ORIGIN, 'ADMIN_PUBLIC_ORIGIN');
  const commerceOrigin = publicOrigin(
    env.COMMERCE_PUBLIC_ORIGIN ?? env.ADMIN_PUBLIC_ORIGIN,
    'COMMERCE_PUBLIC_ORIGIN',
  );
  const tokenKey = base64Key(env.ADMIN_TOKEN_HMAC_KEY, 'ADMIN_TOKEN_HMAC_KEY');
  const currentCdkVersion = positiveInteger(
    env.CDK_HMAC_KEY_VERSION,
    1,
    'CDK_HMAC_KEY_VERSION',
    1_000,
  );
  const configuredCdkKeys = cdkKeys(env);
  if (configuredCdkKeys.size > 0 && !configuredCdkKeys.has(currentCdkVersion)) {
    throw new Error('invalid-config:CDK_HMAC_KEY_VERSION');
  }
  return Object.freeze({
    ownerEmail,
    origin,
    commerceOrigin,
    tokenKey,
    cdkKeys: configuredCdkKeys,
    currentCdkVersion,
    sessionTtlMs: positiveInteger(
      env.ADMIN_SESSION_TTL_HOURS, 12, 'ADMIN_SESSION_TTL_HOURS', 72,
    ) * 3_600_000,
    invitationTtlMs: positiveInteger(
      env.ADMIN_INVITE_TTL_HOURS, 24, 'ADMIN_INVITE_TTL_HOURS', 168,
    ) * 3_600_000,
    bootstrapRetryMs: positiveInteger(
      env.ADMIN_BOOTSTRAP_RETRY_SECONDS, 300, 'ADMIN_BOOTSTRAP_RETRY_SECONDS', 3_600,
    ) * 1_000,
  });
}

export function hmacHex(key, domain, value) {
  return crypto.createHmac('sha256', key).update(`${domain}\0${value}`).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function cdkHash(key, version, normalizedCode) {
  return hmacHex(key, `cdk:v${version}`, normalizedCode);
}

export function normalizeCdk(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{20,80}$/.test(normalized) ? normalized : null;
}
