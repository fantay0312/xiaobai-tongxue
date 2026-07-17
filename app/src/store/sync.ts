/** 按账号拉/推学习档；变更以独立操作持久化，密钥与课堂态永不入档。 */
import { DEFAULT_GLOBAL, revokeLiveImages, useAppStore } from './appStore';
import { useAuthStore } from './authStore';
import {
  applySyncDelta, claimLocalHistoryOwner, rememberLocalHistoryOwner, sanitizeSyncPayload,
  type PendingSyncOperation, type SyncPayload,
} from './pendingSync';
import { pendingSyncQueue } from './pendingSyncQueue';
import { API_BASE, gatewayFetch } from '../lib/api';
import { TOPICS } from '../data';
import { deriveEvolution } from '../engine/evolution';

const LAST_USER_KEY = 'xiaobai-sync-user';
const OWNER_MARKER_KEY = 'xiaobai-sync-owner-initialized';
const DEBOUNCE_MS = 3000;
const RETRY_MS = 15_000;
const KEEPALIVE_LIMIT = 60 * 1024;
let applyingRemote = false;
let pushTimer = 0;
let dirty = false;
let started = false;
let syncGeneration = 0;
let observedAuthKey: string | null = null;
let syncedUser: string | null = null;
let serverVersion: string | null = null;
let serverState: SyncPayload | null = null;
let pushPromise: Promise<void> | null = null;
let remoteRefreshEpoch = 0;
let appliedRefreshEpoch = 0;

function syncIsCurrent(generation: number, user: string): boolean {
  const auth = useAuthStore.getState();
  return generation === syncGeneration && auth.status === 'authed'
    && auth.user === user && !auth.emailBindingRequired;
}

function snapshot(): SyncPayload {
  const state = useAppStore.getState();
  return { global: state.global, events: state.events, reports: state.reports };
}

function emptyState(): SyncPayload {
  return {
    global: { ...DEFAULT_GLOBAL, relationshipMemory: [], goldenAnalogies: [] },
    events: [], reports: [],
  };
}

function replaceLocal(state: SyncPayload): void {
  applyingRemote = true;
  try {
    revokeLiveImages(useAppStore.getState().live);
    useAppStore.setState({ ...state, topicStates: {}, live: null });
    useAppStore.getState().rebuildStates();
  } finally { applyingRemote = false; }
}

function commitMerged(state: SyncPayload): void {
  applyingRemote = true;
  try {
    useAppStore.setState({
      events: state.events,
      reports: state.reports,
      topicStates: {},
      global: { ...state.global, learningLevel: deriveEvolution(state.events, TOPICS).stage },
    });
    useAppStore.getState().rebuildStates();
  } finally { applyingRemote = false; }
}

function sanitize(remote: Partial<SyncPayload>): SyncPayload {
  const state = sanitizeSyncPayload(remote, DEFAULT_GLOBAL);
  state.global.learningLevel = deriveEvolution(state.events, TOPICS).stage;
  return state;
}

function applyOperations(base: SyncPayload, operations: PendingSyncOperation[]): SyncPayload {
  return operations.reduce((state, operation) => applySyncDelta(state, operation.delta), base);
}

async function fetchRemote(): Promise<{
  state: Partial<SyncPayload> | null;
  updatedAt: string | null;
} | null> {
  try {
    const response = await gatewayFetch(`${API_BASE}/state`);
    if (!response.ok) return null;
    const value: unknown = await response.json();
    const document = value as { state?: unknown; updatedAt?: unknown };
    return {
      state: document?.state && typeof document.state === 'object'
        ? document.state as Partial<SyncPayload> : null,
      updatedAt: typeof document?.updatedAt === 'string' ? document.updatedAt : null,
    };
  } catch { return null; }
}

function schedulePush(delay = DEBOUNCE_MS): void {
  dirty = true;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), delay);
}

function scheduleRetry(): void {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    if (dirty) void push();
  }, RETRY_MS);
}

async function performPush(useKeepalive = false, retriedConflict = false): Promise<void> {
  const user = syncedUser;
  const generation = syncGeneration;
  if (!user || !serverState || !syncIsCurrent(generation, user)) return;
  try {
    if (appliedRefreshEpoch < remoteRefreshEpoch) {
      const refreshEpoch = remoteRefreshEpoch;
      const remote = await fetchRemote();
      if (!syncIsCurrent(generation, user)) return;
      if (!remote) {
        dirty = true;
        scheduleRetry();
        return;
      }
      serverState = remote.state ? sanitize(remote.state) : emptyState();
      serverVersion = remote.updatedAt;
      appliedRefreshEpoch = refreshEpoch;
      commitMerged(applyOperations(serverState, pendingSyncQueue.list(user)));
      if (appliedRefreshEpoch < remoteRefreshEpoch) {
        schedulePush(0);
        return;
      }
    }
    const operations = pendingSyncQueue.list(user);
    if (!operations.length) {
      dirty = false;
      return;
    }
    const state = applyOperations(serverState, operations);
    const body = JSON.stringify({ state, baseVersion: serverVersion });
    dirty = false;
    const response = await gatewayFetch(`${API_BASE}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      ...(useKeepalive && new Blob([body]).size <= KEEPALIVE_LIMIT ? { keepalive: true } : {}),
    });
    if (!syncIsCurrent(generation, user)) return;
    if (response.status === 401) {
      dirty = true;
      scheduleRetry();
      return;
    }
    if (response.status === 409 && !retriedConflict) {
      const refreshEpoch = remoteRefreshEpoch;
      const remote = await fetchRemote();
      if (!syncIsCurrent(generation, user)) return;
      if (remote) {
        serverState = remote.state ? sanitize(remote.state) : emptyState();
        serverVersion = remote.updatedAt;
        appliedRefreshEpoch = refreshEpoch;
        commitMerged(applyOperations(serverState, pendingSyncQueue.list(user)));
        dirty = true;
        return performPush(false, true);
      }
    }
    if (!response.ok) {
      dirty = true;
      scheduleRetry();
      return;
    }
    const value: unknown = await response.json().catch(() => null);
    if (!syncIsCurrent(generation, user)) return;
    const updatedAt = (value as { updatedAt?: unknown })?.updatedAt;
    if (typeof updatedAt === 'string') serverVersion = updatedAt;
    serverState = state;
    pendingSyncQueue.clear(user, operations.map((operation) => operation.id));
    const remaining = pendingSyncQueue.list(user);
    commitMerged(applyOperations(state, remaining));
    if (remaining.length || appliedRefreshEpoch < remoteRefreshEpoch) schedulePush(0);
  } catch {
    if (!syncIsCurrent(generation, user)) return;
    dirty = true;
    scheduleRetry();
  }
}

function push(useKeepalive = false): Promise<void> {
  if (pushPromise) return pushPromise;
  const task = performPush(useKeepalive);
  pushPromise = task;
  const release = () => { if (pushPromise === task) pushPromise = null; };
  void task.then(release, release);
  return task;
}

function flushNow(): void {
  if (!dirty) return;
  window.clearTimeout(pushTimer);
  void push(true);
}

async function adopt(user: string, generation: number): Promise<boolean> {
  const refreshEpoch = remoteRefreshEpoch;
  const remote = await fetchRemote();
  if (!syncIsCurrent(generation, user)) return false;
  if (!remote) return false;
  let base = remote.state ? sanitize(remote.state) : emptyState();
  serverVersion = remote.updatedAt;
  appliedRefreshEpoch = refreshEpoch;

  if (!remote.state) {
    if (claimLocalHistoryOwner(localStorage, LAST_USER_KEY, OWNER_MARKER_KEY, user)) {
      const operations = pendingSyncQueue.list(user);
      if (!operations.some((operation) => operation.delta.kind === 'merge')) {
        pendingSyncQueue.prepend(user, { kind: 'merge', state: snapshot() });
      }
    } else {
      replaceLocal(base);
    }
  }

  serverState = base;
  syncedUser = user;
  const operations = pendingSyncQueue.list(user);
  replaceLocal(applyOperations(base, operations));
  if (operations.length || appliedRefreshEpoch < remoteRefreshEpoch) {
    dirty = true;
    await push();
    if (!syncIsCurrent(generation, user)) return false;
  }
  rememberLocalHistoryOwner(localStorage, LAST_USER_KEY, OWNER_MARKER_KEY, user);
  return true;
}

export function initStateSync(): void {
  if (started) return;
  started = true;
  let adoptRetryTimer = 0;
  const onAuth = (status: string, user: string | null, emailBindingRequired: boolean) => {
    const authKey = `${status}\0${user ?? ''}\0${emailBindingRequired ? 'restricted' : 'ready'}`;
    if (authKey === observedAuthKey) return;
    observedAuthKey = authKey;
    syncGeneration += 1;
    window.clearTimeout(pushTimer);
    window.clearTimeout(adoptRetryTimer);
    dirty = false;
    serverState = null;
    pushPromise = null;
    remoteRefreshEpoch = 0;
    appliedRefreshEpoch = 0;
    if (status === 'authed' && user && !emailBindingRequired) {
      syncedUser = null;
      serverVersion = null;
      const tryAdopt = () => {
        const generation = syncGeneration;
        if (!syncIsCurrent(generation, user)) return;
        void adopt(user, generation).catch(() => false).then((ok) => {
          if (!ok && syncIsCurrent(generation, user)) {
            adoptRetryTimer = window.setTimeout(tryAdopt, 30_000);
          }
        });
      };
      tryAdopt();
    } else {
      syncedUser = null;
      serverVersion = null;
    }
  };

  useAuthStore.subscribe((state) => onAuth(state.status, state.user, state.emailBindingRequired));
  const auth = useAuthStore.getState();
  onAuth(auth.status, auth.user, auth.emailBindingRequired);
  useAppStore.subscribe((state, previous) => {
    if (applyingRemote) return;
    const currentAuth = useAuthStore.getState();
    if (currentAuth.status !== 'authed' || currentAuth.emailBindingRequired || !currentAuth.user) return;
    if (state.global === previous.global && state.events === previous.events
      && state.reports === previous.reports) return;
    const before = { global: previous.global, events: previous.events, reports: previous.reports };
    const after = { global: state.global, events: state.events, reports: state.reports };
    const reset = state.global === DEFAULT_GLOBAL && !state.events.length && !state.reports.length;
    if (!pendingSyncQueue.capture(currentAuth.user, before, after, reset)) return;
    if (syncedUser === currentAuth.user && serverState) schedulePush();
  });
  window.addEventListener('storage', (event) => {
    const auth = useAuthStore.getState();
    const eventUser = syncedUser ?? (auth.status === 'authed' && !auth.emailBindingRequired ? auth.user : null);
    if (!eventUser || !pendingSyncQueue.isUserKey(eventUser, event.key)) return;
    if (event.newValue === null) remoteRefreshEpoch += 1;
    if (syncedUser === eventUser && serverState) schedulePush(0);
  });
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}
