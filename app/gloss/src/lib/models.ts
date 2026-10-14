/**
 * The model allow-list and wire types. Safe to import on the client: no keys,
 * no fetches. lib/together.ts does the network side.
 */

export type ModelEntry = {
  id: string;
  label: string;
  short: string;
  blurb: string;
  inPerM: number;
  cachedPerM: number;
  outPerM: number;
};

/**
 * The allow-list. Route and UI both read it. Bake-off 2026-10-09: 3 sample
 * texts x 8 tasks on the real prompts, answers scored blind by a judge.
 *   V4.1 Flash  0.23s to first token, $0.0006 an answer, 7.3/10, best in 11 of 24
 *   V4 Pro      0.58s, $0.0052, 6.5/10
 *   Kimi K3     0.86s, $0.0096, 6.3/10 (best gloss summaries, weak on Related)
 *   GLM-5.3     0.36s at reasoning_effort low, $0.0048, 6.3/10, 3 of the 4 factual errors
 * GLM-5.3 ignores every thinking-off flag (default effort: a 60s summary).
 * Also left out: Qwen3.8 (prints its reasoning into content with thinking off).
 *
 * Flash won on quality as well as speed and cost, so it answers everything:
 * there was a "Deep" choice (V4 Pro, then Kimi K3) and it was dropped
 * 2026-10-09. Older answers and settings may still name "pro"; anything that
 * looks a model up goes through modelOf(), which falls back to Flash.
 */
export let MODELS: Record<string, ModelEntry> = {
  flash: {
    id: "deepseek-ai/DeepSeek-V4.1-Flash",
    label: "DeepSeek V4.1 Flash",
    short: "快速",
    blurb: "Answers in about half a second. Best for most questions.",
    inPerM: 0.3,
    cachedPerM: 0.006,
    outPerM: 1.2,
  },
};

export type ModelKey = string;
export let DEFAULT_MODEL: ModelKey = "flash";
export function configureModels(models: { id: string; label: string; description?: string }[], selected?: string) {
  if (!models.length) return;
  MODELS = Object.fromEntries(models.map((m) => [m.id, { id: m.id, label: m.label, short: m.label, blurb: m.description || '', inPerM: 0, cachedPerM: 0, outPerM: 0 }]));
  DEFAULT_MODEL = selected && MODELS[selected] ? selected : models[0].id;
}

export function isModelKey(v: unknown): v is ModelKey {
  return typeof v === "string" && v in MODELS;
}

/** A model key that is still on the list: a saved "pro" from before Deep was dropped becomes Flash. */
export const modelOf = (v: unknown): ModelKey => (isModelKey(v) ? v : DEFAULT_MODEL);

export type Usage = {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
};

/** Dollars for a run. Cached prompt tokens bill at the cached rate. */
export function costFor(key: ModelKey, prompt: number, cached: number, completion: number): number {
  const m: ModelEntry = MODELS[key];
  const fresh = Math.max(0, prompt - cached);
  return (fresh * m.inPerM + cached * m.cachedPerM + completion * m.outPerM) / 1_000_000;
}

/** A web result an answer can cite as [n]. */
export type Source = { n: number; title: string; url: string; site: string; date?: string };

export type StreamEvent =
  | { type: "meta"; model: string }
  | { type: "searching" }
  /** The model asked for a tool (web search); the route runs it and asks again. Never sent to the browser. */
  | { type: "tool"; id: string; name: string; args: string }
  /** Drop what was written so far: a line before a tool call ("I'll look that up") that the real answer replaces. */
  | { type: "reset" }
  | { type: "sources"; sources: Source[] }
  | { type: "content"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" }
  | { type: "error"; text: string };
