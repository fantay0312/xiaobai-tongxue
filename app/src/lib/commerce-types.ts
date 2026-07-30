export interface CommercePrice {
  id: string;
  billingPeriod: string;
  currency: string;
  amountMinor: string;
  durationDays: number | null;
  bonusPoints: string;
}

export interface CommerceEntitlement {
  key: string;
  name: string;
  value: unknown;
  expiresAt: string | null;
}

export interface CommercePlan {
  id: string;
  code: string;
  name: string;
  tagline: string;
  description: string;
  status: string;
  prices: CommercePrice[];
  entitlements: CommerceEntitlement[];
}

export interface CommerceFeature {
  key: string;
  name: string;
  enabled: boolean;
  reason: string | null;
}

export interface CommerceSubscription {
  id: string;
  planName: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}

export interface CommerceSummary {
  wallet: { available: string };
  subscription: CommerceSubscription | null;
  entitlements: CommerceEntitlement[];
  features: CommerceFeature[];
}

export interface CommerceCatalog {
  plans: CommercePlan[];
}

export interface CommerceRedemption {
  ok: true;
  rewards: Array<{ type: string; label: string }>;
  commerce: CommerceSummary | null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function wholeNumber(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(decode) : [];
}

function decodeEntitlement(value: unknown): CommerceEntitlement {
  const item = record(value);
  return {
    key: text(item.key),
    name: text(item.name, text(item.key)),
    value: item.value ?? null,
    expiresAt: nullableText(item.expiresAt),
  };
}

function decodePrice(value: unknown): CommercePrice {
  const item = record(value);
  return {
    id: text(item.id),
    billingPeriod: text(item.billingPeriod),
    currency: text(item.currency, 'CNY'),
    amountMinor: text(item.amountMinor, '0'),
    durationDays: wholeNumber(item.durationDays),
    bonusPoints: text(item.bonusPoints, '0'),
  };
}

function decodePlan(value: unknown): CommercePlan {
  const item = record(value);
  return {
    id: text(item.id),
    code: text(item.code),
    name: text(item.name, '未命名套餐'),
    tagline: text(item.tagline),
    description: text(item.description),
    status: text(item.status),
    prices: list(item.prices, decodePrice),
    entitlements: list(item.entitlements, decodeEntitlement),
  };
}

export function decodeCommerceCatalog(value: unknown): CommerceCatalog {
  const payload = record(value);
  return { plans: list(payload.plans, decodePlan) };
}

export function decodeCommerceSummary(value: unknown): CommerceSummary {
  const payload = record(value);
  const wallet = record(payload.wallet);
  const rawSubscription = payload.subscription;
  const subscriptionRecord = record(rawSubscription);
  const subscription = rawSubscription && typeof rawSubscription === 'object'
    ? {
        id: text(subscriptionRecord.id),
        planName: text(subscriptionRecord.planName, '未命名套餐'),
        status: text(subscriptionRecord.status),
        startsAt: text(subscriptionRecord.startsAt),
        endsAt: nullableText(subscriptionRecord.endsAt),
      }
    : null;
  return {
    wallet: { available: text(wallet.available, '0') },
    subscription,
    entitlements: list(payload.entitlements, decodeEntitlement),
    features: list(payload.features, (entry) => {
      const item = record(entry);
      return {
        key: text(item.key),
        name: text(item.name, text(item.key)),
        enabled: item.enabled === true,
        reason: nullableText(item.reason),
      };
    }),
  };
}

export function decodeCommerceRedemption(value: unknown): CommerceRedemption {
  const payload = record(value);
  if (payload.ok !== true) throw new Error('invalid-redemption-response');
  return {
    ok: true,
    rewards: list(payload.rewards, (entry) => {
      const item = record(entry);
      return { type: text(item.type), label: text(item.label, '权益已到账') };
    }),
    commerce: payload.commerce && typeof payload.commerce === 'object'
      ? decodeCommerceSummary(payload.commerce)
      : null,
  };
}
