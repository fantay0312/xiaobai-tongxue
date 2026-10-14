"use client";

import type { Anchor, Point } from "./store";

/**
 * Anchors are stored as (block id, character offset) pairs over each block's
 * plain text. That survives re-renders, theme and font changes, and the
 * highlight spans themselves, which only ever split text nodes.
 */

export const textEl = (blockId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"] .blk-text`);

export const blockEl = (blockId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`);

function offsetWithin(el: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(el);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

function pointFor(node: Node, offset: number, edge: "start" | "end", root: HTMLElement): Point | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const blk = el?.closest<HTMLElement>("[data-block]");
  if (blk && root.contains(blk)) {
    const t = blk.querySelector<HTMLElement>(".blk-text");
    if (!t) return null;
    if (t.contains(node)) return { b: blk.dataset.block!, o: offsetWithin(t, node, offset) };
    // In the paragraph number or padding: snap to the edge of the text.
    return { b: blk.dataset.block!, o: edge === "start" ? 0 : (t.textContent ?? "").length };
  }
  return null;
}

/** Turns the live selection into an anchor, or null if it is not in the text. */
export function selectionToAnchor(sel: Selection | null, root: HTMLElement, texts: Map<string, string>, order: Map<string, number>): Anchor | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  let start = pointFor(range.startContainer, range.startOffset, "start", root);
  let end = pointFor(range.endContainer, range.endOffset, "end", root);

  // Selections that begin or end between blocks: use the blocks they touch.
  if (!start || !end) {
    const touched = Array.from(root.querySelectorAll<HTMLElement>("[data-block]")).filter((b) => range.intersectsNode(b));
    if (!touched.length) return null;
    if (!start) start = { b: touched[0].dataset.block!, o: 0 };
    if (!end) {
      const last = touched[touched.length - 1].dataset.block!;
      end = { b: last, o: (texts.get(last) ?? "").length };
    }
  }

  // An end at offset 0 of a following block means the selection really ended before it.
  if (end.o === 0 && end.b !== start.b) {
    const ids = [...order.keys()];
    const prev = ids[(order.get(end.b) ?? 1) - 1];
    if (prev) end = { b: prev, o: (texts.get(prev) ?? "").length };
  }

  const quote = quoteFor({ start, end }, texts, order);
  if (!quote.trim()) return null;
  return trimAnchor({ start, end, quote }, texts);
}

/** Drops leading and trailing whitespace from the anchored span. */
function trimAnchor(a: Anchor, texts: Map<string, string>): Anchor {
  const s = texts.get(a.start.b) ?? "";
  const e = texts.get(a.end.b) ?? "";
  let so = a.start.o;
  let eo = a.end.o;
  while (so < s.length && /\s/.test(s[so]) && !(a.start.b === a.end.b && so >= eo)) so++;
  while (eo > 0 && /\s/.test(e[eo - 1]) && !(a.start.b === a.end.b && eo <= so)) eo--;
  return { start: { b: a.start.b, o: so }, end: { b: a.end.b, o: eo }, quote: a.quote.trim() };
}

export function quoteFor(a: { start: Point; end: Point }, texts: Map<string, string>, order: Map<string, number>): string {
  const ids = [...order.keys()];
  const si = order.get(a.start.b) ?? 0;
  const ei = order.get(a.end.b) ?? si;
  const parts: string[] = [];
  for (let i = si; i <= ei; i++) {
    const id = ids[i];
    const t = texts.get(id) ?? "";
    const from = i === si ? a.start.o : 0;
    const to = i === ei ? a.end.o : t.length;
    parts.push(t.slice(from, to));
  }
  return parts.join("\n\n");
}

function locate(el: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Node | null = null;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.textContent?.length ?? 0;
    if (seen + len >= offset) return { node: n, offset: offset - seen };
    seen += len;
    last = n;
  }
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : { node: el, offset: 0 };
}

/** A live DOM range for an anchor, rebuilt from offsets on demand. */
export function anchorToRange(a: { start: Point; end: Point }): Range | null {
  const s = textEl(a.start.b);
  const e = textEl(a.end.b);
  if (!s || !e) return null;
  const r = document.createRange();
  const sp = locate(s, a.start.o);
  const ep = locate(e, a.end.o);
  try {
    r.setStart(sp.node, sp.offset);
    r.setEnd(ep.node, ep.offset);
  } catch {
    return null;
  }
  return r;
}

/** Compare two points in reading order. */
export function cmp(a: Point, b: Point, order: Map<string, number>): number {
  const d = (order.get(a.b) ?? 0) - (order.get(b.b) ?? 0);
  return d !== 0 ? d : a.o - b.o;
}

/** The [from, to) character span an anchor covers inside one block, if any. */
export function spanIn(a: { start: Point; end: Point }, blockId: string, len: number, order: Map<string, number>): [number, number] | null {
  const bi = order.get(blockId);
  const si = order.get(a.start.b);
  const ei = order.get(a.end.b);
  if (bi === undefined || si === undefined || ei === undefined || bi < si || bi > ei) return null;
  const from = bi === si ? a.start.o : 0;
  const to = bi === ei ? a.end.o : len;
  return to > from ? [from, to] : null;
}

export function selectBlock(blockId: string) {
  const t = textEl(blockId);
  if (!t) return;
  const r = document.createRange();
  r.selectNodeContents(t);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
