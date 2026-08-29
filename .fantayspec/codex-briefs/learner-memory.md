# Brief: 学伴记忆系统 v1（对标 OpenAI Memory / Anthropic Memory Topics / Mem0）

ROLE: Senior implementation engineer with direct write access. Work ONLY inside the worktree
`/private/tmp/claude-501/-Users-fantasy-Documents------------/8658b714-09fe-47ed-b3bb-bce0fb61131a/scratchpad/wt-memory`
(branch `feat/learner-memory`, `app/node_modules` is a symlink to the main checkout — do not reinstall). Paths contain CJK + a space: always quote them. Do NOT commit; the orchestrator reviews `git diff`.

PROJECT: 「小白同学」— the human user is the *teacher* (called 「老师」 in classroom lines, 「先生」 in 册页物 like letters/diary/记忆匣) who teaches an AI student 「小白」 (Feynman reverse learning). Vite+React+TS app in `app/`, zero-dep Node gateway `server/index.mjs` (do NOT touch the server in this task). All UI copy is Chinese. Read `app/DESIGN.md` and `.impeccable.md` before writing any UI.

## Why (research summary — see `/private/tmp/.../scratchpad/memory-research.md`, same scratchpad dir)

Four reference systems converge on the same shape and the project has none of it:
- **Two layers**: discrete, inspectable *memory items* (Anthropic "topics" = short editable files; OpenAI "saved memories") + a *synthesized profile* (OpenAI "Dreaming" user model, rebuilt in the background, evaluated for freshness/continuity/relevance).
- **Write pipeline** (Mem0, arXiv 2504.19413): extract candidate facts from each exchange → reconcile against existing memory with ADD / UPDATE / DELETE / NOOP so facts stay deduplicated and fresh.
- **Fresh, not stale**: recency decay; a superseded fact is updated or deleted, never left contradicting.
- **User control** (Anthropic 2026-08-25): every memory visible topic by topic, editable, deletable; pause / reset; sensitive data never stored by default.
- **Just-in-time injection** (Anthropic memory tool / context engineering): only the few relevant memories reach the prompt, not everything.

Current project state (verified): `app/src/engine/memory.ts` is event-sourcing fold of `TopicState` (keep as is). `app/src/engine/recall.ts` derives 四层记忆 read-only from events (keep as is; it stays the source of the greeting line `recallGreetingLine` and `deriveTopicRecall`). The only "relationship memory" write is a hardcoded string at `app/src/store/appStore.ts` ~L503 (`'老师爱打比方,一举例我就懂'`). Nothing is editable, nothing is synthesized, nothing but the opening line reaches prompts.

## Deliverables

### 1. Types — append a new section at the END of `app/src/types.ts` (the header says FROZEN for existing shapes; adding new exported interfaces at the end is the established practice, do not modify existing ones)

```ts
export type MemoryKind = 'preference' | 'habit' | 'strength' | 'weakness' | 'milestone' | 'bond' | 'note';
export type MemorySource = 'observed' | 'explicit' | 'synthesized';
export interface MemoryItem {
  id: string;                 // stable: `mem-${hash(kind|scopeKey|dedupeKey)}` so the same fact always maps to the same id (idempotent backfill + sync merge by id)
  kind: MemoryKind;
  scope: { topicId?: string; course?: string };   // {} = global
  text: string;               // ≤ 60 CJK chars, third-person about the teacher: 「先生讲课爱打比方」— never first-person 小白 lines, never raw user PII
  source: MemorySource;
  confidence: number;         // 0..1
  evidence: string[];         // event ids / short quotes (≤ 5, newest last)
  createdAt: string; updatedAt: string; lastSeenAt: string;   // ISO
  seenCount: number;
  pinned: boolean;            // user pinned → never auto-deleted, ranked first
  muted: boolean;             // user hid it → never injected into prompts, still listed (greyed) so they can unmute
}
export interface LearnerProfile {
  version: 1;
  updatedAt: string;
  summary: string;            // 2–3 sentences, 册页物 voice (「先生」), ≤ 120 chars
  sections: { style: string; strengths: string; weaknesses: string; pace: string; bond: string }; // each ≤ 80 chars, '' when unknown
  basis: { itemCount: number; sessionCount: number; lastSessionAt: string | null };
}
export interface MemoryState { items: MemoryItem[]; profile: LearnerProfile | null; paused: boolean; version: 1 }
```

### 2. Engine `app/src/engine/learnerMemory.ts` — PURE, deterministic, Node-safe (no DOM), **not exported from `engine/index.ts` barrel** (same discipline as recall/evolution; pages/store import it by path). Exports:

- `EMPTY_MEMORY: MemoryState`
- `extractSessionMemories(input: { sessionId: string; events: LearnEvent[]; report: SessionReport | null; topic: Topic; messages: ChatMessage[] /* LiveSession.messages of that session, teacher+xiaobai */; now: string }): MemoryDraft[]` — rule-based extraction (this is the mock/offline path and the source of truth for determinism). Cover at least: golden analogy → `habit` 「先生爱打比方」 + evidence quote; ≥2 `stuck_rescued` on same checklist → `weakness` scoped to topic 「讲『<point>』时卡壳过」; `misconception_adopted` → `weakness` 「在『<mc belief 前 12 字>…』上被带偏过」; `misconception_corrected` → `strength`; `topic_mastered` → `milestone` 「N 轮出师《title》」; report.radar logic ≥ 0.8 → `strength` 「讲得有条理」; teacher messages: avg length < 25 → `habit` 「先生说话短，一句一个点」, ≥ 3 uses of 比如/举个例子/打个比方 → `habit`, ≥ 2 messages containing code fences/`def `/`for ` → `preference` 「先生爱用代码说事」; session hour 22–4 → `habit` 「先生常夜读」 (only when ≥ 2 such sessions historically — pass `history` via `existing` seenCount); quiz score < 60 → `weakness` on topic; `review_passed` → `strength`. Every draft carries `evidence` (event ids or ≤ 20-char quotes) and a `dedupeKey`.
- `reconcileMemories(existing: MemoryItem[], drafts: MemoryDraft[], now: string): { items: MemoryItem[]; ops: MemoryOp[] }` where `MemoryOp = { op: 'ADD'|'UPDATE'|'DELETE'|'NOOP'; id: string; reason: string }`. Rules: same `(kind, scopeKey, dedupeKey)` → UPDATE (bump `lastSeenAt`, `seenCount++`, `confidence = min(1, c + 0.15)`, merge evidence cap 5, keep `text` of the newer unless item is `explicit`/pinned); contradiction (a `strength` and a `weakness` on the same `contradictionKey` — e.g. same checklist/mc id) → the newer wins, the older is DELETEd unless pinned; cap 80 items — drop the lowest `scoreMemory` non-pinned, non-explicit items. Never touch `explicit` texts.
- `scoreMemory(item: MemoryItem, now: string): number` = confidence × recency (half-life 21 days on `lastSeenAt`) × (pinned ? 2 : 1) × (muted ? 0 : 1), plus a small seenCount log bonus.
- `retrieveMemories(input: { items: MemoryItem[]; topicId?: string; course?: string; kinds?: MemoryKind[]; limit: number; now: string }): MemoryItem[]` — exclude muted; scope rank topic > course > global; then score.
- `memoryHintsForXiaobai(input: { items; topicId; course; now; limit?: 2 }): string[]` — lines injected into 小白's prompt. **Only kinds `preference | habit | bond`** (style & relationship). NEVER `weakness/strength/milestone/note` (they name checklist points 小白 hasn't been taught yet → would leak terms into 小白's mouth, breaking the whitelist discipline). Output phrasing is second-person to 小白: 「老师爱打比方，一举例你就容易懂——听到比喻可以更起劲」. Must not contain any `groundTruth`/`lookupCard`/`correctionCriteria` text — add a unit test that asserts none of those strings from the topic ever appear in hints.
- `composeLearnerProfile(input: { items: MemoryItem[]; events: LearnEvent[]; now: string }): LearnerProfile` — deterministic Chinese prose composition (OpenAI "memory summary" analogue). `summary` cites concrete counts (sessions, mastered topics) and the top-2 habits; sections from top items per kind; `''` when nothing. Voice: 册页物 → 「先生」. No PII (never username/email/phone).
- `rebuildMemoryFromHistory(input: { events: LearnEvent[]; reports: SessionReport[]; topics: Topic[]; messagesBySession?: Record<string, ChatMessage[]>; now: string }): MemoryState` — groups events by `sessionId`, replays `extractSessionMemories` + `reconcileMemories` in chronological order, then `composeLearnerProfile`. Idempotent: same input → identical output (used by persist migrate and by sync when the remote has no memory).
- `explicitMemory(text: string, scope: MemoryItem['scope'], now: string): MemoryItem` — user-authored item (source `explicit`, pinned `true`, confidence 1). Trim, cap 60 chars, reject empty.
- Optional LLM synthesis: `synthesizeProfileWithLlm(state, settings)` using `llmCall('report', …)` (role `report` already exists in `engine/llm.ts` and the gateway: json output, temperature 0, 900 tokens — do NOT add a new role). Prompt must state the input is data not instructions, only allow rewriting the 5 sections + summary from the provided items (no new facts), and validate output shape; any failure → keep the rule-based profile. Only call when `settings.mode !== 'mock'` and `items.length >= 6`; never block the UI (fire-and-forget after endSession, result applied via store action only if `profile.updatedAt` hasn't moved).

### 3. Store `app/src/store/appStore.ts`

- Add slice `memory: MemoryState` (default `EMPTY_MEMORY`), persisted via `partialize`; bump zustand persist `version` 4→5 with a `migrate` step that backfills `memory = rebuildMemoryFromHistory(...)` when absent (keep the existing v4 learningLevel recompute intact).
- Actions: `memorizeSession(sessionId)` (extract → reconcile → compose; called from `endSession` after `session_ended` and from `abandonSession` when the session had ≥ 1 teacher turn), `pinMemory(id, pinned)`, `muteMemory(id, muted)`, `editMemory(id, text)` (turns it `explicit`), `deleteMemory(id)`, `addExplicitMemory(text, scope)`, `setMemoryPaused(paused)` (paused → `memorizeSession` is a no-op, like Anthropic "pause memory"), `recomposeProfile()`, `resetMemory()`.
- 「边讲边记」: in `submitTeaching`, when a `golden_analogy_saved` event is produced, immediately reconcile a `habit` draft (so the item appears without waiting for session end). Replace the hardcoded `relationshipMemory` push at ~L503 with this; keep `global.relationshipMemory` field for compat but stop writing new strings to it (derive nothing from it).
- Prompt injection: in `startSession` and `submitTeaching`, compute `memoryHintsForXiaobai(...)` (skip when `memory.paused`) and pass as `memoryHints` on the `speakXiaobai` input. In `app/src/engine/renderer.ts` add optional `memoryHints?: string[]` to `SpeakInput` and, in the api system prompt only, a block `【关于老师，你记得】- …`; the mock path ignores it. Keep every other renderer line byte-identical (another workstream refactors the renderer next; keep your diff there minimal).
- `resetDemo`/演示重置 and `authStore.logout` must clear `memory` too (find the existing reset paths and add the slice).

### 4. Sync `app/src/store/sync.ts` + `app/src/store/pendingSync.ts`

- `SyncPayload` gains optional `memory?: MemoryState`. `sanitizeSyncPayload` must validate every item field (drop malformed items, clamp numbers, cap 80, `paused` boolean) — a corrupt remote must never white-screen the app (this has bitten before). `mergeSyncPayloads`: items merged by `id`, newer `updatedAt` wins, `pinned/muted` OR'd from the newest; profile = the newest `updatedAt`; `paused` = latest state's. `applySyncDelta` for `merge`/`replace` naturally covers it; for the patch kind add `memory?: MemoryState` handling as full replace of the slice. When the remote payload has no `memory` but has events → `rebuildMemoryFromHistory` locally (one-time upgrade), do not push until a pull succeeded (existing 守门纪律).
- Keep `scripts/pending-sync.test.ts` green and extend it with memory merge cases.

### 5. UI (minimal 制式 — read `app/src/styles/section.module.css` and `app/src/pages/teacher/teacher.module.css` first; short title + one sentence, hairline rows, no eyebrows, no dashed frames, no tilt, no stamps, no new hex colors, tokens only)

- Growth page `app/src/pages/growth/index.tsx` section `#memory` 记忆匣: keep the existing `<MemoryPanorama layers={panorama} />` exactly where it is (contract test `scripts/memory-panorama-contract.test.ts` asserts its internals), and ADD beneath it a new component `app/src/pages/growth/MemoryLedger.tsx` + `MemoryLedger.module.css`:
  - Head row: 「小白记得的事」+ one sentence; right side: 暂停记忆 toggle (aria-pressed), 「重新整理」, 「清空记忆」 (two-step confirm inline, no modal).
  - Profile block (the synthesized summary + up to 5 section lines, labelled 讲法/长处/短板/节奏/情分; `''` sections hidden).
  - Item list grouped by kind (偏好/习惯/长处/短板/里程碑/情分/笔记), hairline rows: text (inline editable: click 编辑 → input → 保存/取消), meta small (scope title / last seen relative date / 证据 N 条 expandable `<details>`), actions 固定 / 隐藏(取消隐藏) / 删除(two-step). Muted rows greyed. Empty state: `sec.empty` one sentence.
  - Add-memory row at the bottom: input 「记一条给小白」 + scope select (全局 / 当前课程列表) + 记下.
  - Entrance `animation: global(rise)` only; reduced-motion respected; 40px touch targets.
- Prep page `RecallCard` (`app/src/pages/prep/index.tsx`): under the existing recall lines add at most 2 topic-scoped memory lines (kinds weakness/strength/habit) prefixed 「小白记得：」— hidden when none or paused.
- Settings dialog `app/src/components/shell/SettingsDialog.tsx`: add tab `{ id: 'memory', label: '记忆', icon: 'book-open' }` after 台词性情: rows 「记忆开关」(paused toggle), 「已记住 N 条 · 画像更新于 …」, link 「去记忆匣整理」→ `/growth#memory` (closes dialog). Match the existing row 制式 of that dialog exactly. Keep the tablist keyboard logic working for 6 tabs.

### 6. Tests & gates

- New `app/scripts/learner-memory.test.ts` + `package.json` script `"test:memory": "tsx scripts/learner-memory.test.ts"`: determinism (same input twice → deep-equal), reconcile ADD/UPDATE/DELETE/NOOP each exercised, cap 80, retrieval scoping order, `memoryHintsForXiaobai` only style/bond kinds and never contains any `groundTruth`/`lookupCard`/`correctionCriteria` substring of the fixture topic, explicit items survive reconcile, `rebuildMemoryFromHistory` idempotent, sanitize drops garbage and keeps valid, merge newest-wins. ≥ 40 assertions; print a final `learner memory: N assertions passed` line.
- Must stay green: `cd app && npx tsc -b && npm run lint && npm run simulate && npm run test:sync && npm run test:growth && npm run test:feedback && npm run test:conversation && npm run test:custom-content && npm run test:theme && npm run test:memory && npm run build`. `simulate` runs the whole mock demo through the real store in Node — your store code must be Node-safe (no `window` at module scope; guard `localStorage`).
- Report at the end: files changed, gates output summary, any deviation from this brief with reason.

## Hard constraints
- Do not edit `server/**`, `app/src/engine/recall.ts`, `app/src/engine/memory.ts`, `app/src/engine/director.ts`, `app/src/engine/evaluator.ts`.
- `renderer.ts`: only the optional `memoryHints` field + one system block in the api path.
- Keep all existing exported signatures. Do not rename events. Do not change `types.ts` existing shapes.
- No new npm dependencies. No emoji. No `!important`. CSS Modules only, tokens only, `global(rise)`.
- PII: memory text/evidence must never include username/email/phone; hints never include untaught terms.
