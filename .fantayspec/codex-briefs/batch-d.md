# Brief: Batch D — prep teaching-flow narrative + remedy note + exam-readiness cue

ROLE: Senior implementation engineer. Direct write access (workspace-write). Edit files directly. Do NOT commit. Keep diffs minimal. NOTE: earlier batches already modified engine/renderer/evaluator/appStore/classroom files — READ CURRENT CODE FIRST; line refs below were taken before those merges and may have drifted.

PROJECT: "小白同学" (Vite+React+TS in `app/`). UI copy Chinese, 书斋 tone (课堂台词称"老师"; 册页物称"先生"). Colors from tokens.css only.

## D-1: Prep page "讲课节奏" narrative (feedback: "感觉就是学了一些零散的知识,建议把整条线连起来")

Prep page: app/src/pages/prep/index.tsx. Sections 壹..伍 = SECTIONS at :36-42; 叁 讲课路线图 renders topic.checklist as an <ol className={s.roadmap}> at :531-574 with LEVEL_META (澄清/举例/边界/试探/迁移, :27-33) badges + probeLine quotes; an L4 ambush row is spliced mid-list (ambushAfter :243, :556-570).

Task: add a short teaching-flow lead narrative ABOVE the roadmap <ol> — a pure derivation from existing topic data, ZERO edits to the 38 topic files:
- New local pure helper (e.g. app/src/pages/prep/flow.ts — pages must NOT import engine/ per DESIGN.md:54): `deriveTeachingFlow(topic)` stitches from `topic.checklist` ({point, level} per item, types.ts:95-111), `topic.misconceptions.length`, `topic.transferHint` (types.ts:143).
- Output shape: 3–5 short sentences in 书斋 tone telling the teacher HOW the lesson flows as one line, e.g.: 先把「{L1 point 短语}」讲清 → 再用例子立住 → 然后逼到边界 → 中途小白会有 {N} 处想岔的地方等你纠 → 最后把它迁移到「{transferHint 或 L5 point}」收束. Quote 1-2 real checklist point titles so it feels grounded, not boilerplate. Do NOT reveal misconception contents (prep already previews them elsewhere, but the narrative should sell rhythm, not spoil specifics).
- Render as a lead paragraph/纸条 styled block in section 叁 (prep.module.css — follow existing 双线书版式/眉批 styling conventions in that file; no new hex colors; typography via existing tokens/--font-display for quoted phrases if fitting).

## D-2: Review page remedy note (feedback: "我没有看到补学模块哎,因为小白100分的缘故吗")

app/src/pages/review/index.tsx: section 肆 "小白还没懂的地方" — when `report.blindSpots.length === 0` the whole branch collapses to one muted line "这次没有留下盲区——小白全都听懂了" (:254-255). RemedyPath only exists inside a blindspot with mcId (:275-293).

Task: augment that empty branch so testers understand the module exists:
- If `report.masteredNow` (true full mastery: coverage+all mc corrected+quiz≥80, engine/mastery.ts:125-128): line like "本场满分出师,没有留下盲区——「补学小径」只在小白答错或被带偏时才会出现。"
- Else (empty by luck/short session): keep existing sentence + append the same explanation clause.
- Pure copy + conditional change; match existing muted styling. No new sections.

## D-3: In-class exam-readiness cue (feedback: "不知道他到底掌握情况咋样了…不知道啥时候停手")

Anti-cheat law: the classroom must NOT reveal director machinery (misconception states, checklist specifics, numbers). A VAGUE readiness vibe is approved. Director stays PURE code.

Design (follow unless current code makes something impossible — then adapt minimally and report):
1. engine/director.ts decide() already computes coverage `hitNow.length / topic.checklist.length` (~:103, :293-294) and knows misconception progress. Add an optional `examReady?: true` to the Decision type (~:17-29), emitted when coverage ≥ 0.8 AND no misconception remains waiting-to-inject AND none is currently adopted-uncorrected. Pure, deterministic.
2. Fire the user-visible cue ONCE per session: track via a session-local flag. Prefer an optional additive field on TopicState (types.ts ~:169, e.g. `examCuedAt?: number`) set through the existing stateDelta merge in appStore.submitTeaching — CHECK zustand persist merge + store/sync.ts sanitize tolerate the new optional field (additive optional should be safe; verify, and keep it out of any strict schema lists). If TopicState extension turns out to ripple too far, an in-memory once-per-live-session flag on the live session object is acceptable — but it must not fire again on every turn.
3. When decision.examReady fires first time, appStore appends a FIXED constant Xiaobai line as its own message after the normal turn output (constant in app/src/data/xiaobaiLines.ts, zero-jargon, no slots needed), e.g. "老师,今日的功课我心里大概有谱了——您要是觉得讲得差不多,就送我去考场试试吧!" Fixed constants are the approved leakage-safe precedent (DEFLECTION_LINE in appStore). No numbers, no checklist/misconception hints.
4. Soft UI affordance: when the cue has fired, the classroom header 送小白赴考 button (pages/classroom/index.tsx ~:432-443, finishLabel/finishIcon ~:417-418) gains a quiet emphasis class (e.g. a reed-ink dot or gentle glow via classroom.module.css; tokens only; if animated, one-shot var(--ease-out) or loop var(--ease-loop); respects global reduced-motion).

simulate: app/scripts/simulate.ts — ADD assertions: (a) happy-path full lesson emits the readiness cue exactly once, only after coverage crosses the threshold; (b) true off-topic turns never emit it; (c) replaying/ending session doesn't duplicate it. NEVER weaken existing assertions. If batch B added an answeredTangent flag, make sure your director change composes with it (answered-tangent turns produce no checklist hits, so they can't accidentally trigger readiness).

## HARD CONSTRAINTS

- director.ts pure (no LLM/async). Gateway shape [system]/[system,user] untouched. Mock templates zero-jargon. Quote-grounding untouched.
- All existing simulate assertions stay green; run the full suite.
- Only touch: app/src/pages/prep/*, app/src/pages/review/*, app/src/pages/classroom/* (button emphasis only), app/src/engine/director.ts, app/src/store/appStore.ts (+sync.ts only if needed for the optional field), app/src/data/xiaobaiLines.ts, app/src/types.ts, app/scripts/simulate.ts. Do not commit.

## VERIFY (from app/)

- `node --import tsx scripts/simulate.ts` all-green (including your new assertions).
- `npx tsc -b --noEmit` clean.

## OUTPUT (final message, English, ≤250 words)

1. Files changed, one line each. 2. Design decisions (once-per-session mechanism chosen; readiness condition). 3. Verification results with counts. 4. Anything deliberately not done.
