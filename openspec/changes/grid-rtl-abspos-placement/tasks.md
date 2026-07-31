# Tasks: grid-rtl-abspos-placement

## 1. Groundwork

- [ ] 1.1 Extend the probe matrix with a mixed in-flow + abspos shape (abspos
      child must align with an in-flow sibling's tracks in RTL) and re-run all
      probes to record the pre-change baseline.
- [ ] 1.2 Build the logical offset table right after track sizing: logical
      (pre-reversal) offset for every line slot, from the same data in-flow
      resolution uses. No behavior change yet; assert it against LTR offsets.

## 2. Restructure abspos placement

- [ ] 2.1 Rewrite the `position: absolute` column branch to resolve
      `logicalStart`/`logicalEnd` (null = open end → flow edge) from the table
      via plain `2*(line+negImplicit)` indexing — no mirror, no swap.
- [ ] 2.2 Convert logical → physical once at the end
      (`left = width - logicalEnd` under RTL); keep rows on the same code path
      with an identity conversion.
- [ ] 2.3 Gate: all 18 probes + `negative-indices-003` fixture + full suite
      green. Any red → stop and record which shape, per the probe README.

## 3. fr rounding remainder

- [ ] 3.1 Re-run `grid-flexible-track-free-space-distribution`; if still red,
      diagnose the remainder assignment in the rounding pass and fix in
      logical track order.

## 4. Promote and close

- [ ] 4.1 Convert probe JSONs to committed HTML/XML fixtures
      (`pnpm gentest`), verify they fail on the pre-change commit, retire
      `tests/probes/grid-abspos-rtl/`.
- [ ] 4.2 Remove the six fixtures from `wpt-quarantine.json`; wpt-score
      418/428 → 424/428. Full suite green.
- [ ] 4.3 UPSTREAM_TAFFY.md entry if Taffy shares the defect (check
      `grid/mod.rs` for the mirror/swap pattern); update memory.
