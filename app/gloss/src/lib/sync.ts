"use client";

/**
 * Account sync for signed-in readers. The browser stays the source of truth
 * while you read; this mirrors it to the account and back.
 *
 * - Push: what changed since the last push, found by comparing each entity's
 *   stable JSON with a baseline of what the server already has. Deletions are
 *   entities in the baseline that are gone locally, sent as tombstones.
 * - Pull: rows changed since the last pull, merged in with applyRemote. The
 *   baseline then records them, so they are not pushed straight back.
 * - Texts travel separately: pushed once with the shelf entry, fetched on
 *   another device only when it is opened there.
 *
 * The baseline lives in localStorage per user, so a second account on the
 * same browser starts fresh and receives what is on this device.
 *
 * While a page watches the shelf (the library), it also pulls every few
 * seconds, so what an agent saves arrives while you look.
 */

import { forgetDoc, loadDoc, saveDoc, useStore, type RemoteChanges } from "./store";
import type { Article } from "./article";
import { forgetCover } from "./covers";

const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"] as const;
type Collection = (typeof COLLECTIONS)[number];

type Entity = { articleId: string; data: unknown; key: string };
type Snapshot = { entities: Record<Collection, Map<string, Entity>>; busy: Set<string> };
type Baseline = { since: string | null; seen: Record<Collection, Record<string, [key: string, articleId: string]>>; revisions: Record<string, number> };
type OutRow = { id: string; articleId: string; data: unknown; deleted?: boolean; doc?: Article; revision?: number };

/** Pushes are split to stay well under the 4.5MB request cap. */
const BATCH_BYTES = 1_500_000;
const MAX_BODY = 4_300_000;
/** Pulls overlap a little, so a write that landed while the last pull ran is not missed. Applying a row twice is harmless. */
const OVERLAP_MS = 30_000;

/** JSON with sorted keys, so the same object always compares equal, whatever order Postgres hands keys back in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function snapshot(): Snapshot {
  const st = useStore.getState();
  const entities = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, Entity>()])) as Snapshot["entities"];
  const busy = new Set<string>();
  const put = (c: Collection, id: string, articleId: string, data: unknown) => entities[c].set(id, { articleId, data, key: stable(data) });

  for (const item of st.library) put("articles", item.id, item.id, item);
  for (const [aid, list] of Object.entries(st.highlights)) for (const h of list) put("highlights", h.id, aid, h);
  for (const [aid, list] of Object.entries(st.glosses))
    for (const g of list) {
      // An answer still being written is left alone until it settles.
      if (g.turns.some((t) => t.streaming)) busy.add(`glosses:${g.id}`);
      else put("glosses", g.id, aid, g);
    }
  for (const [aid, b] of Object.entries(st.briefs)) {
    if (b.status === "ready") put("briefs", aid, aid, b);
    else busy.add(`briefs:${aid}`);
  }
  for (const [aid, p] of Object.entries(st.progress)) put("progress", aid, aid, p);
  return { entities, busy };
}

/** Pages that want arrivals as they happen, and how to tell the running sync. */
let watchers = 0;
let poke: (() => void) | null = null;
const WATCH_MS = 5000;

/** Pull now and every few seconds while the returned stop hasn't been called. */
export function watchShelf(): () => void {
  watchers++;
  poke?.();
  return () => {
    watchers--;
  };
}

const emptyBaseline = (): Baseline => ({ since: null, seen: Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as Baseline["seen"], revisions: {} });

export function startSync(userId: string) {
  const storeKey = `gloss:sync:${userId}`;
  let base: Baseline = emptyBaseline();
  try {
    const raw = localStorage.getItem(storeKey);
    if (raw) base = { ...emptyBaseline(), ...JSON.parse(raw) };
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(base));
    } catch {}
  };

  let stopped = false;
  // One operation at a time: a pull never lands in the middle of a push.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (fn: () => Promise<void>) => (chain = chain.then(() => (stopped ? undefined : fn())).catch(() => { window.dispatchEvent(new CustomEvent('gloss:sync-error', { detail: '云端同步暂未完成，本机内容已保留。请稍后重试。' })); }));

  async function push() {
    const { entities, busy } = snapshot();
    const rows: { c: Collection; row: OutRow; key: string | null; size: number }[] = [];
    for (const c of COLLECTIONS) {
      const seen = base.seen[c];
      for (const [id, e] of entities[c]) {
        if (seen[id]?.[0] === e.key) continue;
        const row: OutRow = { id, articleId: e.articleId, data: e.data };
        // A text goes up with its first shelf entry, and again when it is replaced (its rev changes).
        // Samples ship with the app.
        if (c === "articles" && (e.data as { origin?: string }).origin !== "sample") {
          const doc = await loadDoc(id);
          if (doc) row.doc = doc;
        }
        rows.push({ c, row, key: e.key, size: JSON.stringify(row).length });
      }
      for (const [id, [, articleId]] of Object.entries(seen)) {
        if (entities[c].has(id) || busy.has(`${c}:${id}`)) continue;
        rows.push({ c, row: { id, articleId, data: {}, deleted: true }, key: null, size: id.length + articleId.length + 64 });
      }
    }
    if (!rows.length) return;

    // Too big for one request even alone: send the shelf entry without the text.
    for (const r of rows) {
      if (r.size > MAX_BODY && r.row.doc) {
        delete r.row.doc;
        r.size = JSON.stringify(r.row).length;
      }
    }

    let batch: typeof rows = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const changes: Partial<Record<Collection, OutRow[]>> = {};
      for (const r of batch) (changes[r.c] ??= []).push(r.row);
      for (const r of batch) r.row.revision = base.revisions[`${r.c}:${r.row.id}`] ?? 0;
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      if (!res.ok) throw new Error(`push ${res.status}`);
      Object.assign(base.revisions, (await res.json()).revisions || {});
      for (const r of batch) {
        if (r.key === null) delete base.seen[r.c][r.row.id];
        else base.seen[r.c][r.row.id] = [r.key, r.row.articleId];
      }
      save();
      batch = [];
      bytes = 0;
    };
    for (const r of rows) {
      if (bytes + r.size > BATCH_BYTES) await flush();
      batch.push(r);
      bytes += r.size;
    }
    await flush();
  }

  async function pull() {
    const q = base.since ? `?since=${encodeURIComponent(new Date(Date.parse(base.since) - OVERLAP_MS).toISOString())}` : "";
    const res = await fetch(`/api/sync${q}`);
    if (!res.ok) throw new Error(`pull ${res.status}`);
    const { now, changes } = (await res.json()) as { now: string; changes: RemoteChanges };
    const local = snapshot();
    for (const c of COLLECTIONS) {
      const rows = changes[c] || [];
      changes[c] = rows.filter((r) => {
        const here = local.entities[c].get(r.id), known = base.seen[c][r.id]?.[0];
        if (here && here.key !== known && here.key !== stable(r.data)) return false;
        base.revisions[`${c}:${r.id}`] = r.revision ?? 0;
        return true;
      }) as never;
    }

    // A text replaced on another device: drop this device's copy so it is fetched fresh on open.
    for (const r of changes.articles ?? []) {
      const before = base.seen.articles[r.id];
      if (!r.deleted && r.data && before && (r.data as { rev?: number }).rev !== undefined && stable(r.data) !== before[0]) void forgetDoc(r.id);
      // Removed on another device: its painted cover goes from this one too.
      if (r.deleted) void forgetCover(r.id);
    }
    useStore.getState().applyRemote(changes);

    // Record what was pulled as what the server has, read back through the same snapshot as a push.
    const { entities } = snapshot();
    for (const c of COLLECTIONS) {
      for (const r of changes[c] ?? []) {
        const e = entities[c].get(r.id);
        if (r.deleted) delete base.seen[c][r.id];
        else if (e) base.seen[c][r.id] = [e.key, e.articleId];
      }
    }
    base.since = now;
    save();
  }

  const sync = () => serial(async () => {
    await pull();
    await push();
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useStore.subscribe((st, prev) => {
    if (!st.hydrated) return;
    if (st.library === prev.library && st.highlights === prev.highlights && st.glosses === prev.glosses && st.briefs === prev.briefs && st.progress === prev.progress) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => serial(push), 2000);
  });

  let lastPull = 0;
  const pullIfStale = (ms: number) => {
    if (document.visibilityState === "hidden" || Date.now() - lastPull < ms) return;
    lastPull = Date.now();
    sync();
  };
  const onVisible = () => {
    if (document.visibilityState === "hidden") serial(push);
    else pullIfStale(watchers ? WATCH_MS : 20_000);
  };
  document.addEventListener("visibilitychange", onVisible);
  const ticker = setInterval(() => watchers && pullIfStale(WATCH_MS - 1000), WATCH_MS);
  poke = () => pullIfStale(3000);

  lastPull = Date.now();
  sync();

  return {
    stop() {
      stopped = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      clearInterval(ticker);
      poke = null;
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}

/** Fetch one text from the account and keep it on this device. Null when signed out or not there. */
export async function fetchText(id: string): Promise<Article | null> {
  try {
    const res = await fetch(`/api/articles/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const { doc } = (await res.json()) as { doc: Article };
    await saveDoc(doc);
    return doc;
  } catch {
    return null;
  }
}
