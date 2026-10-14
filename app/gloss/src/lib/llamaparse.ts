/**
 * LlamaParse, for "Read it more carefully": a hard PDF (two columns, tables,
 * maths, a scan) read again by a layout-aware parser. Server-side only.
 *
 * API v2: upload with a tier, poll the job, fetch Markdown per page.
 * Verified 2026-10-10: a page takes a few seconds; cost_effective bills 3
 * credits a page and agentic 10 ($0.00125 a credit).
 */

const BASE = "https://api.cloud.llamaindex.ai/api/v2/parse";

export type Tier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

export type Parsed = { ok: true; pages: string[]; credits: number | null } | { ok: false; error: string };

export async function parseCarefully(pdf: Blob, opts: { tier: Tier; maxPages: number; signal?: AbortSignal; deadlineMs?: number }): Promise<Parsed> {
  const key = process.env.LLAMA_CLOUD_API_KEY;
  if (!key) return { ok: false, error: "服务器暂未连接精读服务。" };
  const auth = { Authorization: `Bearer ${key}` };
  const started = Date.now();
  const deadline = opts.deadlineMs ?? 240_000;

  const form = new FormData();
  form.append("file", pdf, "document.pdf");
  form.append("configuration", JSON.stringify({ tier: opts.tier, version: "latest", page_ranges: { max_pages: opts.maxPages } }));
  let job: string | undefined;
  try {
    const res = await fetch(`${BASE}/upload`, { method: "POST", headers: auth, body: form, signal: opts.signal });
    const j = (await res.json().catch(() => ({}))) as { id?: string; detail?: unknown };
    if (!res.ok || !j.id) return { ok: false, error: `The careful reader refused the file (${res.status}).` };
    job = j.id;
  } catch {
    return { ok: false, error: "暂时无法连接精读服务。" };
  }

  // Poll until done, the request is cancelled, or the function would run out of time.
  while (Date.now() - started < deadline) {
    if (opts.signal?.aborted) return { ok: false, error: "Stopped." };
    await new Promise((r) => setTimeout(r, 1500));
    const s = (await fetch(`${BASE}/${job}`, { headers: auth, signal: opts.signal })
      .then((r) => r.json())
      .catch(() => null)) as { job?: { status?: string; error_message?: string | null } } | null;
    const status = s?.job?.status;
    if (status === "COMPLETED") break;
    if (status === "FAILED" || status === "CANCELLED") return { ok: false, error: s?.job?.error_message || "The careful reader could not read this file." };
  }
  if (Date.now() - started >= deadline) return { ok: false, error: "Reading carefully took too long. Try a shorter PDF." };

  const res = (await fetch(`${BASE}/${job}?expand=markdown,usage`, { headers: auth, signal: opts.signal })
    .then((r) => r.json())
    .catch(() => null)) as { markdown?: { pages?: { page_number: number; markdown: string; success?: boolean }[] }; job?: { usage?: { credits?: number | null } } } | null;
  const pages = (res?.markdown?.pages ?? []).sort((a, b) => a.page_number - b.page_number).map((p) => p.markdown ?? "");
  if (!pages.some((p) => p.trim())) return { ok: false, error: "The careful reader found no text in this file." };
  return { ok: true, pages, credits: res?.job?.usage?.credits ?? null };
}
