# grid-layout Specification

## Purpose

Computes CSS Grid layout — track resolution, auto-placement, intrinsic and flexible track sizing, and alignment — for `display: grid` containers, interoperating with flex and block nodes in the same tree.

## Requirements

### Requirement: Explicit and implicit grid resolution

The engine SHALL build the grid from `grid-template-rows`/`grid-template-columns` track lists supporting fixed lengths, percentages, `fr` units, `auto`, `min-content`, `max-content`, `fit-content()`, `minmax()`, and `repeat()` (integer counts, `auto-fill`, `auto-fit`), creating implicit tracks sized by `grid-auto-rows`/`grid-auto-columns` when items are placed outside the explicit grid.

#### Scenario: Fixed template

- **WHEN** a grid has `grid-template-columns: 40px 40px 40px 40px` and `grid-template-rows: 40px 40px 40px` with 8px gaps and padding
- **THEN** tracks are positioned exactly as Chrome renders them (per the corresponding fixture expectations)

#### Scenario: Auto-fill repeat

- **WHEN** a definite-width grid uses `repeat(auto-fill, 40px)` columns
- **THEN** as many 40px tracks are created as fit the inner width

### Requirement: Auto-placement

The engine SHALL place items per the CSS Grid auto-placement algorithm: definite placements first (line numbers, negative line numbers, `span n`), then auto-placed items in `grid-auto-flow` order (`row` or `column`), with `dense` packing backfilling earlier gaps when specified.

#### Scenario: Spanning item forces implicit tracks

- **WHEN** an item declares `grid-column: 1 / -1` in a 4-column grid
- **THEN** it spans all 4 explicit columns

#### Scenario: Dense packing

- **WHEN** `grid-auto-flow: row dense` and a small item follows a large one that left a gap
- **THEN** the small item backfills the earlier gap

### Requirement: Track sizing

The engine SHALL size tracks per the CSS Grid track sizing algorithm: resolve intrinsic minimums/maximums from item contributions (including items spanning multiple tracks), distribute free space to `fr` tracks proportionally, apply `minmax()` constraints, and expand/stretch per `align-content`/`justify-content`.

#### Scenario: fr distribution

- **WHEN** a 400px-wide grid has columns `1fr 2fr 3fr` (no gaps)
- **THEN** the columns are laid out at the positions Chrome produces (≈66.67px, 133.33px, 200px within rounding)

#### Scenario: Conformance with Chrome-derived fixtures

- **WHEN** any vendored `grid`, `blockgrid`, or `gridflex` fixture's input tree is laid out
- **THEN** every node's x, y, width, and height match the fixture's expectations within 0.1px

### Requirement: Grid item and content alignment

The engine SHALL align items within their grid areas per `justify-items`/`align-items` (overridable per-item with `justify-self`/`align-self`, including safe/unsafe variants) and align the track grid within the container per `justify-content`/`align-content`, defaulting to stretch behavior per spec.

#### Scenario: Centered item in area

- **WHEN** a fixed-size item has `justify-self: center` in a larger grid area
- **THEN** it is centered horizontally within its area

### Requirement: Mixed grid, flex, and block trees

The engine SHALL support grid containers nested in flex/block containers and vice versa, negotiating sizes through the shared measurement protocol, including grids under min-content/max-content sizing constraints.

#### Scenario: Grid child of flex row

- **WHEN** a flex row contains a `display: grid` child with intrinsic-sized tracks
- **THEN** the grid's measured size feeds flex sizing and the layout matches the corresponding `gridflex`/flex fixture expectations

### Requirement: Absolutely positioned grid children

The engine SHALL size and position `position: absolute` children of grid containers against their inset-modified containing block, honoring grid-line-based containing blocks where placements are definite.

#### Scenario: Absolute child with insets

- **WHEN** a grid container has an absolute child with definite insets
- **THEN** the child is positioned against the container per the corresponding fixture expectations
