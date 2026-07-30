## Purpose

Runs Taffy's language-agnostic XML conformance fixtures under vitest so every layout result is verified against Chrome-derived ground truth.

## ADDED Requirements

### Requirement: XML fixture execution

The test harness SHALL parse each vendored Taffy flex fixture (`<test>` with `<viewport>`, `<input>`, `<expectations>`), build the corresponding node tree from the styled `<div>`/`<text>` elements, compute layout at the fixture's viewport, and assert every node's x/y/width/height against expectations with 0.1px tolerance. Fixtures with `use-rounding="true"` run with the rounding pass enabled.

#### Scenario: Full suite run

- **WHEN** `pnpm test` runs
- **THEN** every vendored flex fixture executes as an individually-reported vitest case, and the suite passes only when all match

### Requirement: Ahem text measurement

The harness SHALL implement Taffy's test measure function for `<text>` fixture nodes: Ahem-font semantics where each glyph is a 10×10px square, text wraps at zero-width-space boundaries within available width, and known dimensions short-circuit measurement.

#### Scenario: Wrapping text fixture

- **WHEN** a fixture's `<text>` node with 9 four-glyph words is measured under 50px available width
- **THEN** measurement yields the same size Taffy's test harness produces, and the fixture's expectations are met

### Requirement: Pinned fixture provenance

The vendored fixtures SHALL be copied verbatim from the Taffy repository with the source commit hash recorded in the repo, so fixture updates are deliberate and diffable.

#### Scenario: Fixture sync audit

- **WHEN** a contributor checks fixture provenance
- **THEN** the recorded commit hash identifies the exact upstream Taffy revision the fixtures came from
