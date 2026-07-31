# Proposal: grid-rtl-fr-rounding-remainder

## Why

Two related RTL leftovers from `grid-rtl-abspos-placement` (archived
2026-07-30), both already diagnosed there so this change starts from evidence
rather than a hunt:

1. **fr rounding remainder** — `grid-flexible-track-free-space-distribution`
   fails in RTL only, 3 mismatched nodes out of 99. Both directions produce the
   same width *histogram* (98 tracks of 1px, one of 2px); only the position of
   the 2px track differs — ours at physical index 49, Chrome's at 51. This is
   the last quarantined pair that is a genuine engine defect (the remaining
   four need viewport-relative text wrapping the harness cannot express), so
   fixing it takes wpt-score 422/428 → **424/428 (99.1%)** and empties the
   actionable quarantine.

2. **Probe shape `b`** — an absolutely-positioned child with an open end in an
   axis whose only track is positive-implicit resolves to 10px instead of
   spanning 490. The one red shape left in `tests/probes/grid-abspos-rtl/`
   (74/80). It blocks no fixture, but it is the difference between "the abspos
   RTL model is correct" and "correct except one shape", and retiring the probe
   directory (task 4.1 of the archived change) is gated on it.

## What Changes

- Fix the RTL `fr` rounding-remainder assignment so the ±1px lands on the same
  visual tracks as Chrome. Location is the rounding pass (`roundLayout` in
  `src/index.ts`) or the track offsets feeding it — *not* `fr` sizing itself,
  which is already correct (see Impact).
- Fix abspos shape `b`: an open end in a positive-implicit-only axis must reach
  the flow's start edge.
- Promote `grid-flexible-track-free-space-distribution` (both box variants) out
  of `tests/fixtures/wpt-quarantine.json`.
- If both land, convert the probe matrix to committed fixtures and retire
  `tests/probes/grid-abspos-rtl/` — the deferred task 4.1.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `grid-layout`: "Track sizing" gains an integral-rounding requirement — when
  rounding distributes a remainder across equal `fr` tracks, the remainder
  lands on the same visual tracks in RTL as in LTR.

## Impact

- `src/index.ts` (`roundLayout`) and/or `src/compute/grid/alignment.ts` (track
  offsets); `src/compute/grid/mod.ts` for shape `b`; tests.
- **Do not look in `fr` sizing.** Unrounded track positions are already correct
  and identical to Chrome's implied ones (1.0101px per track); the entire
  divergence is in `round()`.
- Risk on shape `b` is concentrated and known: WPT
  `positioned-grid-items-negative-indices-003` (probe shape `i`) also has
  `explicit === 0` and *needs* the count mirror that `b` needs skipped. One
  attempt at `explicit === 0` as the discriminator already regressed that
  control and was reverted. The suite, not the probe matrix alone, is the gate.
