import type {
  CdkCampaignInput,
  Entitlement,
  FeatureFlag,
  MutationReason,
  PlanInput,
  PlanStatus,
  PointAdjustmentInput,
} from '../types/admin'
import {
  campaignFrom,
  creationFrom,
  entitlementFrom,
  featureFrom,
  overviewFrom,
  pageFrom,
  planFrom,
  pointsFrom,
  subscriptionFrom,
  userFrom,
} from './normalizers'
import {
  auditFrom,
  invitationFrom,
  operatorFrom,
  permissionFrom,
  roleFrom,
} from './team-normalizers'
import {
  ApiError,
  authenticated,
  body,
  clearCsrf,
  queryString,
  request,
} from './api-client'

export { ADMIN_API_ROOT, ApiError } from './api-client'

function entitlementValue(valueType: Entitlement['valueType'], value: boolean | string): unknown {
  if (valueType === 'boolean') return value === true || value === 'true'
  if (valueType === 'integer') {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
      throw new ApiError('整数权益值格式无效', 400, 'INVALID_ENTITLEMENT_VALUE')
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) {
      throw new ApiError('整数权益值超出安全范围', 400, 'INVALID_ENTITLEMENT_VALUE')
    }
    return parsed
  }
  if (valueType === 'json') {
    try {
      return JSON.parse(String(value))
    } catch {
      throw new ApiError('JSON 权益值格式无效', 400, 'INVALID_ENTITLEMENT_VALUE')
    }
  }
  return String(value)
}

type EntitlementWrite = Omit<Entitlement, 'id' | 'updatedAt'> & MutationReason
type FeatureWrite = Pick<
  FeatureFlag,
  'name' | 'description' | 'enabled' | 'requiredEntitlementKey' | 'publicReason' | 'config' | 'version'
> & { changeReason: string }

export const adminApi = {
  auth: {
    me: () => authenticated(request('/auth/me')),
    login: (input: { email: string; password: string }) =>
      authenticated(request('/auth/login', { method: 'POST', ...body(input) })),
    activate: (input: { token: string; displayName: string; password: string }) =>
      authenticated(request('/auth/activate', { method: 'POST', ...body(input) })),
    logout: async () => {
      await request('/auth/logout', { method: 'POST' })
      clearCsrf()
    },
  },
  overview: async () => overviewFrom(await request('/overview')),
  users: {
    list: async (filters: { query?: string; status?: string; page?: number; pageSize?: number }) =>
      pageFrom(
        await request(`/users${queryString({
          q: filters.query,
          status: filters.status,
          page: filters.page,
          pageSize: filters.pageSize,
        })}`),
        userFrom,
      ),
    status: async (
      id: string,
      input: { status: 'active' | 'banned'; reason: string; summary: string },
    ) => userFrom(await request(`/users/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      ...body({ disabled: input.status === 'banned', reason: input.reason }),
    })),
    assignSubscription: (
      id: string,
      input: {
        planId: string
        priceId?: string
        startsAt: string
        expiresAt?: string
        reason: string
        idempotencyKey: string
        summary: string
      },
    ) => request('/subscriptions', {
      method: 'POST',
      ...body({
        userId: id,
        planId: input.planId,
        priceId: input.priceId,
        startsAt: input.startsAt,
        endsAt: input.expiresAt,
        status: 'active',
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      }),
    }),
  },
  subscriptions: {
    list: async (filters: { userId?: string; page?: number; pageSize?: number }) =>
      pageFrom(
        await request(`/subscriptions${queryString(filters)}`),
        subscriptionFrom,
      ),
    update: (id: string, input: { status: string; endsAt?: string; reason: string }) =>
      request(`/subscriptions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        ...body(input),
      }),
  },
  plans: {
    list: async () => pageFrom(await request('/plans'), planFrom),
    create: async (input: PlanInput & MutationReason) =>
      planFrom(await request('/plans', {
        method: 'POST',
        ...body({ ...input, status: 'draft' }),
      })),
    update: async (
      id: string,
      input: PlanInput & MutationReason & { version: number; status?: PlanStatus },
    ) => planFrom(await request(`/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...body(input),
    })),
    publish: async (
      id: string,
      input: PlanInput & MutationReason & { version: number },
    ) => planFrom(await request(`/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...body({ ...input, status: 'active' }),
    })),
  },
  entitlements: {
    list: async () => pageFrom(await request('/entitlements'), entitlementFrom),
    create: async (input: EntitlementWrite) =>
      entitlementFrom(await request('/entitlements', {
        method: 'POST',
        ...body({
          key: input.key,
          name: input.name,
          description: input.description,
          valueType: input.valueType,
          defaultValue: entitlementValue(input.valueType, input.defaultValue),
          reason: input.reason,
        }),
      })),
    update: async (id: string, input: EntitlementWrite) =>
      entitlementFrom(await request(`/entitlements/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        ...body({
          name: input.name,
          description: input.description,
          valueType: input.valueType,
          defaultValue: entitlementValue(input.valueType, input.defaultValue),
          status: input.status,
          version: input.version,
          reason: input.reason,
        }),
      })),
  },
  features: {
    list: async () => pageFrom(await request('/features'), featureFrom),
    update: async (key: string, input: FeatureWrite) =>
      featureFrom(await request(`/features/${encodeURIComponent(key)}`, {
        method: 'PUT',
        ...body(input),
      })),
  },
  points: {
    get: async (filters: { userId: string; page?: number; pageSize?: number }) =>
      pointsFrom(await request(`/points${queryString(filters)}`)),
    adjust: (input: PointAdjustmentInput) =>
      request('/points/adjustments', {
        method: 'POST',
        ...body({
          userId: input.userId,
          amount: input.direction === 'debit' ? `-${input.amount.replace(/^-/, '')}` : input.amount,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          metadata: input.reference ? { reference: input.reference } : {},
        }),
      }),
  },
  cdk: {
    campaigns: async () => pageFrom(await request('/cdk/campaigns'), campaignFrom),
    createCampaign: async (input: CdkCampaignInput) =>
      creationFrom(await request('/cdk/campaigns', {
        method: 'POST',
        ...body({
          name: input.name,
          quantity: input.quantity,
          expiresAt: input.expiresAt,
          rewards: input.benefits.map((benefit) => {
            if (benefit.type === 'points') {
              return { type: 'points', amount: benefit.value, label: benefit.label }
            }
            if (benefit.type === 'subscription') {
              return {
                type: 'subscription',
                planId: benefit.value,
                durationDays: benefit.durationDays,
                label: benefit.label,
              }
            }
            return { type: 'entitlement', key: benefit.value, value: true, label: benefit.label }
          }),
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        }),
      })),
    revoke: async (id: string, input: { reason: string }) =>
      campaignFrom(await request(`/cdk/campaigns/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        ...body(input),
      })),
  },
  access: {
    operators: async () => pageFrom(await request('/team/operators'), operatorFrom),
    roles: async () => pageFrom(await request('/team/roles'), roleFrom),
    permissions: async () => pageFrom(await request('/team/permissions'), permissionFrom),
    invitations: async () => pageFrom(await request('/team/invitations'), invitationFrom),
    invite: async (input: { email: string; displayName?: string; roleIds: string[]; reason: string }) =>
      invitationFrom(await request('/team/invitations', { method: 'POST', ...body(input) })),
    resendInvitation: async (id: string, reason: string) =>
      invitationFrom(await request(`/team/invitations/${encodeURIComponent(id)}/resend`, {
        method: 'POST',
        ...body({ reason }),
      })),
    updateOperator: async (
      id: string,
      input: { status: 'pending' | 'active' | 'suspended'; reason: string },
    ) => operatorFrom(await request(`/team/operators/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      ...body({ status: input.status, reason: input.reason }),
    })),
    assignOperatorRoles: (id: string, roleIds: string[], reason: string) =>
      request(`/team/operators/${encodeURIComponent(id)}/roles`, {
        method: 'POST',
        ...body({ roleIds, reason }),
      }),
    updateRole: async (
      id: string,
      input: {
        name: string
        description: string
        permissionKeys: string[]
        version: number
        reason: string
      },
    ) => roleFrom(await request(`/team/roles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...body(input),
    })),
    createRole: async (input: {
      code: string
      name: string
      description: string
      permissionKeys: string[]
      reason: string
    }) => roleFrom(await request('/team/roles', { method: 'POST', ...body(input) })),
  },
  audit: async (filters: {
    actor?: string
    action?: string
    targetType?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }) => pageFrom(await request(`/audit${queryString(filters)}`), auditFrom),
}
