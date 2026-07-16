# Brief: Batch E — 盲区星图 unified sky + cross-course star links

ROLE: Senior implementation engineer. Direct write access (workspace-write). Edit files directly. Do NOT commit. Keep diffs focused; the orchestrator reviews git diff afterwards.

PROJECT: "小白同学" (Vite+React+TS in `app/`). User feedback on the growth page 卷三 盲区星图: "这个可以做成星图,星图的一部分,且可以相互连接" — they want it to feel like ONE real star chart where related knowledge points interconnect, not three separate course strips.

CURRENT STATE (verified today):
- Component `app/src/pages/growth/KnowledgeMap.tsx` (303 lines) + styles in `app/src/pages/growth/growth.module.css`. Used by growth page 卷三; `onSelect` opens an evidence chain elsewhere — that contract is frozen.
- Structure: `.starAtlas > .skyChart` (one dark panel) containing per-course `<section .skyRealm>` (壹垣《大模型训练》6 stars / 贰垣《操作系统原理》30 / 叁垣《Python 程序设计》6). Each realm has `.skyHead` (number+title+progress+hint) and `.skyField` with its own `<svg .skyLines>` (viewBox 720×fieldH, preserveAspectRatio=none, AmbientDust + serpentine segment lines lit/walked/dim) plus `<ol .starList>` of absolutely-positioned `.starSlot` `<li>`s (left/top in %, entrance stagger min(i*45,300)ms) each holding a `.starBtn` (五态 star glyph + name).
- Deterministic star positions: `starPoint()` — 6-col serpentine + FNV hash jitter + sine wave. DO NOT change position math (refresh-stable positions are a discipline).
- Realms are visually separated by dashed dividers (in growth.module.css, look for the realm border/divider rule).

## E-1: One continuous sky

Make the three realms read as constellations in ONE sky, not three stacked strips:
- Remove/soften the hard dashed dividers between realms inside `.skyChart`; the dark sky background must flow continuously.
- Keep the `.skyHead` info (垣名/进度/hint) but restyle it as a floating in-sky constellation annotation (smaller, quieter, sits over the sky rather than banding it). Keep the h3/aria-labelledby semantics.
- Keep DOM order, Tab order, and all existing star button semantics/interactions untouched.

## E-2: Cross-course star links (the core ask)

1. New curated data file `app/src/data/starLinks.ts`:
   ```ts
   export interface StarLink { a: string; b: string; note: string } // note ≤10 字, e.g. '同讲 Token'
   export const STAR_LINKS: readonly StarLink[] = [ ... ];
   ```
   Propose 12–18 semantically REAL links by reading actual topic data (`app/src/data/topics/`, titles/points). Candidates to verify and extend (verify exact topicIds yourself):
   - OS「Scaling Law 与 Agentic AI」↔ LLM「Scaling Laws」(同讲 Scaling)
   - OS「一个 Token 的旅程」↔ LLM「Token 与分词」(同讲 Token)
   - OS「多处理器编程」/「并发控制:互斥」↔ Python「GIL 与多线程」(并发一脉)
   - Python「生成器与迭代器」↔ OS「协程与异步编程」(让出执行权)
   - Python「可变默认参数」↔「浅拷贝与深拷贝」(对象引用语义, intra-course non-adjacent links are allowed when meaningful)
   - OS「CPU、GPU 和 SIMT」↔ LLM「预训练与微调」(训练算力)
   - OS「计算机系统安全」↔ LLM「RLHF 与对齐」(安全与对齐)
   Rules: both endpoints must be existing topicIds; no self-links; no duplicate pairs (a/b unordered); prefer cross-course; every note must be honest (no forced links — quality over count).
2. Render an overlay `<svg>` spanning the WHOLE `.skyChart` (absolute inset-0, aria-hidden, pointer-events:none) that draws a gently curved path (single quadratic, slight bow) between linked star centers.
   - Positions MUST be measured from the DOM (the per-realm SVGs use preserveAspectRatio=none so math from viewBox coords won't hold). Suggested: give each `.starSlot` li a `data-star-id={topicId}`; measure centers with offsetLeft/offsetTop chains or getBoundingClientRect relative to `.skyChart`; recompute on mount + ResizeObserver (and after fonts/layout settle — one rAF after mount is fine; entrance animation only transforms, and getBoundingClientRect during translateY(8px) rise could be off by 8px — either measure via offset* layout properties (immune to transforms) or delay first measure ~350ms).
   - Overlay svg uses measured pixel width/height (no preserveAspectRatio=none scaling), so strokes render naturally.
3. Link styling (tokens only, dark-sky context): default = faint dashed lilac (`color-mix(in oklab, var(--lilac) 34%, transparent)`-ish), clearly distinct from the intra-course dust-white 星轨; when BOTH endpoints are mastered → a brighter reed/jade lit style (mirror the existing segLit/segGlow language). Optional tiny midpoint note label — only if it stays quiet; skip if noisy.
4. Interaction: hovering OR focusing a star button highlights its cross-links (stroke brightens) and the linked stars (e.g. a soft halo class). Selected star (existing `selectedId`) keeps its links highlighted. Implement with component state (hoveredId) + class toggles; NO layout shifts, NO transform on `.starSlot` (discipline: slots must never get transforms).
5. Reduced-motion: links render statically (no draw-in animation needed; if you add one, one-shot var(--ease-out) and it dies under the global kill switch).

## E-3: Data hygiene assertion

`app/scripts/simulate.ts` has a 数据体检 section near the end. Add checks: every STAR_LINKS endpoint is a valid topicId in TOPICS; no self-link; no duplicate unordered pair. Import STAR_LINKS by path (avoid barrels if simulate's existing imports do so — follow the file's current import style).

## HARD CONSTRAINTS

- Star position math (`starPoint`, hash01, serpentine) unchanged. `.starSlot` gets no transform. Entrance stagger stays.
- `--dust-o` custom-property opacity discipline for dust stays; `.skyLines` preserveAspectRatio=none lines keep `vector-effect: non-scaling-stroke` (check existing css and keep).
- Colors from tokens.css or color-mix of tokens only; the sky panel is one of the page's approved deep anchors — do not add new deep panels elsewhere.
- Evidence-chain contract frozen: `onSelect(topicId)`, `selectedId`, button aria/labels keep working exactly as before.
- Only touch: app/src/pages/growth/KnowledgeMap.tsx, app/src/pages/growth/growth.module.css, app/src/data/starLinks.ts (new), app/scripts/simulate.ts (assertion only). Do not commit.

## VERIFY (from app/)

- `npx tsc -b --noEmit` clean.
- `node --import tsx scripts/simulate.ts` all green including your new data checks.
- `npm run build` succeeds.

## OUTPUT (final message, English, ≤300 words)

1. Files changed. 2. The final STAR_LINKS list (a ↔ b + note, so the orchestrator can fact-check semantics). 3. Measurement approach chosen and how resize/entrance-animation is handled. 4. Verification results. 5. Anything deliberately not done.
