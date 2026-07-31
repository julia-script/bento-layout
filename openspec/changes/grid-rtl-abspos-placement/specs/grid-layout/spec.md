# grid-layout (delta)

## MODIFIED Requirements

### Requirement: Absolutely positioned grid children

The engine SHALL size and position `position: absolute` children of grid
containers against their inset-modified containing block, honoring
grid-line-based containing blocks where placements are definite — in both
directions. Under `direction: rtl` a line-based containing block SHALL be the
mirror image of its LTR counterpart: the same **size**, at the mirrored
**position**. An absent line (open end) SHALL resolve to the container edge on
the side the *flow* leaves open, not a fixed physical side.

#### Scenario: Definite insets

- **WHEN** a grid container has an absolute child with definite insets
- **THEN** the child is sized and positioned against the inset-modified
  containing block

#### Scenario: RTL mirrors position, never size

- **WHEN** an absolutely positioned child has any line-based column placement
  (open-ended from a line, ending at a line, both lines definite, spans, or
  negative lines) in a grid with explicit, implicit, negative-implicit, or zero
  tracks
- **THEN** under `direction: rtl` the child's width equals its LTR width and
  its x-position is the mirror of the LTR position — for every shape in
  `tests/probes/grid-abspos-rtl/` (a–i), with the LTR variants unchanged

#### Scenario: Negative-index placements keep working

- **WHEN** an absolute child is placed via negative lines in a grid whose
  tracks are all negative-implicit (WPT
  `positioned-grid-items-negative-indices-003`, probe shape `i`)
- **THEN** both directions match Chrome — this scenario is the control that
  invalidated five prior fix attempts and MUST gate any change

### Requirement: Track sizing

The engine SHALL size tracks per css-grid-1 §11: initialize base/growth limits
from track sizing functions, resolve intrinsic contributions (items batched by
span, gutters and baseline shims included), maximize tracks, and expand
flexible (`fr`) tracks against definite or available space, including
`min-content`/`max-content` constraints, `fit-content()` caps, percentage
tracks, and gap accounting. When integral rounding distributes a remainder
across equal `fr` tracks, the remainder SHALL land on the same **visual**
tracks in RTL as in LTR (WPT `grid-flexible-track-free-space-distribution`).

#### Scenario: fr distribution against definite space

- **WHEN** a 100px grid has `grid-template-columns` of 99 equal `1fr` tracks
- **THEN** per-track sizes match Chrome in all four variants, including which
  tracks receive the rounding remainder in RTL
