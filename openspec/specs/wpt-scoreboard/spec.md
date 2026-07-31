# wpt-scoreboard Specification

## Purpose

Report engine conformance against the imported WPT corpus as a stable, countable
metric — pass/fail per suite and per spec section — replacing fuzz-tree counts
as the progress measure while stabilizing.

## Requirements

### Requirement: Scoreboard reports pass/fail with a stable denominator

`pnpm wpt-score` SHALL run the engine against every imported WPT fixture
(quarantined included) and report, per suite and in total: passing count,
failing count, and denominator. Two consecutive runs with no engine or corpus
change SHALL report identical numbers.

#### Scenario: Countable progress

- **WHEN** an engine fix lands and the scoreboard is re-run
- **THEN** the total passing count changes by exactly the number of fixtures
  that fix affected, and no other numbers move

### Requirement: Failures group by spec section

The scoreboard SHALL aggregate failures by the spec-section URL recorded at
import time (`<link rel="help">`), listing sections ordered by failure count.

#### Scenario: Failures name their spec section

- **WHEN** the scoreboard reports failures
- **THEN** each failure is attributed to at least one spec-section URL, and a
  per-section tally is printed so the largest defect cluster is identifiable
  without opening individual fixtures
