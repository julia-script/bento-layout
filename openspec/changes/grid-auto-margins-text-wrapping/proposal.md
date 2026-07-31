# Proposal: grid-auto-margins-text-wrapping

## Why

Four fixtures remain quarantined, all variants of WPT
`layout-algorithm_auto-margins-ignored-during-track-sizing-001`. They are the
last actionable entries in `tests/fixtures/wpt-quarantine.json` and the only
thing between the corpus and 428/428.

**They are not a grid bug.** Diagnosed before writing this proposal, they are
two independent *harness* defects that together make the fixture unpassable by
construction — the recorded input does not describe the layout Chrome measured:

1. **The viewport is recorded as `max-content`.** `parseViewportConstraint`
   (`tests/html/support/test_helper.js:93`) only reads a real viewport size when
   the test root is wrapped in a `.viewport` element; otherwise it defaults both
   axes to `max-content`. This page has no wrapper, so the fixture says
   "max-content" while Chrome laid the page out in its actual 1280px viewport.
   The engine faithfully gives the block root its max-content width — 3030px —
   and no text ever wraps. **Zero** of the 107 imported WPT pages carry a
   `.viewport` wrapper, so every one of them currently records `max-content`.

2. **The text measure only breaks on U+200B.** `measureAhem`
   (`tests/harness/measure.ts:33`) does `textContent.split(ZWS)` and nothing
   else. That is inherited from Taffy, whose own fixtures insert explicit
   `&ZeroWidthSpace;` break opportunities. Real WPT prose uses ordinary spaces,
   so a paragraph measures as one unbreakable line: 1010px wide and 10px tall
   where Chrome wraps it to 427x30.

Verified by experiment: wrapping the test root in `.viewport {width: 1280px}`
and regenerating moves the root from 3030 to 1280 — confirming (1) — while the
children stay 1010/820/840 wide and 10px tall, confirming (2) is a separate
cause that (1) does not fix.

## What Changes

- Teach the import/generation path to record the real viewport for WPT pages,
  either by wrapping the test root in a `.viewport` element at rewrite time or
  by having the extractor fall back to the actual layout viewport when there is
  no wrapper.
- Teach `measureAhem` to break on ordinary whitespace in addition to U+200B,
  matching how the Ahem font is actually used in prose tests.
- Promote the four `auto-margins-ignored-during-track-sizing-001` variants out
  of quarantine; wpt-score 424/428 → **428/428 (100%)** and the quarantine list
  empties.
- If either change proves to have wider consequences than the evidence below
  suggests, record the fixture family as a documented harness limitation
  instead. Reaching 428/428 is not worth destabilising a 5037-test corpus.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `conformance-harness`: the fixture format records the viewport the oracle
  actually used, and the Ahem text measure wraps on whitespace, not only on
  explicit zero-width-space break opportunities.

## Impact

- `tests/html/support/test_helper.js` (viewport extraction),
  `scripts/wpt-import.ts` (if the wrapper is added at rewrite time),
  `tests/harness/measure.ts` (whitespace breaking), regenerated WPT fixtures.
- **No `src/` change is expected.** If one turns out to be needed, that is a
  genuine finding and should be split into its own change rather than folded in
  here.
- **Blast radius is the main risk, and it is real:** 127 committed HTML pages
  use the `&ZeroWidthSpace;` entity and depend on the current breaking rule, and
  12 fixtures contain space-separated text whose measurement would change.
  Regenerating WPT fixtures also re-derives expectations from Chrome, so a
  careless regeneration can silently *move the goalposts* rather than fix the
  engine. Regenerate deliberately, diff the expectations, and treat any change
  to a currently-passing fixture as a finding to explain — not noise to accept.
