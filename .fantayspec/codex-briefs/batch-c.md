# Brief: Batch C — Xiaobai expression fix + click reactions + aha celebration

ROLE: Senior implementation engineer. Direct write access (workspace-write). Edit files directly. Do NOT commit. Keep diffs minimal — orchestrator reviews git diff afterwards. NOTE: an earlier batch already modified AppShell/engine/classroom files — read current code first; line refs below may have drifted slightly.

PROJECT: "小白同学" (Vite+React+TS in `app/`). Xiaobai is a 2D CSS sprite: `app/src/components/xiaobai/XiaobaiAvatar.tsx` + `XiaobaiAvatar.module.css`, atlas `app/public/xiaobai-book-boy-atlas.webp` (1776×888, 4 cols × 2 rows, cell 444×444, ALL 8 cells occupied — no spare cells; you cannot add new artwork).

SPRITE_FRAMES (XiaobaiAvatar.tsx:22-31): idle{0,0} gentle smile · curious{1,0} finger-to-chin · confused{2,0} **scratching head, droopy sad eyebrows + frown** · thinking{3,0} chewing brush pen · aha{0,1} pointing up with yellow spark marks · happy{1,1} closed-eye laugh · proud{2,1} arms crossed · shy{3,1} bowing 作揖 with clasped hands.

Props contract is FROZEN (mood/level/speaking/size/variant). Zero-breakage seam: root div already exposes `data-mood={mood}` (XiaobaiAvatar.tsx:63). Variants: paper (default) and board (dark chalkboard, module.css:79-92). Existing animation: only `speakingNod` loop (module.css:94-97, var(--ease-loop)) + entrance `global(rise)`. Reduced-motion kill at module.css:99-102 plus the GLOBAL kill switch (app/src/index.css:77-87). Note `.avatar::after` is an inset ring (z-index:1, pointer-events:none) and `.levelMark` sits at z-index:2 — pick your overlay layers around those.

User feedback driving this batch:
1. "小白产生的'困惑'的情绪看起来怪怪的,是不是考虑换一个会更有意思" — diagnosis (orchestrator viewed the atlas): the confused cell's art reads as SAD/distressed (难过), not puzzled — droopy brows + frown mismatch the label 困惑, which is why it feels off.
2. "点小白的头,小白会挠头,点脸颊会微笑的那种…想要留住人的话,可以从小白这个形象和互动上做一些细节"
3. "可以在小白开窍的时候加一些萌萌的动画" — but brand tone is 认真求学的少年, NOT 萌宠 (app/DESIGN.md:53) — celebration must stay scholarly/ink-flavored.

## C-a: Recontextualize the confused expression (no new art possible)

Add a CSS overlay that makes the frame read as 困惑 instead of 难过: a small ink-drawn thought-puff with a "?" floating near the head, in `--ink-soft` (paper variant) / `--chalk-soft` (board variant). Implement as a component-level element or pseudo-element gated by `[data-mood="confused"]` in XiaobaiAvatar.module.css (TSX edits are allowed as long as the props contract is untouched). Requirements:
- Scales with the avatar (component uses container-type:inline-size + cqi units; smallest usage is size 92 in pages/exam/ExamQuestion.tsx:78-83 — must stay legible/not clip there).
- Gentle float loop allowed → `var(--ease-loop)` ONLY; one-shot appear → `var(--ease-out)`. New keyframes defined inside the module.css are fine (only referencing globally-defined keyframe names needs `global()`).
- The "?" must be a drawn/typographic mark (font `var(--font-display)` glyph or inline SVG stroke), NOT an emoji (DESIGN.md:13). Colors from tokens only.
- Optional bonus: a one-shot subtle head-tilt (≤2deg rotate on the sprite wrapper, var(--ease-out)) when entering confused.

## C-b: Click reactions (classroom only)

Handle pointer events on the classroom stage wrapper `.boardFrame` (pages/classroom/index.tsx:456, classroom.module.css:131-139) so the XiaobaiAvatar props contract stays frozen. Design:
- Split hit zones by pointer Y within the frame: top ≈ head → 挠头 reaction: temporarily swap displayed mood to `confused` frame {2,0} (it literally IS a scratch-head pose) WITH a blush overlay so it reads as bashful/sheepish (挠头不好意思), NOT sad. If in practice this still reads sad, fall back to `shy` {3,1} (作揖). Mid/face zone → 微笑 reaction: swap to `happy` {1,1} + blush overlay.
- Mechanism: classroom-local transient state (e.g. `tapMood`) with ~900ms setTimeout revert; render `mood={tapMood ?? (live.busy ? 'thinking' : live.mood)}`. Gate taps on `!live.busy` so it never fights the thinking/typing flow. Clear timeout on unmount.
- Blush overlay: two soft radial cheek washes via CSS on a `.tapBlush`-style class (color from `--lilac-wash` or a color-mix derivation of tokens — no new hex).
- Add `cursor:pointer` on .boardFrame; a tiny press feedback (scale 0.99, var(--ease-out)) is welcome. Keyboard/a11y: give the wrapper role="button" tabIndex={0} aria-label="逗逗小白" and trigger the face reaction on Enter/Space; the reaction is decorative so also keep aria-live silence (no announcements).
- Do NOT add reactions to other pages (home/growth/exam) this round.

## C-c: Aha/开窍 celebration

Today only the chat bubble gets `ahaWash` (classroom.module.css:327-334); the avatar itself does nothing. Add a one-shot celebration on the avatar when mood becomes `aha`:
- CSS keyed off `[data-mood="aha"]` (newly-matching selector restarts the animation when entering aha — sufficient).
- Visual: 2–4 rising ink-sparkle marks (inline SVG strokes or pseudo-elements; reed/jade family — `--reed-ink` on paper, `--chalk-jade` on board) + a soft radial reed wash bloom behind the figure. Single-direction motion, `var(--ease-out)`, fill-mode backwards, NO infinite loop, NO bounce/elastic (DESIGN.md:14). Scholarly ink flavor, not confetti.
- Must look right at classroom size 170 (board variant) and degrade gracefully at other sizes/variants (exam page also hits `aha` at size 92 when an answer is judged correct — that's fine and desirable).
- Global reduced-motion kill switch already covers CSS animations; do not add JS-driven motion here.

## HARD CONSTRAINTS

- XiaobaiAvatar props contract frozen: mood/level/speaking/size/variant signatures unchanged (adding NO new required props; avoid new optional props unless truly necessary — prefer data-mood CSS seam + classroom wrapper handling).
- Colors from tokens.css only (or color-mix of tokens). No emoji as design elements. Entrance anims = global(rise) only; loops = var(--ease-loop); one-shots = var(--ease-out).
- Only touch: app/src/components/xiaobai/*, app/src/pages/classroom/index.tsx, app/src/pages/classroom/classroom.module.css. Nothing else. Do not commit.

## VERIFY (from app/)

- `npx tsc -b --noEmit` clean.
- `node --import tsx scripts/simulate.ts` still all-green (should be untouched by this batch — run to prove no accidental engine impact).

## OUTPUT (final message, English, ≤250 words)

1. Files changed, one line each. 2. Design decisions (head-tap frame choice; overlay layering vs ::after ring/levelMark). 3. Verification results. 4. Anything deliberately not done.
