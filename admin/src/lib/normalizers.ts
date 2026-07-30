import type {
  AdminSession,
  AdminUser,
  CdkBenefit,
  CdkCampaign,
  CdkCreationResult,
  Entitlement,
  FeatureFlag,
  LedgerEntry,
  ManagedSubscription,
  OverviewData,
  PageResult,
  Permission,
  PlanPrice,
  PointWallet,
  PointsResult,
  SubscriptionPlan,
} from '../types/admin'

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function dateText(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : value instanceof Date
      ? value.toISOString()
      : undefined
}

export function unwrap(payload: unknown): unknown {
  return isRecord(payload) && 'data' in payload ? payload.data : payload
}

export function pageFrom<T>(payload: unknown, normalize: (item: unknown) => T): PageResult<T> {
  const data = unwrap(payload)
  const record = isRecord(data) ? data : {}
  const rawItems = Array.isArray(data) ? data : Array.isArray(record.items) ? record.items : []
  return {
    items: rawItems.map(normalize),
    total: safeNumber(record.total, rawItems.length),
    page: safeNumber(record.page, 1),
    pageSize: safeNumber(record.pageSize, rawItems.length || 20),
  }
}

function permissionKeys(value: unknown): Permission[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (isRecord(entry) && typeof entry.key === 'string') return [entry.key]
    return []
  })
}

export function sessionFrom(payload: unknown): { session: AdminSession; csrfToken: string } {
  const data = unwrap(payload)
  if (!isRecord(data)) throw new Error('管理会话响应格式无效')
  const admin = isRecord(data.admin) ? data.admin : data
  const roles = Array.isArray(data.roles) ? data.roles.filter(isRecord) : []
  const primaryRole = roles[0]
  return {
    session: {
      id: text(admin.id),
      email: text(admin.email),
      displayName: text(admin.displayName, text(admin.email)),
      roleId: text(primaryRole?.id),
      roleName: text(primaryRole?.name, admin.isOwner === true ? '最高管理员' : '管理成员'),
      permissions: permissionKeys(data.permissions),
      isOwner: admin.isOwner === true,
    },
    csrfToken: text(data.csrfToken),
  }
}

export function overviewFrom(payload: unknown): OverviewData {
  const data = unwrap(payload)
  const counts = isRecord(data) && isRecord(data.counts) ? data.counts : {}
  const items: Array<[string, string]> = [
    ['users', '用户总数'],
    ['activeSubscriptions', '有效订阅'],
    ['pointsIssued', '累计发放积分'],
    ['cdkRedeemed', '已兑换 CDK'],
  ]
  return {
    generatedAt: new Date().toISOString(),
    metrics: items.map(([key, label]) => ({ key, label, value: text(counts[key], '0') })),
    alerts: [],
    recentActions: [],
  }
}

export function userFrom(value: unknown): AdminUser {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    username: text(item.username),
    email: typeof item.email === 'string' ? item.email : undefined,
    displayName: text(item.displayName, text(item.username)),
    status: item.disabledAt ? 'banned' : 'active',
    pointsBalance: typeof item.pointsBalance === 'string' ? item.pointsBalance : undefined,
    restrictions: Array.isArray(item.restrictions)
      ? item.restrictions.filter(isRecord).map((restriction) => ({
        id: text(restriction.id),
        scope: text(restriction.scope),
        reason: text(restriction.reason),
        publicReason: text(restriction.publicReason) || undefined,
        startsAt: text(restriction.startsAt),
        expiresAt: dateText(restriction.expiresAt),
      }))
      : [],
    createdAt: text(item.createdAt),
    lastActiveAt: dateText(item.lastActiveAt ?? item.updatedAt),
  }
}

export function subscriptionFrom(value: unknown): ManagedSubscription {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    userId: text(item.userId),
    username: text(item.username),
    planId: text(item.planId),
    planName: text(item.planName),
    planCode: text(item.planCode),
    status: text(item.status, 'active') as ManagedSubscription['status'],
    source: text(item.source, 'admin') as ManagedSubscription['source'],
    startsAt: text(item.startsAt),
    endsAt: dateText(item.endsAt),
    createdAt: text(item.createdAt),
  }
}

function priceFrom(value: unknown): PlanPrice {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id) || undefined,
    currency: text(item.currency, 'CNY'),
    amountMinor: text(item.amountMinor, '0'),
    billingPeriod: text(item.billingPeriod, 'monthly') as PlanPrice['billingPeriod'],
    durationDays: item.durationDays == null ? undefined : safeNumber(item.durationDays),
    bonusPoints: text(item.bonusPoints, '0'),
  }
}

export function planFrom(value: unknown): SubscriptionPlan {
  const item = isRecord(value) ? value : {}
  const entitlements = Array.isArray(item.entitlements) ? item.entitlements.filter(isRecord) : []
  return {
    id: text(item.id),
    code: text(item.code),
    name: text(item.name),
    tagline: text(item.tagline),
    description: text(item.description),
    status: text(item.status, 'draft') as SubscriptionPlan['status'],
    version: safeNumber(item.version, 1),
    versionNumber: safeNumber(item.versionNumber, 1),
    prices: Array.isArray(item.prices) ? item.prices.map(priceFrom) : [],
    entitlementKeys: entitlements.map((entry) => text(entry.entitlementKey)).filter(Boolean),
    updatedAt: text(item.updatedAt, text(item.createdAt)),
  }
}

export function entitlementFrom(value: unknown): Entitlement {
  const item = isRecord(value) ? value : {}
  const rawDefault = item.defaultValue
  return {
    id: text(item.id),
    key: text(item.entitlementKey, text(item.key)),
    name: text(item.name),
    description: text(item.description),
    valueType: text(item.valueType, 'boolean') as Entitlement['valueType'],
    defaultValue: typeof rawDefault === 'boolean' ? rawDefault : text(rawDefault),
    status: text(item.status, 'active') as Entitlement['status'],
    version: safeNumber(item.version, 1),
    updatedAt: text(item.updatedAt, text(item.createdAt)),
  }
}

export function featureFrom(value: unknown): FeatureFlag {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    key: text(item.featureKey, text(item.key)),
    name: text(item.name),
    description: text(item.description),
    enabled: item.enabled === true,
    requiredEntitlementKey: text(item.requiredEntitlementKey) || undefined,
    publicReason: text(item.publicReason),
    config: isRecord(item.config) ? item.config : {},
    version: safeNumber(item.version, 1),
    updatedAt: text(item.updatedAt, text(item.createdAt)),
  }
}

export function walletFrom(value: unknown): PointWallet | null {
  if (!isRecord(value)) return null
  return {
    id: text(value.id),
    userId: text(value.userId),
    available: text(value.available, '0'),
    version: text(value.version, '1'),
  }
}

export function ledgerFrom(value: unknown): LedgerEntry {
  const item = isRecord(value) ? value : {}
  const amount = text(item.amount, '0')
  const metadata = isRecord(item.metadata) ? item.metadata : {}
  return {
    id: text(item.id),
    userId: text(item.targetUserId),
    direction: amount.startsWith('-') ? 'debit' : 'credit',
    amount,
    balanceAfter: text(item.balanceAfter, '0'),
    source: text(item.operationKind, 'admin_adjustment') as LedgerEntry['source'],
    reason: text(item.reason),
    reference: text(metadata.reference) || undefined,
    operatorEmail: text(item.actorAdminEmail) || undefined,
    createdAt: text(item.createdAt),
  }
}

export function pointsFrom(payload: unknown): PointsResult {
  const data = unwrap(payload)
  const record = isRecord(data) ? data : {}
  return { wallet: walletFrom(record.wallet), ...pageFrom(record, ledgerFrom) }
}

function benefitFrom(value: unknown): CdkBenefit {
  const item = isRecord(value) ? value : {}
  const type = text(item.type, 'points') as CdkBenefit['type']
  const selected = type === 'points' ? item.amount : type === 'subscription' ? item.planId : item.key
  return {
    type,
    value: text(selected),
    label: text(item.label) || undefined,
    durationDays: item.durationDays == null ? undefined : safeNumber(item.durationDays),
  }
}

export function campaignFrom(value: unknown): CdkCampaign {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    name: text(item.name),
    status: text(item.status, 'active') as CdkCampaign['status'],
    benefits: Array.isArray(item.rewards) ? item.rewards.map(benefitFrom) : [],
    generatedCount: safeNumber(item.generatedCount, safeNumber(item.codeCount)),
    redeemedCount: safeNumber(item.redeemedCount),
    expiresAt: dateText(item.expiresAt),
    createdAt: text(item.createdAt),
  }
}

export function creationFrom(payload: unknown): CdkCreationResult {
  const data = unwrap(payload)
  const item = isRecord(data) ? data : {}
  return {
    campaign: campaignFrom(item.campaign),
    codes: Array.isArray(item.codes) ? item.codes.filter((code): code is string => typeof code === 'string') : [],
  }
}
