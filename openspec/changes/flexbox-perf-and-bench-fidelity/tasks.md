## 1. Benchmark fidelity (do first — establishes the baseline everything else is judged against)

- [x] 1.1 Add a `taffyDeep` builder to `scripts/bench.ts` matching taffy's `build_deep_hierarchy`: branching factor 2, `flexGrow: 1`, uniform `margin: 10`, single (default row) flex direction, no padding, no leaf sizes. Size it to ~4,000 and ~10,000 nodes to line up with taffy's 12- and 14-level cases.
- [x] 1.2 Relabel the existing alternating-axis deep scenarios as engine-only stress cases (name them so the alternation is visible, e.g. `flex: deep alternating-axis (stress)`), keeping them in the suite.
- [x] 1.3 Add a `--json` shape-metadata field per scenario recording depth, branching factor, flex direction, and applied style properties, so published figures can state their shape.
- [x] 1.4 Establish the corrected baseline: run the full bench on unmodified `src/`, in a clean process, and record results (including fixed-time iteration counts for the two deep scenarios) into the scratch notes used by task 5.1.
- [x] 1.5 Rewrite `BENCHMARKS.md`: publish like-for-like ~7–10× deep-tree ratios against taffy's shape; state each scenario's tree shape; add an explicit retraction noting the prior ~75–90× figure and "redundant measure passes" diagnosis were measured on a non-comparable shape and are withdrawn; move alternating-axis results to a clearly-marked engine-only section with no cross-engine ratio.
- [x] 1.6 Add a "Methodology" section to `BENCHMARKS.md` recording the D6 rules: separate processes over monkeypatching, fixed-time iterations for heavy scenarios, verify the profile resolves to the intended source tree, warm both sides equally, state tree shape.
- [x] 1.7 Commit as a standalone change. `pnpm vitest run` must still report 4,410 passing (no engine change in this group).

## 2. Cache allocation audit (confirm the safety precondition before changing anything)

- [x] 2.1 Enumerate every caller of `computeChildLayout` / `measureChildSize` / `measureChildSizeBoth` / `performChildLayout` and confirm none mutates the returned `LayoutOutput` or any object reachable from it.
- [x] 2.2 Add a temporary debug build that deep-freezes every `LayoutOutput` returned from `Cache.get`, run the full fixture suite under it, and confirm zero frozen-object write errors. Record the result; remove the temporary build before committing.

## 3. Allocation-free cache

- [x] 3.1 Rewrite the `Cache` class in `src/tree.ts` to store key fields inline as primitives (`kw`, `kh`, `aw`, `ah`, `pw`, `axis`; plus `ph` on the final-layout entry only) and compare them with `===`. Delete `cacheKey`, `mixedKey`, and the `CacheKey` interface.
- [x] 3.2 Preserve the existing match predicate exactly: `axis` remains part of the key (dropping it fails 4 grid baseline fixtures); do NOT adopt taffy's `known_dimensions == cached_size` relaxation (it fails 12 more); `compute-size` compares `pw` but not `ph`, `perform-layout` compares both.
- [x] 3.3 Store a prebuilt `LayoutOutput` per measure slot in `store()` so `get()` returns an existing object and allocates nothing on hit.
- [x] 3.4 Keep `computeCacheSlot` slot assignment identical (0 = both known, 1–4 = one known, 5–8 = neither), now taking primitives instead of `Size` objects.
- [x] 3.5 Verify `pnpm vitest run` reports 4,410 passing with zero skips.
- [x] 3.6 Re-measure: fixed-time iteration count on both deep scenarios plus GC scavenge count per 20 runs, baseline vs new, each in its own process on real source (no monkeypatching). Record actual numbers — publish a null or negative result if that is what appears.
- [x] 3.7 Commit as a standalone, independently revertible change.

## 4. FlexItem allocation reduction

- [x] 4.1 Enumerate every field of `FlexItem`, classifying each as immutable-per-resolution (derived from style + `nodeInnerSize`) or mutable-per-pass (`flexBasis`, `innerFlexBasis`, `targetSize`, `hypotheticalInnerSize`, `hypotheticalOuterSize`, `frozen`, `violation`, offsets, baselines, …). Write the classification into a comment above the interface so a future field addition is forced to declare its class.
- [x] 4.2 Cache the constructed `FlexItem[]` on the parent node, keyed on the inputs the immutable fields derive from (`nodeInnerSize` width/height and child list identity/length). Invalidate alongside the existing per-run cache clear. **Implemented, measured, and reverted — see 4.6.**
- [x] 4.3 Reset every mutable-per-pass field explicitly at the start of each `computeFlexboxLayout` pass — by enumeration, never by omission — so a reused item is indistinguishable from a fresh one.
- [x] 4.4 Verify `pnpm vitest run` reports 4,410 passing with zero skips.
- [x] 4.5 Re-measure allocation: heap churn per 20 runs and GC scavenge count, before vs after, same methodology as 3.6.
- [x] 4.6 **Reverted.** The reset logic was provably safe (1,600 repeat-layout and 400 stale-memo differential checks all identical, full suite green), but the memo hit only 28.6% — containers are measured under many different inner sizes per run, so 71% of calls rebuilt anyway and paid the key comparison on top. Throughput measured 0.972x, faster in only 2/5 paired trials. Reverted per design D5; task 3 stands alone. The FlexItem field classification comment was kept.
- [x] 4.7 Commit as a standalone, independently revertible change.

## 5. Republish and close out

- [ ] 5.1 Re-run the full benchmark suite on the optimized engine in a clean process and update `BENCHMARKS.md` with final figures, reporting every scenario including any that regressed.
- [ ] 5.2 Re-profile the deep-tree workload and record the post-optimization hot spots, so the next perf effort starts from current evidence rather than this change's starting point.
- [ ] 5.3 Confirm the delta spec's scenarios hold: cache lookups/hits allocate nothing, scavenges are strictly lower than the allocating baseline, full suite identical, and published deep-tree ratios use taffy's shape with alternating-axis labeled engine-only.
- [ ] 5.4 Update `README.md` if it cites any performance figure or the superseded deep-tree claim.
