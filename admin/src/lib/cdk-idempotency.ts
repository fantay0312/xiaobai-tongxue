import type { CdkBenefit } from '../types/admin'
import { mutationKeyForDraft, type PendingMutation } from './idempotency'

const STORAGE_PREFIX = 'xiaobai.admin.cdk.pending.v1'
const PENDING_TTL_MS = 15 * 60_000
const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

export interface CdkCreationDraft {
  name: string
  quantity: number
  benefits: CdkBenefit[]
  expiresAt?: string
  reason: string
}

export interface PendingCdkCreation extends PendingMutation {
  createdAt: number
}

export interface StoredCdkCreation {
  pending: PendingCdkCreation
  draft: CdkCreationDraft
}

export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): SessionStorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function storageKey(adminId: string): string | null {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(adminId)
    ? `${STORAGE_PREFIX}:${adminId}`
    : null
}

function benefitFrom(value: unknown): CdkBenefit | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (!['points', 'subscription', 'entitlement'].includes(String(item.type))
    || typeof item.value !== 'string' || !item.value || item.value.length > 200) return null
  if (item.label !== undefined
    && (typeof item.label !== 'string' || item.label.length > 160)) return null
  if (item.durationDays !== undefined
    && (typeof item.durationDays !== 'number'
      || !Number.isSafeInteger(item.durationDays)
      || item.durationDays < 1 || item.durationDays > 3_650)) return null
  return {
    type: item.type as CdkBenefit['type'],
    value: item.value,
    ...(typeof item.label === 'string' ? { label: item.label } : {}),
    ...(typeof item.durationDays === 'number' ? { durationDays: item.durationDays } : {}),
  }
}

function draftFrom(value: unknown): CdkCreationDraft | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const benefits = Array.isArray(item.benefits) ? item.benefits.map(benefitFrom) : []
  if (typeof item.name !== 'string' || !item.name || item.name.length > 160
    || typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity)
    || item.quantity < 1 || item.quantity > 10_000 || benefits.some((benefit) => !benefit)
    || benefits.length < 1 || benefits.length > 50
    || typeof item.reason !== 'string' || !item.reason || item.reason.length > 500
    || (item.expiresAt !== undefined
      && (typeof item.expiresAt !== 'string' || !localDateTimeToIso(item.expiresAt)))) return null
  return {
    name: item.name,
    quantity: Number(item.quantity),
    benefits: benefits as CdkBenefit[],
    ...(typeof item.expiresAt === 'string' ? { expiresAt: item.expiresAt } : {}),
    reason: item.reason,
  }
}

function draftFingerprint(draft: CdkCreationDraft): string {
  return JSON.stringify({
    name: draft.name,
    quantity: draft.quantity,
    benefits: draft.benefits.map((benefit) => ({
      type: benefit.type,
      value: benefit.value,
      ...(benefit.label === undefined ? {} : { label: benefit.label }),
      ...(benefit.durationDays === undefined ? {} : { durationDays: benefit.durationDays }),
    })),
    ...(draft.expiresAt === undefined ? {} : { expiresAt: draft.expiresAt }),
    reason: draft.reason,
  })
}

function pendingFrom(value: unknown, draft: CdkCreationDraft): PendingCdkCreation | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.key !== 'string' || !KEY_PATTERN.test(item.key)
    || typeof item.fingerprint !== 'string'
    || item.fingerprint !== draftFingerprint(draft)
    || !Number.isSafeInteger(item.createdAt)) return null
  return {
    key: item.key,
    fingerprint: item.fingerprint,
    createdAt: Number(item.createdAt),
  }
}

export function cdkCreationKeyForDraft(
  current: PendingCdkCreation | null,
  draft: CdkCreationDraft,
  generate?: () => string,
  now = Date.now(),
): PendingCdkCreation {
  const selected = mutationKeyForDraft(current, draftFingerprint(draft), generate)
  if (selected === current) return current
  return { ...selected, createdAt: now }
}

export function savePendingCdkCreation(
  adminId: string,
  value: StoredCdkCreation,
  storage: SessionStorageLike | null = browserStorage(),
  now = Date.now(),
): boolean {
  const key = storageKey(adminId)
  const draft = draftFrom(value.draft)
  const pending = draft ? pendingFrom(value.pending, draft) : null
  if (!key || !storage || !draft || !pending || now < pending.createdAt
    || now - pending.createdAt >= PENDING_TTL_MS) {
    clearPendingCdkCreation(adminId, storage)
    return false
  }
  try {
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, pending, draft }))
    return true
  } catch {
    return false
  }
}

export function loadPendingCdkCreation(
  adminId: string,
  storage: SessionStorageLike | null = browserStorage(),
  now = Date.now(),
): StoredCdkCreation | null {
  const key = storageKey(adminId)
  if (!key || !storage) return null
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? 'null')
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid-pending-cdk')
    const record = parsed as Record<string, unknown>
    const draft = draftFrom(record.draft)
    const pending = draft ? pendingFrom(record.pending, draft) : null
    if (record.schemaVersion !== 1 || !draft || !pending
      || now < pending.createdAt || now - pending.createdAt >= PENDING_TTL_MS) {
      throw new Error('invalid-pending-cdk')
    }
    return { pending, draft }
  } catch {
    clearPendingCdkCreation(adminId, storage)
    return null
  }
}

export function clearPendingCdkCreation(
  adminId: string,
  storage: SessionStorageLike | null = browserStorage(),
): void {
  const key = storageKey(adminId)
  try {
    if (key) storage?.removeItem(key)
  } catch {
    // Storage can be disabled by browser policy; CDK creation still remains functional.
  }
}

export function localDateTimeToIso(value: string): string | null {
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second = '0'] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
  if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1
    || date.getDate() !== parts[2] || date.getHours() !== parts[3]
    || date.getMinutes() !== parts[4] || date.getSeconds() !== parts[5]) return null
  return date.toISOString()
}
