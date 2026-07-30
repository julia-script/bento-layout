## MODIFIED Requirements

### Requirement: Layout caching

The engine SHALL cache intermediate measurement results during a single layout computation so that repeated measurement of the same subtree under the same inputs does not recompute it, keeping deep nested-flex trees tractable (no exponential blowup).

Cache lookups SHALL NOT allocate: a lookup MUST NOT construct key objects,
strings, or other temporary values derived from the layout inputs, and a cache
hit MUST NOT construct a fresh result object. Which inputs distinguish two cache
entries is unchanged by this requirement — caching MUST remain transparent, so
enabling or disabling it cannot change any computed layout.

#### Scenario: Deeply nested tree completes

- **WHEN** a 50-level-deep nested flex tree is laid out
- **THEN** computation completes in well under a second rather than time exponential in depth

#### Scenario: Repeated lookups do not allocate

- **WHEN** a tree of at least 8,000 nodes is laid out twice and per-run allocation is sampled
- **THEN** the number of objects allocated by cache lookups and cache hits is zero, and total garbage-collector scavenges per run are strictly lower than an equivalent run whose cache allocates per lookup

#### Scenario: Caching does not alter results

- **WHEN** the full conformance fixture suite is run after any change to cache key representation or entry storage
- **THEN** every fixture produces layout identical to the fixture expectations, with no fixture newly skipped

## ADDED Requirements

### Requirement: Comparable benchmark tree shapes

Published performance figures that compare this engine against another
implementation SHALL be measured on tree shapes equivalent to those the
reference implementation benchmarks, and SHALL state the shape parameters
(depth, branching factor, flex direction, and the style properties applied)
alongside the figures.

A scenario whose tree shape has no counterpart in the reference implementation
SHALL NOT be presented as a comparative ratio against it; such scenarios MAY be
published as engine-only stress cases when labeled as such.

#### Scenario: Deep-tree comparison uses the reference shape

- **WHEN** a deep-tree benchmark ratio against the reference implementation is published
- **THEN** the measured tree uses the same branching factor, uniform flex direction, and per-node style properties as the reference implementation's own deep-tree benchmark

#### Scenario: Non-comparable scenarios are labeled

- **WHEN** a benchmark scenario has no equivalent in the reference implementation, such as one alternating flex direction per level
- **THEN** it is reported without a comparative ratio and is explicitly identified as an engine-only stress case

#### Scenario: Superseded figures are retracted

- **WHEN** a previously published figure is found to have been measured on a non-comparable shape
- **THEN** the published document states that the earlier figure was withdrawn and why, rather than silently replacing it
