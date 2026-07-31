import assert from 'node:assert/strict'
import { formatInteger, formatMoney, majorToMinor, minorToMajor } from '../src/lib/format'
import { planFrom, pointsFrom, userFrom } from '../src/lib/normalizers'
import { can, ownerCan } from '../src/lib/permissions'
import { mutationKeyForDraft } from '../src/lib/idempotency'
import { invitationFrom } from '../src/lib/team-normalizers'
import { adminApi } from '../src/lib/api'
import { AUDIT_TARGET_OPTIONS } from '../src/lib/audit-targets'
import {
  cdkCreationKeyForDraft,
  clearPendingCdkCreation,
  loadPendingCdkCreation,
  localDateTimeToIso,
  savePendingCdkCreation,
  type SessionStorageLike,
} from '../src/lib/cdk-idempotency'
import { useAuthStore } from '../src/store/auth'
import type { AdminSession } from '../src/types/admin'

const session: AdminSession = {
  id: 'admin-1',
  email: 'operator@example.com',
  displayName: 'Operator',
  roleId: 'role-1',
  roleName: '运营',
  permissions: ['users.*', 'points.read'],
  isOwner: false,
}

assert.equal(can(session, 'users.read'), true)
assert.equal(can(session, 'users.ban'), true)
assert.equal(can(session, 'points.adjust'), false)
assert.equal(ownerCan(session, 'users.read'), false)
assert.deepEqual(
  AUDIT_TARGET_OPTIONS.map((option) => option.value),
  [
    'user', 'user-restriction', 'subscription-plan', 'entitlement', 'feature',
    'subscription', 'cdk-campaign', 'admin-account', 'admin-invitation', 'admin-role',
  ],
)

assert.equal(majorToMinor('19.90'), '1990')
assert.equal(majorToMinor('0.05'), '5')
assert.equal(majorToMinor('12.345'), null)
assert.equal(minorToMajor('1990'), '19.90')
assert.equal(minorToMajor('5'), '0.05')
assert.equal(formatMoney('900719925474099312', 'CNY'), '¥9,007,199,254,740,993.12')
assert.equal(formatInteger('900719925474099312'), '900,719,925,474,099,312')

const user = userFrom({ id: 'user-1', username: 'alice', disabledAt: null })
assert.equal(user.status, 'active')
assert.equal(user.email, undefined)
assert.equal(user.pointsBalance, undefined)

const plan = planFrom({
  id: 'plan-1',
  code: 'commercial',
  prices: [{ id: 'price-1', amountMinor: '900719925474099312', bonusPoints: '12' }],
})
assert.equal(plan.prices[0]?.amountMinor, '900719925474099312')

const points = pointsFrom({
  wallet: { id: 'wallet-1', userId: 'user-1', available: '900719925474099312', version: '2' },
  items: [{
    id: 'operation-1',
    targetUserId: 'user-1',
    amount: '-20',
    balanceAfter: '900719925474099292',
    operationKind: 'admin_adjustment',
    actorAdminEmail: 'owner@example.com',
  }],
  total: 1,
  page: 1,
  pageSize: 20,
})
assert.equal(points.wallet?.available, '900719925474099312')
assert.equal(points.items[0]?.direction, 'debit')
assert.equal(points.items[0]?.operatorEmail, 'owner@example.com')

let generatedKeys = 0
const generateKey = () => `key-${++generatedKeys}`
const firstDraft = mutationKeyForDraft(null, 'same-request', generateKey)
const failedRetry = mutationKeyForDraft(firstDraft, 'same-request', generateKey)
const changedDraft = mutationKeyForDraft(failedRetry, 'changed-request', generateKey)
assert.equal(failedRetry.key, firstDraft.key)
assert.notEqual(changedDraft.key, firstDraft.key)

const cdkDraft = {
  name: '开学季',
  quantity: 100,
  benefits: [{ type: 'points' as const, value: '50' }],
  reason: '运营活动',
}
const firstCdkKey = cdkCreationKeyForDraft(null, cdkDraft, generateKey)
const failedCdkRetry = cdkCreationKeyForDraft(firstCdkKey, cdkDraft, generateKey)
const editedCdkKey = cdkCreationKeyForDraft(
  failedCdkRetry,
  { ...cdkDraft, quantity: 101 },
  generateKey,
)
const resetAfterSuccess = cdkCreationKeyForDraft(null, cdkDraft, generateKey)
assert.equal(failedCdkRetry.key, firstCdkKey.key)
assert.notEqual(editedCdkKey.key, firstCdkKey.key)
assert.notEqual(resetAfterSuccess.key, firstCdkKey.key)

const storageValues = new Map<string, string>()
const memoryStorage: SessionStorageLike = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => { storageValues.delete(key) },
}
const pendingTime = 1_000_000
const storedDraft = {
  ...cdkDraft,
  expiresAt: '2030-01-02T03:04',
}
const storedPending = cdkCreationKeyForDraft(
  null,
  storedDraft,
  () => 'cdk-retry-key-0001',
  pendingTime,
)
assert.equal(savePendingCdkCreation(
  'admin-1',
  { pending: storedPending, draft: storedDraft },
  memoryStorage,
  pendingTime,
), true)
const restoredCreation = loadPendingCdkCreation('admin-1', memoryStorage, pendingTime + 1)
assert.deepEqual(restoredCreation, { pending: storedPending, draft: storedDraft })
assert.ok(restoredCreation)
const refreshRetry = cdkCreationKeyForDraft(
  restoredCreation.pending,
  restoredCreation.draft,
  () => 'unexpected-new-key',
  pendingTime + 1,
)
assert.equal(refreshRetry.key, storedPending.key)
assert.equal(refreshRetry.createdAt, storedPending.createdAt)
assert.equal(loadPendingCdkCreation('admin-2', memoryStorage, pendingTime + 1), null)
const serializedCreation = [...storageValues.values()][0] ?? ''
assert.doesNotMatch(serializedCreation, /codes|ciphertext/i)
const persistedCreation = JSON.parse(serializedCreation) as Record<string, unknown>
assert.deepEqual(Object.keys(persistedCreation).sort(), ['draft', 'pending', 'schemaVersion'])
assert.equal(
  localDateTimeToIso('2030-01-02T03:04'),
  new Date(2030, 0, 2, 3, 4).toISOString(),
)
assert.equal(localDateTimeToIso('2030-02-30T03:04'), null)
assert.equal(
  loadPendingCdkCreation('admin-1', memoryStorage, pendingTime + 15 * 60_000),
  null,
)
assert.equal(storageValues.size, 0)
storageValues.set('xiaobai.admin.cdk.pending.v1:admin-1', '{bad-json')
assert.equal(loadPendingCdkCreation('admin-1', memoryStorage, pendingTime + 1), null)
assert.equal(storageValues.size, 0)
assert.equal(savePendingCdkCreation(
  'admin-1',
  { pending: storedPending, draft: storedDraft },
  memoryStorage,
  pendingTime,
), true)
clearPendingCdkCreation('admin-1', memoryStorage)
assert.equal(storageValues.size, 0)

const throwingStorage: SessionStorageLike = {
  getItem: () => { throw new Error('storage-read-blocked') },
  setItem: () => { throw new Error('storage-write-blocked') },
  removeItem: () => { throw new Error('storage-delete-blocked') },
}
assert.equal(loadPendingCdkCreation('admin-1', throwingStorage, pendingTime), null)
assert.equal(savePendingCdkCreation(
  'admin-1',
  { pending: storedPending, draft: storedDraft },
  throwingStorage,
  pendingTime,
), false)
clearPendingCdkCreation('admin-1', throwingStorage)

const storageGlobal = globalThis as typeof globalThis & { sessionStorage?: Storage }
const originalStorageDescriptor = Object.getOwnPropertyDescriptor(storageGlobal, 'sessionStorage')
try {
  Object.defineProperty(storageGlobal, 'sessionStorage', {
    configurable: true,
    get: () => { throw new Error('storage-getter-blocked') },
  })
  assert.equal(loadPendingCdkCreation('admin-1'), null)
} finally {
  if (originalStorageDescriptor) {
    Object.defineProperty(storageGlobal, 'sessionStorage', originalStorageDescriptor)
  } else {
    Reflect.deleteProperty(storageGlobal, 'sessionStorage')
  }
}

const invitation = invitationFrom({
  invitation: {
    id: 'invite-1',
    email: 'member@example.com',
    expiresAt: '2999-01-01T00:00:00.000Z',
    createdAt: '2026-07-30T00:00:00.000Z',
  },
  operator: { id: 'operator-1' },
})
assert.equal(invitation.id, 'invite-1')
assert.equal(invitation.status, 'pending')

const originalLogout = adminApi.auth.logout
useAuthStore.setState({ phase: 'ready', session, failure: undefined })
adminApi.auth.logout = async () => {
  throw new Error('network unavailable')
}
const failedLogout = await useAuthStore.getState().signOut()
assert.equal(failedLogout, false)
assert.deepEqual(useAuthStore.getState().session, session)
assert.match(useAuthStore.getState().failure ?? '', /服务器会话仍可能有效/)
adminApi.auth.logout = async () => {}
const confirmedLogout = await useAuthStore.getState().signOut()
assert.equal(confirmedLogout, true)
assert.equal(useAuthStore.getState().session, null)
assert.equal(useAuthStore.getState().failure, undefined)
adminApi.auth.logout = originalLogout

console.log('domain invariants: ok')
