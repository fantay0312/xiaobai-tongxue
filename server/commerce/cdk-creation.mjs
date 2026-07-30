import crypto from 'node:crypto';
import { cdkHash, normalizeCdk } from '../admin/config.mjs';
import { validateRewardRequest } from './cdk-rewards.mjs';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, label, maximum) {
  if (typeof value !== 'string') throw new Error(`invalid-${label}`);
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) {
    throw new Error(`invalid-${label}`);
  }
  return normalized;
}

function idempotencyKey(value) {
  const key = text(value, 'idempotency-key', 160);
  if (!IDEMPOTENCY_PATTERN.test(key)) throw new Error('invalid-idempotency-key');
  return key;
}

function canonicalValue(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(
      (key) => [key, canonicalValue(value[key])],
    ));
  }
  throw new Error('invalid-cdk-request');
}

function normalizeInput(input, now) {
  const quantity = Number(input?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) {
    throw new Error('invalid-cdk-quantity');
  }
  let expiresAt = null;
  if (input.expiresAt != null) {
    const parsed = new Date(input.expiresAt);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= now) {
      throw new Error('invalid-cdk-expiry');
    }
    expiresAt = parsed.toISOString();
  }
  return {
    name: text(input?.name, 'cdk-campaign-name', 160),
    quantity,
    rewards: validateRewardRequest(input?.rewards),
    expiresAt,
    reason: text(input?.reason, 'reason', 500),
    idempotencyKey: idempotencyKey(input?.idempotencyKey),
  };
}

function requestHash(input) {
  const canonical = canonicalValue({
    name: input.name,
    quantity: input.quantity,
    rewards: input.rewards,
    expiresAt: input.expiresAt,
    reason: input.reason,
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function exportKey(rootKey) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) {
    throw new Error('cdk-export-key-unavailable');
  }
  return crypto.createHmac('sha256', rootKey)
    .update('xiaobai:cdk-export:aes-256-gcm:v1')
    .digest();
}

function additionalData(identity, campaignId) {
  return Buffer.from(JSON.stringify({
    actorId: identity.actorId,
    idempotencyKey: identity.idempotencyKey,
    requestHash: identity.requestHash,
    campaignId,
  }));
}

function encryptExport(rootKey, identity, result) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', exportKey(rootKey), nonce);
  cipher.setAAD(additionalData(identity, result.campaign.id));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ schemaVersion: 1, ...result }), 'utf8'),
    cipher.final(),
  ]);
  return { nonce, tag: cipher.getAuthTag(), ciphertext };
}

function decryptExport(rootKey, identity, operation) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      exportKey(rootKey),
      operation.exportNonce,
    );
    decipher.setAAD(additionalData(identity, operation.campaignId));
    decipher.setAuthTag(operation.exportTag);
    const payload = JSON.parse(Buffer.concat([
      decipher.update(operation.exportCiphertext),
      decipher.final(),
    ]).toString('utf8'));
    if (payload?.schemaVersion !== 1 || payload.campaign?.id !== operation.campaignId
        || !Array.isArray(payload.codes)) throw new Error('invalid-export');
    return { campaign: payload.campaign, codes: payload.codes };
  } catch {
    throw new Error('cdk-export-unavailable');
  }
}

function rawCdk() {
  const body = crypto.randomBytes(18).toString('hex').toUpperCase();
  return `XB-${body.match(/.{1,6}/g).join('-')}`;
}

function generateCodes(quantity, key, keyVersion) {
  const rawCodes = [];
  const storedCodes = [];
  const uniqueHashes = new Set();
  while (rawCodes.length < quantity) {
    const raw = rawCdk();
    const hash = cdkHash(key, keyVersion, normalizeCdk(raw));
    if (uniqueHashes.has(hash)) continue;
    uniqueHashes.add(hash);
    rawCodes.push(raw);
    storedCodes.push({ hash, hint: `${raw.slice(0, 8)}…${raw.slice(-6)}` });
  }
  return { rawCodes, storedCodes };
}

function jsonResponse(campaign, codes) {
  return JSON.parse(JSON.stringify({ campaign, codes }));
}

function exportExpired(operation, now) {
  const expiresAt = new Date(operation.exportExpiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now || !operation.exportCiphertext;
}

async function createOrReplay(context, tx) {
  const {
    identity, input, key, keyVersion, rootKey, now,
  } = context;
  const operation = await tx.cdk.lockCampaignCreation(identity);
  if (operation.replayed) {
    if (exportExpired(operation, now())) {
      if (operation.exportCiphertext) await tx.cdk.expireCampaignCreation(identity);
      return { expiredCampaignId: operation.campaignId };
    }
    return { result: decryptExport(rootKey, identity, operation) };
  }
  await tx.cdk.reserveCampaignCreation(identity);
  const generated = generateCodes(input.quantity, key, keyVersion);
  const campaign = await tx.cdk.createCampaign({
    name: input.name,
    keyVersion,
    rewards: input.rewards,
    codes: generated.storedCodes,
    expiresAt: input.expiresAt,
    createdBy: identity.actorId,
  });
  const result = jsonResponse(campaign, generated.rawCodes);
  await tx.cdk.completeCampaignCreation({
    ...identity,
    campaignId: campaign.id,
    ...encryptExport(rootKey, identity, result),
  });
  return { result };
}

export function createCdkCampaignCreator({
  postgres,
  cdkKeys,
  currentCdkVersion,
  exportRootKey,
  now = Date.now,
} = {}) {
  const keys = cdkKeys ?? new Map();
  return async function createCampaign(rawInput, actorId) {
    if (!UUID_PATTERN.test(actorId)) throw new Error('invalid-actor-id');
    const input = normalizeInput(rawInput, now());
    const key = keys.get(currentCdkVersion);
    if (!key) throw new Error('cdk-key-unavailable');
    exportKey(exportRootKey);
    if (typeof postgres.cdk.clearExpiredCampaignExports === 'function') {
      await postgres.cdk.clearExpiredCampaignExports();
    }
    const identity = {
      actorId,
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash(input),
    };
    const outcome = await postgres.withTransaction((tx) => createOrReplay({
      identity,
      input,
      key,
      keyVersion: currentCdkVersion,
      rootKey: exportRootKey,
      now,
    }, tx));
    if (outcome.expiredCampaignId) {
      const error = new Error('cdk-export-expired');
      error.campaignId = outcome.expiredCampaignId;
      throw error;
    }
    return outcome.result;
  };
}
