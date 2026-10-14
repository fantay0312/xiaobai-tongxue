"use client";

import type { LayoutBlock } from "@llamaindex/liteparse-wasm";
import { inlineMd, markdownBlocks, slugify, tidyTitle, undash, type Article, type Block } from "./article";
import { readApiKey } from "./ask";

/**
 * PDF to Gloss blocks, in two passes.
 *
 * 1. LiteParse (Rust, compiled to WebAssembly) reads the text layer in the
 *    browser: reading order across columns, headings, lists and real tables,
 *    a few milliseconds a page. The file itself never leaves the browser.
 * 2. Pages with no usable text layer (scans, pictures of text, garbled
 *    glyphs) are rendered and read by a vision model on the server
 *    (/api/pdf-page), a few at a time.
 *
 * Longer PDFs need the reader's own Together key: every question sends the
 * whole text, so a book would spend a day's free use in a few questions.
 */

export const PDF_FREE_PAGES = 20;
export const PDF_MAX_PAGES = 400;
const WASM = `${import.meta.env.BASE_URL}liteparse-2.15.1.wasm`;
/** The complexity reasons that mean the text layer is missing or unusable. Others ("vector-text") are noise for prose. */
const UNREADABLE = new Set(["scanned", "no-text", "garbled"]);
const VISION_AT_ONCE = 6;
/** At most this many hard pages per PDF are read again in the background. */
const UPGRADE_MAX = 30;
/** Maths symbols, and the private-use or replacement characters of glyphs the text layer could not map. */
const MATHS = /[∑∏∫√≤≥≠≈∂∇∈∉⊂±×÷→⇒∞αβγδεζηθλμσφψωΓΔΘΛΣΦΨΩ]/g;
const BROKEN = /[\ufffd\ue000-\uf8ff]/g;
/** Long side of a page image sent to the vision model, in pixels. */
const VISION_PX = 1600;

export class PdfError extends Error {
  constructor(
    message: string,
    readonly needKey = false
  ) {
    super(message);
  }
}

export type PdfProgress = (pct: number, label?: string) => void;

type LP = typeof import("@llamaindex/liteparse-wasm");
let lib: Promise<LP> | null = null;
function liteparse(): Promise<LP> {
  lib ??= import("@llamaindex/liteparse-wasm").then(async (m) => {
    await m.default({ module_or_path: WASM });
    return m;
  });
  lib.catch(() => (lib = null));
  return lib;
}

const failed = (e: unknown) =>
  new PdfError(/password/i.test(String(e)) ? "这份 PDF 已加密，请解除密码后重试。" : "无法读取这份 PDF。");

export async function pdfToArticle(file: File, onProgress?: PdfProgress): Promise<Article> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lp = await liteparse();
  const parser = new lp.LiteParse({ ocrEnabled: false, outputFormat: "json", extractBlocks: true, imageMode: "off", quiet: true, maxPages: PDF_MAX_PAGES });

  let session: Awaited<ReturnType<typeof parser.openBatchSession>>;
  try {
    session = await parser.openBatchSession(bytes, 25);
  } catch (e) {
    throw failed(e);
  }
  const total = session.totalPages;
  const pages = Math.min(total, PDF_MAX_PAGES);
  const label = `${pages} 页`;
  if (pages > PDF_FREE_PAGES && !readApiKey()) {
    session.free();
    throw new PdfError(`这份 PDF 有 ${pages} 页，请先在设置中选择可用的模型。`, true);
  }

  // Pass 1: the text layer, a batch at a time.
  onProgress?.(0, `正在读取 ${label}`);
  const byPage = new Map<number, LayoutBlock[]>();
  try {
    for (let b = await session.nextBatch(); b; b = await session.nextBatch()) {
      for (const pg of b.result.pages) byPage.set(pg.pageNum, pg.blocks ?? []);
      onProgress?.(b.endPage / pages, `正在读取 ${label}`);
    }
  } catch (e) {
    throw failed(e);
  } finally {
    session.free();
  }

  // Pass 2: pages whose text cannot be read, by a vision model. Pages that can be read but look hard
  // (columns, tables, maths) are kept from the text layer now and read again in the background.
  let unreadable: number[] = [];
  let hard: number[] = [];
  try {
    const stats = await parser.isComplex(bytes);
    unreadable = stats.filter((p) => p.needsOcr && p.reasons.some((r) => UNREADABLE.has(r))).map((p) => p.pageNumber);
    // layout.isComplex, not needsOcr: "vector-text" fires on ordinary prose.
    hard = stats.filter((p) => p.layout?.isComplex && !unreadable.includes(p.pageNumber)).map((p) => p.pageNumber);
  } catch {}
  for (const [p, lbs] of byPage) {
    if (unreadable.includes(p) || hard.includes(p)) continue;
    const t = lbs.map((b) => b.text ?? "").join(" ");
    const words = t.split(/\s+/).filter(Boolean).length;
    if (
      (t.match(MATHS)?.length ?? 0) >= 4 ||
      (t.match(BROKEN)?.length ?? 0) >= 3 ||
      // A table, a grid or a figure the text layer could only approximate.
      lbs.some((b) => b.kind === "table" || b.kind === "grid_fallback" || b.kind === "figure") ||
      // Little text in many pieces: a slide or a form.
      (words < 250 && lbs.length >= 6)
    )
      hard.push(p);
  }
  hard = hard.filter((p) => p <= pages).sort((a, b) => a - b).slice(0, UPGRADE_MAX);
  parser.free();
  const vision = new Map<number, Block[]>();
  if (unreadable.length) await readByVision(lp, bytes, unreadable, vision, onProgress);

  // Assemble in page order: the vision model's reading replaces that page's text layer. Every block
  // keeps its page. Paragraphs are joined across page breaks, but never into or out of a hard page,
  // so that page can later be swapped for a better reading on its own.
  const segments: Block[][] = [[]];
  let title = "";
  const isHard = (p: number) => hard.includes(p);
  for (let p = 1; p <= pages; p++) {
    if (p > 1 && (isHard(p) || isHard(p - 1))) segments.push([]);
    const seg = segments[segments.length - 1];
    const fromVision = vision.get(p);
    if (fromVision) {
      seg.push(...fromVision.map((b) => ({ ...b, page: p })));
      continue;
    }
    for (const lb of byPage.get(p) ?? []) {
      // The first top-level heading near the start is the title.
      if (!title && p <= 2 && lb.kind === "heading" && lb.level === 1 && lb.text && lb.text.length < 200) {
        title = plain(lb.text);
        continue;
      }
      const b = toBlock(lb);
      if (b) seg.push({ ...b, page: p });
    }
  }
  const stitched = segments.flatMap(stitchBlocks);
  // No title from the text layer (a scan, say): the first heading the page reader found.
  if (!title && stitched[0] && (stitched[0].type === "h2" || stitched[0].type === "h3") && text(stitched[0]).length < 200) title = text(stitched.shift()!);
  const blocks = stitched.map((b, i) => ({ ...b, id: `b${i + 1}` }));
  if (!blocks.length) throw new PdfError(unreadable.length ? "无法读取 PDF 页面，请稍后重试。" : "这份 PDF 中没有可读取的文字。");

  if (!title) title = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
  return {
    id: `${slugify(title)}-${Math.random().toString(36).slice(2, 7)}`,
    title: tidyTitle(undash(title)),
    source: `${file.name}${total > PDF_MAX_PAGES ? `，前 ${PDF_MAX_PAGES} 页` : ""}`,
    blocks,
    origin: "file",
    addedAt: Date.now(),
    ...(hard.length ? { upgrade: hard } : {}),
  };
}

/** Pages of a PDF rendered as JPEG data URLs, the way the vision model reads them. */
export async function renderPages(bytes: Uint8Array, pageNums: number[]): Promise<{ pageNum: number; image: string }[]> {
  const lp = await liteparse();
  const shooter = new lp.LiteParse({ ocrEnabled: false, outputFormat: "json", imageMode: "off", quiet: true, extractScreenshots: true, targetPages: pageNums.join(","), dpi: 120 });
  try {
    const shots = (await shooter.parse(bytes)).screenshots;
    return await Promise.all(shots.map(async (s) => ({ pageNum: s.pageNum, image: await pageImage(new Uint8Array(s.imageBytes)) })));
  } finally {
    shooter.free();
  }
}

const plain = (md: string) =>
  inlineMd(md)
    .map((r) => r.text)
    .join("")
    .trim();

/** One LiteParse block as a Gloss block, or nothing for rules, pictures and the shards of diagrams. */
function toBlock(b: LayoutBlock): Block | null {
  const runs = (t: string) => inlineMd(undash(t.replace(/\s+/g, " ").trim()));
  switch (b.kind) {
    case "heading": {
      const t = (b.text ?? "").trim();
      // Labels lifted out of a diagram ("##Coefficient") are not headings.
      if (!t || t.startsWith("#")) return null;
      if (t.length > 160) return { id: "", type: "p", runs: runs(t) };
      return { id: "", type: (b.level ?? 2) <= 2 ? "h2" : "h3", runs: runs(t) };
    }
    case "paragraph":
      return b.text?.trim() ? { id: "", type: "p", runs: runs(b.text) } : null;
    case "list_item":
      return b.text?.trim() ? { id: "", type: "li", runs: runs(b.text) } : null;
    case "code":
    case "grid_fallback": {
      const t = (b.lines ?? []).join("\n").replace(/\s+$/, "");
      return t.trim() ? { id: "", type: "pre", runs: [{ text: t, code: true }] } : null;
    }
    case "table": {
      const rows = [...(b.header ? [b.header] : []), ...(b.rows ?? [])].map((r) => r.map((c) => plain(c.text ?? "")));
      const cells = rows.flat();
      const cols = Math.max(0, ...rows.map((r) => r.length));
      // A diagram read as a grid is mostly empty cells; a real table is mostly full.
      if (rows.length < 2 || cols < 2 || cells.filter(Boolean).length / Math.max(1, cells.length) < 0.6) return null;
      return { id: "", type: "table", runs: [], rows: rows.map((r) => [...r, ...Array(cols - r.length).fill("")]), head: Boolean(b.header) };
    }
    default:
      return null;
  }
}

const text = (b: Block) => b.runs.map((r) => r.text).join("");

/** Short things a page sets between the two halves of a paragraph: footnotes, captions, a figure's labels, a table. */
const LOOKBACK = 10;
const interlude = (b: Block) => b.type !== "p" || text(b).length < 260;

/**
 * Paragraphs broken by a page or column end, or by a footnote, figure or
 * table set in their middle, are joined again: the last long paragraph
 * stops without closing punctuation, and this one starts in lowercase or
 * with a bracket. What sat between them stays, after the joined paragraph.
 */
export function stitchBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === "p" && /^[a-z(\[]/.test(text(b).trimStart())) {
      let at = out.length - 1;
      while (at >= 0 && out.length - at <= LOOKBACK && interlude(out[at])) at--;
      const prev = at >= 0 && out.length - at <= LOOKBACK ? out[at] : null;
      if (prev?.type === "p" && !/[.!?:;"”’)\]]\s*$/.test(text(prev))) {
        out[at] = { ...prev, runs: [...prev.runs, { text: " " }, ...b.runs] };
        continue;
      }
    }
    out.push(b);
  }
  return out;
}

/** A rendered page, shrunk and re-encoded as JPEG, so a scan at full resolution is not megabytes on the wire. */
async function pageImage(png: Uint8Array): Promise<string> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  const k = Math.min(1, VISION_PX / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function readByVision(lp: LP, bytes: Uint8Array, pageNums: number[], into: Map<number, Block[]>, onProgress?: PdfProgress) {
  const apiKey = readApiKey() || undefined;
  let done = 0;
  let stop: PdfError | null = null;
  const label = () => `正在读取扫描页，${done} / ${pageNums.length}`;
  onProgress?.(0, label());

  for (let i = 0; i < pageNums.length && !stop; i += VISION_AT_ONCE) {
    const group = pageNums.slice(i, i + VISION_AT_ONCE);
    const shooter = new lp.LiteParse({ ocrEnabled: false, outputFormat: "json", imageMode: "off", quiet: true, extractScreenshots: true, targetPages: group.join(","), dpi: 120 });
    let shots: { pageNum: number; imageBytes: number[] }[] = [];
    try {
      shots = (await shooter.parse(bytes)).screenshots;
    } catch {}
    shooter.free();

    await Promise.all(
      shots.map(async (s) => {
        try {
          const res = await fetch("/api/pdf-page", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: await pageImage(new Uint8Array(s.imageBytes)), apiKey }),
          });
          const j = (await res.json()) as { markdown?: string; error?: string; code?: string };
          if (j.markdown) into.set(s.pageNum, markdownBlocks(htmlTablesToMarkdown(j.markdown)));
          else if (j.code === "need_key") stop = new PdfError(j.error ?? "请在设置中选择可用的识别模型。", true);
        } catch {}
        done++;
        onProgress?.(done / pageNums.length, label());
      })
    );
  }
  // Out of free use with nothing read at all: say so, rather than an empty text.
  if (stop && !into.size) throw stop;
}

/**
 * Page readers (LlamaParse always, a vision model sometimes) write tables as
 * HTML inside their Markdown; the block parser reads pipe tables. Each <table> becomes one, a merged cell repeated across the
 * columns it spans so the columns stay aligned.
 */
export function htmlTablesToMarkdown(md: string): string {
  return md.replace(/<table[\s\S]*?<\/table>/gi, (html) => {
    const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
    if (!table) return html;
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll("th, td")).flatMap((cell) => {
        const text = (cell.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
        return Array<string>(Math.max(1, Number(cell.getAttribute("colspan")) || 1)).fill(text);
      })
    );
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (!width) return "";
    const line = (r: string[]) => `| ${[...r, ...Array<string>(width - r.length).fill("")].join(" | ")} |`;
    return `\n\n${[line(rows[0]), line(Array<string>(width).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
  });
}
