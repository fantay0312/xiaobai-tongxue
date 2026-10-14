"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Side = "top" | "bottom" | "left" | "right";
/**
 * How a tip arrives: "pop" grows in from its control, "quick" just appears
 * (another tip was showing a moment ago), "move" travels over from the tip
 * that is showing now.
 */
type Mode = "pop" | "quick" | "move";
type Tip = { el: HTMLElement; label: string; hint?: string; kbd?: string; side: Side; tone: "ink" | "paper"; mode: Mode };
type Spot = { x: number; y: number; w: number; h: number; side: Side };

const GAP = 8;
const EDGE = 8;
/** A tip slides only to a control this close by. Farther, it fades in where it is needed. */
const SLIDE_MAX = 220;
/** A tip that left less than this long ago comes back without its entrance. */
const WARM_MS = 300;
/** Leaving a control, the tip waits this long for the next one, then fades for FADE_MS. */
const GRACE_MS = 70;
const FADE_MS = 110;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function read(el: HTMLElement, mode: Mode): Tip {
  const d = el.dataset;
  const r = el.getBoundingClientRect();
  return {
    el,
    label: d.tip ?? "",
    hint: d.tipHint || undefined,
    kbd: d.tipKbd || undefined,
    side: (d.tipSide as Side) || (r.top < 96 ? "bottom" : "top"),
    tone: el.closest<HTMLElement>("[data-tip-tone]")?.dataset.tipTone === "paper" ? "paper" : "ink",
    mode,
  };
}

/** Where the tip box goes for a control: its preferred side, flipped and clamped to stay on screen. */
function spot(tip: Tip, w: number, h: number): Spot {
  const r = tip.el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let side = tip.side;
  if (side === "top" && r.top - h - GAP < EDGE) side = "bottom";
  else if (side === "bottom" && r.bottom + h + GAP > vh - EDGE) side = "top";
  let x = side === "left" ? r.left - w - GAP : side === "right" ? r.right + GAP : r.left + r.width / 2 - w / 2;
  let y = side === "top" ? r.top - h - GAP : side === "bottom" ? r.bottom + GAP : r.top + r.height / 2 - h / 2;
  x = Math.max(EDGE, Math.min(vw - w - EDGE, x));
  y = Math.max(EDGE, Math.min(vh - h - EDGE, y));
  return { x: Math.round(x), y: Math.round(y), w, h, side };
}

/**
 * One tooltip for the whole app. Anything with data-tip gets it: instantly on
 * hover or keyboard focus, never on touch. It always appears at its control:
 * moving along a row of controls, it slides from one to the next; anywhere
 * else it fades in where it is needed, and never travels across the screen.
 * Optional: data-tip-hint (a second, quieter phrase), data-tip-kbd (a key),
 * data-tip-side, and data-tip-tone="paper" on a dark surface.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [leaving, setLeaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // The refs are the truth for the event handlers; the state only renders it.
  const tipRef = useRef<Tip | null>(null);
  const leavingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef(0);
  // Where the box was last placed while visible, so the next tip knows whether to slide.
  const placed = useRef<Spot | null>(null);
  // After a click, the control under the pointer stays quiet until it is left.
  const muted = useRef<HTMLElement | null>(null);

  const render = (t: Tip | null, out = false) => {
    tipRef.current = t;
    leavingRef.current = out;
    setTip(t);
    setLeaving(out);
  };

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    // Gone at once: on a click, a scroll, Escape, or when the control goes away.
    const gone = () => {
      clear();
      if (tipRef.current) hiddenAt.current = Date.now();
      placed.current = null;
      render(null);
    };
    const show = (el: HTMLElement) => {
      if (!el.dataset.tip || el.getAttribute("aria-expanded") === "true") return gone();
      clear();
      const visible = tipRef.current !== null && !leavingRef.current;
      const warm = tipRef.current !== null || Date.now() - hiddenAt.current < WARM_MS;
      render(read(el, visible ? "move" : warm ? "quick" : "pop"));
    };
    // Leaving a control: a moment's grace for the next one along, then a quick fade.
    const hide = () => {
      if (!tipRef.current || leavingRef.current) return;
      clear();
      timer.current = setTimeout(() => {
        hiddenAt.current = Date.now();
        placed.current = null;
        render(tipRef.current, true);
        timer.current = setTimeout(gone, FADE_MS);
      }, GRACE_MS);
    };
    const tipped = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = tipped(e.target);
      if (!el) return;
      if (el === muted.current) return tipRef.current && tipRef.current.el !== el ? gone() : undefined;
      if (el !== tipRef.current?.el || leavingRef.current) show(el);
      else clear();
    };
    const out = (e: PointerEvent) => {
      const m = muted.current;
      if (m && !(e.relatedTarget instanceof Node && m.contains(e.relatedTarget))) muted.current = null;
      const from = tipped(e.target);
      if (!from) return;
      const to = tipped(e.relatedTarget);
      if (to === from) return;
      if (!to) hide();
    };
    const down = (e: PointerEvent) => {
      const el = tipped(e.target);
      if (el) muted.current = el;
      gone();
    };
    const focusIn = (e: FocusEvent) => {
      const el = tipped(e.target);
      if (el && el.matches(":focus-visible")) show(el);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && tipRef.current) gone();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", gone);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", gone, { passive: true, capture: true });
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", gone);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", gone, { capture: true });
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
      clear();
    };
  }, []);

  // A control can unmount or change its label under the tip.
  useEffect(() => {
    if (!tip) return;
    const mo = new MutationObserver(() => {
      if (!tip.el.isConnected || !tip.el.dataset.tip) render(null);
      else if (tip.el.dataset.tip !== tip.label || tip.el.dataset.tipHint !== tip.hint) render(read(tip.el, "move"), leavingRef.current);
    });
    mo.observe(tip.el, { attributes: true, attributeFilter: ["data-tip", "data-tip-hint", "aria-expanded"] });
    const gone = setInterval(() => !tip.el.isConnected && render(null), 200);
    return () => {
      mo.disconnect();
      clearInterval(gone);
    };
  }, [tip]);

  // Placed before the first paint, at its control. The only motion across the
  // screen is a slide from where the last tip visibly was, centre to centre,
  // and only to a control close by. Nothing ever starts from the corner.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!tip || !box || leavingRef.current) return;
    const seen = box.getBoundingClientRect(); // where the box shows now, mid-slide included
    const at = spot(tip, box.offsetWidth, box.offsetHeight);
    const from = placed.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slide = !still && tip.mode === "move" && from !== null && from.side === at.side && Math.hypot(from.x - at.x, from.y - at.y) <= SLIDE_MAX;
    for (const a of box.getAnimations()) a.cancel();
    box.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
    box.dataset.side = at.side;
    placed.current = at;
    if (slide && from) {
      // From the old tip's centre, with the new tip's size, kept on screen.
      const sx = Math.max(EDGE, Math.min(window.innerWidth - at.w - EDGE, seen.left + from.w / 2 - at.w / 2));
      const sy = at.side === "top" ? seen.top + from.h - at.h : seen.top;
      box.animate([{ transform: `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0)` }, { transform: box.style.transform }], { duration: 180, easing: EASE });
      return;
    }
    const face = box.firstElementChild as HTMLElement | null;
    if (!face || still || tip.mode === "quick") return;
    if (tip.mode === "pop") {
      const d = 4;
      const [dx, dy] = at.side === "top" ? [0, d] : at.side === "bottom" ? [0, -d] : at.side === "left" ? [d, 0] : [-d, 0];
      face.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.96)` }, { opacity: 1, transform: "none" }], { duration: 150, easing: EASE });
    } else {
      face.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: "ease-out" });
    }
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={boxRef} className={`tip-box${leaving ? " is-leaving" : ""}`} aria-hidden>
      <div className={`tip tip-${tip.tone}`}>
        <span className="tip-main">
          <span className="font-medium">{tip.label}</span>
          {tip.kbd && <kbd className="tip-kbd">{tip.kbd}</kbd>}
        </span>
        {tip.hint && <span className="tip-hint">{tip.hint}</span>}
      </div>
    </div>
  );
}
