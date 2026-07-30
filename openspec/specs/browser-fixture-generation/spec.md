# browser-fixture-generation Specification

## Purpose

Generates layout conformance fixtures directly from a real, pinned browser, making Chrome (and the CSS specs it implements) the project's ground truth instead of vendored third-party snapshots.

## Requirements

### Requirement: HTML-to-XML fixture generation

The gentest pipeline SHALL load each HTML fixture file from the fixture-source tree in pinned headless Chrome, extract the input tree (element structure and style attributes) and the browser-computed layout (x/y/width/height per node), and write one XML fixture per variant in the exact format the conformance harness consumes.

#### Scenario: Round trip

- **WHEN** `pnpm gentest` runs over an HTML fixture defining a flex container with two children
- **THEN** XML fixtures are written whose `<input>` reflects the fixture's styles and whose `<expectations>` match Chrome's rendered geometry, and the conformance harness can execute them unchanged

### Requirement: Variant expansion

The pipeline SHALL generate all four standard variants per HTML fixture — `border_box_ltr`, `content_box_ltr`, `border_box_rtl`, `content_box_rtl` — by toggling the document's box-sizing and direction classes before each extraction.

#### Scenario: Four variants per fixture

- **WHEN** a single HTML fixture is processed
- **THEN** four XML files with the standard variant suffixes are produced, each with expectations measured under that variant

### Requirement: Deterministic text measurement

The pipeline SHALL render fixture text in the Ahem font (embedded locally, no network fetch) so text measurement is deterministic and matches the harness's Ahem measure function (10px square glyphs, zero-width-space break opportunities).

#### Scenario: Text fixture reproducibility

- **WHEN** the same text-bearing HTML fixture is generated twice
- **THEN** both runs produce byte-identical XML

### Requirement: Recorded browser provenance

The pipeline SHALL pin the Chrome version it drives (via Puppeteer's browser management) and record that version in the repository alongside the generated fixtures, so any regeneration diff is attributable to a deliberate browser-version change.

#### Scenario: Provenance audit

- **WHEN** a contributor checks how the current fixtures were produced
- **THEN** the recorded Chrome version identifies the exact browser build, and running the pipeline with that build reproduces the committed fixtures

### Requirement: Browser-authoritative divergence handling

When regeneration produces expectations that differ from previously committed fixtures, the browser's output SHALL be treated as correct: the new expectation is adopted, and any resulting engine test failure is treated as an engine bug (or, if intentional, documented as a known divergence in the repository).

#### Scenario: Divergence from legacy snapshot

- **WHEN** current Chrome lays out a fixture differently from the previously vendored expectation
- **THEN** the regenerated fixture carries Chrome's values, and the suite passes only once the engine matches the browser (or the case is explicitly documented as a known divergence)

### Requirement: Hermetic test suite

Fixture generation SHALL be a development-time step: generated XML is committed, and `pnpm test` SHALL run without launching a browser or requiring Puppeteer's Chrome download.

#### Scenario: Clean-checkout test run

- **WHEN** `pnpm install && pnpm test` runs on a machine with no Chrome available to Puppeteer
- **THEN** the full conformance suite executes and passes using the committed fixtures
