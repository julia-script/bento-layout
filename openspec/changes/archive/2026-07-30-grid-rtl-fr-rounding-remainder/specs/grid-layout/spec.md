# grid-layout (delta)

## MODIFIED Requirements

### Requirement: Track sizing

The engine SHALL size tracks per the CSS Grid track sizing algorithm: resolve
intrinsic minimums/maximums from item contributions (including items spanning
multiple tracks), distribute free space to `fr` tracks proportionally, apply
`minmax()` constraints, and expand/stretch per `align-content`/`justify-content`.
When integral rounding distributes a remainder across equal `fr` tracks, the
remainder SHALL land on the same **visual** tracks under `direction: rtl` as
Chrome places them, with LTR unchanged.

#### Scenario: fr distribution

- **WHEN** a 400px-wide grid has columns `1fr 2fr 3fr` (no gaps)
- **THEN** the columns are laid out at the positions Chrome produces (≈66.67px, 133.33px, 200px within rounding)

#### Scenario: Conformance with Chrome-derived fixtures

- **WHEN** any vendored `grid`, `blockgrid`, or `gridflex` fixture's input tree is laid out
- **THEN** every node's x, y, width, and height match the fixture's expectations within 0.1px

#### Scenario: Rounding remainder placement in RTL

- **WHEN** a 100px grid has `grid-template-columns` of 99 equal `1fr` tracks
  under `direction: rtl` (WPT `grid-flexible-track-free-space-distribution`)
- **THEN** every track's x and width match Chrome in all four variants —
  including which track absorbs the ±1px rounding remainder, which is not the
  mirror of the LTR assignment
