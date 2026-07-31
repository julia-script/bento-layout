## 1. Generation & serialization

- [x] 1.1 Seeded PRNG (mulberry32-style) + per-tree derived seeds; `--seed`/`--iterations`/`--only` CLI plumbing in `scripts/fuzz.ts`
- [x] 1.2 Style→inline-CSS serializer, property-table-driven; round-trip unit test against the harness attribute parser
- [x] 1.3 Grammar-based tree generator with weighted per-mode profiles (flex/grid/block/mixed), quantized value palette, size caps; determinism unit test (same seed → same trees)

## 2. Differential execution

- [x] 2.1 Batched Chrome executor reusing the gentest extraction machinery (setContent per tree, Ahem/DPR/scrollbar determinism controls); engine-vs-Chrome comparison at harness tolerance
- [x] 2.2 Known-divergence filter (skip matches against KNOWN_DIVERGENCES.md signatures) and seed-attributed mismatch reporting with auto re-check before reporting

## 3. Shrinking & persistence

- [x] 3.1 Greedy delta-debugging shrinker (node removal + style resetting to fixed point, step budget, pre-shrink tree kept as fallback)
- [x] 3.2 Failure-to-fixture: write minimized repro to `tests/html/fuzz-found/` with seed/Chrome-version header; verify it flows through `pnpm gentest` into a failing XML regression fixture

## 4. Burn-in

- [ ] 4.1 Run a substantial fuzz campaign per mode; triage all findings (fix engine bugs or document divergences with spec citations); resulting fixtures committed and suite green
      In progress. 20 engine bugs found and fixed so far (incl. one crash),
      each with a committed `tests/html/fuzz-found/` fixture and an
      UPSTREAM_TAFFY entry where Taffy shares the defect.
      Baseline re-measured 2026-07-30 (seed 20260731, 25 trees x 4 modes, all
      running to completion, no crashes): flex 18 / block 18 / grid 19 /
      mixed 15 = **70 findings**. Per the README, the tree-level count is a
      poor progress metric — the feature histogram over minimized findings is
      the signal, and aspectRatio sits at 26, unmoved, so that class still has
      live bugs.
- [x] 4.2 Document `pnpm fuzz` workflow and triage policy in the README; record default iteration budget from measured throughput
      Done: README "Differential fuzzing" section covers the workflow and
      commands, the divergence policy ("the browser wins", KNOWN_DIVERGENCES
      needs a spec citation) and the upstream-logging rule, and the measured
      budget (0.2-4.4 trees/s by mode; 25 trees/mode as the default campaign).
      It also records the two traps: a crash hides every later tree, and the
      finding count is not a progress metric.
