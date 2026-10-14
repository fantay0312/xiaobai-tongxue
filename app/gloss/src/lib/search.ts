/**
 * Web search with Exa, for answers that need the world beyond the text.
 * Fact-check always searches first; any other question offers the model a
 * web_search tool (WEB_TOOL) and lets it decide. Server-side only.
 *
 * "instant" search, verified 2026-10-10: about 0.5s and $0.004 a search with
 * excerpts, the same top results as "fast" ($0.007) on our queries. Excerpts
 * are Exa's query-relevant highlights rather than whole pages, so the prompt stays small.
 */

import type { Source } from "./models";

const EXA_URL = "https://api.exa.ai/search";
/** What a search costs when Exa does not say, charged against a free reader's budget. */
export const SEARCH_USD = 0.004;

/** The tool the model is offered. Its description is what decides when it searches. */
export const WEB_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for facts the text does not give: who a named person, organisation or place is, what a named work, event or term refers to, or what has happened since the text was written. Do not search for what the text itself says.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up, in a few words, e.g. \"Alan G. Chynoweth Bellcore physicist\"" } },
      required: ["query"],
    },
  },
} as const;
const RESULTS = 5;

export const searchEnabled = () => Boolean(process.env.EXA_API_KEY);

export type WebResults = { sources: Source[]; excerpts: string[]; usd: number };

/** Null when search is off, fails or times out: the answer goes ahead without it. */
export async function webSearch(query: string, signal?: AbortSignal): Promise<WebResults | null> {
  const key = process.env.EXA_API_KEY;
  if (!key || !query.trim()) return null;
  try {
    const res = await fetch(EXA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      body: JSON.stringify({
        query: query.slice(0, 500),
        type: "instant",
        numResults: RESULTS,
        contents: { highlights: { maxCharacters: 700 } },
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      results?: { title?: string; url?: string; publishedDate?: string; highlights?: string[] }[];
      costDollars?: { total?: number };
    };
    const rows = (j.results ?? []).filter((r) => r.url && /^https?:/i.test(r.url) && r.highlights?.length);
    if (!rows.length) return null;
    const sources: Source[] = rows.map((r, i) => {
      let site = "";
      try {
        site = new URL(r.url!).hostname.replace(/^www\./, "");
      } catch {}
      return { n: i + 1, title: (r.title || site).trim().slice(0, 160), url: r.url!, site, ...(r.publishedDate ? { date: r.publishedDate.slice(0, 10) } : {}) };
    });
    const excerpts = rows.map((r) => r.highlights!.join(" … ").replace(/\s+/g, " ").slice(0, 900));
    return { sources, excerpts, usd: j.costDollars?.total ?? SEARCH_USD };
  } catch {
    return null;
  }
}

/** What to search for: the reader's question, with the passage it is about for context. */
export function searchQuery(t: { action: string; quote?: string; question?: string }, latest?: string): string {
  const quote = t.quote?.replace(/\s+/g, " ").trim().slice(0, 300);
  const question = (latest ?? t.question)?.trim();
  if (t.action === "check" && !latest) return quote ?? question ?? "";
  if (question && quote) return `${question} (about: "${quote}")`;
  return question ?? quote ?? "";
}
