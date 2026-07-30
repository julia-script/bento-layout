# flexbox-layout Specification

## Purpose

Computes CSS Flexible Box Layout (sizes and positions) for a tree of styled nodes, matching browser behavior as captured by Taffy's Chrome-derived conformance fixtures.

## Requirements

### Requirement: Flexbox container layout

The engine SHALL lay out children of a `display: flex` container per the CSS Flexible Box Layout Module Level 1 algorithm, supporting `flex-direction` (row, row-reverse, column, column-reverse), `flex-wrap` (nowrap, wrap, wrap-reverse), `flex-grow`, `flex-shrink`, `flex-basis`, `gap` (row-gap/column-gap), and the alignment properties `justify-content`, `align-items`, `align-self`, and `align-content` (including start/end/flex-start/flex-end/center/stretch/baseline/space-between/space-around/space-evenly where the spec defines them).

#### Scenario: Grow distribution

- **WHEN** a 400px-wide row container has two children with `flex-grow: 1` and no basis
- **THEN** each child is laid out 200px wide, positioned at x=0 and x=200

#### Scenario: Conformance with Chrome-derived fixtures

- **WHEN** any vendored Taffy flex fixture's input tree is laid out
- **THEN** every node's x, y, width, and height match the fixture's expectations within 0.1px

### Requirement: Box model

The engine SHALL apply margin, padding, and border to sizing and positioning, honoring `box-sizing: border-box` and `box-sizing: content-box`, with lengths specified as pixels or percentages (percentages resolved against the containing block per CSS rules, including percentage margins/padding resolving against the inline size).

#### Scenario: Content-box sizing

- **WHEN** a node has `width: 100px`, `padding: 10px`, and `box-sizing: content-box`
- **THEN** its reported border-box width is 120px

### Requirement: Size constraints and aspect ratio

The engine SHALL honor `min-width`/`max-width`/`min-height`/`max-height` and `aspect-ratio`, applying them in the order CSS defines (min wins over max; aspect-ratio derives the indefinite axis from the definite one).

#### Scenario: Aspect ratio derives height

- **WHEN** a node has a definite width of 300px, `aspect-ratio: 3`, and no height
- **THEN** its height resolves to 100px

### Requirement: Absolutely positioned children

The engine SHALL remove `position: absolute` children from flex flow and size/position them from their `top`/`right`/`bottom`/`left` insets against the container's padding box, falling back to static position alignment when insets are auto.

#### Scenario: Inset-driven size

- **WHEN** an absolute child of a 400×300 flex container has `left: 5%`, `top: 5%`, `width: 50%`
- **THEN** the child is placed at x=20, y=15 with width 200

### Requirement: Direction (ltr/rtl)

The engine SHALL lay out trees under both `direction: ltr` and `direction: rtl`, mirroring main-axis order and inset resolution accordingly.

#### Scenario: RTL row order

- **WHEN** a 100px-wide ltr-row layout is recomputed with `direction: rtl`
- **THEN** children are placed mirror-imaged along the horizontal axis

### Requirement: Pixel-grid rounding

The engine SHALL provide an optional rounding pass that snaps layout to whole pixels using cumulative-position rounding (rounding absolute positions, then deriving sizes from rounded edges) so that adjacent rounded boxes neither overlap nor gap.

#### Scenario: Rounding matches fixtures

- **WHEN** a fixture marked `use-rounding="true"` is laid out with rounding enabled
- **THEN** all resulting coordinates and sizes are integers matching the fixture expectations

### Requirement: Layout caching

The engine SHALL cache intermediate measurement results during a single layout computation so that repeated measurement of the same subtree under the same inputs does not recompute it, keeping deep nested-flex trees tractable (no exponential blowup).

#### Scenario: Deeply nested tree completes

- **WHEN** a 50-level-deep nested flex tree is laid out
- **THEN** computation completes in well under a second rather than time exponential in depth
