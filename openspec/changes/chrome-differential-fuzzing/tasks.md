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
- [ ] 4.2 Document `pnpm fuzz` workflow and triage policy in the README; record default iteration budget from measured throughput
