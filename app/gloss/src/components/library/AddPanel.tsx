"use client";

import { SignInButton } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, BookmarkPlus, Check, Copy, FileUp, Loader2, Trash2, X } from "lucide-react";
import Link from 'next/link';
import { BOOK_ACCEPT, importFromFile, importFromUrl, keep, looksLikeUrl } from "@/lib/import";
import { normalizeUrl } from "@/lib/links";
import { useStore } from "@/lib/store";
import { Mark, type AgentMark } from "./AgentMarks";
import { Glyph } from "./Book";

export type AddTab = "books" | "links" | "agent";

/**
 * Adding to the library: paste links (one or many), or connect an agent that
 * saves to it through the Gloss MCP server.
 */
export function AddPanel({ tab, onTab, onClose, signedIn }: { tab: AddTab; onTab: (t: AddTab) => void; onClose: () => void; signedIn: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="presentation">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" style={{ animation: "fade 0.2s both" }} onClick={onClose} />
      <section role="dialog" aria-modal aria-label="加入书库" className="add-panel">
        <header className="flex items-center justify-between gap-3">
          <div className="lib-sort !ml-0" role="tablist" aria-label="添加">
            <button type="button" role="tab" aria-selected={tab === "books"} onClick={() => onTab("books")}>
              导入书籍
            </button>
            <button type="button" role="tab" aria-selected={tab === "links"} aria-checked={tab === "links"} onClick={() => onTab("links")}>
              收藏链接
            </button>
            <button type="button" role="tab" aria-selected={tab === "agent"} aria-checked={tab === "agent"} onClick={() => onTab("agent")}>
              连接 Agent
            </button>
          </div>
          <button type="button" aria-label="关闭" data-tip="关闭" data-tip-kbd="Esc" onClick={onClose} className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
            <X size={17} />
          </button>
        </header>
        {tab === "books" ? <Books /> : tab === "links" ? <Links /> : <Agent signedIn={signedIn} />}
      </section>
    </div>,
    document.body
  );
}

/**
 * What opens the panel: plain about adding articles, with the agents that can
 * do it for you. On hover the marks fan out to the right from Grok, which
 * holds its place, and the plus turns.
 */
export { AddButton } from './AddButton';

type BookRow = { name: string; status: 'waiting' | 'reading' | 'saved' | 'failed'; id?: string; error?: string };

function Books() {
  const fileRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BookRow[]>([]);
  const [progress, setProgress] = useState('');
  useEffect(() => buttonRef.current?.focus(), []);

  const importBooks = async (files: File[]) => {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRows(files.map((file) => ({ name: file.name, status: 'waiting' })));
    const update = (index: number, patch: Partial<BookRow>) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    try {
      for (let i = 0; i < files.length; i++) {
        update(i, { status: 'reading' });
        setProgress(`正在导入 ${i + 1} / ${files.length}：${files[i].name}`);
        try {
          const result = await importFromFile(files[i], (_, label) => label && setProgress(label));
          const error = result.ok ? await keep(result.article, result.file) : result.error;
          update(i, error ? { status: 'failed', error } : { status: 'saved', id: result.ok ? result.article.id : undefined });
        } catch {
          update(i, { status: 'failed', error: '导入没有完成，请重新选择文件再试。' });
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress('导入已结束，成功的书籍已加入书库。');
    }
  };

  return <div className="mt-5" role="tabpanel" aria-label="导入书籍">
    <p className="text-[19px] font-serif leading-tight text-ink">把自己的书带进来</p>
    <p className="mt-2 text-[13px] leading-relaxed text-ink-2">支持 EPUB、PDF、TXT 和 Markdown，可一次选择多本。EPUB 按章节顺序导入文字，保留标题与段落。</p>
    <input ref={fileRef} type="file" multiple accept={BOOK_ACCEPT} className="hidden" aria-label="选择书籍文件" onChange={(event) => {
      void importBooks(Array.from(event.target.files ?? []));
      event.target.value = '';
    }} />
    <button ref={buttonRef} type="button" disabled={busy} className="mt-5 flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rule-strong p-6 text-ink hover:bg-sunk disabled:opacity-60"
      onClick={() => fileRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); void importBooks(Array.from(event.dataTransfer.files)); }}>
      {busy ? <Loader2 size={24} className="animate-spin" aria-hidden /> : <FileUp size={24} aria-hidden />}
      <span>{busy ? '正在导入书籍…' : '选择文件，或拖到这里'}</span>
    </button>
    <p className="mt-3 text-[12px] leading-relaxed text-ink-3">EPUB 最大 50 MB，文本最大 10 MB；暂不支持加密 EPUB、图片与原书排版。</p>
    <p className="mt-3 text-[13px] text-ink-2" role="status" aria-live="polite">{progress}</p>
    {!!rows.length && <ul className="add-rows scroll-thin" aria-label="书籍导入结果">
      {rows.map((row, index) => <li key={`${index}-${row.name}`} data-state={row.status}>
        <span className="add-dot" aria-hidden>{row.status === 'reading' ? <Loader2 size={13} className="animate-spin" /> : row.status === 'saved' ? <Check size={13} /> : row.status === 'failed' ? <X size={13} /> : null}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] text-ink">{row.name}</span>
          <span className="block text-[12px] text-ink-2">{row.error || (row.status === 'saved' ? '已加入书库' : row.status === 'reading' ? '正在读取' : '等待导入')}</span></span>
        {row.id && <Link href={`/read/${row.id}`} className="text-[13px] text-ink underline underline-offset-4">开始阅读</Link>}
      </li>)}
    </ul>}
  </div>;
}

/* ---------- links ---------- */

type Row = { url: string; state: "waiting" | "reading" | "saved" | "already" | "failed"; title?: string; error?: string };

/** How many links one Save reads in. A Pocket export can hold thousands; the rest wait in the box for the next Save. */
const BATCH = 100;

/** Every web link in an export: Pocket, Instapaper and Raindrop CSVs, Pocket's HTML, or a plain list. */
function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>,]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[).;\]]+$/, "")))];
}

function Links() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const urls = [...new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(looksLikeUrl))];

  const fromExport = async (f: File) => {
    const found = linksIn(await f.text().catch(() => ""));
    if (!found.length) return setNote(`未在 ${f.name} 中找到链接。`);
    setText((cur) => [cur.trim(), ...found].filter(Boolean).join("\n"));
    setNote(`已在 ${f.name} 中找到 ${found.length} 个链接。`);
  };

  const save = async () => {
    if (!urls.length || busy) return;
    setBusy(true);
    const have = new Set(useStore.getState().library.flatMap((x) => (x.sourceUrl ? [normalizeUrl(x.sourceUrl)] : [])));
    const all: Row[] = urls.map((url) => ({ url, state: have.has(normalizeUrl(url)) ? "already" : "waiting" }));
    const fresh = all.filter((r) => r.state === "waiting");
    const known = all.length - fresh.length;
    const rest = fresh.slice(BATCH).map((r) => r.url);
    // A long export lists only what is being read now; a short paste shows every link, saved before or not.
    const list = all.length > BATCH ? fresh.slice(0, BATCH) : all;
    setRows(list);
    setText(rest.join("\n"));
    setNote(
      all.length > BATCH
        ? [rest.length ? `正在保存 ${BATCH} 个链接，剩余 ${rest.length} 个留在上方，可继续保存。` : `正在保存 ${fresh.length} 个链接。`, known ? `${known} 个已在书库中。` : ""].filter(Boolean).join(" ")
        : null
    );
    const set = (i: number, r: Partial<Row>) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, ...r } : x)));
    const todo = list.map((r, i) => ({ r, i })).filter((x) => x.r.state === "waiting");
    const next = async () => {
      for (let x = todo.shift(); x; x = todo.shift()) {
        set(x.i, { state: "reading" });
        const r = await importFromUrl(x.r.url, (_, label) => label && set(x!.i, { title: label }));
        const err = r.ok ? await keep(r.article, r.file) : r.error;
        set(x.i, err ? { state: "failed", error: err, title: undefined } : { state: "saved", title: r.ok ? r.article.title : undefined });
      }
    };
    // A few at a time, so a slow site never holds the rest up.
    await Promise.all([next(), next(), next()]);
    setBusy(false);
  };

  return (
    <div className="mt-5">
      <p className="text-[19px] font-serif leading-tight text-ink">将链接收进书库</p>
      <p className="mt-1 text-[13px] text-ink-3">
        一个或多个链接，每行一个。逐篇读取并按主题分类，也支持 PDF。正在迁出 Pocket、Instapaper 或 Raindrop？{" "}
        <button type="button" onClick={() => fileRef.current?.click()} className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
          把导出文件拖到这里
        </button>
        .
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.html,.htm,.txt,.json,text/csv,text/html,text/plain,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void fromExport(f);
          e.target.value = "";
        }}
      />
      <textarea
        ref={ref}
        value={text}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          setOver(false);
          if (!f) return;
          e.preventDefault();
          void fromExport(f);
        }}
        style={over ? { borderColor: "var(--rubric)", borderStyle: "dashed" } : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        placeholder={"https://paulgraham.com/greatwork.html\nhttps://..."}
        rows={4}
        className="add-text"
        aria-label="待收藏链接"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-4">{urls.length ? `${urls.length} 个链接` : text.trim() ? "尚未找到链接" : ""}</span>
        <button type="button" onClick={save} disabled={!urls.length || busy} className="add-btn">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "正在保存" : urls.length > 1 ? `保存 ${Math.min(urls.length, BATCH)} 个链接` : "保存"}
        </button>
      </div>
      {note && <p className="mt-2 text-[12.5px] text-ink-3">{note}</p>}
      {rows.length > 0 && (
        <ul className="add-rows scroll-thin">
          {rows.map((r) => (
            <li key={r.url} data-state={r.state}>
              <span className="add-dot" aria-hidden>
                {r.state === "reading" ? <Loader2 size={13} className="animate-spin" /> : r.state === "saved" || r.state === "already" ? <Check size={13} /> : r.state === "failed" ? <X size={13} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{r.title ?? r.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {r.state === "saved" ? "已保存到书库" : r.state === "already" ? "已在书库" : r.state === "failed" ? r.error : r.state === "reading" ? "正在读取" : "等待中"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Bookmarklets />
    </div>
  );
}

/**
 * Bookmarklets: one click on any page opens it in Gloss, in a new tab, to read now
 * or to shelve for later (`/?url=` and `/?save=` on the home page).
 */
function Bookmarklets() {
  const readRef = useRef<HTMLAnchorElement>(null);
  const saveRef = useRef<HTMLAnchorElement>(null);
  const [origin, setOrigin] = useState("https://usegloss.io");
  const code = (param: "url" | "save") => `javascript:void(window.open('${origin}/?${param}='+encodeURIComponent(location.href)))`;
  useEffect(() => setOrigin(window.location.origin + import.meta.env.BASE_URL + "#"), []);
  // React refuses javascript: links in JSX, so they are set by hand.
  useEffect(() => {
    readRef.current?.setAttribute("href", code("url"));
    saveRef.current?.setAttribute("href", code("save"));
  });
  const pill = "inline-flex cursor-grab items-center gap-1.5 rounded-full border border-rule-strong bg-bg px-3 py-1.5 text-[13px] font-medium text-ink shadow-[var(--shadow-card)] active:cursor-grabbing";
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <p className="lib-label">从任意网页</p>
      <p className="mt-1 text-[13px] text-ink-3">拖到浏览器书签栏，在任意文章页面点击使用。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a ref={readRef} onClick={(e) => e.preventDefault()} data-tip="把我拖到书签栏" className={pill}>
          <BookOpen size={14} className="text-ink-3" /> 在阅读器中打开
        </a>
        <a ref={saveRef} onClick={(e) => e.preventDefault()} data-tip="把我拖到书签栏" className={pill}>
          <BookmarkPlus size={14} className="text-ink-3" /> 收进阅读书库
        </a>
      </div>
      <details className="mt-3 text-[12.5px] text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">在手机上</summary>
        <div className="mt-2">
          <CopyBlock title="收藏任意网页，再编辑书签" body="将它粘贴为地址，并命名为“收进阅读书库”。" text={code("save")} />
        </div>
      </details>
    </div>
  );
}

/* ---------- an agent ---------- */

type Conn = { id: string; label: string; createdAt: string; lastUsedAt: string | null };
const LABELS: { label: string; mark?: AgentMark }[] = [
  { label: "Grok Bot", mark: "grok" },
  { label: "Claude", mark: "claude" },
  { label: "ChatGPT", mark: "chatgpt" },
  { label: "其他" },
];

function Agent({ signedIn }: { signedIn: boolean }) {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [made, setMade] = useState<{ token: string; label: string } | null>(null);
  const [label, setLabel] = useState("Grok Bot");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin + import.meta.env.BASE_URL.replace(/reader\/$/, "api/reader") : "";

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/agent-tokens")
      .then((r) => r.json())
      .then((j: { tokens?: Conn[] }) => setConns(j.tokens ?? []))
      .catch(() => setConns([]));
  }, [signedIn]);

  if (!signedIn)
    return (
      <div className="mt-5">
        <AgentIntro />
        <p className="mt-4 text-[13.5px] text-ink-2">Agent 会保存到当前账号的书库，因此需要先登录。</p>
        <SignInButton mode="modal">
          <button type="button" className="add-btn mt-4">
            登录后连接
          </button>
        </SignInButton>
      </div>
    );

  const create = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/agent-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
    const j = (await res.json().catch(() => ({}))) as { id?: string; token?: string; label?: string; error?: string };
    setBusy(false);
    if (!res.ok || !j.token || !j.id) return setErr(j.error ?? "无法创建连接，请重试。");
    setMade({ token: j.token, label: j.label ?? label });
    setConns((c) => [{ id: j.id!, label: j.label ?? label, createdAt: new Date().toISOString(), lastUsedAt: null }, ...(c ?? [])]);
  };

  const revoke = async (id: string) => {
    setConns((c) => c?.filter((x) => x.id !== id) ?? null);
    await fetch(`/api/agent-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="mt-5">
      <AgentIntro />
      {made ? (
        <Setup token={made.token} label={made.label} origin={origin} />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="lib-sort !ml-0" role="radiogroup" aria-label="选择 Agent">
            {LABELS.map((l) => (
              <button key={l.label} type="button" role="radio" aria-checked={label === l.label} onClick={() => setLabel(l.label)} className="inline-flex items-center gap-1.5">
                {l.mark && <Mark k={l.mark} size={14} />}
                {l.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={create} disabled={busy} className="add-btn">
            {busy && <Loader2 size={14} className="animate-spin" />}
            创建连接
          </button>
          {err && <p className="w-full text-[12.5px] text-rubric-text">{err}</p>}
        </div>
      )}
      {conns && conns.length > 0 && (
        <div className="mt-6">
          <p className="lib-label">已连接</p>
          <ul className="mt-2 divide-y divide-rule">
            {conns.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{c.label}</span>
                  <span className="ml-2 text-ink-3">
                    {c.lastUsedAt ? `最近使用 ${new Date(c.lastUsedAt).toLocaleDateString("zh-CN", { day: "numeric", month: "short" })}` : "尚未使用"}
                  </span>
                </span>
                <button type="button" onClick={() => revoke(c.id)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-ink-3 transition-colors hover:bg-sunk hover:text-ink">
                  <Trash2 size={13} /> 撤销
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AgentIntro() {
  return (
    <div className="flex items-start gap-3.5">
      <Glyph k="agent" size={46} className="shrink-0" />
      <div>
        <p className="font-serif text-[19px] leading-tight text-ink">让 Agent 帮你整理</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">
          阅读器提供 MCP 接口。把它连接到 AI 助手，再请它整理你的书签并把文章保存到阅读书库。每篇文章都会自动提取并分类。
        </p>
      </div>
    </div>
  );
}

const PROMPT = "查看我上个月的 X 书签，找到其中的文章、随笔或论文链接，把它们保存到我的阅读书库。";

function Setup({ token, label, origin }: { token: string; label: string; origin: string }) {
  const url = `${origin}/mcp`;
  const steps: { title: string; body: string; copy: string }[] =
    label === "Grok Bot" || label === "Grok"
      ? [
          { title: "Grok Bot：在聊天中发送这段话", body: "确认后即可使用阅读工具。", copy: `添加一个名为 Gloss 的自定义 MCP 服务，地址为 ${url} ，请求头 Authorization 设置为 Bearer ${token}` },
        ]
      : label === "Claude"
        ? [
            { title: "Claude Code：运行以下命令", body: "然后请 Claude 把文章保存到阅读书库。", copy: `claude mcp add --transport http gloss ${url} --header "Authorization: Bearer ${token}"` },
            { title: "或在 claude.ai 中打开设置、连接器、添加自定义连接器", body: "链接包含你的令牌，请妥善保管。", copy: `${url}/${token}` },
          ]
        : [
            { title: "服务地址和请求头", body: `地址 ${url}，以及以下请求头：`, copy: `Authorization: Bearer ${token}` },
            { title: "如果应用仅支持地址，可使用包含令牌的链接", body: "请妥善保管，避免出现在日志中。", copy: `${url}/${token}` },
          ];
  return (
    <div className="mt-5 space-y-3">
      <p className="text-[13px] text-good">连接已创建。令牌只显示一次，请现在复制。</p>
      {steps.map((s) => (
        <CopyBlock key={s.title} title={s.title} body={s.body} text={s.copy} />
      ))}
      <CopyBlock title="然后可以这样告诉它" body="Agent 会保存帖子链接指向的文章。如果帖子本身就是长文，则发送帖子正文。" text={PROMPT} />
    </div>
  );
}

function CopyBlock({ title, body, text }: { title: string; body: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[14px] border border-rule bg-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{title}</p>
          <p className="text-[12px] text-ink-3">{body}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {}
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-sunk px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">{text}</pre>
    </div>
  );
}
