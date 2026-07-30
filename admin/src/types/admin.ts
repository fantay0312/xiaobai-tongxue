export type Identifier = string

export type Permission =
  | '*'
  | 'overview.read'
  | 'users.read'
  | 'users.restrict'
  | 'plans.read'
  | 'plans.write'
  | 'entitlements.read'
  | 'entitlements.write'
  | 'features.read'
  | 'features.write'
  | 'subscriptions.read'
  | 'subscriptions.write'
  | 'points.read'
  | 'points.adjust'
  | 'cdk.read'
  | 'cdk.write'
  | 'team.read'
  | 'team.roles'
  | 'audit.read'
  | (string & {})
export interface AdminSession {
  id: Identifier
  email: string
  displayName: string
  roleId: Identifier
  roleName: string
  permissions: Permission[]
  isOwner: boolean
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Metric {
  key: string
  label: string
  value: string
  delta?: number
  note?: string
}

export interface OverviewData {
  generatedAt: string
  metrics: Metric[]
  alerts: Array<{
    id: Identifier
    level: 'info' | 'warning' | 'critical'
    title: string
    detail: string
    href?: string
  }>
  recentActions: AuditEvent[]
}

export type UserStatus = 'active' | 'banned' | 'pending' | 'deleted'

export interface UserSubscription {
  id: Identifier
  planId: Identifier
  planName: string
  status: 'active' | 'paused' | 'cancelled' | 'expired'
  startsAt: string
  expiresAt?: string
  source: 'purchase' | 'admin' | 'cdk' | 'system'
}

export interface ManagedSubscription {
  id: Identifier
  userId: Identifier
  username: string
  planId: Identifier
  planName: string
  planCode: string
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'revoked'
  source: 'admin' | 'cdk' | 'payment' | 'system'
  startsAt: string
  endsAt?: string
  createdAt: string
}

export interface AdminUser {
  id: Identifier
  username: string
  email?: string
  displayName: string
  status: UserStatus
  pointsBalance?: string
  subscription?: UserSubscription
  restrictions: UserRestriction[]
  createdAt: string
  lastActiveAt?: string
}

export interface UserRestriction {
  id: Identifier
  scope: string
  reason: string
  publicReason?: string
  startsAt: string
  expiresAt?: string
}

export type PlanStatus = 'draft' | 'active' | 'archived'
export type BillingCycle = 'free' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'custom'

export interface PlanPrice {
  id?: Identifier
  currency: string
  amountMinor: string
  billingPeriod: BillingCycle
  durationDays?: number
  bonusPoints: string
}

export interface SubscriptionPlan {
  id: Identifier
  code: string
  name: string
  tagline: string
  description: string
  status: PlanStatus
  version: number
  versionNumber: number
  prices: PlanPrice[]
  entitlementKeys: string[]
  subscriberCount?: number
  updatedAt: string
}

export interface PlanInput {
  code: string
  name: string
  tagline: string
  description: string
  prices: PlanPrice[]
  entitlements: Array<{ key: string; value: unknown }>
}

export interface Entitlement {
  id: Identifier
  key: string
  name: string
  description: string
  valueType: 'boolean' | 'integer' | 'string' | 'json'
  defaultValue: boolean | string
  status: 'active' | 'archived'
  version: number
  updatedAt: string
}

export interface FeatureFlag {
  id: Identifier
  key: string
  name: string
  description: string
  enabled: boolean
  requiredEntitlementKey?: string
  publicReason: string
  config: Record<string, unknown>
  version: number
  updatedAt: string
}

export interface PointWallet {
  id: Identifier
  userId: Identifier
  available: string
  version: string
}

export interface PointsResult extends PageResult<LedgerEntry> {
  wallet: PointWallet | null
}

export type LedgerDirection = 'credit' | 'debit'
export type LedgerSource =
  | 'admin_adjustment'
  | 'cdk_redeem'
  | 'subscription_bonus'
  | 'consumption'
  | 'refund'
  | 'expiry'

export interface LedgerEntry {
  id: Identifier
  userId: Identifier
  direction: LedgerDirection
  amount: string
  balanceAfter: string
  source: LedgerSource
  reason: string
  reference?: string
  operatorEmail?: string
  createdAt: string
}

export interface PointAdjustmentInput {
  userId: Identifier
  direction: LedgerDirection
  amount: string
  reason: string
  reference?: string
  idempotencyKey: string
}

export interface CdkBenefit {
  type: 'points' | 'subscription' | 'entitlement'
  value: string
  label?: string
  durationDays?: number
}

export type CampaignStatus = 'active' | 'revoked' | 'completed'

export interface CdkCampaign {
  id: Identifier
  name: string
  status: CampaignStatus
  benefits: CdkBenefit[]
  generatedCount: number
  redeemedCount: number
  expiresAt?: string
  createdAt: string
}

export interface CdkCampaignInput {
  name: string
  benefits: CdkBenefit[]
  quantity: number
  expiresAt?: string
  reason: string
  idempotencyKey: string
}

export interface CdkCreationResult {
  campaign: CdkCampaign
  codes: string[]
}
export interface Operator {
  id: Identifier
  email: string
  displayName: string
  status: 'pending' | 'active' | 'suspended'
  roles: string[]
  isOwner: boolean
  lastLoginAt?: string
}

export interface PermissionDefinition {
  key: Permission
  name: string
  description: string
  group: string
  ownerOnly: boolean
}

export interface Role {
  id: Identifier
  code: string
  name: string
  description: string
  permissions: Permission[]
  system: boolean
  memberCount: number
  version: number
}

export interface Invitation {
  id: Identifier
  email: string
  roleName: string
  status: 'pending' | 'activated' | 'expired' | 'revoked'
  expiresAt: string
  createdAt: string
}

export interface AuditEvent {
  id: Identifier
  actorEmail: string
  action: string
  targetType: string
  targetId?: string
  summary: string
  reason?: string
  ipAddress?: string
  createdAt: string
}

export interface MutationReason {
  reason: string
  summary: string
}
