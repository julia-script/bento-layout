# Design: wpt-conformance-suite

## Context

The gentest pipeline (scripts/gentest.ts) already turns an HTML page into four
Chrome-oracle XML fixtures. WPT supplies ~4,600 curated layout tests, of which a
first-pass grep puts ~390 check-layout-th tests inside our feature subset;
including static reftest markup the import candidates are likely 800–1,500.
WPT checkout lives at `~/Documents/dev.nosync/wpt` (sparse, 62 MB, pinned to
the cloned commit — record the SHA in the manifest).

## Goals / Non-Goals

- Goals: reproducible import; stable scoreboard; main suite stays green.
- Non-goals: running WPT's own harness/expectations; visual reftest comparison;
  supporting features the engine doesn't have (floats, tables, writing modes);
  importing suites beyond the four cloned ones.

## Decisions

### D1. Chrome stays the oracle; WPT is inputs only

We strip `<script>` includes (testharness, check-layout-th) and `data-expected-*`
attributes, keep the markup and styles, and regenerate expectations via gentest.
This sidesteps WPT expectation formats entirely and makes reftests importable.
Trade-off: we test "matches Chrome", not "matches spec" — same trust model as
the whole fixture suite, so no change in meaning.

### D2. Classification is conservative allowlist, not blocklist

The importer parses each file's inline styles and `<style>` blocks and accepts
only properties/values in the engine-supported set (reuse the fuzz generator's
property model as the seed list, extended with statics like `direction`).
Anything unrecognized ⇒ skip with reason. A blocklist grep (as in scoping)
under-skips: unknown-but-unsupported features would import as silently-wrong
fixtures. False *skips* are cheap (corpus stays large); false *imports* poison
the scoreboard.

### D3. Rewriting is mechanical, minimal, and validated

Per imported file: extract `<body>` content and style rules; drop scripts,
`data-expected-*`, `class="test"` harness residue; wrap in our harness header
(test_helper.js + test_base_style.css); force explicit `display` on every
element (base stylesheet defaults div to flex — bug-17 lesson); map WPT Ahem
usage onto our Ahem setup; record `<!-- wpt: <path>, help: <urls> -->`.
Validation: the emitted page must survive gentest with non-degenerate geometry
(root not 0x0 unless the source was), else auto-skip with reason `rewrite-failed`.

### D4. Quarantine is a checked-in JSON list, enforced by the runner

`tests/fixtures/wpt-quarantine.json` lists fixture basenames currently failing.
`fixtures.test.ts` skips quarantined names in `pnpm test`; `pnpm wpt-score` runs
everything, diffs actual vs quarantine, and reports:
- newly-passing (candidates for promotion — the fix workflow removes them),
- newly-failing (regressions — fail the score run loudly),
- per-suite and per-help-URL tallies.
Promotion is manual-in-commit (edit the JSON in the fixing commit), so the
green-suite invariant and the scoreboard never drift silently.

### D5. Scoreboard determinism

Score runs the vitest fixture comparator programmatically (share the assert
logic, not a subprocess grep), sorted output, no timestamps. Section attribution
comes from the recorded help URLs, tallied per URL path segment
(`css-grid-1/#track-sizing` style).

## Risks / Trade-offs

- **Rewrite fidelity**: mechanical extraction can change layout (lost
  whitespace text nodes, selector specificity). Mitigation: D3 validation plus
  a spot-check diff of N random imports against raw WPT pages rendered in
  Chrome without our harness.
- **Corpus churn**: WPT moves fast. Mitigation: pinned SHA in manifest;
  re-import is an explicit, reviewed operation.
- **Scoreboard initially large and red**: expected; quarantine keeps it out of
  the green suite. First triage may reveal whole unsupported *sections* — those
  get reclassified to skip (denominator shrinks) rather than sitting in
  quarantine forever.

## Open Questions

- Whether `direction: rtl` tests import as-is or map onto the existing
  4-variant generation (likely: import as-is, let gentest's rtl variants stand).
- Whether css-align's low clean rate (6/102 by grep) is real or a filter
  artifact — resolved by the allowlist scan in task 1.
