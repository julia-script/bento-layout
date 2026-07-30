## Purpose

Finds browser-conformance bugs automatically by comparing the engine's layout of randomly generated trees against a real pinned Chrome, and turns every confirmed mismatch into a permanent minimized conformance fixture.

## ADDED Requirements

### Requirement: Reproducible random tree generation

The fuzzer SHALL generate layout trees from a seeded pseudo-random generator such that the same seed always produces the same tree, drawing from the engine's supported style space (dimensions, percentages, box model, flex properties, grid templates/placements, gaps, alignment, direction, box-sizing, Ahem text leaves) while excluding features the engine deliberately does not implement.

#### Scenario: Same seed, same tree

- **WHEN** the fuzzer runs twice with the same seed and iteration count
- **THEN** it generates identical trees and reports identical results

### Requirement: Differential comparison against Chrome

For each generated tree, the fuzzer SHALL compute layout with the engine, render the equivalent HTML in the pinned Chrome, and compare every node's x/y/width/height within the conformance tolerance, reporting each disagreement with the seed and tree that produced it. Divergences documented as known SHALL NOT be reported.

#### Scenario: Disagreement is reported with its seed

- **WHEN** a generated tree lays out differently in the engine than in Chrome beyond tolerance
- **THEN** the fuzzer reports the mismatching nodes, expected vs actual geometry, and the seed that reproduces it

#### Scenario: Clean run

- **WHEN** no generated tree produces a disagreement
- **THEN** the fuzzer exits successfully, reporting the number of trees checked

### Requirement: Mismatch shrinking

The fuzzer SHALL minimize each mismatching tree — removing nodes and resetting style properties while the engine/Chrome disagreement persists — and report the minimized reproduction rather than the raw random tree.

#### Scenario: Minimal reproduction

- **WHEN** a 30-node random tree produces a mismatch attributable to two nodes' interacting styles
- **THEN** the reported reproduction contains only the nodes and style properties required for the mismatch to persist

### Requirement: Failure-to-fixture persistence

The fuzzer SHALL write each minimized mismatch as an HTML fixture in the fixture-source tree, from which the standard generation pipeline produces committed XML regression fixtures that the conformance suite runs like any other fixture.

#### Scenario: Fuzz finding becomes a regression test

- **WHEN** a minimized mismatch is persisted and the fixture pipeline is run
- **THEN** `pnpm test` executes the new fixture, failing until the engine matches Chrome (or the case is documented as a known divergence)
