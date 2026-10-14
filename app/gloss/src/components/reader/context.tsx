"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { DocIndex } from "@/lib/doc";

export type ReaderApi = {
  ix: DocIndex;
  /** Scroll a paragraph into view and flash it. */
  jumpTo: (n: number, opts?: { flash?: boolean }) => void;
  jumpToBlock: (blockId: string, opts?: { flash?: boolean }) => void;
  /** Show a floating preview of a paragraph next to a citation chip. */
  peek: (n: number | null, rect?: DOMRect) => void;
};

export const ReaderContext = createContext<ReaderApi | null>(null);

export function useReader(): ReaderApi {
  const v = useContext(ReaderContext);
  if (!v) throw new Error("useReader outside ReaderContext");
  return v;
}

export function useMedia(query: string, fallback = false): boolean {
  const [match, setMatch] = useState(fallback);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const fmtCost = (usd: number) => (!Number.isFinite(usd) ? '按服务端用量结算' : usd < 0.0001 ? "<$0.0001" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`);

export const fmtTokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US"));
