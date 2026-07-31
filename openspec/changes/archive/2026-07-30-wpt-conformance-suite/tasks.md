# Tasks: wpt-conformance-suite

## 1. Importer

- [x] 1.1 Build the supported-property allowlist from the fuzz generator's
      property model plus static additions; document it in the importer.
- [x] 1.2 `scripts/wpt-import.ts`: scan the four suites, classify every file
      (import / skip+reason), write `tests/html/wpt/manifest.json` including
      the WPT checkout SHA. Verify the scan is total (spec: every file appears
      exactly once).
- [x] 1.3 Rewriter: emit gentest-shape pages for import-classified files
      (strip scripts/expectations, explicit display, provenance header).
      Validate each via a gentest dry run; demote failures to
      skip:rewrite-failed.
- [x] 1.4 Spot-check fidelity: for ~20 random imports, compare Chrome geometry
      of the rewritten page vs the raw WPT page; investigate any divergence
      before proceeding.

## 2. Fixture generation + quarantine

- [x] 2.1 Batch-generate XML fixtures for all imported pages
      (`tests/fixtures/wpt/**`).
- [x] 2.2 Run engine vs fixtures once; write initial
      `tests/fixtures/wpt-quarantine.json` from the failures. `pnpm test`
      must stay green with wpt fixtures included and quarantine applied.
- [x] 2.3 Commit corpus + fixtures + quarantine in one reviewable commit.

## 3. Scoreboard

- [x] 3.1 `pnpm wpt-score`: run all wpt fixtures (quarantine included), report
      pass/fail per suite + per help-URL section, newly-passing and
      newly-failing lists. Deterministic output (spec: identical numbers on
      unchanged re-run).
- [x] 3.2 Record the initial scoreboard in the change (baseline numbers) and
      triage the top section clusters: reclassify whole-section unsupported
      groups to skip so the denominator is honest.

## 4. Stabilization loop (open-ended, exits to fuzzing)

- [~] 4.1 Work the largest section clusters: probe matrix → fix →
      promote fixtures out of quarantine → UPSTREAM_TAFFY.md entry when Taffy
      shares the defect. Repeat while clusters remain tractable.
      **Stopped deliberately at 418/428 (97.7%).** Eight clusters closed
      (upstream entries 17–22 plus two harness bugs). The last cluster —
      RTL absolutely-positioned grid placement, 6 fixtures — resisted five
      attempts and needs a restructure of the abspos placement block rather
      than another formula tweak; see `tests/probes/grid-abspos-rtl/README.md`
      for the constraints already established. The remaining 4 fixtures need
      viewport-relative text wrapping the harness cannot express.
- [x] 4.2 Document the wpt-import/score workflow in README alongside the fuzz
      workflow; state the resume criterion for the parked fuzzing burn-in
      (scoreboard plateau).
