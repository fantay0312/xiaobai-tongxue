import type {
  AuditEvent,
  Invitation,
  Operator,
  Permission,
  PermissionDefinition,
  Role,
} from '../types/admin'
import { isRecord, unwrap } from './normalizers'

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value)
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function permissionFrom(value: unknown): PermissionDefinition {
  const item = isRecord(value) ? value : {}
  const key = text(item.key) as Permission
  return {
    key,
    name: text(item.name, key),
    description: text(item.description),
    group: key.split('.')[0] ?? 'other',
    ownerOnly: false,
  }
}

export function roleFrom(value: unknown): Role {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    code: text(item.code),
    name: text(item.name),
    description: text(item.description),
    permissions: stringList(item.permissionKeys),
    system: item.isSystem === true,
    memberCount: safeNumber(item.memberCount),
    version: safeNumber(item.version, 1),
  }
}

export function operatorFrom(value: unknown): Operator {
  const item = isRecord(value) ? value : {}
  return {
    id: text(item.id),
    email: text(item.email),
    displayName: text(item.displayName, text(item.email)),
    status: text(item.status, 'pending') as Operator['status'],
    roles: stringList(item.roles),
    isOwner: item.isOwner === true,
    lastLoginAt: text(item.lastLoginAt) || undefined,
  }
}

export function invitationFrom(value: unknown): Invitation {
  const payload = unwrap(value)
  const outer = isRecord(payload) ? payload : {}
  const item = isRecord(outer.invitation) ? outer.invitation : outer
  const now = Date.now()
  const expiresAt = text(item.expiresAt)
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false
  const status: Invitation['status'] = item.revokedAt
    ? 'revoked'
    : item.consumedAt
      ? 'activated'
      : expired
        ? 'expired'
        : 'pending'
  return {
    id: text(item.id),
    email: text(item.email),
    roleName: '预设角色已写入席位',
    status,
    expiresAt,
    createdAt: text(item.createdAt),
  }
}

export function auditFrom(value: unknown): AuditEvent {
  const item = isRecord(value) ? value : {}
  const details = isRecord(item.details) ? item.details : {}
  const summaryParts = [
    text(item.action),
    text(item.outcome),
    text(details.scope),
  ].filter(Boolean)
  return {
    id: text(item.id),
    actorEmail: text(item.actorEmail, '系统任务'),
    action: text(item.action),
    targetType: text(item.targetType, 'system'),
    targetId: text(item.targetId) || undefined,
    summary: summaryParts.join(' · '),
    reason: text(details.reason) || undefined,
    ipAddress: undefined,
    createdAt: text(item.occurredAt, text(item.createdAt)),
  }
}
