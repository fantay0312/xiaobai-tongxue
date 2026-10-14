"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * The desk at the foot of the landing: one frame, the same size whatever is
 * on it, so the page never jumps between visits. A line to name it, three
 * tiles (or one wide one), and a quiet line under them.
 */
export function Desk({ label, aside, foot, children }: { label: ReactNode; aside?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  return (
    <section className="desk" aria-label={typeof label === "string" ? label : undefined}>
      <header className="desk-head">
        <h2 className="desk-label">{label}</h2>
        {aside && <div className="desk-aside">{aside}</div>}
      </header>
      {children}
      <p className="desk-foot">{foot}</p>
    </section>
  );
}

/** A quiet link in the desk's header: to all highlights, or to the library. */
export function DeskLink({ onClick, href, children }: { onClick?: () => void; href?: string; children: ReactNode }) {
  const body = (
    <>
      {children}
      <ArrowRight size={13} aria-hidden />
    </>
  );
  return href ? (
    <Link href={href} className="desk-link">
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className="desk-link">
      {body}
    </button>
  );
}
