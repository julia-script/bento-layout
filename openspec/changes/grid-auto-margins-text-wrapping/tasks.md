# Tasks: grid-auto-margins-text-wrapping

## 1. Whitespace break opportunities

- [ ] 1.1 Extend `measureAhem` (`tests/harness/measure.ts:33`) to break on
      ordinary whitespace as well as U+200B. Additive only — text with no
      whitespace must measure byte-identically (design D2). Note the
      min-content contribution becomes the longest *word*.
- [ ] 1.2 Full suite green with **no fixture regenerated**. This isolates the
      measure change: any fixture that breaks here is a real behavioural
      consequence, not a regeneration artifact. 12 fixtures contain
      space-separated text; expect to have to look at them.

## 2. Record the real viewport for imported pages

- [ ] 2.1 Wrap WPT test roots in an explicit `.viewport` element at import
      time, using the same width `gentest` renders at (design D1). Do not
      change `parseViewportConstraint`'s default — 107 imported pages and the
      hand-written corpus rely on it.
- [ ] 2.2 Assert at generation time that the recorded viewport width equals the
      width Chrome actually laid out at, so the two cannot silently drift.
- [ ] 2.3 Regenerate only the WPT corpus. Diff the emitted XML: any expectation
      change in a currently-passing fixture must be explained before it is
      accepted (design D3) — regeneration can move goalposts instead of fixing
      anything.

## 3. Promote and close

- [ ] 3.1 Verify the four `auto-margins-ignored-during-track-sizing-001`
      variants now pass, and that they fail on the parent commit for the
      diagnosed reason rather than incidentally.
- [ ] 3.2 Remove them from `wpt-quarantine.json`; wpt-score 424 → 428/428.
      The quarantine list should now be empty — say so explicitly in
      `wpt-score` output or the memory note if it is.
- [ ] 3.3 Answer design's open questions: confirm Chrome's 427/426/427 columns
      sum to 1280 (i.e. the `1fr` remainder interacts with the LayoutUnit
      quantization from `grid-rtl-fr-rounding-remainder` as expected), and
      spot-check the 8 WPT fixtures with multi-word text for any that were
      passing only because prose measured as a single line.
- [ ] 3.4 UPSTREAM_TAFFY.md entry only if a genuine engine defect surfaces —
      this change is expected to touch no `src/` file. Update memory
      ([[flexboxjs-wpt-conformance]]).

## Stop conditions

- If task 1.2 or 2.3 disturbs currently-passing fixtures beyond what design D2
  predicts, stop and record the family as a documented harness limitation.
  428/428 is not worth destabilising a 5037-test corpus.
- If a `src/` change appears necessary, that is a real finding: split it into
  its own change rather than folding it in here.
