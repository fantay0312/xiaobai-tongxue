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

final result: passed
