import type { GoldenAnalogy, LearnEvent, SessionReport, XiaobaiGlobal } from '../types';

export interface SyncPayload {
  global: XiaobaiGlobal;
  events: LearnEvent[];
  reports: SessionReport[];
}

interface CollectionDelta<T> {
  upsert: T[];
  remove: string[];
}

interface SyncGlobalDelta {
  persona?: XiaobaiGlobal['persona'];
  learningLevel?: XiaobaiGlobal['learningLevel'];
  relationshipMemory?: CollectionDelta<string>;
  goldenAnalogies?: CollectionDelta<GoldenAnalogy>;
  topicsMastered?: number;
  bestRecord?: string | null;
}

export type SyncPayloadDelta =
  | { kind: 'replace'; state: SyncPayload }
  | { kind: 'merge'; state: SyncPayload }
  | {
      kind: 'patch';
      global: SyncGlobalDelta;
      events: CollectionDelta<LearnEvent> | null;
      reports: CollectionDelta<SessionReport> | null;
    };

export interface PendingSyncOperation {
  id: string;
  createdAt: number;
  sourceId: string;
  delta: SyncPayloadDelta;
}

export interface SyncStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

export function canClaimLocalHistory(
  ownerKnown: boolean, lastUser: string | null, ownershipInitialized: boolean, user: string,
): boolean {
  return ownerKnown && (lastUser?.toLowerCase() === user.toLowerCase()
    || (lastUser === null && !ownershipInitialized));
}

type OwnershipStorage = Pick<SyncStorage, 'getItem' | 'setItem'>;

export function claimLocalHistoryOwner(
  storage: OwnershipStorage, ownerKey: string, markerKey: string, user: string,
): boolean {
  let lastUser: string | null;
  let ownershipInitialized: boolean;
  try {
    lastUser = storage.getItem(ownerKey);
    ownershipInitialized = storage.getItem(markerKey) !== null;
  } catch { return false; }
  if (!canClaimLocalHistory(true, lastUser, ownershipInitialized, user)) return false;
  if (lastUser !== null) return true;
  try {
    storage.setItem(markerKey, '1');
    storage.setItem(ownerKey, user);
    return true;
  } catch { return false; }
}

export function rememberLocalHistoryOwner(
  storage: OwnershipStorage, ownerKey: string, markerKey: string, user: string,
): void {
  try {
    storage.setItem(markerKey, '1');
    storage.setItem(ownerKey, user);
  } catch { /* 已持久化的服务端或待推操作不受影响 */ }
}

const PERSONAS = new Set(['好奇型', '严谨型', '杠精型']);
const EVENT_TYPES = new Set([
  'session_started', 'checklist_hit', 'accuracy_flag', 'misconception_injected',
  'misconception_corrected', 'misconception_adopted', 'golden_analogy_saved',
  'stuck_rescued', 'prep_completed', 'remedy_completed', 'topic_mastered',
  'review_triggered', 'review_passed', 'xiaobai_quiz_scored', 'session_ended',
]);
const RADAR_KEYS = new Set(['覆盖度', '准确度', '逻辑结构', '深度', '纠错力']);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isRadar(value: unknown, partial = false): boolean {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return (partial || entries.length === RADAR_KEYS.size)
    && entries.every(([key, score]) => RADAR_KEYS.has(key) && finite(score));
}

function isBlindSpot(value: unknown): boolean {
  return object(value) && typeof value.knowledgePoint === 'string'
    && typeof value.evidence === 'string' && ['high', 'medium', 'low'].includes(String(value.severity))
    && (value.mcId === null || typeof value.mcId === 'string')
    && (value.checklistId === null || typeof value.checklistId === 'string');
}

function isQuiz(value: unknown): boolean {
  return object(value) && finite(value.score) && value.score >= 0 && value.score <= 100
    && Array.isArray(value.answers) && value.answers.every((answer) => object(answer)
      && typeof answer.quizId === 'string' && typeof answer.correct === 'boolean'
      && typeof answer.checklistRef === 'string')
    && strings(value.failedChecklist);
}

export function isSyncAnalogy(value: unknown): value is GoldenAnalogy {
  return object(value) && typeof value.id === 'string' && typeof value.topicId === 'string'
    && typeof value.text === 'string' && typeof value.t === 'string';
}

export function isSyncEvent(value: unknown): value is LearnEvent {
  return object(value) && typeof value.id === 'string' && typeof value.t === 'string'
    && EVENT_TYPES.has(String(value.type)) && typeof value.topicId === 'string'
    && (value.sessionId === null || typeof value.sessionId === 'string')
    && object(value.payload) && typeof value.evidence === 'string';
}

export function isSyncReport(value: unknown): value is SessionReport {
  return object(value) && typeof value.sessionId === 'string' && typeof value.topicId === 'string'
    && ['teach', 'reteach', 'review'].includes(String(value.mode)) && typeof value.startedAt === 'string'
    && typeof value.endedAt === 'string' && isRadar(value.radar)
    && (value.radarDelta === null || isRadar(value.radarDelta, true))
    && strings(value.highlights) && strings(value.goldenAnalogies)
    && Array.isArray(value.blindSpots) && value.blindSpots.every(isBlindSpot)
    && (value.quiz === null || isQuiz(value.quiz))
    && Number.isInteger(value.turnCount) && Number(value.turnCount) >= 0
    && typeof value.masteredNow === 'boolean';
}

export function isSyncPayload(value: unknown): value is SyncPayload {
  if (!object(value) || !object(value.global)) return false;
  const global = value.global;
  return PERSONAS.has(String(global.persona))
    && Number.isInteger(global.learningLevel) && Number(global.learningLevel) >= 1
    && Number(global.learningLevel) <= 5 && strings(global.relationshipMemory)
    && Array.isArray(global.goldenAnalogies) && global.goldenAnalogies.every(isSyncAnalogy)
    && Number.isInteger(global.topicsMastered) && Number(global.topicsMastered) >= 0
    && (global.bestRecord === null || typeof global.bestRecord === 'string')
    && Array.isArray(value.events) && value.events.every(isSyncEvent)
    && Array.isArray(value.reports) && value.reports.every(isSyncReport);
}

export function sanitizeSyncPayload(
  remote: Partial<SyncPayload>, defaults: XiaobaiGlobal,
): SyncPayload {
  const candidate: Record<string, unknown> = object(remote.global) ? remote.global : {};
  return {
    global: {
      persona: PERSONAS.has(String(candidate.persona))
        ? candidate.persona as XiaobaiGlobal['persona'] : defaults.persona,
      learningLevel: Number.isInteger(candidate.learningLevel)
        && Number(candidate.learningLevel) >= 1 && Number(candidate.learningLevel) <= 5
        ? Number(candidate.learningLevel) as XiaobaiGlobal['learningLevel'] : defaults.learningLevel,
      relationshipMemory: strings(candidate.relationshipMemory)
        ? candidate.relationshipMemory.slice(-5) : [],
      goldenAnalogies: Array.isArray(candidate.goldenAnalogies)
        ? candidate.goldenAnalogies.filter(isSyncAnalogy) : [],
      topicsMastered: Number.isInteger(candidate.topicsMastered) && Number(candidate.topicsMastered) >= 0
        ? Number(candidate.topicsMastered) : defaults.topicsMastered,
      bestRecord: candidate.bestRecord === null || typeof candidate.bestRecord === 'string'
        ? candidate.bestRecord : defaults.bestRecord,
    },
    events: Array.isArray(remote.events) ? remote.events.filter(isSyncEvent) : [],
    reports: Array.isArray(remote.reports) ? remote.reports.filter(isSyncReport) : [],
  };
}

function betterRecord(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTurns = Number.parseInt(current, 10);
  const candidateTurns = Number.parseInt(candidate, 10);
  if (!Number.isFinite(currentTurns)) return candidate;
  if (!Number.isFinite(candidateTurns)) return current;
  return candidateTurns < currentTurns ? candidate : current;
}

export function mergeSyncPayloads(...states: SyncPayload[]): SyncPayload {
  const latest = states.at(-1);
  if (!latest) throw new Error('sync-payload-required');
  const events = new Map(states.flatMap((state) => state.events).map((event) => [event.id, event]));
  const reports = new Map(states.flatMap((state) => state.reports)
    .map((report) => [report.sessionId, report]));
  const memories = [...new Set(states.flatMap((state) => state.global.relationshipMemory))].slice(-5);
  const analogies = new Map(states.flatMap((state) => state.global.goldenAnalogies)
    .map((analogy) => [analogy.id, analogy]));
  const eventList = [...events.values()].sort((a, b) => a.t.localeCompare(b.t));
  return {
    global: {
      ...latest.global,
      learningLevel: Math.max(...states.map((state) => state.global.learningLevel)) as XiaobaiGlobal['learningLevel'],
      relationshipMemory: memories,
      goldenAnalogies: [...analogies.values()],
      topicsMastered: Math.max(
        eventList.filter((event) => event.type === 'topic_mastered').length,
        ...states.map((state) => state.global.topicsMastered),
      ),
      bestRecord: states.reduce<string | null>(
        (best, state) => betterRecord(best, state.global.bestRecord), null,
      ),
    },
    events: eventList,
    reports: [...reports.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
}

function collectionDelta<T>(
  before: T[], after: T[], identity: (item: T) => string,
): CollectionDelta<T> | null {
  const previous = new Set(before.map(identity));
  const next = new Set(after.map(identity));
  const upsert = after.filter((item) => !previous.has(identity(item)));
  const remove = before.map(identity).filter((id) => !next.has(id));
  return upsert.length || remove.length ? { upsert, remove } : null;
}

export function diffSyncPayload(
  before: SyncPayload, after: SyncPayload, replace = false,
): SyncPayloadDelta | null {
  if (replace) return { kind: 'replace', state: after };
  const global: SyncGlobalDelta = {};
  if (before.global.persona !== after.global.persona) global.persona = after.global.persona;
  if (before.global.learningLevel !== after.global.learningLevel) global.learningLevel = after.global.learningLevel;
  global.relationshipMemory = collectionDelta(
    before.global.relationshipMemory, after.global.relationshipMemory, (item) => item,
  ) ?? undefined;
  global.goldenAnalogies = collectionDelta(
    before.global.goldenAnalogies, after.global.goldenAnalogies, (item) => item.id,
  ) ?? undefined;
  if (before.global.topicsMastered !== after.global.topicsMastered) {
    global.topicsMastered = after.global.topicsMastered;
  }
  if (before.global.bestRecord !== after.global.bestRecord) global.bestRecord = after.global.bestRecord;
  const events = collectionDelta(before.events, after.events, (event) => event.id);
  const reports = collectionDelta(before.reports, after.reports, (report) => report.sessionId);
  return Object.keys(global).length || events || reports
    ? { kind: 'patch', global, events, reports }
    : null;
}

function applyCollection<T>(
  base: T[], delta: CollectionDelta<T>, identity: (item: T) => string,
): T[] {
  const values = new Map(base.map((item) => [identity(item), item]));
  for (const id of delta.remove) values.delete(id);
  for (const item of delta.upsert) values.set(identity(item), item);
  return [...values.values()];
}

export function applySyncDelta(base: SyncPayload, delta: SyncPayloadDelta): SyncPayload {
  if (delta.kind === 'replace') return delta.state;
  if (delta.kind === 'merge') return mergeSyncPayloads(base, delta.state);
  const patch = delta.global;
  const global: XiaobaiGlobal = { ...base.global };
  if (patch.persona) global.persona = patch.persona;
  if (patch.learningLevel) global.learningLevel = Math.max(
    global.learningLevel, patch.learningLevel,
  ) as XiaobaiGlobal['learningLevel'];
  if (patch.relationshipMemory) global.relationshipMemory = applyCollection(
    global.relationshipMemory, patch.relationshipMemory, (item) => item,
  ).slice(-5);
  if (patch.goldenAnalogies) global.goldenAnalogies = applyCollection(
    global.goldenAnalogies, patch.goldenAnalogies, (item) => item.id,
  );
  if (patch.topicsMastered !== undefined) {
    global.topicsMastered = Math.max(global.topicsMastered, patch.topicsMastered);
  }
  if ('bestRecord' in patch) global.bestRecord = betterRecord(global.bestRecord, patch.bestRecord ?? null);
  const events = delta.events
    ? applyCollection(base.events, delta.events, (event) => event.id).sort((a, b) => a.t.localeCompare(b.t))
    : base.events;
  const reports = delta.reports
    ? applyCollection(base.reports, delta.reports, (report) => report.sessionId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    : base.reports;
  global.topicsMastered = Math.max(
    global.topicsMastered,
    events.filter((event) => event.type === 'topic_mastered').length,
  );
  return { global, events, reports };
}
