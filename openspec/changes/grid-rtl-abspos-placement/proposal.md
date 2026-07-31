# Proposal: grid-rtl-abspos-placement

## Why

Six of the ten remaining quarantined WPT fixtures are grid RTL bugs, and the
larger of the two (absolutely-positioned grid children, 4 fixtures) has
resisted **five** fix attempts — each reverted after regressing a control. The
probe matrix at `tests/probes/grid-abspos-rtl/README.md` establishes why: after
`reverseNonGutterTracks` reverses the track vector in place, the line→slot
correspondence is not a pure function of the line number, so no adjustment to
the existing mirror/swap formulas can satisfy all shapes at once. The abspos
placement block needs restructuring, not another tweak.

## What Changes

- Restructure the `position: absolute` branch of `computeGridLayout`
  (`src/compute/grid/mod.ts`): resolve the item's grid-line placement to
  **offsets in logical (flow-relative) coordinates first**, then convert the
  logical pair to a physical rect **once, at the end**. This removes the
  index-mirror + start/end-swap + per-edge-fallback interplay that made the
  current code unfixable shape-by-shape.
- Fix the RTL fr-track rounding-remainder placement
  (`grid-flexible-track-free-space-distribution`, 2 fixtures): the extra pixel
  from distributing 100px over 99 `1fr` tracks must land on the same *visual*
  track as Chrome in RTL.
- Promote the six fixtures out of `tests/fixtures/wpt-quarantine.json`;
  wpt-score rises from 418/428 (97.7%) to an expected 424/428 (99.1%).
- The 18-probe matrix (9 shapes × 2 directions) becomes committed regression
  fixtures once green, replacing the probe JSONs.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `grid-layout`: the "Absolutely positioned grid children" requirement gains
  RTL scenarios — line-based containing blocks must produce mirrored
  *positions* with identical *sizes* in RTL, across explicit, implicit,
  negative-implicit, and zero-track grids.

## Impact

- `src/compute/grid/mod.ts` (abspos branch; possibly `reverseNonGutterTracks`
  interaction), `src/compute/grid/trackSizing.ts` (fr remainder), tests.
- Risk is concentrated and known: the five failed attempts each regressed one
  of `positioned-grid-items-negative-indices-003` (shape `i`),
  the one-open-end shapes (`c`/`d`/`f`), or the LTR controls. All are in the
  committed probe matrix and gate every step.
- No API changes; no effect on LTR layout (every LTR probe must stay
  byte-identical).
