"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A button that opens a small panel. Closes on outside click and Escape. */
export function Popover({
  label,
  trigger,
  children,
  align = "right",
  width = 300,
  triggerClass = "",
  tip,
  openOn,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  triggerClass?: string;
  /** The trigger's tooltip; defaults to the label. */
  tip?: string;
  /** A window event that opens the panel from elsewhere on the page. */
  openOn?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 56, width, maxHeight: 600 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const w = Math.min(width, right - left - 24);
      const x = Math.max(left + 12, Math.min(align === "right" ? anchor.right - w : anchor.left, right - w - 12));
      const y = Math.max(top + 12, Math.min(anchor.bottom + 8, bottom - 120));
      setPosition({ left: x, top: y, width: w, maxHeight: Math.max(96, bottom - y - 12) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, width, align]);

  useEffect(() => {
    if (!openOn) return;
    // On the next frame, so the click that sent the event does not count as an outside click.
    const show = () => requestAnimationFrame(() => setOpen(true));
    window.addEventListener(openOn, show);
    return () => window.removeEventListener(openOn, show);
  }, [openOn]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // During a view transition the pointer lands on the root's snapshot, not on the page.
      if (e.target === document.documentElement && document.documentElement.classList.contains("theme-swap")) return;
      if (!ref.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector("button")?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        data-tip={open ? undefined : tip ?? label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={`${triggerClass} ${open ? "bg-sunk text-ink" : ""}`}
      >
        {trigger}
      </button>
      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          className="pop scroll-thin fixed z-[60] overflow-y-auto overscroll-contain p-4"
          style={{ ...position, ["--origin" as string]: align === "right" ? "top right" : "top left" }}
        >
          {children(() => setOpen(false))}
        </div>, document.body
      )}
    </div>
  );
}

/** Every nav control: same height, same center line, same hover. */
export const barBtn =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium leading-none text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-sunk hover:text-ink active:scale-[0.94]";
