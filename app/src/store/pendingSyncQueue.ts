import {
  diffSyncPayload,
  isSyncAnalogy,
  isSyncEvent,
  isSyncPayload,
  isSyncReport,
  type PendingSyncOperation,
  type SyncPayload,
  type SyncPayloadDelta,
  type SyncStorage,
} from './pendingSync';

const KEY_PREFIX = 'xiaobai-sync-op-v2:';
const PERSONAS = new Set(['好奇型', '严谨型', '杠精型']);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function isCollection<T>(
  value: unknown, itemGuard: (item: unknown) => item is T,
): value is { upsert: T[]; remove: string[] } {
  return object(value) && Array.isArray(value.upsert) && value.upsert.every(itemGuard)
    && strings(value.remove);
}

function validGlobalPatch(global: Record<string, unknown>): boolean {
  if (global.persona !== undefined && !PERSONAS.has(String(global.persona))) return false;
  if (global.learningLevel !== undefined && (!Number.isInteger(global.learningLevel)
    || Number(global.learningLevel) < 1 || Number(global.learningLevel) > 5)) return false;
  if (global.topicsMastered !== undefined && (!Number.isInteger(global.topicsMastered)
    || Number(global.topicsMastered) < 0)) return false;
  if (global.bestRecord !== undefined && global.bestRecord !== null
    && typeof global.bestRecord !== 'string') return false;
  if (global.relationshipMemory !== undefined
    && !isCollection(global.relationshipMemory, (item): item is string => typeof item === 'string')) return false;
  return global.goldenAnalogies === undefined || isCollection(global.goldenAnalogies, isSyncAnalogy);
}

function isDelta(value: unknown): value is SyncPayloadDelta {
  if (!object(value)) return false;
  if (value.kind === 'replace' || value.kind === 'merge') return isSyncPayload(value.state);
  if (value.kind !== 'patch' || !object(value.global) || !validGlobalPatch(value.global)) return false;
  return (value.events === null || isCollection(value.events, isSyncEvent))
    && (value.reports === null || isCollection(value.reports, isSyncReport));
}

function parseOperation(raw: string | null, expectedId: string): PendingSyncOperation | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.id !== expectedId || !value.id
      || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 1
      || typeof value.sourceId !== 'string' || !value.sourceId || !isDelta(value.delta)) return null;
    return value as unknown as PendingSyncOperation;
  } catch { return null; }
}

function browserStorage(): SyncStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function accountPrefix(user: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(user.trim().toLowerCase())}:`;
}

/** 每次变化独占一个 key，避免多页签对单槽非原子读改写。 */
export function createPendingSyncQueue(storage: SyncStorage | null = browserStorage()) {
  const sourceId = uid();
  const memory = new Map<string, Map<string, PendingSyncOperation>>();
  const persisted = new Set<string>();
  let logicalClock = Date.now();

  const list = (user: string): PendingSyncOperation[] => {
    const prefix = accountPrefix(user);
    const account = memory.get(prefix) ?? new Map<string, PendingSyncOperation>();
    memory.set(prefix, account);
    try {
      const keys = Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index) ?? null);
      const storedIds = new Set<string>();
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue;
        const expectedId = key.slice(prefix.length);
        const operation = parseOperation(storage?.getItem(key) ?? null, expectedId);
        if (operation) {
          account.set(operation.id, operation);
          persisted.add(key);
          storedIds.add(operation.id);
        } else storage?.removeItem(key);
      }
      for (const id of account.keys()) {
        if (persisted.has(`${prefix}${id}`) && !storedIds.has(id)) account.delete(id);
      }
    } catch { /* 存储受限时用本页内存队列 */ }
    return [...account.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  };

  const append = (
    user: string, delta: SyncPayloadDelta, afterCreatedAt = 0,
  ): PendingSyncOperation => {
    const prefix = accountPrefix(user);
    const observedTime = Math.max(0, ...list(user).map((operation) => operation.createdAt));
    logicalClock = Math.max(Date.now(), logicalClock + 1, observedTime + 1, afterCreatedAt + 1);
    const operation = { id: uid(), createdAt: logicalClock, sourceId, delta };
    const account = memory.get(prefix) ?? new Map<string, PendingSyncOperation>();
    account.set(operation.id, operation);
    memory.set(prefix, account);
    try {
      storage?.setItem(`${prefix}${operation.id}`, JSON.stringify(operation));
      persisted.add(`${prefix}${operation.id}`);
    } catch { /* 内存兜底 */ }
    return operation;
  };

  const prepend = (user: string, delta: SyncPayloadDelta): PendingSyncOperation => {
    const prefix = accountPrefix(user);
    const observed = list(user);
    const firstTime = Math.min(Date.now(), ...observed.map((operation) => operation.createdAt));
    const operation = { id: uid(), createdAt: Math.max(1, firstTime - 1), sourceId, delta };
    const account = memory.get(prefix) ?? new Map<string, PendingSyncOperation>();
    account.set(operation.id, operation);
    memory.set(prefix, account);
    try {
      storage?.setItem(`${prefix}${operation.id}`, JSON.stringify(operation));
      persisted.add(`${prefix}${operation.id}`);
    } catch { /* 内存兜底 */ }
    return operation;
  };

  const capture = (
    user: string, before: SyncPayload, after: SyncPayload, replace = false,
  ): PendingSyncOperation | null => {
    const delta = diffSyncPayload(before, after, replace);
    return delta ? append(user, delta) : null;
  };

  const clear = (user: string, ids: string[]): void => {
    const prefix = accountPrefix(user);
    const account = memory.get(prefix);
    for (const id of ids) {
      account?.delete(id);
      persisted.delete(`${prefix}${id}`);
      try { storage?.removeItem(`${prefix}${id}`); } catch { /* 内存状态已清 */ }
    }
  };

  const isUserKey = (user: string, key: string | null): boolean =>
    typeof key === 'string' && key.startsWith(accountPrefix(user));
  return { sourceId, list, append, prepend, capture, clear, isUserKey };
}

export const pendingSyncQueue = createPendingSyncQueue();
