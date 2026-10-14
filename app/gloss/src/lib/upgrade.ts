"use client";

/**
 * Hard PDF pages, read again in the background. The import shows LiteParse's
 * reading at once; pages whose layout looked hard (columns, tables, maths)
 * are listed in article.upgrade and read here by Qwen3.5-9B through
 * /api/pdf-page (mode "layout"), then swapped in one page at a time.
 * On hard pages it scored 6.9/10 in scripts/pdf-eval against 3.9 for the text layer.
 *
 * A page is swapped only while that is safe for what the reader has done:
 * - never once the text has a gloss or a whole-text gloss, since both cite ¶
 *   numbers and a swap renumbers every paragraph after the page;
 * - never on a page with a highlight anchored to it;
 * - only when the new reading is plausible: not empty, within half to twice
 *   the length of the old, keeping its headings and most of its words (a
 *   model that describes a figure instead of transcribing fails this).
 * New blocks get their own ids (u<page>-<n>), so every other block and mark is untouched.
 */

import { blockText, markdownBlocks, modelText, wordCount, type Article, type Block } from "./article";
import { readApiKey } from "./ask";
import { htmlTablesToMarkdown, renderPages } from "./pdf";
import { loadDoc, loadPdf, saveDoc, useStore } from "./store";

const AT_ONCE = 4;

export type UpgradeProgress = { done: number; total: number; active: boolean };

/** Once anything cites paragraph numbers, the paragraphs stay as they are. */
function frozen(id: string): boolean {
  const st = useStore.getState();
  return (st.glosses[id]?.length ?? 0) > 0 || Boolean(st.briefs[id]);
}

/** Ids of every block a highlight covers, from its first block to its last. */
function marked(doc: Article): Set<string> {
  const order = new Map(doc.blocks.map((b, i) => [b.id, i]));
  const ids = new Set<string>();
  for (const h of useStore.getState().highlights[doc.id] ?? []) {
    const a = order.get(h.anchor.start.b);
    const z = order.get(h.anchor.end.b);
    if (a === undefined || z === undefined) continue;
    for (let i = Math.min(a, z); i <= Math.max(a, z); i++) ids.add(doc.blocks[i].id);
  }
  return ids;
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/** A heading that is the title again, give or take a word or punctuation (a running head, a subtitle run on). */
function isTitle(heading: string, title: string): boolean {
  const h = words(heading);
  const t = new Set(words(title));
  return h.length > 0 && h.filter((w) => t.has(w)).length / h.length >= 0.8 && Math.abs(h.length - t.size) <= 3;
}

/** Whether a new reading of a page can stand in for the old one. */
export function plausible(old: Block[], next: Block[]): boolean {
  const before = old.map(modelText).join(" ");
  const after = next.map(modelText).join(" ");
  if (after.trim().length < 40) return false;
  if (before.length > 200) {
    const ratio = after.length / before.length;
    if (ratio < 0.5 || ratio > 2) return false;
  }
  const have = new Set(words(after));
  const found = (ws: string[]) => (ws.length ? ws.filter((w) => have.has(w)).length / ws.length : 1);
  // Headings the text layer found must survive; so must most of its words.
  if (old.some((b) => (b.type === "h2" || b.type === "h3") && found(words(blockText(b))) < 0.7)) return false;
  const was = words(before);
  return was.length < 30 || found(was) >= 0.6;
}

/**
 * One run per text, which finishes even if the reader leaves the page: the
 * work belongs to the text, not to the screen showing it. Screens subscribe
 * to its progress.
 */
const runs = new Map<string, { listeners: Set<(p: UpgradeProgress) => void>; last: UpgradeProgress }>();

/** Reads this text's pending pages (once, however often it is called) and reports progress until unsubscribed. */
export function startUpgrade(id: string, listener: (p: UpgradeProgress) => void): () => void {
  const existing = runs.get(id);
  if (existing) {
    existing.listeners.add(listener);
    listener(existing.last);
    return () => existing.listeners.delete(listener);
  }
  const run = { listeners: new Set([listener]), last: { done: 0, total: 0, active: false } as UpgradeProgress };
  runs.set(id, run);
  const onProgress = (p: UpgradeProgress) => {
    run.last = p;
    for (const l of run.listeners) l(p);
  };
  let stopped = false;

  void (async () => {
    let done = 0;
    let total = 0;
    try {
      const first = await loadDoc(id);
      const pending = first?.upgrade ?? [];
      if (!first || !pending.length || frozen(id)) return;
      const pdf = await loadPdf(id);
      // Another device has the text but not the file: nothing to read from.
      if (!pdf) return;
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const apiKey = readApiKey() || undefined;
      total = pending.length;
      onProgress({ done, total, active: true });

      for (let i = 0; i < pending.length && !stopped; i += AT_ONCE) {
        const group = pending.slice(i, i + AT_ONCE);
        let shots: { pageNum: number; image: string }[] = [];
        try {
          shots = await renderPages(bytes, group);
        } catch {}
        const readings = await Promise.all(
          shots.map(async (s) => {
            try {
              const res = await fetch("/api/pdf-page", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: s.image, apiKey, mode: "layout" }),
              });
              const j = (await res.json()) as { markdown?: string; code?: string };
              return { page: s.pageNum, markdown: j.markdown, spent: j.code === "need_key" };
            } catch {
              return { page: s.pageNum, markdown: undefined, spent: false };
            }
          })
        );

        for (const r of readings) {
          // Free use spent: keep the text layer and the list, and try again another day.
          if (r.spent) stopped = true;
          if (stopped) break;
          const doc = await loadDoc(id);
          if (!doc || frozen(id)) return;
          const rest = (doc.upgrade ?? []).filter((p) => p !== r.page);
          const old = doc.blocks.filter((b) => b.page === r.page);
          let next = r.markdown ? markdownBlocks(htmlTablesToMarkdown(r.markdown)) : [];
          // The title, if it came from this page, is already shown above the text.
          if (next[0] && (next[0].type === "h2" || next[0].type === "h3") && isTitle(blockText(next[0]), doc.title)) next = next.slice(1);
          const hit = marked(doc);
          if (next.length && plausible(old, next) && !old.some((b) => hit.has(b.id))) {
            const fresh = next.map((b, k) => ({ ...b, id: `u${r.page}-${k + 1}`, page: r.page }));
            const blocks = [...doc.blocks.filter((b) => (b.page ?? 0) < r.page), ...fresh, ...doc.blocks.filter((b) => (b.page ?? 0) > r.page)];
            const updated: Article = { ...doc, blocks, upgrade: rest.length ? rest : undefined };
            if (await useStore.getState().updateText(updated, wordCount(updated))) window.dispatchEvent(new CustomEvent("gloss:text-replaced", { detail: updated }));
          } else {
            // Not better, or marked since: the text layer's reading stays, and the page leaves the list.
            await saveDoc({ ...doc, upgrade: rest.length ? rest : undefined });
          }
          done++;
          onProgress({ done, total, active: true });
        }
      }
    } finally {
      onProgress({ done, total, active: false });
      runs.delete(id);
    }
  })();

  return () => run.listeners.delete(listener);
}
