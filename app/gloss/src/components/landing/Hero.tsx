import type { ReactNode } from "react";

/**
 * The landing's top: what Gloss does, in one line, and the place to start.
 * "any line" is marked the way a reader marks: the wash, then the pen under it.
 */
export function Hero({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[980px] flex-col items-center px-6 text-center sm:px-10">
      <h1 className="hero-title font-serif text-ink">
        <span className="block">
          高亮<span className="hero-mark">任意一句</span>。
        </span>
        <span className="block">随时向它提问。</span>
      </h1>
      {children}
    </section>
  );
}
