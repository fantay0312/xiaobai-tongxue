"use client";

import { useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { normalizeUrl } from "@/lib/links";
import { CLASSICS, classicCover } from "@/lib/classics";
import { importFromUrl, keep } from "@/lib/import";
import { useStore } from "@/lib/store";
import type { AddTab } from "./AddPanel";
import { MarkStack } from "./AgentMarks";

/**
 * Under a shelf that is still nearly empty: three ways to fill it. A dozen
 * classics in one click, links of your own, or an agent that shelves for you.
 */
export function Starter({ count, signedIn, onAdd }: { count: number; signedIn: boolean; onAdd: (tab: AddTab) => void }) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);

  const shelveClassics = async () => {
    const have = new Set(useStore.getState().library.map((x) => (x.sourceUrl ? normalizeUrl(x.sourceUrl) : "")));
    const todo = CLASSICS.filter((c) => !have.has(normalizeUrl(c.url)));
    if (!todo.length) return;
    setBusy({ done: 0, total: todo.length });
    setFailed(0);
    const next = async () => {
      for (let c = todo.shift(); c; c = todo.shift()) {
        const r = await importFromUrl(c.url);
        const err = r.ok ? await keep({ ...r.article, title: c.title, author: c.author, published: String(c.year) }, undefined, { topic: c.topic, cover: classicCover(c) }) : r.error;
        if (err) setFailed((n) => n + 1);
        setBusy((b) => b && { ...b, done: b.done + 1 });
      }
    };
    await Promise.all([next(), next(), next()]);
    setBusy(null);
  };

  return (
    <section className="starter" aria-label="丰富你的书库">
      <div className="starter-card is-classics">
        <div className="starter-fan" aria-hidden>
          {CLASSICS.slice(0, 5).map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c.key} src={classicCover(c)} alt="" style={{ ["--i" as string]: i }} />
          ))}
        </div>
        <div className="min-w-0">
          <p className="starter-title">{count ? "添加经典" : "从几篇经典开始"}</p>
          <p className="starter-body">十二篇值得反复阅读的文章：汉明、费曼、奥威尔、格雷厄姆、华莱士等。</p>
          <button type="button" onClick={shelveClassics} disabled={Boolean(busy)} className="starter-btn">
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> 正在收藏 {busy.done} of {busy.total}
              </>
            ) : (
              <>
                加入书架 <ArrowRight size={15} />
              </>
            )}
          </button>
          {failed > 0 && !busy && <p className="mt-2 text-[12.5px] text-ink-3">{failed} 暂时无法导入，请稍后重试。</p>}
        </div>
      </div>
      <button type="button" className="starter-card" onClick={() => onAdd("links")}>
        <span className="starter-icon">
          <Link2 size={20} />
        </span>
        <span className="starter-title">收藏自己的链接</span>
        <span className="starter-body">粘贴一个或多个链接，阅读器会逐篇提取并按主题分类。</span>
      </button>
      <button type="button" className="starter-card" onClick={() => onAdd("agent")}>
        <span className="starter-icon is-agent">
          <MarkStack size={24} />
        </span>
        <span className="starter-title">让 Agent 帮你整理</span>
        <span className="starter-body">
          把书库连接到你的 AI 助手，请它从书签中收藏值得阅读的文章。{!signedIn && " Needs an account."}
        </span>
      </button>
    </section>
  );
}
