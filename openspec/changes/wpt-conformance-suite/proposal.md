# Proposal: wpt-conformance-suite

## Why

Fuzz-tree counts cannot answer "how many bugs are left" — one bug flags a whole
tree, several trees share one cause, and the generated space is unbounded. WPT
(web-platform-tests) is the conformance suite Chrome, Firefox, and Safari share:
a finite, enumerated, spec-organized corpus. Importing the subset our engine can
express gives a real denominator ("N/M passing, grouped by spec section") to
stabilize against before resuming fuzzing.

## What Changes

- Add a local WPT corpus (sparse checkout at `~/Documents/dev.nosync/wpt`,
  already cloned: css-flexbox, css-grid, css-sizing, css-align; ~4,600 test
  files, ~881 check-layout-th geometry tests, ~390 within our feature subset by
  a first-pass grep).
- Add an **importer** (`scripts/wpt-import.ts`) that scans WPT test files,
  classifies them (geometry-assertion / static-markup / unsupported), rewrites
  the usable ones into our gentest harness shape, and emits them under
  `tests/html/wpt/<suite>/`.
- Reuse the existing `gentest` Chrome pipeline as the oracle — WPT's own
  expectations and reference pages are not consumed; WPT serves as curated,
  spec-targeted *inputs*. Reftests are therefore importable too when their
  markup is in-subset.
- Add a **scoreboard** (`pnpm wpt-score`): pass/fail counts per suite and per
  spec-section annotation (WPT `<link rel="help">` URLs name the section).
- Failing imports become the work queue; fixes follow the existing loop
  (probe matrix → fix → UPSTREAM_TAFFY.md entry when Taffy shares the defect).
- Fuzzing burn-in (`chrome-differential-fuzzing` change) is parked, not
  archived; committed fuzz fixtures remain as regression tests.

## Capabilities

### New Capabilities
- `wpt-import`: classify and convert WPT layout tests into engine fixtures,
  with a recorded skip reason for every excluded file.
- `wpt-scoreboard`: report conformance as pass/fail per suite and spec section,
  stable across runs so progress is countable.

### Modified Capabilities
<!-- none: fixture format, gentest pipeline, and test runner are unchanged -->

## Impact

- New: `scripts/wpt-import.ts`, `scripts/wpt-score.ts` (or flags on existing
  scripts), `tests/html/wpt/**`, generated `tests/fixtures/wpt/**`.
- Unchanged: engine source, existing fixtures, fuzz infra.
- Test-count metric changes meaning: the suite will initially gain many
  *failing* fixtures. These must be quarantined (not run in `pnpm test`) until
  fixed, so the main suite stays green: `pnpm test` keeps its invariant, and
  the scoreboard owns the red.
