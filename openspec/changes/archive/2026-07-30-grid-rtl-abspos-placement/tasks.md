# Tasks: grid-rtl-abspos-placement

## 1. Groundwork

- [x] 1.1 Extend the probe matrix with a mixed in-flow + abspos shape (abspos
      child must align with an in-flow sibling's tracks in RTL) and re-run all
      probes to record the pre-change baseline.
- [x] 1.2 Build the logical offset table right after track sizing: logical
      (pre-reversal) offset for every line slot, from the same data in-flow
      resolution uses. No behavior change yet; assert it against LTR offsets.

## 2. Restructure abspos placement

- [x] 2.1 Rewrite the `position: absolute` column branch to resolve
      `logicalStart`/`logicalEnd` (null = open end → flow edge) from the table
      via plain `2*(line+negImplicit)` indexing — no mirror, no swap.
- [x] 2.2 Convert logical → physical once at the end
      (`left = width - logicalEnd` under RTL); keep rows on the same code path
      with an identity conversion.
      Rows were already direction-independent and needed no change.
- [~] 2.3 Gate: `negative-indices-003` + full suite green (4955 passing);
      probes **74/80** — only shape `b` still red, recorded in the probe
      README. `h` was fixed in follow-up: the offset table now reverses the
      whole track sequence rather than just the explicit range, matching the
      frame `absColCounts` puts the line numbers in. `b` does not block any
      quarantined fixture.

## 3. fr rounding remainder

- [~] 3.1 Re-run `grid-flexible-track-free-space-distribution`; if still red,
      diagnose the remainder assignment in the rounding pass and fix in
      logical track order.
      **Diagnosed, not fixed** — deferred to its own change, since the fix is
      in the rounding pass and unrelated to abspos placement. Findings:
      - Still red at 3 of 99 nodes, RTL only. The logical-order model did *not*
        fix it outright (D4's optimistic branch).
      - Both directions produce the same width *histogram* (98 tracks of 1px,
        one of 2px). Only the position of the 2px track differs: ours at
        physical index 49, Chrome's at 51.
      - Unrounded positions are correct and identical to Chrome's implied ones
        (1.0101 per track); the divergence is entirely in `round()`.
      - In **LTR**, `round(i*w)` reproduces Chrome at all 99 boundaries. In
        **RTL** it misses at exactly two (i=49, i=50), where Chrome sits 1px
        higher.
      - Chrome's RTL boundary set is **not** the mirror of its LTR set: they
        differ at one boundary (mirrored-LTR has 48, RTL has 50), and the 2px
        track spans [49,51] in LTR vs [47,49] in RTL — not mirror images.
      - Ruled out: float accumulation drift (~7e-15, three orders too small to
        flip these decisions); tie-breaking (no boundary is exactly .5);
        round/floor/ceil of the position; round-the-distance-from-the-right;
        and mirroring the rounded LTR positions. Every clean model fails at
        the same 2-3 indices near 49-51.
      - Chrome's remainder lands on logical track 47 in RTL but 49 in LTR, so
        it is not a fixed logical track either — it emerges from Chrome's own
        accumulation order.

## 4. Promote and close

- [ ] 4.1 Convert probe JSONs to committed HTML/XML fixtures
      (`pnpm gentest`), verify they fail on the pre-change commit, retire
      `tests/probes/grid-abspos-rtl/`.
      Deferred: `b` and `h` are still red, so the matrix stays a probe
      directory for now. `pnpm probe-matrix` added to run it per-variant.
- [~] 4.2 Remove the six fixtures from `wpt-quarantine.json`; wpt-score
      418/428 → 424/428. Full suite green.
      Four promoted (`positioned-grid-items-022`/`-026`, both box variants);
      wpt-score 418 → **422/428** (98.6%). The two
      `grid-flexible-track-free-space-distribution` fixtures stay quarantined
      pending 3.1.
- [x] 4.3 UPSTREAM_TAFFY.md entry if Taffy shares the defect (check
      `grid/mod.rs` for the mirror/swap pattern); update memory.
      Taffy does share it — `grid/mod.rs:571-619` has the identical
      mirror + swap + per-edge-fallback trio. Recorded as entry #26
      (suspected; no vendored Rust checkout available to execute).
