import { PG_INT64_MAX, pgBigIntString } from '../integer-bounds.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;
const VALUE_TYPES = new Set(['boolean', 'integer', 'string', 'json']);

function pointString(value) {
  return pgBigIntString(value, 'point-amount', { positive: true });
}

function validPointTotal(items, error) {
  const total = items
    .filter((item) => item.type === 'points')
    .reduce((sum, item) => sum + BigInt(item.amount), 0n);
  if (total > PG_INT64_MAX) throw new Error(error);
}

function rejectDuplicateEntitlements(items, error) {
  const keys = items
    .filter((item) => item.type === 'entitlement')
    .map((item) => item.key);
  if (new Set(keys).size !== keys.length) throw new Error(error);
}

function labelValue(value, fallback, error = 'invalid-cdk-reward') {
  const label = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (typeof label !== 'string' || !label || label.length > 160) throw new Error(error);
  return label;
}

function validTypedValue(type, value) {
  if (!VALUE_TYPES.has(type) || value === undefined) return false;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'string') return typeof value === 'string';
  return true;
}

function validDefinition(value, expectedKey = null) {
  return value && typeof value === 'object'
    && KEY_PATTERN.test(value.key) && value.key.length <= 100
    && (!expectedKey || value.key === expectedKey)
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 120
    && validTypedValue(value.valueType, value.value);
}

function entitlementKey(value, error) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!KEY_PATTERN.test(key) || key.length > 100) throw new Error(error);
  return key;
}

function futureExpiry(value, error, now = Date.now(), allowExpired = false) {
  if (value == null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || (!allowExpired && parsed.getTime() <= now)) {
    throw new Error(error);
  }
  return parsed.toISOString();
}

export function validateRewardRequest(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error('invalid-cdk-rewards');
  }
  let subscriptions = 0;
  const items = value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('invalid-cdk-reward');
    const label = labelValue(item.label, item.type);
    if (item.type === 'points') {
      return { type: 'points', amount: pointString(item.amount), label };
    }
    if (item.type === 'subscription') {
      subscriptions += 1;
      const durationDays = Number(item.durationDays);
      if (subscriptions > 1) throw new Error('multiple-subscription-rewards');
      if (!UUID_PATTERN.test(item.planId)
          || !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
        throw new Error('invalid-subscription-reward');
      }
      return { type: 'subscription', planId: item.planId, durationDays, label };
    }
    if (item.type === 'entitlement') {
      return {
        type: 'entitlement',
        key: entitlementKey(item.key, 'invalid-entitlement-reward'),
        value: item.value,
        expiresAt: futureExpiry(item.expiresAt, 'invalid-entitlement-reward'),
        label,
      };
    }
    throw new Error('invalid-cdk-reward-type');
  });
  if (items.some((item) => item.type === 'entitlement' && item.value === undefined)) {
    throw new Error('invalid-entitlement-reward');
  }
  rejectDuplicateEntitlements(items, 'invalid-entitlement-reward');
  validPointTotal(items, 'invalid-point-amount');
  return { schemaVersion: 1, items };
}

function requestedItems(value, error = 'invalid-cdk-reward-request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schemaVersion !== 1 || !Array.isArray(value.items)
      || value.items.length < 1 || value.items.length > 50) {
    throw new Error(error);
  }
  return value.items;
}

async function freezeSubscription(item, label, loadPlan) {
  const durationDays = Number(item.durationDays);
  if (!UUID_PATTERN.test(item.planId)
      || !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error('invalid-subscription-reward');
  }
  const plan = await loadPlan(item.planId);
  if (!plan) throw new Error('cdk-published-plan-not-found');
  const snapshot = plan.snapshot;
  if (!UUID_PATTERN.test(plan.planVersionId) || !snapshot
      || typeof snapshot.planCode !== 'string' || !snapshot.planCode
      || typeof snapshot.planName !== 'string' || !snapshot.planName
      || typeof snapshot.tagline !== 'string' || typeof snapshot.description !== 'string'
      || snapshot.price !== null
      || !Number.isSafeInteger(plan.snapshot?.versionNumber)
      || !Array.isArray(plan.snapshot?.entitlements)
      || plan.snapshot.entitlements.length > 200
      || plan.snapshot.entitlements.some((entry) => (
        entry.status !== 'active' || !validDefinition(entry)
      ))) {
    throw new Error('cdk-plan-entitlement-invalid');
  }
  const keys = snapshot.entitlements.map((entry) => entry.key);
  if (new Set(keys).size !== keys.length) throw new Error('cdk-plan-entitlement-invalid');
  return {
    type: 'subscription',
    planId: item.planId,
    planVersionId: plan.planVersionId,
    durationDays,
    snapshot: {
      ...plan.snapshot,
      entitlements: plan.snapshot.entitlements.map(({ status: _status, ...entry }) => entry),
    },
    label,
  };
}

async function freezeEntitlement(item, label, loadEntitlement) {
  const key = entitlementKey(item.key, 'invalid-entitlement-reward');
  const definition = await loadEntitlement(key);
  if (!definition) throw new Error('cdk-active-entitlement-not-found');
  if (!validDefinition({ ...definition, value: item.value }, key)) {
    throw new Error('invalid-entitlement-reward-value');
  }
  return {
    type: 'entitlement',
    key: definition.key,
    name: definition.name,
    valueType: definition.valueType,
    value: item.value,
    expiresAt: futureExpiry(item.expiresAt, 'invalid-entitlement-reward'),
    label,
  };
}

export async function freezeRewardRequest(value, { loadPlan, loadEntitlement }) {
  const items = [];
  let subscriptionSeen = false;
  for (const item of requestedItems(value)) {
    const label = labelValue(item?.label, '', 'invalid-cdk-reward-request');
    if (item?.type === 'points') {
      items.push({ type: 'points', amount: pointString(item.amount), label });
      continue;
    }
    if (item?.type === 'subscription') {
      if (subscriptionSeen) throw new Error('multiple-subscription-rewards');
      subscriptionSeen = true;
      items.push(await freezeSubscription(item, label, loadPlan));
      continue;
    }
    if (item?.type !== 'entitlement') throw new Error('invalid-cdk-reward-type');
    items.push(await freezeEntitlement(item, label, loadEntitlement));
  }
  rejectDuplicateEntitlements(items, 'invalid-entitlement-reward');
  validPointTotal(items, 'invalid-point-amount');
  return { schemaVersion: 1, items };
}

function frozenEntitlement(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid-cdk-reward-snapshot');
  const key = typeof value.key === 'string' ? value.key : '';
  const name = typeof value.name === 'string' ? value.name : '';
  if (!KEY_PATTERN.test(key) || key.length > 100 || !name || name.length > 120
      || !validTypedValue(value.valueType, value.value)) {
    throw new Error('invalid-cdk-reward-snapshot');
  }
  return { key, name, valueType: value.valueType, value: value.value };
}

export function readFrozenRewards(value, { allowExpired = false } = {}) {
  const items = requestedItems(value, 'invalid-cdk-reward-snapshot');
  let subscriptions = 0;
  const frozen = items.map((item) => {
    const label = labelValue(item?.label, '', 'invalid-cdk-reward-snapshot');
    if (item?.type === 'points') {
      return { type: 'points', amount: pointString(item.amount), label };
    }
    if (item?.type === 'entitlement') {
      return {
        type: 'entitlement',
        ...frozenEntitlement(item),
        expiresAt: futureExpiry(
          item.expiresAt, 'invalid-cdk-reward-snapshot', Date.now(), allowExpired,
        ),
        label,
      };
    }
    subscriptions += 1;
    const durationDays = Number(item?.durationDays);
    const snapshot = item?.snapshot;
    if (item?.type !== 'subscription' || subscriptions > 1
        || !UUID_PATTERN.test(item.planId) || !UUID_PATTERN.test(item.planVersionId)
        || !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650
        || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
        || snapshot.price !== null
        || typeof snapshot.planCode !== 'string' || !snapshot.planCode
        || typeof snapshot.planName !== 'string' || !snapshot.planName
        || typeof snapshot.tagline !== 'string' || typeof snapshot.description !== 'string'
        || !Number.isSafeInteger(snapshot.versionNumber) || snapshot.versionNumber < 1
        || !Array.isArray(snapshot.entitlements) || snapshot.entitlements.length > 200) {
      throw new Error('invalid-cdk-reward-snapshot');
    }
    const entitlements = snapshot.entitlements.map(frozenEntitlement);
    if (new Set(entitlements.map((entry) => entry.key)).size !== entitlements.length) {
      throw new Error('invalid-cdk-reward-snapshot');
    }
    return {
      type: 'subscription',
      planId: item.planId,
      planVersionId: item.planVersionId,
      durationDays,
      snapshot: { ...snapshot, entitlements },
      label,
    };
  });
  rejectDuplicateEntitlements(frozen, 'invalid-cdk-reward-snapshot');
  validPointTotal(frozen, 'invalid-cdk-reward-snapshot');
  return { schemaVersion: 1, items: frozen };
}
