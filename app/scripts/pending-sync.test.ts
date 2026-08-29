import assert from 'node:assert/strict';
import {
  applyMemoryDelta, applySyncDelta, canClaimLocalHistory, claimLocalHistoryOwner,
  diffSyncPayload, mergeSyncPayloads, sanitizeSyncPayload,
  type SyncPayload, type SyncStorage,
} from '../src/store/pendingSync';
import { createPendingSyncQueue } from '../src/store/pendingSyncQueue';
import { EMPTY_MEMORY } from '../src/engine/learnerMemory';
import type { MemoryItem, MemoryState } from '../src/types';

function payload(topicsMastered: number, eventIds: string[] = []): SyncPayload {
  return {
    global: {
      persona: '好奇型', learningLevel: 1, relationshipMemory: [],
      goldenAnalogies: [], topicsMastered, bestRecord: null,
    },
    events: eventIds.map((id, index) => ({
      id, t: `2026-07-18T00:00:0${index}.000Z`, type: 'checklist_hit',
      topicId: 'attention', sessionId: 'sync-test', payload: {}, evidence: id,
    })),
    reports: [],
  };
}

function memoryStorage(): { storage: SyncStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      get length() { return values.size; },
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
      key: (index) => [...values.keys()][index] ?? null,
    },
  };
}

const shared = memoryStorage();
const firstTab = createPendingSyncQueue(shared.storage);
const secondTab = createPendingSyncQueue(shared.storage);
const base = payload(0);
assert.equal(canClaimLocalHistory(true, null, false, 'Teacher'), true,
  '首次同步的未归属本地历史必须允许当前账号认领');
assert.equal(canClaimLocalHistory(true, null, true, 'Teacher'), false,
  '归属标记存在但账号键缺失时不得把旧历史当作首次迁移');
assert.equal(canClaimLocalHistory(true, '', false, 'Teacher'), false, '空账号标记不得被当作首次迁移');
assert.equal(canClaimLocalHistory(true, 'teacher', true, 'Teacher'), true, '账号归属比较应忽略大小写');
assert.equal(canClaimLocalHistory(true, 'Other', true, 'Teacher'), false, '明确属于其他账号时必须拒绝认领');
assert.equal(canClaimLocalHistory(false, null, false, 'Teacher'), false, '存储不可读时必须保持 fail-closed');
const ownerStorage = memoryStorage();
assert.equal(claimLocalHistoryOwner(ownerStorage.storage, 'owner', 'marker', 'Teacher'), true,
  '首次认领必须先可靠写入归属标记');
assert.equal(ownerStorage.values.get('owner'), 'Teacher');
assert.equal(ownerStorage.values.get('marker'), '1');
ownerStorage.values.delete('owner');
assert.equal(claimLocalHistoryOwner(ownerStorage.storage, 'owner', 'marker', 'Other'), false,
  '归属键被单独删除时不得把旧历史认给其他账号');
ownerStorage.values.set('marker', 'corrupted');
assert.equal(claimLocalHistoryOwner(ownerStorage.storage, 'owner', 'marker', 'Other'), false,
  '非规范但存在的归属标记也必须保持 fail-closed');
assert.equal(claimLocalHistoryOwner({
  getItem: () => null,
  setItem: () => { throw new Error('quota'); },
}, 'owner', 'marker', 'Teacher'), false, '首次归属写入失败必须保持 fail-closed');
firstTab.capture('Teacher', base, payload(1, ['from-a']));
secondTab.capture('teacher', base, payload(0, ['from-b']));
const concurrent = firstTab.list('TEACHER');
assert.equal(concurrent.length, 2, '多页签操作必须各占独立存储键');
const combined = concurrent.reduce((state, operation) => applySyncDelta(state, operation.delta), base);
assert.deepEqual(combined.events.map((event) => event.id).sort(), ['from-a', 'from-b']);
assert.equal(combined.global.topicsMastered, 1, '旧页签无关操作不得回滚全局状态');

const reloaded = createPendingSyncQueue(shared.storage);
assert.equal(reloaded.list('teacher').length, 2, '刷新后待推操作必须保留');
const requested = reloaded.list('teacher');
const later = secondTab.capture('teacher', payload(0, ['from-b']), payload(0, ['from-b', 'later']));
assert.ok(later);
reloaded.clear('teacher', requested.map((operation) => operation.id));
assert.deepEqual(firstTab.list('teacher').map((operation) => operation.id), [later.id],
  '成功响应只能清除它实际发出的操作');

const resetStorage = memoryStorage();
const resetTab = createPendingSyncQueue(resetStorage.storage);
const staleTab = createPendingSyncQueue(resetStorage.storage);
const beforeReset = payload(1, ['old']);
resetTab.capture('Reset', payload(0), beforeReset);
resetTab.capture('Reset', beforeReset, payload(0), true);
staleTab.capture('Reset', beforeReset, payload(1, ['old', 'after-reset']));
const resetResult = resetTab.list('Reset')
  .reduce((state, operation) => applySyncDelta(state, operation.delta), payload(9, ['remote']));
assert.deepEqual(resetResult.events.map((event) => event.id), ['after-reset'],
  '清空必须覆盖远端与旧页签历史');
assert.equal(resetResult.global.topicsMastered, 0);

const claimStorage = memoryStorage();
const claimTab = createPendingSyncQueue(claimStorage.storage);
claimTab.capture('Claim', payload(1, ['history']), payload(2, ['history', 'after-claim']));
const claim = claimTab.prepend('Claim', { kind: 'merge', state: payload(1, ['history']) });
const claimed = claimTab.list('Claim')
  .reduce((state, operation) => applySyncDelta(state, operation.delta), payload(4, ['remote']));
assert.equal(claimTab.list('Claim')[0]?.id, claim.id, '认领基线必须排在已有操作之前');
assert.deepEqual(claimed.events.map((event) => event.id), ['remote', 'history', 'after-claim'],
  '空远端认领遇到冲突后必须合并双方历史');
assert.deepEqual(applySyncDelta(claimed, claim.delta), claimed, '认领操作重放必须幂等');
claimTab.capture('Claim', claimed, payload(0), true);
const claimedThenReset = claimTab.list('Claim')
  .reduce((state, operation) => applySyncDelta(state, operation.delta), payload(4, ['remote']));
assert.deepEqual(claimedThenReset, payload(0), '认领之后的清空操作必须保持最终优先级');

const isolated = resetTab.capture('Other', payload(0), payload(3, ['other']));
assert.ok(isolated);
assert.equal(resetTab.list('Reset').some((operation) => operation.id === isolated.id), false,
  '不同账号的操作不得串档');

const corrupted = memoryStorage();
corrupted.values.set('xiaobai-sync-op-v2:broken:bad-object', '{}');
corrupted.values.set('xiaobai-sync-op-v2:broken:bad-array', '[]');
const recovering = createPendingSyncQueue(corrupted.storage);
assert.deepEqual(recovering.list('broken'), [], '损坏的持久操作必须可恢复地丢弃');
assert.equal(corrupted.values.size, 0, '损坏键应被清理，避免每次启动重试');

const malformed = memoryStorage();
const malformedWriter = createPendingSyncQueue(malformed.storage);
malformedWriter.capture('Malformed', payload(0), payload(1, ['event']));
const [validKey, validRaw] = [...malformed.values.entries()][0];
const badScalar = JSON.parse(validRaw) as { delta: { global: { topicsMastered: unknown } } };
badScalar.delta.global.topicsMastered = 'oops';
malformed.values.set(validKey, JSON.stringify(badScalar));
assert.deepEqual(createPendingSyncQueue(malformed.storage).list('Malformed'), [],
  '非法全局标量不得进入同步状态');
assert.equal(malformed.values.size, 0);

const sanitized = sanitizeSyncPayload({
  global: {
    persona: 7, learningLevel: 99, relationshipMemory: ['ok', 3], goldenAnalogies: [{}],
    topicsMastered: Number.NaN, bestRecord: {},
  },
  events: [{}], reports: [{}],
} as unknown as Partial<SyncPayload>, payload(0).global);
assert.deepEqual(sanitized.global, payload(0).global, '畸形远端全局字段必须回退到安全默认值');
assert.deepEqual(sanitized.events, [], '畸形远端事件必须丢弃');
assert.deepEqual(sanitized.reports, [], '畸形远端报告必须丢弃');

const mismatched = memoryStorage();
const mismatchWriter = createPendingSyncQueue(mismatched.storage);
mismatchWriter.capture('Mismatch', payload(0), payload(1, ['event']));
const [[operationKey, operationRaw]] = [...mismatched.values.entries()];
mismatched.values.delete(operationKey);
mismatched.values.set(`${operationKey}-wrong`, operationRaw);
assert.deepEqual(createPendingSyncQueue(mismatched.storage).list('Mismatch'), [],
  '存储键后缀与操作 id 错配时必须清理');
assert.equal(mismatched.values.size, 0);

const blockedStorage: SyncStorage = {
  get length() { throw new Error('blocked'); },
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
  key: () => { throw new Error('blocked'); },
};
const fallback = createPendingSyncQueue(blockedStorage);
const fallbackOperation = fallback.capture('Offline', payload(0), payload(3, ['offline']));
assert.ok(fallbackOperation);
assert.equal(fallback.list('Offline')[0]?.id, fallbackOperation.id,
  '存储受限时本页仍不丢待推操作');

const firstDelta = diffSyncPayload(payload(0), payload(1, ['first']));
const secondDelta = diffSyncPayload(payload(1, ['first']), payload(2, ['first', 'retry']));
assert.ok(firstDelta && secondDelta);
const afterRetry = applySyncDelta(applySyncDelta(payload(9, ['remote']), firstDelta), secondDelta);
assert.deepEqual(afterRetry.events.map((event) => event.id), ['remote', 'first', 'retry']);
assert.equal(afterRetry.global.topicsMastered, 9, '已含本地变更的远端计数不得被重试叠加');
assert.deepEqual(firstDelta && applySyncDelta(afterRetry, firstDelta), afterRetry,
  '同一操作在丢失响应后重放必须幂等');

// ── 学伴记忆切片:补丁保留、新者胜合并、净化、坏补丁拦截、重放幂等 ──
const T0 = '2026-08-10T00:00:00.000Z';
const T1 = '2026-08-12T00:00:00.000Z';
const memItem = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'mem-analogy', kind: 'habit', scope: {}, text: '先生讲课爱打比方', source: 'observed', dedupeKey: 'analogy',
  confidence: 0.8, evidence: ['e1'], createdAt: T0, updatedAt: T0, lastSeenAt: T0, seenCount: 1,
  pinned: false, muted: false, ...over,
});
const memState = (items: MemoryItem[], paused = false): MemoryState => ({ items, profile: null, paused, version: 1 });
const withMemory = { ...payload(0), memory: memState([memItem()]) };
const memoryPatch = diffSyncPayload(payload(0), withMemory);
assert.ok(memoryPatch && memoryPatch.kind === 'patch' && memoryPatch.memory?.items?.upsert.length === 1,
  '记忆切片变化必须进入补丁');
const patched = applySyncDelta(payload(0), memoryPatch);
assert.deepEqual(patched.memory, withMemory.memory, '补丁应用后必须保留记忆切片');
assert.deepEqual(applySyncDelta(patched, memoryPatch), patched, '记忆补丁重放必须幂等');
assert.equal('memory' in applySyncDelta(payload(0), diffSyncPayload(payload(0), payload(1, ['x']))!), false,
  '无记忆基线与无记忆补丁不得凭空补键');
const staleMuted = { ...payload(0), memory: memState([memItem({ muted: true, updatedAt: T0 })]) };
const freshUnmuted = { ...payload(0), memory: memState([memItem({ muted: false, updatedAt: T1 })]) };
const mergedMemory = mergeSyncPayloads(freshUnmuted, staleMuted).memory;
assert.ok(mergedMemory && mergedMemory.items[0].muted === false && mergedMemory.items[0].updatedAt === T1,
  '合并按 updatedAt 新者胜:本地取消隐藏必须压过远端旧的隐藏');
const tiePinned = mergeSyncPayloads(
  { ...payload(0), memory: memState([memItem({ pinned: false })]) },
  { ...payload(0), memory: memState([memItem({ pinned: true })]) },
).memory;
assert.ok(tiePinned && tiePinned.items[0].pinned === true, '同时间平手取固定者');
const unmuteDelta = diffSyncPayload(staleMuted, freshUnmuted);
assert.ok(unmuteDelta && unmuteDelta.kind === 'patch' && unmuteDelta.memory?.items?.upsert[0]?.muted === false,
  '取消隐藏(同 id 换 updatedAt)必须作为 upsert 进入补丁');
assert.equal(applySyncDelta(applySyncDelta(payload(0), memoryPatch), unmuteDelta).memory?.items[0].muted, false,
  '较新的 upsert 必须覆盖旧条目');
assert.equal(applySyncDelta(freshUnmuted, diffSyncPayload(payload(0), staleMuted)!).memory?.items[0].muted, false,
  '较旧的 upsert 不得覆盖新条目');
const sanitizedMemory = sanitizeSyncPayload({
  ...payload(0), memory: { items: [{}], paused: 'x' },
} as unknown as Partial<SyncPayload>, payload(0).global);
assert.deepEqual(sanitizedMemory.memory, EMPTY_MEMORY, '条目畸形但切片成形的远端记忆:丢条目、归安全值');
assert.equal(sanitizeSyncPayload({ ...payload(0), memory: 'x' } as unknown as Partial<SyncPayload>, payload(0).global).memory,
  undefined, '整体畸形的远端记忆键视同缺失(交给拉档方从事件流回填),不得落成空切片盖掉本地');
// 先生固定+隐藏(T1) vs 另一台设备后台「又见到一次」(updatedAt 不变、lastSeenAt 更新):意图字段不得丢
const T2 = '2026-08-14T00:00:00.000Z';
const pinnedLocal = memItem({ pinned: true, muted: true, updatedAt: T1 });
const seenRemote = memItem({ lastSeenAt: T2, seenCount: 2, confidence: 0.95, evidence: ['e1', 'e2'] });
const replayed = applyMemoryDelta(memState([seenRemote]), { items: { upsert: [pinnedLocal], remove: [] } }).items[0];
assert.ok(replayed.pinned && replayed.muted && replayed.lastSeenAt === T2 && replayed.seenCount === 2
  && replayed.confidence === 0.95 && replayed.evidence.length === 2,
  '补丁重放:固定/隐藏取 updatedAt 新者,观察字段两边取大');
const mergedIntent = mergeSyncPayloads(
  { ...payload(0), memory: memState([seenRemote]) }, { ...payload(0), memory: memState([pinnedLocal]) },
).memory!.items[0];
assert.ok(mergedIntent.pinned && mergedIntent.muted && mergedIntent.lastSeenAt === T2, '409 合并同样不丢固定/隐藏');
assert.equal('memory' in sanitizeSyncPayload(payload(0), payload(0).global), false,
  '远端没有记忆键时净化不得补键(留给拉档方回填)');
const badMemory = memoryStorage();
const badMemoryWriter = createPendingSyncQueue(badMemory.storage);
badMemoryWriter.capture('BadMemory', payload(0), withMemory);
const [badKey, badRaw] = [...badMemory.values.entries()][0];
const corruptMemory = JSON.parse(badRaw) as { delta: { memory: { items: { upsert: unknown[] } } } };
corruptMemory.delta.memory.items.upsert = [{ id: 'x', kind: 'alien' }];
badMemory.values.set(badKey, JSON.stringify(corruptMemory));
assert.deepEqual(createPendingSyncQueue(badMemory.storage).list('BadMemory'), [],
  '畸形记忆补丁不得从本地队列回流');
assert.equal(badMemory.values.size, 0);

console.log('pending sync operation log: 57 assertions passed');
