# wpt-import

## Purpose

Convert the subset of WPT layout tests our engine can express into gentest
fixtures, with every exclusion recorded and re-derivable, so the imported corpus
is reproducible from a WPT checkout rather than hand-curated.

## ADDED Requirements

### Requirement: Classify every WPT test file deterministically

The importer SHALL scan the configured WPT suites (css-flexbox, css-grid,
css-sizing, css-align) and assign every test file exactly one class:
`import` (markup within the supported feature subset), or `skip` with a machine-
readable reason (unsupported CSS property/value, script-driven DOM mutation,
reference/support file, non-Ahem font dependency, or other named cause).

#### Scenario: Full-corpus scan is total

- **WHEN** the importer runs against the WPT checkout
- **THEN** every `.html` test file under the configured suites appears in the
  manifest exactly once, as `import` or as `skip` with a reason

#### Scenario: Unsupported feature is skipped, not mangled

- **WHEN** a test uses a feature outside the engine subset (e.g. `float`,
  `writing-mode`, tables, `position: sticky`)
- **THEN** the file is classified `skip` with the offending feature named, and
  no fixture is emitted for it

### Requirement: Imported tests preserve WPT layout semantics in gentest form

For every `import`-classified file the importer SHALL emit a test page under
`tests/html/wpt/<suite>/` that reproduces the original test's layout-relevant
markup and styles inside the gentest harness (explicit `display` on every
element, Ahem text spans, our support stylesheet), and record the source WPT
path and its `<link rel="help">` spec URLs in the emitted file.

#### Scenario: Emitted page round-trips through gentest

- **WHEN** an emitted page is run through `pnpm gentest`
- **THEN** four XML fixtures (border/content-box x ltr/rtl) are generated from
  Chrome without manual editing of the page

#### Scenario: Provenance is traceable

- **WHEN** any imported fixture fails in the runner
- **THEN** the failing fixture can be traced back to its WPT source path and
  spec-section URL from the emitted file's header alone

### Requirement: Failing imports are quarantined from the green suite

Imported fixtures whose engine output diverges from Chrome SHALL be excluded
from the default `pnpm test` run and tracked in a quarantine list consumed by
the scoreboard, so the main suite invariant (always green at every commit)
is preserved.

#### Scenario: Main suite stays green on import

- **WHEN** the importer lands N new fixtures of which K currently fail
- **THEN** `pnpm test` passes, and the K failures are visible only via the
  scoreboard/quarantine list

#### Scenario: A fix promotes a fixture

- **WHEN** an engine fix makes a quarantined fixture pass
- **THEN** the fixture is removed from quarantine and joins the default suite,
  and the scoreboard reflects the new pass count
