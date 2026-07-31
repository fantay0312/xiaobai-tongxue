# Growth book and profile redesign QA

- Source, profile layout: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-bf6545b7-b81b-444f-9fa1-ea63691f78aa.png`
- Source, removable demo action: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-b8924a34-cd61-483e-a506-85205ff67237.png`
- Source, former seal wall: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-17826844-16fd-4849-98c6-f72bbabdd07a.png`
- Implementation, profile desktop: `/tmp/xiaobai-profile-1428x1240-v2.jpg`
- Implementation, profile mobile: `/tmp/xiaobai-profile-mobile.jpg`
- Same-input profile comparison: `/tmp/xiaobai-profile-comparison-v2.jpg`
- Verified viewports: 1428 × 1240, 1440 × 900, and 390 × 844
- Verified states: standalone growth data; authenticated profile fixture used only for visual QA and removed before the production build

## Visual checks

- The profile dialog follows the reference structure at the same 1428 × 1240 viewport: near-full-window surface, fixed left navigation, independently scrolling content, visible close action, and clear selected state.
- The implementation keeps Xiaobai’s paper, ink, seal-red, and academy typography instead of copying the reference product’s generic monochrome skin.
- Enlarging the desktop shell from 66 × 44 rem to 84 × 72 rem removed the excessive empty outer margin found in the first comparison.
- The seal area now reads as a bound archive with spine, two leaves, page folios, previous/next controls, and a focused seal preview.
- The blind-spot area reads as a celestial learning atlas with traditional constellation labels, modern orbital guides, lit/dim stars, and a paper evidence folio.
- The avatar level mark, portrait-side curved mark, and “演示重置” action are absent.
- At 390 × 844, the profile shell, seal pages, evidence folio, and document remain inside the viewport. The celestial plate alone keeps intentional internal horizontal panning.

## Interaction and accessibility checks

- Seal pagination reaches both spreads, disables the first/last direction correctly, and exposes the current folios.
- Opening a seal shows its preview; Escape closes it and restores focus to the originating seal.
- Selecting a star updates `aria-expanded` and displays the evidence folio in the same desktop viewport.
- On mobile, selecting a star brings the evidence folio into view after the horizontally pannable chart.
- The evidence folio shows the engine-owned 45% key-point, 35% correction, and 20% quiz contributions, plus base mastery and retention.
- Profile navigation switches among overview, account security, transcript/data, and preferences.
- Phone editing opens and cancels without losing the section; transcript upload and preference handoff controls remain reachable.
- Failed or indeterminate logout requests retain the visible profile and reconcile the session in the background.

## Remaining severity

- P0: none
- P1: none
- P2: none

## 2026-07-30 · 科举科名与单一学问星海

- Source, former multi-realm chart: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-cd234c85-a6df-4e3d-9194-e1dec26021ff.png`
- Source, preferred four-point star language: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-bbcd5177-382c-46c4-9342-16a8bb152904.png`
- Source, preferred continuous star-sea density: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-af989042-988f-4645-8e1c-1222e8bdd3ed.png`
- Implementation, desktop: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-sea-desktop.png`
- Implementation, mobile: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-sea-mobile.png`
- Same-input reference comparison: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/reference-comparison.jpg`
- Verified viewports: 1440 × 1000 and 390 × 844
- Verified states: desktop all-sea, desktop selected knowledge star, mobile six-topic course, mobile 30-topic course, chart/list switch, and course switch

### Visual checks

- Three stacked course realms are now one continuous deep-indigo star sea. All 42 knowledge nodes remain present in desktop all-sea view.
- Information stars and decoration stars are separate layers: six featured stars plus 28 decorative stars on desktop; four featured stars plus 14 decorative stars on mobile.
- The generated star-sea asset supplies fine atmospheric dust while the four-point project icon marks only featured or active knowledge stars.
- Course labels use three fixed, non-overlapping anchors in all-sea view; mobile labels and edge stars retain readable side clearance.
- The 30-topic mobile course uses a five-column collision-safe layout. Measured minimum center distance is 52.6 px for 49.3 px controls.
- The comparison pass confirms substantially lower information density than the former chart while retaining the requested decorative starlight and continuous star-sea atmosphere.

### Interaction and accessibility checks

- Course switching updates both the focused field and selected evidence node instead of snapping back to a prior course.
- Chart/list switching retains the selected knowledge node and the external status focus.
- Selecting a linked star renders at most three semantic links; SVG and HTML coordinates now share the same stretched view box. Measured selected-star endpoint error is 0.03 px.
- The chart exposes 42 operable nodes on desktop and the selected course’s 6 or 30 nodes on mobile. No document-level horizontal overflow was detected at 390 px.
- Roving focus declares its arrow/Home/End shortcuts and follows visual direction; focused, hovered, or selected nodes remain legible under a status filter.
- Stage presentation consistently reads 童生、秀才、举人、贡士、进士 while unbounded learning XP remains numbered as 第 N 阶.

### Fix history

- Pass 1: removed stacked realm cards and persistent semantic-link clutter; introduced the single star sea and independent decoration layer.
- Pass 2: reduced featured stars from eight/five to six/four and separated overlapping course labels.
- Pass 3: added mobile edge clearance, fixed course-switch reversion, and selected the first available topic on course change.
- Pass 4: changed mobile dense courses to five collision-safe columns, disabled compact jitter, aligned SVG paths with percentage-positioned stars, and strengthened filtered focus states.

### Remaining severity

- P0: none
- P1: none
- P2: none

## 2026-07-30 · 星形缩小与精修

- Source visual truth: `/var/folders/hz/rw0f86hj6p790vsr1vjp4pyw0000gn/T/codex-clipboard-bbcd5177-382c-46c4-9342-16a8bb152904.png`
- Implementation, desktop all-sea: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-polish-desktop-v2.png`
- Implementation, desktop selected state: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-polish-selected-v2.png`
- Implementation, mobile: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-polish-mobile-v2.png`
- Same-input focused comparison: `/Users/fantasy/Documents/作业/竞赛 /学伴智仓/output/design-qa/star-polish-comparison-v2.jpg`
- Source pixels: 625 × 640. Implementation pixels/CSS viewport: 1440 × 1000 desktop and 390 × 844 mobile at density 1.
- Normalization: the source is a star-language reference rather than a full product screen. Its 625 × 640 motif and the implementation’s 625 × 656 star-sea field crop were aspect-fit/padded to 625 × 640 and placed in one 1262 × 640 comparison image. Layout fidelity was judged separately from star-shape fidelity to avoid false precision.
- Verified states: desktop all-sea, selected Token star with two semantic links and evidence panel, mobile six-topic course, mobile 30-topic course, keyboard focus, and reduced information-star density.

### Required fidelity surfaces

- Fonts and typography: unchanged from the passed old-school academy implementation. Smaller stars leave more air around the existing course and topic labels; no new wrapping, clipping, or weight drift was introduced.
- Spacing and layout rhythm: the 44 × 44 px interaction target remains unchanged while the visible featured star is now 13 × 13 px and the active star is 13.78 × 13.78 px. The ordinary knowledge point is a borderless 3 px light core. The dense 30-topic mobile course retains a 52.65 px minimum center distance and no document overflow.
- Colors and visual tokens: stars retain the moon-paper `#f6ead0` core and status-colored short glow. Semantic links are thinner and quieter; selected/focused state stays distinguishable without scaling the full control.
- Image quality and asset fidelity: the former 29 px hollow sparkle was replaced with the exact Iconify `ph:star-four-fill` asset. Featured stars now read as small, sharp light points like the reference; desktop decoration remains 28 stars and mobile 14, with a measured 3.17–7.95 px range and maximum opacity 0.177.
- Copy and content: no product copy, mastery value, course name, knowledge-node count, or evidence semantics changed.

### Comparison history

- Pass 1 finding: the production 29 px hollow four-point outline and 7 px ring core read like large form markers rather than stars.
- Pass 1 fix: reduced the outline to 18 px, the core to 5 px, softened links and glow, and reduced decoration to 5–12 px.
- Pass 2 finding: the smaller outline still read as a hollow diamond and remained more prominent than the reference’s pin-light stars.
- Pass 2 fix: replaced it with the library-sourced solid four-point asset, reduced featured stars to 13 px, active scale to 1.06, ordinary nodes to 3 px solid points, locked nodes to 2 px, and decoration to 3–8 px at 0.07–0.18 opacity with a 10-second breath.
- Post-fix evidence: the same-input comparison shows solid, compact light points with a short halo instead of large hollow diamonds. Desktop measures 6 featured + 28 decorative stars; mobile measures 4 + 14. Selected evidence, two semantic links, keyboard focus, and all click targets remain functional. Browser logs contain no error or warning.

### Remaining severity

- P0: none
- P1: none
- P2: none

## 2026-07-31 · 成长编年轴卷首重构

- Source visual truth: `/Users/fantasy/.codex/generated_images/019fb7c6-29ee-7821-b61c-4032aba963ec/exec-e3b6cd58-e80a-4a07-8b55-11229b559325.png`
- Implementation, source-sized desktop: `/tmp/xiaobai-growth-reference-size.png`
- Implementation, 1440 desktop: `/tmp/xiaobai-growth-1440.png`
- Implementation, 390 mobile: `/tmp/xiaobai-growth-390.png`
- Same-input comparison: `/tmp/xiaobai-growth-comparison.jpg`
- Source pixels: 1487 × 1058. Source-sized implementation viewport/pixels: 1487 × 1058 at density 1.
- Verified viewports: 1487 × 1058, 1440 × 1024, 960 × 1000, 720 × 1000, 560 × 1000, and 390 × 1000. The 720 px and 390 px checks also cover the effective reflow widths reached at 200% and 400% desktop zoom.
- Verified states: default 童生 / 好奇型, 性情切换到严谨型, live-region announcement, then restoration to 好奇型.

### Required fidelity surfaces

- Structure: the former full-width title, dream banner, five equal stage cards, three persona cards, and two mentor cards are replaced by the selected asymmetric dossier / chronicle / marginalia composition.
- Hierarchy: the center column owns the current chapter, unbounded learning-XP track, wish, and the five-stage chronology. The current chapter is the single expanded `aria-current="step"` item rather than a duplicated stage card.
- Rhythm: the portrait is the only complete paper object; the wish is an unboxed margin note; future stages are ruled ledger rows; persona choices are flat marginal notes. This removes the previous repeated rounded-card cadence.
- Brand fidelity: all colors, typography, radii, paper treatment, and the existing `XiaobaiAvatar` asset come from the project design system. No generated character asset, new hex color, emoji, fake icon, or decorative UI gradient was added.
- Mobile: the portrait and title compact into a short identity strip before the current chapter. The five-stage chronology remains a vertical list with no page-level horizontal overflow at 390 px.

### Interaction and accessibility checks

- Source order exposes the `h1` before the decorative portrait; the portrait and repeated dossier facts are hidden from assistive technology.
- The learning progressbar exposes min, max, now, label, and value text. The five fixed degree names remain separate from the unbounded “第 N 阶” XP language.
- Persona controls use real buttons, `aria-pressed`, persistence through the existing store action, and a concise polite live-region update. Switching and restoring the default state passed in the in-app browser.
- Every persona button and the primary next-step link measures at least 44 px high at all tested breakpoints.
- 390 px has `scrollWidth === clientWidth`; stage rows reflow vertically and no horizontal stage scroller remains.
- Reduced-motion retains the global timer/animation safeguards and removes the new width/transform transitions. Forced-colors gives current nodes and selected persona states explicit system-color edges.
- Browser console check after responsive and interaction passes returned no warnings or errors.

### Fix history

- Pass 1: replaced the two-column card collection with the selected three-column chronology and flat marginal notes.
- Pass 2: collapsed the mobile portrait into a compact identity strip and fixed the avatar sprite frame leaking a second expression when its inline square size was constrained.
- Pass 3: merged the duplicated current-stage row into the five-item ordered chronology, aligning the implementation with the selected reference and preserving one semantic current step.

### Remaining severity

- P0: none
- P1: none
- P2: none

## 2026-07-31 · 编年史、金句画廊与星链精修

- Current-before, chronicle desktop/mobile: `/tmp/growth-audit-chronicle.png`, `/tmp/growth-audit-chronicle-mobile.png`
- Implementation, chronicle desktop/mobile: `/tmp/growth-after-chronicle-v2.png`, `/tmp/growth-after-chronicle-mobile-v2.png`
- Current-before, gallery desktop/mobile: `/tmp/growth-audit-gallery.png`, `/tmp/growth-audit-gallery-mobile.png`
- Implementation, gallery desktop/mobile: `/tmp/growth-after-gallery.png`, `/tmp/growth-after-gallery-mobile-v2.png`
- Same-state gallery comparison: `/tmp/growth-gallery-mobile-before-after.png`
- Current-before / implementation, selected star links: `/tmp/growth-audit-star-links.png`, `/tmp/growth-after-star-links.png`
- Same-state star-link comparison: `/tmp/growth-star-links-before-after.png`
- Verified viewports: 1280 × 720, 611 × 731, and 390 × 844.
- Verified states: zero-entry and one-entry chronicle, zero-entry gallery, selected 「Token 与分词」 with semantic links and evidence dock.

### Visual checks

- Chronicle entries no longer read as repeated admin cards. Dates and classroom records now share a continuous solid ledger spine, ruled separators, flat metadata, and an editorial empty-state folio.
- Chronicle metadata reflows from three columns to a two-plus-full-width arrangement at 390 px. The empty state and the one-entry state have no page-level horizontal overflow.
- Gallery no longer uses the masked horizontal card carousel. Its real-data structure is an ordered, two-column editorial archive with a full-width lead quote; the current empty state is a composed `COLLECTION 00` museum note rather than a loose sentence.
- At 390 px, section subtitles move to their own line. The former orphan final character in the gallery subtitle is gone, and `scrollWidth === innerWidth`.
- The selected-star comparison uses the same 1280 × 720 state. The former `1px` dashed foreground plus `4px` glow reads as a broken rope; the final `0.75px` continuous foreground plus `2.25px` low-opacity glow reads as a quiet cartographic relation.
- Star-link curvature is reduced from 9% / 18–42 px to 5.5% / 10–28 px. The long downward relation remains visible without dominating the Milky Way asset.

### Interaction and accessibility checks

- `#chronicle`, six-entry default paging, `aria-expanded`, `aria-controls="chronicle-log"`, report links, and the real event/report derivation remain unchanged.
- Chronicle now exposes summary values as a `dl`, dates as `time[dateTime]`, and each classroom record as an `article` with an `h3` topic heading. Report links and the old-page control retain at least 44 px height.
- Gallery keeps `global.goldenAnalogies` as its only data source and adds `ol` / `figure` / `blockquote` / `cite` / `time` semantics without changing id, text, topic fallback, time, or order.
- Selecting 「Token 与分词」 still sets `aria-pressed="true"`, opens the evidence dock, and renders at most three semantic links. SVG remains `aria-hidden`, link paths remain non-interactive, and star buttons remain 44 × 44 px.
- The in-app browser log contains no warnings or errors after reload, star selection, responsive checks, and hot updates.
- The current browser archive contains no saved golden analogy, so populated-gallery visual coverage is enforced by the semantic/static contract and responsive CSS rather than a screenshot with fabricated persisted data.

### Remaining severity

- P0: none
- P1: none
- P2: none

final result: passed
