# conformance-harness Specification

## Purpose

Runs Taffy's language-agnostic XML conformance fixtures under vitest so every layout result is verified against Chrome-derived ground truth.

## Requirements

### Requirement: XML fixture execution

The test harness SHALL parse each fixture from the `flex`, `block`, `blockflex`, `grid`, `blockgrid`, `gridflex`, `fuzz-found`, and `wpt/*` directories (`<test>` with `<viewport>`, `<input>`, `<expectations>`), build the corresponding node tree from the styled `<div>`/`<text>` elements (including `text-align` and the grid template/placement/auto-flow attributes), compute layout at the fixture's viewport, and assert every node's x/y/width/height against expectations with 0.1px tolerance. Fixtures with `use-rounding="true"` run with the rounding pass enabled. No fixture is skipped except an imported WPT fixture listed in the quarantine (see the `wpt-import` capability); the authored and vendored corpora have no skips.

#### Scenario: Full suite run

- **WHEN** `pnpm test` runs
- **THEN** every vendored fixture from all six directories executes as an individually-reported vitest case, and the suite passes only when all match

#### Scenario: No skipped fixtures remain outside the WPT quarantine

- **WHEN** the suite runs after grid layout is implemented
- **THEN** the skip lists are empty for the vendored, authored and fuzz-found corpora — the previously grid-rooted flex fixtures (`bevy_issue_10343_grid`, `bevy_issue_21240` variants) execute and pass — and the only skips are the quarantined WPT fixtures

### Requirement: Ahem text measurement

The harness SHALL implement Taffy's test measure function for `<text>` fixture nodes: Ahem-font semantics where each glyph is a 10×10px square, text wraps at zero-width-space boundaries within available width, and known dimensions short-circuit measurement.

#### Scenario: Wrapping text fixture

- **WHEN** a fixture's `<text>` node with 9 four-glyph words is measured under 50px available width
- **THEN** measurement yields the same size Taffy's test harness produces, and the fixture's expectations are met

### Requirement: Pinned fixture provenance

The committed XML fixtures SHALL be produced by the in-repo browser generation pipeline from the HTML fixture-source tree, with the generating Chrome version recorded in the repository, so that fixture updates are deliberate, diffable, and reproducible. The historical Taffy-commit provenance applies only until a fixture directory has been regenerated through the pipeline.

#### Scenario: Fixture provenance audit

- **WHEN** a contributor checks fixture provenance
- **THEN** the recorded Chrome version (and the HTML source file each XML fixture derives from) identifies exactly how the fixtures were produced, and re-running the pipeline reproduces them
