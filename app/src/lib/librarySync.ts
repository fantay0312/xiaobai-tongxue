/**
 * 资料库同步 —— 应用里生成的内容，在云端资料库留一份真正的文件。
 *
 * - saveArtifactToLibrary：把一份成果的 Markdown 存进「我生成的/<类型>」，记下 成果键 → 文件 id + 内容指纹；
 *   内容没变不重传，变了先传新的再清掉旧的。
 * - 自动同步：模型生成的内容稳定片刻后自动存；自己写的等停笔一阵再存。
 *   省着用：同一份 5 分钟内最多处理一次、同一时间只传一份（服务端也不接受同账号并发上传）、
 *   每天自动上传有上限、出错指数退避、连续失败就放弃这一版，不循环重试。
 *   未登录、资料库连不上、页面在后台时都不跑。
 * - 使用记录：服务端不记「这份资料被用在哪儿」，在这里按文件 id / 成果键记一份，供「被用于」显示。
 *
 * 状态按账号存在当前浏览器（localStorage）。
 */
import { useSyncExternalStore } from 'react';
import { ARTIFACT_LABELS, artifactContent, findArtifact, listArtifacts, type Artifact } from './artifacts';
import { createFolder, listLibrary, purgeLibraryEntry, updateLibraryEntry, uploadLibraryFile, type LibraryEntry } from './fileLibrary';
import { useAuthStore } from '../store/authStore';

/** 云端副本所在的系统文件夹 */
export const GENERATED_FOLDER = '我生成的';
/** 同步改动了云端资料库后在 window 上派发，资料库页据此刷新列表 */
export const LIBRARY_CHANGED_EVENT = 'xiaobai:library-changed';

export interface CloudCopy {
  fileId: string;
  /** 上传时内容的指纹 */
  hash: string;
  name: string;
  /** 上传时间 */
  at: string;
  /** 上次核对时成果的 updatedAt：没变就不用再算指纹 */
  seen: string;
  /** 副本被用户从资料库删掉了：不再自动补，除非用户再点一次保存 */
  removed?: boolean;
}

export type LibraryUseKind = 'chat' | 'course' | 'lesson' | 'agent' | 'research' | 'workbench';
export interface LibraryUse {
  kind: LibraryUseKind;
  /** 一句话，如「对话：学习率太大会怎样」「生成闪卡《梯度下降》」 */
  label: string;
  at: string;
  /** 能跳过去的终端位置 */
  open?: Artifact['open'];
}

export type SyncPhase = 'signed-out' | 'off' | 'syncing' | 'offline' | 'budget' | 'idle';
export interface LibrarySyncState {
  auto: boolean;
  copies: Record<string, CloudCopy>;
  uses: Record<string, LibraryUse[]>;
  /** 正在上传或排队的成果键 */
  active: string[];
  phase: SyncPhase;
  /** 今天已自动上传的份数与上限 */
  autoCount: number;
  budget: number;
  lastSyncAt?: string;
  lastError?: { at: string; text: string };
}

interface Attempt {
  /** 上次处理的时间 */
  at: number;
  fails: number;
  /** 这之前不再自动处理 */
  nextAt: number;
  /** 失败时成果的 updatedAt：内容变了就重新给机会 */
  seen: string;
}
interface Stored {
  auto: boolean;
  copies: Record<string, CloudCopy>;
  uses: Record<string, LibraryUse[]>;
  attempts: Record<string, Attempt>;
  day: string;
  autoCount: number;
  lastSyncAt?: string;
  lastError?: { at: string; text: string };
}

const LIMITS = {
  tickMs: 20_000,
  /** 模型生成的：最后一次改动后稳定这么久才存，避开还在生成的 */
  aiSettleMs: 20_000,
  /** 自己写的：停笔这么久才存 */
  userSettleMs: 3 * 60_000,
  perArtifactMs: 5 * 60_000,
  dailyBudget: 120,
  batch: 4,
  gapMs: 1500,
  maxFails: 5,
  maxBackoffMs: 6 * 60 * 60_000,
  offlineBaseMs: 60_000,
  offlineMaxMs: 30 * 60_000,
  copies: 800,
  usesPerTarget: 12,
  useTargets: 300,
};

const storageKey = (owner: string | null) => `xiaobai-library-sync-v1:${encodeURIComponent(owner ?? 'local')}`;
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const blank = (): Stored => ({ auto: true, copies: {}, uses: {}, attempts: {}, day: today(), autoCount: 0 });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/* ── 持久化 ── */
const cache = new Map<string, Stored>();
const listeners = new Set<() => void>();
const snapshots = new Map<string, LibrarySyncState>();
const active = new Map<string, Set<string>>();
/** 资料库连不上时的全局退避 */
const offline = { until: 0, fails: 0 };

function read(owner: string | null): Stored {
  const key = storageKey(owner);
  const cached = cache.get(key);
  if (cached) return cached;
  let state = blank();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (isRecord(raw)) {
      state = {
        auto: raw.auto !== false,
        copies: isRecord(raw.copies) ? raw.copies as Record<string, CloudCopy> : {},
        uses: isRecord(raw.uses) ? raw.uses as Record<string, LibraryUse[]> : {},
        attempts: isRecord(raw.attempts) ? raw.attempts as Record<string, Attempt> : {},
        day: typeof raw.day === 'string' ? raw.day : today(),
        autoCount: typeof raw.autoCount === 'number' ? raw.autoCount : 0,
        ...(typeof raw.lastSyncAt === 'string' ? { lastSyncAt: raw.lastSyncAt } : {}),
        ...(isRecord(raw.lastError) && typeof raw.lastError.text === 'string' && typeof raw.lastError.at === 'string'
          ? { lastError: { at: raw.lastError.at, text: raw.lastError.text } } : {}),
      };
    }
  } catch { /* 损坏或不可用时当作没有 */ }
  cache.set(key, state);
  return state;
}

function emit(owner: string | null): void {
  snapshots.delete(storageKey(owner));
  listeners.forEach((listener) => listener());
}

function write(owner: string | null, update: (state: Stored) => Stored): Stored {
  const key = storageKey(owner);
  // 先丢掉内存里的旧值再读：另一个标签页可能刚写过
  cache.delete(key);
  const next = update(read(owner));
  const copyKeys = Object.keys(next.copies);
  if (copyKeys.length > LIMITS.copies) {
    const keep = copyKeys.sort((a, b) => Date.parse(next.copies[b].at) - Date.parse(next.copies[a].at)).slice(0, LIMITS.copies);
    next.copies = Object.fromEntries(keep.map((id) => [id, next.copies[id]]));
  }
  cache.set(key, next);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 存不下就只留在内存里 */ }
  emit(owner);
  return next;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith('xiaobai-library-sync-v1:')) return;
    cache.delete(event.key);
    snapshots.clear();
    listeners.forEach((listener) => listener());
  });
}

const signedIn = (owner: string | null): owner is string => {
  const auth = useAuthStore.getState();
  return !!owner && auth.user === owner && auth.status === 'authed';
};

function snapshot(owner: string | null): LibrarySyncState {
  const key = storageKey(owner);
  const cached = snapshots.get(key);
  if (cached) return cached;
  const state = read(owner);
  const busy = [...(active.get(key) ?? [])];
  const autoCount = state.day === today() ? state.autoCount : 0;
  const phase: SyncPhase = !signedIn(owner) ? 'signed-out'
    : busy.length ? 'syncing'
      : !state.auto ? 'off'
        : offline.until > Date.now() ? 'offline'
          : autoCount >= LIMITS.dailyBudget ? 'budget' : 'idle';
  const next: LibrarySyncState = {
    auto: state.auto, copies: state.copies, uses: state.uses, active: busy, phase, autoCount, budget: LIMITS.dailyBudget,
    ...(state.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
  };
  snapshots.set(key, next);
  return next;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** 订阅当前账号的同步状态：副本映射、使用记录、开关与进度 */
export function useLibrarySync(owner: string | null): LibrarySyncState {
  return useSyncExternalStore(subscribe, () => snapshot(owner), () => snapshot(owner));
}
export const librarySyncState = (owner: string | null): LibrarySyncState => snapshot(owner);

function markActive(owner: string | null, key: string, on: boolean): void {
  const id = storageKey(owner);
  const set = active.get(id) ?? new Set<string>();
  if (on) set.add(key); else set.delete(key);
  active.set(id, set);
  emit(owner);
}

/* ── 使用记录 ── */
/** 记一次「这份资料 / 成果被用在哪儿」。targetId 是资料库文件 id 或成果键。 */
export function recordLibraryUse(owner: string | null, targetId: string, use: Omit<LibraryUse, 'at'> & { at?: string }): void {
  const label = use.label.trim().slice(0, 80);
  if (!targetId || !label) return;
  write(owner, (state) => {
    const entry: LibraryUse = { kind: use.kind, label, at: use.at ?? new Date().toISOString(), ...(use.open ? { open: use.open } : {}) };
    const rest = (state.uses[targetId] ?? []).filter((item) => !(item.kind === entry.kind && item.label === entry.label));
    const uses = { ...state.uses, [targetId]: [entry, ...rest].slice(0, LIMITS.usesPerTarget) };
    const targets = Object.keys(uses);
    if (targets.length > LIMITS.useTargets) {
      const keep = targets.sort((a, b) => Date.parse(uses[b][0]?.at ?? '') - Date.parse(uses[a][0]?.at ?? '')).slice(0, LIMITS.useTargets);
      return { ...state, uses: Object.fromEntries(keep.map((id) => [id, uses[id]])) };
    }
    return { ...state, uses };
  });
}
export const libraryUses = (owner: string | null, targetId: string): LibraryUse[] => read(owner).uses[targetId] ?? [];

/* ── 副本映射 ── */
export const cloudCopyOf = (owner: string | null, key: string): CloudCopy | undefined => {
  const copy = read(owner).copies[key];
  return copy && !copy.removed ? copy : undefined;
};
/** 反查：这个资料库文件是哪份成果的副本 */
export function artifactKeyOfFile(owner: string | null, fileId: string): string | undefined {
  const copies = read(owner).copies;
  return Object.keys(copies).find((key) => copies[key].fileId === fileId);
}

/**
 * 用资料库的最新列表核对副本：文件被删（或进了回收站）就标记为已移除，自动同步不再补；
 * 从回收站恢复后重新认回来。资料库页每次拿到列表时调用。
 */
export function reconcileLibraryCopies(owner: string | null, entries: LibraryEntry[]): void {
  const state = read(owner);
  const live = new Set(entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt).map((entry) => entry.id));
  const now = Date.now();
  const changed = Object.keys(state.copies).filter((key) => {
    const copy = state.copies[key];
    // 刚传上去的副本可能还没出现在这份列表里（列表请求早于上传完成）
    if (!live.has(copy.fileId) && now - Date.parse(copy.at) < 60_000) return false;
    return !!copy.removed === live.has(copy.fileId);
  });
  if (!changed.length) return;
  write(owner, (current) => {
    const copies = { ...current.copies };
    for (const key of changed) {
      const copy = copies[key];
      if (!copy) continue;
      const { removed: _removed, ...rest } = copy;
      copies[key] = live.has(copy.fileId) ? rest : { ...rest, removed: true };
    }
    return { ...current, copies };
  });
}

export function setLibraryAutoSync(owner: string | null, on: boolean): void {
  write(owner, (state) => ({ ...state, auto: on }));
  if (on) requestLibrarySync(800);
}

/* ── 指纹 ── */
async function digest(text: string): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // 非安全上下文没有 subtle：退回 FNV-1a，够用来判断「内容变没变」
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ (code + index), 0x85ebca6b);
    }
    return `f${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${text.length.toString(16)}`;
  }
}

/* ── 云端操作 ── */
/** 读不到资料库列表：是服务的问题，不算某一份成果的失败 */
class LibraryUnreachable extends Error {}
let tree: { owner: string; at: number; entries: LibraryEntry[] } | null = null;
/** 资料库列表；自动同步一批内复用，手动保存总是取最新 */
async function libraryEntries(owner: string, fresh: boolean): Promise<LibraryEntry[]> {
  if (!fresh && tree && tree.owner === owner && Date.now() - tree.at < 60_000) return tree.entries;
  let listing: Awaited<ReturnType<typeof listLibrary>>;
  try {
    listing = await listLibrary();
  } catch (error) {
    throw new LibraryUnreachable(error instanceof Error ? error.message : '资料库暂时连不上。');
  }
  tree = { owner, at: Date.now(), entries: listing.entries.map((entry) => ({ ...entry })) };
  return tree.entries;
}

/**
 * 成果存成文件时用的名字。成果正文一律是 Markdown（代码、文献库也是包在围栏里的 Markdown），
 * 所以扩展名不是 .md / .txt 的补上 .md：这样资料库能解析它，小砚才能把它当资料引用。
 */
export function artifactFileName(filename: string | undefined, title: string): string {
  const raw = (filename || title || '').replace(/[\\/]/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  const safe = !raw || raw === '.' || raw === '..' ? '未命名' : raw;
  return /\.(md|markdown|txt)$/i.test(safe) ? safe : `${safe}.md`;
}
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}
/** 同一文件夹里不重名：占用时加序号 */
function uniqueName(entries: LibraryEntry[], parentId: string | null, wanted: string): string {
  const taken = new Set(entries.filter((entry) => !entry.deletedAt && entry.parentId === parentId).map((entry) => entry.name));
  if (!taken.has(wanted)) return wanted;
  const [stem, ext] = splitName(wanted);
  for (let index = 2; index < 200; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} ${Date.now().toString(36)}${ext}`;
}

async function ensureFolder(entries: LibraryEntry[], kind: Artifact['kind']): Promise<LibraryEntry> {
  const find = (name: string, parentId: string | null) => entries.find((entry) => entry.kind === 'folder' && !entry.deletedAt && entry.parentId === parentId && entry.name === name);
  let root = find(GENERATED_FOLDER, null);
  if (!root) { root = await createFolder(GENERATED_FOLDER, null); entries.push(root); }
  const label = ARTIFACT_LABELS[kind] ?? '其他';
  let folder = find(label, root.id);
  if (!folder) { folder = await createFolder(label, root.id); entries.push(folder); }
  return folder;
}

const announce = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT)); };

export interface SaveOptions {
  /** 自动同步调用：只在内容变了时联网；副本被用户删过就跳过 */
  auto?: boolean;
}
export interface SaveResult {
  /** 云端副本的文件 id；跳过时为空串 */
  fileId: string;
  name: string;
  /** 这次是否真的上传了新内容 */
  changed: boolean;
  /** 自动同步因为用户删过副本而跳过 */
  skipped?: boolean;
}

async function saveNow(owner: string | null, key: string, { auto = false }: SaveOptions): Promise<SaveResult> {
  if (!signedIn(owner)) throw new Error('登录后才能把内容存到资料库。');
  const artifact = findArtifact(owner, key);
  const content = artifact ? await artifactContent(owner, key) : null;
  if (!artifact || !content) throw new Error('这份内容已经不在了，可能已被删除。');
  if (!content.text.trim()) throw new Error('内容还是空的，写点东西再存。');
  const hash = await digest(content.text);
  const seen = artifact.updatedAt;
  const known = read(owner).copies[key];

  // 自动同步：内容没变就不联网
  if (auto && known && known.hash === hash) {
    write(owner, (state) => (state.copies[key] ? { ...state, copies: { ...state.copies, [key]: { ...state.copies[key], seen } } } : state));
    return { fileId: known.removed ? '' : known.fileId, name: known.name, changed: false, skipped: !!known.removed };
  }
  if (auto && known?.removed) {
    write(owner, (state) => (state.copies[key] ? { ...state, copies: { ...state.copies, [key]: { ...state.copies[key], seen } } } : state));
    return { fileId: '', name: known.name, changed: false, skipped: true };
  }

  const entries = await libraryEntries(owner, !auto);
  if (!signedIn(owner)) throw new Error('登录状态变了，已停止保存。');
  const old = known ? entries.find((entry) => entry.id === known.fileId && entry.kind === 'file' && !entry.deletedAt) : undefined;

  if (known && old && known.hash === hash) {
    write(owner, (state) => ({ ...state, copies: { ...state.copies, [key]: { fileId: old.id, hash, name: old.name, at: known.at, seen } } }));
    return { fileId: old.id, name: old.name, changed: false };
  }
  if (auto && known && !old) {
    // 副本被用户删了：尊重这个决定，只记下来
    write(owner, (state) => ({ ...state, copies: { ...state.copies, [key]: { ...known, seen, removed: true } } }));
    return { fileId: '', name: known.name, changed: false, skipped: true };
  }

  // 旧副本被用户挪过位置就跟着放在那儿；否则放进「我生成的/<类型>」
  const parentId = old ? old.parentId : (await ensureFolder(entries, artifact.kind)).id;
  const wanted = artifactFileName(content.filename, artifact.title);
  let moved: { id: string; name: string } | undefined;
  if (old && old.name === wanted) {
    // 同名先让开，传完新的再清掉旧的
    const [stem, ext] = splitName(wanted);
    const aside = uniqueName(entries, parentId, `${stem}（旧版）${ext}`);
    await updateLibraryEntry(old.id, { name: aside });
    moved = { id: old.id, name: old.name };
    old.name = aside;
  }
  const name = uniqueName(entries, parentId, wanted);
  let uploaded: LibraryEntry;
  try {
    uploaded = await uploadLibraryFile(new File([content.text], name, { type: /\.txt$/i.test(name) ? 'text/plain' : 'text/markdown' }), parentId, new AbortController().signal);
  } catch (error) {
    if (moved) {
      const previous = moved;
      await updateLibraryEntry(previous.id, { name: previous.name }).then(() => { if (old) old.name = previous.name; }, () => {});
    }
    throw error;
  }
  entries.push({ ...uploaded });
  const at = new Date().toISOString();
  write(owner, (state) => ({
    ...state,
    copies: { ...state.copies, [key]: { fileId: uploaded.id, hash, name: uploaded.name, at, seen } },
    lastSyncAt: at,
  }));
  if (old) {
    // 旧副本仍被课程引用时删不掉，就留着那份「旧版」
    await purgeLibraryEntry(old.id).then(
      () => { const index = entries.indexOf(old); if (index >= 0) entries.splice(index, 1); },
      () => updateLibraryEntry(old.id, { trashed: true }).then(() => { old.deletedAt = at; }, () => {}),
    );
  }
  announce();
  return { fileId: uploaded.id, name: uploaded.name, changed: true };
}

// 同一时间只做一份：服务端对同账号的并发上传直接拒绝
let chain: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<SaveResult>>();

/**
 * 把一份成果存到云端资料库，返回副本的文件 id。
 * 已有副本且内容没变时不重传；内容变了上传新版并清掉旧版。失败抛 Error，message 可直接给用户看。
 */
export function saveArtifactToLibrary(owner: string | null, key: string, options: SaveOptions = {}): Promise<SaveResult> {
  const id = `${storageKey(owner)}|${key}`;
  const running = inflight.get(id);
  if (running) return running;
  markActive(owner, key, true);
  const job = chain.then(() => saveNow(owner, key, options)).finally(() => {
    inflight.delete(id);
    markActive(owner, key, false);
  });
  chain = job.catch(() => {});
  inflight.set(id, job);
  if (!options.auto) {
    // 用户主动保存成功：清掉这份的失败计数，并记下处理时间（自动同步 5 分钟内不再碰它）
    job.then(() => write(owner, (state) => ({
      ...state,
      attempts: { ...state.attempts, [key]: { at: Date.now(), fails: 0, nextAt: 0, seen: findArtifact(owner, key)?.updatedAt ?? '' } },
      lastError: undefined,
    })), () => {});
  }
  return job;
}

/* ── 自动同步 ── */
const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
let running = false;
let started = false;
let soon: number | undefined;

function candidates(owner: string, state: Stored, now: number): Artifact[] {
  return listArtifacts(owner).filter((artifact) => {
    const copy = state.copies[artifact.key];
    if (copy && copy.seen === artifact.updatedAt) return false;
    const updated = Date.parse(artifact.updatedAt);
    const settle = artifact.madeBy === 'ai' ? LIMITS.aiSettleMs : LIMITS.userSettleMs;
    if (Number.isFinite(updated) && now - updated < settle) return false;
    const attempt = state.attempts[artifact.key];
    if (!attempt) return true;
    if (now - attempt.at < LIMITS.perArtifactMs || now < attempt.nextAt) return false;
    // 这一版已经连续失败到上限：等内容变了再说
    return !(attempt.fails >= LIMITS.maxFails && attempt.seen === artifact.updatedAt);
  });
}

function backOff(owner: string): void {
  offline.fails += 1;
  offline.until = Date.now() + Math.min(LIMITS.offlineBaseMs * 2 ** (offline.fails - 1), LIMITS.offlineMaxMs);
  emit(owner);
}

async function runBatch(owner: string): Promise<void> {
  let failures = 0;
  for (let round = 0; round < LIMITS.batch; round += 1) {
    if (!signedIn(owner) || document.visibilityState === 'hidden') return;
    const state = read(owner);
    if (!state.auto) return;
    if ((state.day === today() ? state.autoCount : 0) >= LIMITS.dailyBudget) return;
    const now = Date.now();
    const next = candidates(owner, state, now)[0];
    if (!next) return;
    const stamp = (fails: number) => write(owner, (current) => ({
      ...current,
      attempts: {
        ...current.attempts,
        [next.key]: { at: now, fails, seen: next.updatedAt, nextAt: fails ? now + Math.min(LIMITS.perArtifactMs * 2 ** fails, LIMITS.maxBackoffMs) : 0 },
      },
    }));
    try {
      const result = await saveArtifactToLibrary(owner, next.key, { auto: true });
      stamp(0);
      if (offline.fails) { offline.fails = 0; offline.until = 0; }
      if (result.changed) {
        write(owner, (current) => ({ ...current, day: today(), autoCount: (current.day === today() ? current.autoCount : 0) + 1, lastError: undefined }));
        await pause(LIMITS.gapMs);
      }
    } catch (error) {
      // 资料库本身连不上：整批停下，按退避稍后再看，不记到这份成果头上
      if (error instanceof LibraryUnreachable) { backOff(owner); return; }
      failures += 1;
      const previous = state.attempts[next.key];
      stamp((previous && previous.seen === next.updatedAt ? previous.fails : 0) + 1);
      const text = `《${next.title}》没存上：${error instanceof Error ? error.message : '操作未完成。'}`;
      write(owner, (current) => ({ ...current, lastError: { at: new Date().toISOString(), text } }));
      // 连着失败多半是服务的问题：这一批到此为止
      if (failures >= 2) { backOff(owner); return; }
    }
  }
}

function tick(): void {
  if (running || typeof document === 'undefined') return;
  const owner = useAuthStore.getState().user;
  if (!signedIn(owner)) return;
  if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
  const state = read(owner);
  if (!state.auto) return;
  if (Date.now() < offline.until) return;
  if ((state.day === today() ? state.autoCount : 0) >= LIMITS.dailyBudget) return;
  if (!candidates(owner, state, Date.now()).length) return;
  running = true;
  const done = () => { running = false; emit(owner); };
  const work = () => runBatch(owner).catch(() => {});
  // 多个标签页同时开着时，只让一个去传
  if (navigator.locks?.request) {
    void navigator.locks.request(`xiaobai-library-sync:${owner}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); }).then(done, done);
  } else {
    void work().then(done);
  }
}

/** 让自动同步尽快看一眼（有新成果、刚打开资料库、刚恢复联网时调用）。 */
export function requestLibrarySync(delay = 2500): void {
  if (typeof window === 'undefined') return;
  if (soon !== undefined) window.clearTimeout(soon);
  soon = window.setTimeout(() => { soon = undefined; tick(); }, delay);
}

/** 用户点「立即同步」：清掉连不上的退避，马上再试一轮。 */
export function retryLibrarySync(owner: string | null): void {
  offline.until = 0;
  offline.fails = 0;
  write(owner, (state) => ({ ...state, lastError: undefined }));
  requestLibrarySync(100);
}

/** 启动自动同步（幂等）。模块被引入时就会调用；真正上传前仍逐项检查登录、开关与额度。 */
export function startLibraryAutoSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.setInterval(tick, LIMITS.tickMs);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestLibrarySync(4000); });
  window.addEventListener('online', () => requestLibrarySync(4000));
  requestLibrarySync(8000);
}

startLibraryAutoSync();
