# browser-fixture-generation (delta)

## MODIFIED Requirements

### Requirement: Deterministic text measurement

The pipeline SHALL render fixture text in the Ahem font (embedded locally, no
network fetch) so text measurement is deterministic and matches the harness's
Ahem measure function (10px square glyphs; break opportunities at zero-width
spaces and at ordinary whitespace).

#### Scenario: Text fixture reproducibility

- **WHEN** the same text-bearing HTML fixture is generated twice
- **THEN** both runs produce byte-identical XML

### Requirement: HTML-to-XML fixture generation

The gentest pipeline SHALL load each HTML fixture file from the fixture-source tree in pinned headless Chrome, extract the input tree (element structure and style attributes) and the browser-computed layout (x/y/width/height per node), and write one XML fixture per variant in the exact format the conformance harness consumes. Each fixture SHALL record the available space the browser actually laid it out under; where a fixture's root is not wrapped in an explicit `.viewport` element, the recorded viewport SHALL still describe the space the browser used, so that a fixture's input and its expectations always denote the same layout.

#### Scenario: Round trip

- **WHEN** `pnpm gentest` runs over an HTML fixture defining a flex container with two children
- **THEN** XML fixtures are written whose `<input>` reflects the fixture's styles and whose `<expectations>` match Chrome's rendered geometry, and the conformance harness can execute them unchanged

#### Scenario: Imported page records the viewport it was measured in

- **WHEN** a WPT page whose root is not wrapped in a `.viewport` element is
  imported and generated
- **THEN** the emitted fixture records the definite viewport Chrome laid it out
  under, not `max-content`, so an engine replaying the fixture reproduces
  Chrome's wrapping
