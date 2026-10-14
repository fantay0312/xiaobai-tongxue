"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useReader } from "./context";

/** A floating preview of the paragraph a citation points to. */
export function Peek({ peek }: { peek: { n: number; rect: DOMRect } | null }) {
  const { ix } = useReader();
  if (!peek) return null;
  const id = ix.byNumber.get(peek.n);
  const text = id ? ix.texts.get(id) ?? "" : "";
  if (!text) return null;
  const w = 340;
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, peek.rect.left + peek.rect.width / 2 - w / 2));
  const below = peek.rect.top < 220;
  const style = below ? { left, top: peek.rect.bottom + 8 } : { left, bottom: window.innerHeight - peek.rect.top + 8 };
  return (
    <div className="pop pointer-events-none fixed z-[70] p-4" style={{ ...style, width: w, ["--origin" as string]: below ? "top center" : "bottom center" }} role="tooltip">
      <p className="mb-1.5 text-[11.5px] font-semibold tabular-nums text-rubric-text">¶{peek.n}</p>
      <p className="line-clamp-6 font-serif text-[15px] leading-[1.5] text-ink">{text}</p>
      <p className="mt-2 text-[11.5px] text-ink-4">点击跳转</p>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["选中文字，再输入问题", "向选中文字提问"],
  ["/", "向全文提问"],
  ["J  K", "下一段与上一段"],
  ["Enter", "向当前段落提问"],
  ["[  ]", "上一条与下一条批注"],
  ["B", "为这篇文章生成导读"],
  ["N", "笔记本"],
  ["F", "专注模式"],
  ["Esc", "关闭或返回"],
  ["?", "This list"],
];

export function Shortcuts() {
  const open = useStore((s) => s.shortcutsOpen);
  const setUI = useStore((s) => s.setUI);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUI({ shortcutsOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setUI]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink/20 p-4 backdrop-blur-[2px]" onClick={() => setUI({ shortcutsOpen: false })} style={{ animation: "fade 0.2s" }}>
      <div role="dialog" aria-label="键盘快捷键" className="pop w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[22px] leading-none text-ink">快捷键</h2>
          <button type="button" aria-label="关闭" data-tip="关闭" data-tip-kbd="Esc" onClick={() => setUI({ shortcutsOpen: false })} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunk">
            <X size={16} />
          </button>
        </div>
        <dl className="divide-y divide-rule">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="flex gap-1">
                {k.includes(",") || k.length > 6
                  ? <span className="text-[13px] text-ink-2">{k}</span>
                  : k.split("  ").map((x) => <kbd key={x}>{x}</kbd>)}
              </dt>
              <dd className="text-right text-[13px] text-ink-3">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Resume toast and first-run hint share this little card. */
export function Toast({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] left-1/2 z-[55] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-[18px] bg-lens py-1.5 pl-4 pr-1.5 text-[13px] leading-snug text-lens-fg shadow-pop sm:bottom-[96px] sm:rounded-full"
      style={{ animation: "rise 0.45s var(--ease-spring) both" }}
    >
      {children}
      <button type="button" aria-label="关闭" onClick={onClose} className="grid size-7 place-items-center rounded-full text-lens-mute hover:bg-lens-hover hover:text-lens-fg">
        <X size={14} />
      </button>
    </div>
  );
}
