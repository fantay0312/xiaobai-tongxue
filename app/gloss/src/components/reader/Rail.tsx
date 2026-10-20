"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGlosses, useHighlights, useStore } from "@/lib/store";
import { useReader } from "./context";

type Geo = { docTop: number; docH: number; blocks: { id: string; top: number; h: number; heading: boolean; fill: number }[] };

/** How much wider a bar beside the reading position grows; it eases back further away. */
const MAGNIFY = 0.9;
const BAR_W = 18;
const ease = "0.35s cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * A scrollbar that maps the text as far as you have read. The track is the
 * whole length; paragraphs appear as bars once you have scrolled to them, and
 * swell beside where you are reading. Highlights are yellow, glosses are
 * vermilion dots, and the brief's sections are ticks. Click or drag anywhere,
 * read or not, to travel.
 */
export function Rail({ articleEl }: { articleEl: HTMLElement | null }) {
  const { ix } = useReader();
  const glosses = useGlosses(ix.article.id);
  const highlights = useHighlights(ix.article.id);
  const brief = useStore((s) => s.briefs[ix.article.id]);
  const size = useStore((s) => s.settings.size);
  const railRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [railH, setRailH] = useState(0);
  const [view, setView] = useState({ top: 0, h: 0 });
  // The furthest down the text the reader has come, in text pixels.
  const [reached, setReached] = useState(0);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const drag = useRef(false);

  const measure = useCallback(() => {
    if (!articleEl || !railRef.current) return;
    const r = articleEl.getBoundingClientRect();
    const docTop = r.top + window.scrollY;
    const blocks = Array.from(articleEl.querySelectorAll<HTMLElement>("[data-block]")).map((el) => {
      const br = el.getBoundingClientRect();
      const len = (el.textContent ?? "").length;
      return {
        id: el.dataset.block!,
        top: br.top - r.top,
        h: br.height,
        heading: el.dataset.type === "h2" || el.dataset.type === "h3",
        fill: Math.min(1, 0.45 + len / 1400),
      };
    });
    setGeo({ docTop, docH: r.height, blocks });
    setRailH(railRef.current.clientHeight);
  }, [articleEl]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    if (articleEl) {
      ro.observe(articleEl);
      if (articleEl.parentElement) ro.observe(articleEl.parentElement);
    }
    if (railRef.current) ro.observe(railRef.current);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [measure, articleEl, size]);

  useEffect(() => {
    if (!geo) return;
    const on = () => {
      const top = window.scrollY - geo.docTop;
      setView({ top, h: window.innerHeight });
      setReached((r) => Math.max(r, top + window.innerHeight));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [geo]);

  if (!geo || geo.docH <= 0) return <div ref={railRef} className="h-full" />;
  const k = railH / geo.docH;
  const posOf = (blockId: string) => {
    const b = geo.blocks.find((x) => x.id === blockId);
    return b ? b.top * k : null;
  };

  const travel = (clientY: number) => {
    const rr = railRef.current?.getBoundingClientRect();
    if (!rr) return;
    const y = Math.max(0, Math.min(railH, clientY - rr.top));
    window.scrollTo({ top: geo.docTop + y / k - window.innerHeight * 0.3, behavior: drag.current ? "instant" : "smooth" });
  };

  const sections = brief?.status === "ready" ? brief.data.sections : [];
  const hoverSection = (() => {
    if (hoverY === null || !sections.length) return null;
    let found: { title: string; start: number; y: number } | null = null;
    for (const s of sections) {
      const id = ix.byNumber.get(s.start);
      const y = id ? posOf(id) : null;
      if (y !== null && y <= hoverY + 2) found = { ...s, y };
    }
    return found;
  })();

  const vTop = Math.max(0, view.top * k);
  const vH = Math.max(14, Math.min(railH - vTop, view.h * k));
  const reachedY = Math.min(railH, reached * k);
  const shown = (y: number) => y <= reachedY;
  // A soft lens centred on the visible stretch of text.
  const center = vTop + vH / 2;
  const sigma = 24 + vH / 2;
  const lens = (y: number) => 1 + MAGNIFY * Math.exp(-((y - center) ** 2) / (2 * sigma * sigma));

  return (
    <div
      ref={railRef}
      role="slider"
      aria-label="阅读位置"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, Math.min(1, (view.top + view.h * 0.3) / geo.docH)) * 100)}
      tabIndex={-1}
      className="group relative h-full cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        drag.current = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        travel(e.clientY);
        drag.current = true;
      }}
      onPointerMove={(e) => {
        const rr = railRef.current?.getBoundingClientRect();
        if (rr) setHoverY(e.clientY - rr.top);
        if (drag.current && e.buttons) travel(e.clientY);
      }}
      onPointerUp={() => (drag.current = false)}
      onPointerLeave={() => setHoverY(null)}
    >
      {/* The track: the whole text, darker over the part already read. */}
      <span aria-hidden className="pointer-events-none absolute left-[4px] top-0 h-full w-px bg-rule" />
      <span aria-hidden className="pointer-events-none absolute left-[4px] top-0 w-px bg-ink-4" style={{ height: reachedY, transition: `height ${ease}` }} />

      {geo.blocks.map((b) => {
        const y = b.top * k;
        const h = Math.max(1, b.h * k - 2);
        const on = shown(y);
        const s = lens(y + h / 2);
        const base = b.heading ? 0.8 : 0.75;
        return (
          <span
            key={b.id}
            className="absolute left-[6px]"
            style={{
              top: y,
              height: h,
              width: b.heading ? BAR_W : BAR_W * b.fill,
              background: b.heading
                ? "var(--ink-2)"
                : "repeating-linear-gradient(to bottom, var(--ink-4) 0 1px, transparent 1px 3px)",
              opacity: on ? Math.min(1, base + 0.25 * ((s - 1) / MAGNIFY)) : 0,
              transform: `scaleX(${on ? s : 0})`,
              transformOrigin: "left center",
              transition: `transform ${ease}, opacity ${ease}`,
            }}
          />
        );
      })}

      {sections.map((s) => {
        const id = ix.byNumber.get(s.start);
        const y = id ? posOf(id) : null;
        return y === null || !shown(y) ? null : <span key={s.start} className="absolute left-0 h-px w-[5px] bg-ink-3" style={{ top: y }} />;
      })}

      {highlights.map((h) => {
        const y = posOf(h.anchor.start.b);
        return y === null || !shown(y) ? null : (
          <span
            key={h.id}
            className="absolute left-[4px] w-[22px] rounded-[1px] bg-[var(--hl-strong)]"
            style={{ top: y, height: 4, transform: `scaleX(${lens(y)})`, transformOrigin: "left center", transition: `transform ${ease}` }}
          />
        );
      })}

      {glosses.map((g) => {
        const id = g.anchor?.start.b ?? g.at;
        const y = id ? posOf(id) : null;
        return y === null || !shown(y) ? null : (
          <span
            key={g.id}
            className="absolute left-[25px] size-[5px] rounded-full bg-[var(--rubric)]"
            style={{ top: y, transform: `translateX(${BAR_W * (lens(y) - 1)}px)`, transition: `transform ${ease}` }}
          />
        );
      })}

      <span
        className="pointer-events-none absolute -left-[2px] w-[46px] rounded-[7px] border border-ink-3/35 bg-ink/[0.035] transition-[border-color] group-hover:border-ink-3/70"
        style={{ top: vTop, height: vH }}
        aria-hidden
      />

      {hoverSection && (
        <span
          className="pointer-events-none absolute left-[52px] z-10 whitespace-nowrap rounded-md bg-lens px-2 py-1 text-[11.5px] text-lens-fg shadow-pop"
          style={{ top: Math.max(0, hoverSection.y - 4), animation: "fade 0.15s" }}
        >
          {hoverSection.title}
          <span className="ml-2 text-[11px] tabular-nums text-lens-mute">¶{hoverSection.start}</span>
        </span>
      )}
    </div>
  );
}
