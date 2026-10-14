"use client";

import { ACTION_QUESTIONS, ACTIONS } from "./actions";
import { numberBlocks, slugify, tidyTitle, undash } from "./article";
import { SAMPLES } from "./samples";
import { loadDoc, useStore, type Gloss, type Highlight, type Point, type Turn } from "./store";
import { zip } from "./zip";

/**
 * Notes as Markdown: one text's questions, answers, highlights and the
 * reader's own notes, in reading order. The notebook copies one; the shelf
 * exports them all as a zip of files that drop straight into Obsidian.
 */

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The first turn answers the gloss itself; after that, user and assistant turns alternate. */
export function pairsOf(g: Gloss): { q: string; a?: Turn }[] {
  const pairs: { q: string; a?: Turn }[] = [{ q: capFirst(g.question ?? (g.anchor ? ACTION_QUESTIONS[g.action] : "关于全文")), a: g.turns[0] }];
  for (const t of g.turns.slice(1)) {
    if (t.role === "user") pairs.push({ q: capFirst(t.content) });
    else pairs[pairs.length - 1].a = t;
  }
  return pairs;
}

export type NotesMeta = { title: string; author?: string; published?: string; source?: string; url?: string };
/** Paragraph numbers and block order, when the text itself is at hand. */
export type Place = { numbers: Map<string, number>; order: Map<string, number> };

type Entry = { kind: "gloss"; g: Gloss } | { kind: "hl"; h: Highlight };

const yaml = (s: string) => JSON.stringify(s);
const day = (t: number) => new Date(t).toLocaleDateString("zh-CN", { day: "numeric", month: "short", year: "numeric" });

export function notesMarkdown(meta: NotesMeta, glosses: Gloss[], highlights: Highlight[], place?: Place, opts: { frontmatter?: boolean } = {}): string {
  const pos = (e: Entry): Point | null => (e.kind === "hl" ? e.h.anchor.start : e.g.anchor?.start ?? (e.g.at ? { b: e.g.at, o: 0 } : null));
  const entries: Entry[] = [...glosses.map((g) => ({ kind: "gloss" as const, g })), ...highlights.map((h) => ({ kind: "hl" as const, h }))];
  const created = (e: Entry) => (e.kind === "hl" ? e.h.createdAt : e.g.createdAt);
  entries.sort((a, b) => {
    const pa = pos(a);
    const pb = pos(b);
    if (place && pa && pb) {
      const d = (place.order.get(pa.b) ?? 0) - (place.order.get(pb.b) ?? 0);
      if (d) return d;
      if (pa.o !== pb.o) return pa.o - pb.o;
    }
    return created(a) - created(b);
  });
  const num = (b?: string) => (b && place ? place.numbers.get(b) : undefined);

  const lines: string[] = [];
  if (opts.frontmatter) {
    lines.push("---", `title: ${yaml(meta.title)}`);
    if (meta.author) lines.push(`author: ${yaml(meta.author)}`);
    if (meta.published) lines.push(`published: ${yaml(meta.published)}`);
    if (meta.source) lines.push(`source: ${yaml(meta.source)}`);
    if (meta.url) lines.push(`url: ${meta.url}`);
    lines.push("tags: [gloss]", "---", "");
  }
  lines.push(`# ${meta.title}`);
  const by = [meta.author, meta.published].filter(Boolean).join(", ");
  if (by) lines.push(by);
  if (meta.url && !opts.frontmatter) lines.push(meta.url);
  lines.push("", `Notes from Gloss, ${day(Date.now())}`, "");

  for (const e of entries) {
    if (e.kind === "hl") {
      const n = num(e.h.anchor.start.b);
      lines.push(`> ${e.h.anchor.quote.replace(/\n+/g, " ")}`);
      if (n) lines.push(`> (¶${n})`);
      lines.push("");
      if (e.h.note) lines.push(e.h.note.trim(), "");
      continue;
    }
    const g = e.g;
    const n = num(g.anchor?.start.b ?? g.at);
    lines.push(`## ${g.anchor ? ACTIONS[g.action].label : "问题"}${n ? ` (¶${n})` : ""}`);
    if (g.anchor) lines.push(`> ${g.anchor.quote.replace(/\n+/g, " ")}`, "");
    for (const p of pairsOf(g)) {
      lines.push(`**${p.q}**`, "");
      if (p.a?.content) lines.push(undash(p.a.content), "");
      // Web citations as Markdown footnotes, so [1] in the answer still leads somewhere.
      if (p.a?.content && p.a.sources?.length) lines.push(...p.a.sources.map((x) => `[${x.n}]: ${x.url} "${x.title.replace(/"/g, "'")}"`), "");
    }
  }
  return lines.join("\n").trim() + "\n";
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Every text with something in it, one Markdown file each, in a zip. Returns how many files. */
export async function exportAll(): Promise<number> {
  const st = useStore.getState();
  const ids = [...new Set([...Object.keys(st.glosses), ...Object.keys(st.highlights)])].filter(
    (id) => (st.glosses[id]?.length ?? 0) + (st.highlights[id]?.length ?? 0) > 0
  );
  const files: { name: string; text: string }[] = [];
  const taken = new Set<string>();

  for (const id of ids) {
    const item = st.library.find((x) => x.id === id);
    const doc = SAMPLES.find((a) => a.id === id) ?? (await loadDoc(id));
    const title = tidyTitle(item?.title ?? doc?.title ?? id);
    const meta: NotesMeta = {
      title,
      author: doc?.author ?? item?.author,
      published: doc?.published,
      source: doc?.source ?? item?.source,
      url: doc?.sourceUrl,
    };
    const place = doc ? { numbers: numberBlocks(doc.blocks), order: new Map(doc.blocks.map((b, i) => [b.id, i])) } : undefined;
    const glosses = (st.glosses[id] ?? []).filter((g) => g.turns.some((t) => t.content));
    let base = slugify(title);
    for (let k = 2; taken.has(base); k++) base = `${slugify(title)}-${k}`;
    taken.add(base);
    files.push({ name: `Gloss/${base}.md`, text: notesMarkdown(meta, glosses, st.highlights[id] ?? [], place, { frontmatter: true }) });
  }

  if (files.length) download(zip(files), `gloss-notes-${new Date().toISOString().slice(0, 10)}.zip`);
  return files.length;
}
