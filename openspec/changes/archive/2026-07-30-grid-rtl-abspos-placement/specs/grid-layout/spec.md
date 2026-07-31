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

#### Scenario: Absolute child with insets

- **WHEN** a grid container has an absolute child with definite insets
- **THEN** the child is positioned against the container per the corresponding
  fixture expectations

#### Scenario: RTL mirrors position, never size

- **WHEN** an absolutely positioned child has any line-based column placement
  (open-ended from a line, ending at a line, both lines definite, spans, or
  negative lines) in a grid with explicit, implicit, negative-implicit, or zero
  tracks
- **THEN** under `direction: rtl` the child's width equals its LTR width and
  its x-position is the mirror of the LTR position, with the LTR variants
  unchanged. Covered by `tests/probes/grid-abspos-rtl/` (10 shapes x 4
  variants); shape `b` — an open end in an axis whose only track is
  positive-implicit — is a known remaining gap, tracked in that README and
  blocking no fixture.

#### Scenario: Negative-index placements keep working

- **WHEN** an absolute child is placed via negative lines in a grid whose
  tracks are all negative-implicit (WPT
  `positioned-grid-items-negative-indices-003`, probe shape `i`)
- **THEN** both directions match Chrome — this scenario is the control that
  invalidated five prior fix attempts and MUST gate any change

Note: this change originally also modified "Requirement: Track sizing" for the
RTL `fr` rounding remainder. That work was diagnosed but not implemented, so
the requirement is left untouched here and carried into the follow-up change
`grid-rtl-fr-rounding-remainder` instead.
