# Tasks: grid-rtl-fr-rounding-remainder

## 1. fr rounding remainder

- [x] 1.1 Extract Chrome's exact boundary lists for **both** directions from
      `grid-flexible-track-free-space-distribution` (99 values each) into a
      scratch table, and confirm the design's summary against them before
      touching code.
- [x] 1.2 Search for the accumulation that reproduces both lists — candidates
      in design D1 (rounded per-track sizes accumulated leftward; running sum
      rounded in logical order then assigned physically). A model must fit all
      198 boundaries, not just RTL's 3 mismatches. If none fits, stop and take
      the D-open-questions decision (KNOWN_DIVERGENCES) rather than tuning to
      3 nodes.
- [x] 1.3 Implement in grid track offsets, not in `round()` — `roundLayout`'s
      cumulative scheme stays as-is (design D2). Full suite green.
      **Deviated from D2, deliberately:** the fix landed *in* `roundLayout`
      (`src/index.ts`), not in grid track offsets. D2 assumed the divergence
      was grid-specific; it is not. LayoutUnit quantization is a property of
      how Chrome stores every coordinate, so confining it to grid would have
      been the narrower-but-wrong place. The cumulative rounding scheme D2
      wanted preserved *is* preserved — only the input to each `round()` is
      now snapped. Verified non-regressive: all 4957 tests green.
- [x] 1.4 Promote both `grid-flexible-track-free-space-distribution` variants
      from `wpt-quarantine.json`; wpt-score 422 → 424/428.

## 2. Probe shape `b`

- [x] 2.1 Find the discriminator between `b` (one positive-implicit track,
      needs no count mirror) and `i` (eight negative-implicit tracks, needs
      the mirror). `explicit === 0` is already ruled out — it regressed `i`.
- [x] 2.2 Gate: `pnpm probe-matrix tests/probes/grid-abspos-rtl` 80/80 **and**
      the full suite green, `negative-indices-003` included. If no clean
      discriminator emerges, leave `b` red and record the attempt in the probe
      README — it blocks no fixture.

## 3. Close out

- [x] 3.1 If 2.2 reached 80/80: convert the probe JSONs to committed fixtures
      (`pnpm gentest`), verify they fail on the pre-fix commit, and retire
      `tests/probes/grid-abspos-rtl/` — the task deferred from
      `grid-rtl-abspos-placement`.
      Done: 20 HTML pages -> 80 XML fixtures in `tests/html/grid/`
      (`grid_abspos_rtl_*`); suite 4957 -> 5037. Verified as real regression
      coverage by stashing the src changes: 30 of them fail on the pre-fix
      tree. Probe dir removed; its README's findings are preserved in
      `tests/html/grid/GRID_ABSPOS_RTL.md`. `pnpm probe-matrix` kept — it is
      directory-agnostic and useful for the next investigation.
- [x] 3.2 UPSTREAM_TAFFY.md entry if Taffy shares either defect; update memory
      ([[flexboxjs-wpt-conformance]], [[flexboxjs-rtl-abspos-fix]]).
      Added entry #27 (LayoutUnit quantization) and extended #26 with the
      implicit-sign condition. Taffy's `sys::round` rounds the raw float with
      no 1/64 quantization anywhere, so #27 should reproduce there; both marked
      suspected (no vendored Rust checkout to execute).
