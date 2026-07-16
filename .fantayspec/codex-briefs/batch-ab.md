# Brief: Batch A+B — classroom viewport lock + dialogue engine fixes

ROLE: Senior implementation engineer. You have direct write access (workspace-write). Edit source files directly. Do NOT commit. Keep diffs minimal — the orchestrator reviews your git diff afterwards.

PROJECT: "小白同学" — Feynman-reverse learning app (student teaches AI pupil 小白). Vite+React+TS in `app/`. Engine modes: `mock` (rule/template), `api`/`proxy` (LLM via gateway). All colors from `app/src/styles/tokens.css` (never invent hex). UI copy Chinese, 书斋 tone; Xiaobai calls the user 老师 in class.

This implements fixes for real user-testing feedback. Line refs below were verified today.

## TASK A — classroom viewport lock (tiny, surgical)

Feedback (both testers): "黑板随着对话变长窗口也变长了…左边的小白就看不到了；黑板最好可以用滚轮滑动".
Root cause: `.shell{min-height:100dvh}` (app/src/components/shell/AppShell.module.css:3-4) has no height ceiling, so long conversations grow the page and the left Xiaobai rail scrolls away. A viewport lock exists as dead code inside the retired dark-shell variant `.board{height:100dvh;overflow:hidden}` (AppShell.module.css:13-18) — `boardMode` is hardcoded false (AppShell.tsx:27-29).

Fix exactly this way:
1. AppShell.tsx: derive `appLocked` from route `pathname.startsWith('/teach')` (mirror how `landingMode` is derived ~:30) and append a new class to `shellClass` (~:55-59).
2. AppShell.module.css: new `.locked { height: 100dvh; overflow: hidden; }` — height-only, NO colors. Do NOT reuse `.board` (it re-tints header/background dark; the room must stay paper-colored).
3. `app/src/pages/classroom/*` needs NO changes: the internal scroll chain (.room→.main→.chat→.boardObj→.stream all flex:1/min-height:0/overflow-y:auto) and stick-to-bottom logic (classroom/index.tsx:326-349, scrollToBottom + nearBottom<96) are already correct and start working once the shell has definite height.

Acceptance: on /teach with long conversation the body no longer scrolls; wheel scrolls `.stream` inside the blackboard; left `.stage` stays visible; the `position:fixed` lookup drawer (classroom.module.css:609) unaffected.

## TASK B — engine: three dialogue-quality fixes

Flow map: appStore.submitTeaching (app/src/store/appStore.ts:195-284) → guard → evaluate (app/src/engine/evaluator.ts:98; rule path :32-91, llm merge :142-199, prompt :201-230) → director.decide (app/src/engine/director.ts:101-300, PURE code) → speakXiaobai (app/src/engine/renderer.ts:167-217; mock :90-121, api :123-147, actionBrief :149-162, leakage loop :193-216). Node test mirror: app/scripts/simulate.ts (teachTurn :94-152).

### B-P1: off-topic misjudgment when teacher answers Xiaobai's OWN tangent question

Feedback: in api mode Xiaobai asks curiosity follow-ups beyond today's checklist (e.g. "词表是怎么收集来的?"). The teacher answers; the answer contains no checklist vocab, so evaluator marks `offTopic` (evaluator.ts:72-74 rule, :174 merge), director takes the ev.offTopic branch (director.ts:196-198) → line "嗯,老师,这个跟今天的知识点没关系吧" (data/xiaobaiLines.ts:53). Xiaobai dismisses the answer to his own question — feels broken.

Root cause: evaluator is blind to context — EvaluateInput (evaluator.ts:11-18) and the eval user JSON (:221-229) carry only the current utterance.

Fix direction (you own the detailed design):
- Thread recent context (at least the last Xiaobai bubble) from appStore.ts:221-223 into evaluate; extend EvaluateInput.
- api mode: include the last Xiaobai line in the eval user JSON + a system-prompt rule: if the teacher's utterance is a responsive answer to Xiaobai's immediately-preceding question — even beyond today's checklist — do NOT mark offTopic; expose a separate flag (e.g. answeredTangent). Gateway accepts ONLY [system] or [system,user] shapes — keep exactly one system + one user.
- mock mode: cheap lexical guard — normalized content-word overlap between teacher utterance and the last Xiaobai question (e.g. ≥1 shared CJK token of length ≥2 after stripping punctuation/stopwords) → suppress offTopic.
- ⚠️ CRITICAL: do NOT use "previous Xiaobai bubble contained a question" as the guard — nearly every Xiaobai line ends with a probe; that would kill off-topic detection entirely and break simulate red-path assertions (偏题→stay_confused + 拉回 simulate.ts:289-292; R4 :275 asserts line does NOT contain "没关系吧"). Simulate's off-topic turns (sports smalltalk) share no content words with the preceding probe — they must stay red-path.
- Desired UX when suppressed: Xiaobai briefly acknowledges the answer (existing "记进小本本" motif welcome), no false dismissal; director treats it as a stay/park turn (no checklist hit, no mc event — keep simulate :291-292 semantics for TRUE off-topic only). New mock template lines go in data/xiaobaiLines.ts, zero-jargon (terms only via {term}/{belief}/{probe} slots — file-head comment :2-6; some pools assert first-element ordering, read comments).

### B-P2: hard topic switches, no bridging

Feedback: "感觉是为了推备课里面的教学路线而突然切换话题,前言不搭后语;没有懂token数不用省和下一句的关系,感觉是硬切了一个话题".
Where: director pickNextTarget (director.ts:88-99, 272-299) hands renderer a new probe; mock glues raw `next.probeLine` (renderer.ts:116-119); api actionBrief (:149-162) never instructs bridging.

Fix:
- api mode: for ask_*/express_understanding briefs, add instruction: first respond/acknowledge the teacher's last sentence in ONE short clause (may reuse words from recentTeacherTerms whitelist — already leakage-safe), THEN ask the probe.
- mock mode: prefix a short bridge connector before `next.probeLine` (template with existing slots, zero-jargon).
- MUST keep `probeLine` verbatim as substring of the final bubble — simulate.ts:177-182 asserts probe continues after aha paraphrase. Prefix/append around it; never paraphrase the probe.

### B-P3: pacing — "切换的太快了,没反应过来"

Current: paraphrase + new probe glued into ONE bubble; typewriter fixed 26ms/char (classroom/index.tsx:96-104); director systemNote renders instantly (:483-509).

Fix, prefer UI-level (do NOT change message/event data shape; splitting one xiaobai turn into multiple messages risks replay/report/diary derivations):
- Insert a natural typewriter pause (~600-900ms) at the sentence boundary before a trailing probe question (detect 。/！/？ boundary in the UI, or renderer emits an invisible pause marker the UI strips — stored message text must stay clean for quote-grounding and replay).
- Optionally length-adaptive typing speed (long bubbles slightly slower, cap total duration).
- Delay the systemNote bubble's appearance until the xiaobai typewriter finishes.
- Reduced-motion: typewriter is JS-driven; if an instant-render path exists honor it, otherwise leave and note it.

## HARD CONSTRAINTS (violating any = rework)

- director.ts stays pure code (no LLM, no async). Every Xiaobai line exits ONLY via speakXiaobai's leakage gate. Gateway shape [system] / [system,user] only. Mock templates: zero jargon, slots only.
- Quote-grounding discipline unchanged (evaluator.ts:130-133,147-158,176-182). Don't touch it.
- ALL existing simulate assertions stay green. You may ADD assertions (recommended: one for P1 answered-tangent guard, one for P2 bridge keeping probeLine substring); never weaken existing ones. If an existing assertion's literal must evolve, stop and explain in your summary instead of changing its intent.
- No new hex colors; new UI copy in Chinese, 书斋 tone.
- Only touch files under app/src and app/scripts. Do not commit.

## VERIFY (run yourself, from app/)

- `node --import tsx scripts/simulate.ts` (this exact form; npm IPC pipes may be blocked in your sandbox) — must end all-green.
- `npx tsc -b --noEmit` — clean.

## OUTPUT (final message, English, ≤300 words)

1. Files changed, one line each. 2. Key design decisions (esp. P1 guard + P3 pause mechanism). 3. Verification results with exact assertion counts. 4. Anything you deliberately did not do.
