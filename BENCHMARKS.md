# Benchmarks

Run with `pnpm bench` (scripts/bench.ts). Each scenario reports the median of 10
samples after 3 warmups, plus iterations completed in a fixed window (2s by
default; set `BENCH_WINDOW_MS` to widen it). Every run is a full from-scratch
layout (`computeLayout` clears all caches). `pnpm bench --json` additionally
emits each scenario's tree shape.

Figures below were taken with `BENCH_WINDOW_MS=3000`.

**Environment:** Apple M1 Max, 32 GB, Node v26.5.0, 2026-07-30.

> ### Retraction
>
> An earlier revision of this file reported that branching deep flex trees were
> **~75–90× slower than the Rust engine below** and attributed it to "redundant
> measure passes or cache misses specific to nested alternating-axis
> containers".
>
> **That figure is withdrawn.** It was measured on a tree shape with no
> counterpart in the reference suite: our deep-tree builder alternated
> `flexDirection` at every level and added padding on containers plus fixed
> sizes on leaves, none of which the `Deep tree (auto size)` bench does.
> Alternating the axis alone costs roughly 3.8× the compute-size calls per node
> that a uniform-direction tree of the same shape does, so the comparison was
> measuring our extra work against a lighter tree.
>
> On the matching shape the gap measured **~7–8×** at the time of the
> retraction, and **~5.6–6×** after the cache fix described in
> [Reading](#reading). The accompanying diagnosis was also wrong: the dominant
> cost was per-lookup allocation in the measurement cache, not redundant
> measure passes.

## Comparable scenarios

These use tree shapes matching a published cross-engine benchmark, so the
ratios are meaningful.

| Scenario | Nodes | Median | Iters/s | Throughput |
|---|--:|--:|--:|--:|
| flex: wide (10 children) | 11 | 0.15 ms | 104,031 | 72k nodes/s |
| flex: wide (100 children) | 101 | 0.08 ms | 12,204 | 1.20M nodes/s |
| flex: wide (1,000 children) | 1,001 | 0.79 ms | 1,109 | 1.26M nodes/s |
| flex: wide (10,000 children) | 10,001 | 27.9 ms | 42.8 | 358k nodes/s |
| flex: deep uniform (~4,000) | 3,071 | 30.3 ms | 31.0 | 101k nodes/s |
| flex: deep uniform (~10,000) | 8,191 | 77.6 ms | 12.7 | 106k nodes/s |
| grid: 10×10 | 101 | 1.19 ms | 1,904 | 85k nodes/s |
| grid: 32×32 | 1,025 | 5.87 ms | 178 | 175k nodes/s |
| grid: 100×100 | 10,001 | 81.1 ms | 12.3 | 123k nodes/s |

### Shapes

| Scenario | Shape |
|---|---|
| flex: wide | flat, row + wrap, fixed leaf size, margin 1, gap 2 |
| flex: deep uniform | branch 2, uniform row direction, `flexGrow: 1` + margin 10, default-style root, max-content available space — built node-for-node to match the standard deep-hierarchy benchmark (3,071 / 8,191 nodes, reproducing its budget undershoot) |
| grid: N×N | flat, `auto`/`1fr` tracks both axes, gap 2 |

## Engine-only scenarios

No cross-engine counterpart, so **no ratio is published for these**. They
are retained because they exercise paths the comparable set does not, and the
alternating-axis trees are the most sensitive regression detectors in the suite.

| Scenario | Nodes | Median | Iters/s | Throughput |
|---|--:|--:|--:|--:|
| flex: deep alternating-axis (depth 10, branch 2) | 2,047 | 367 ms | 2.7 | 5.6k nodes/s |
| flex: deep alternating-axis (depth 7, branch 3) | 3,280 | 412 ms | 2.5 | 8.0k nodes/s |
| block: 1,000 stacked (margin collapsing) | 1,001 | 0.73 ms | 1,870 | 1.37M nodes/s |
| block: 10,000 stacked | 10,001 | 12.7 ms | 88.6 | 786k nodes/s |
| mixed page: 10 sections | 271 | 4.20 ms | 360 | 65k nodes/s |
| mixed page: 100 sections | 2,701 | 30.7 ms | 32.2 | 88k nodes/s |

The alternating-axis trees alternate `flexDirection` per level, add padding on
every container and a fixed size on every leaf.

## Reference: Taffy (Rust) on the same machine

Taffy's criterion benches (`cargo bench --bench flexbox`, the "Taffy 0.7"
harness), same M1 Max.

| Scenario | Taffy (Rust) | flexboxjs (TS) | Ratio |
|---|--:|--:|--:|
| Wide 2-level, 10k nodes | 7.8 ms | 27.9 ms | ~3.6× |
| Deep tree (auto size), 12-level / ~4k | 5.4 ms | 30.3 ms | ~5.6× |
| Deep tree (auto size), 14-level / ~10k | 12.8 ms | 77.6 ms | ~6× |

The reference suite also benchmarks a 100-level "super deep" single chain
(0.50 ms). An
earlier revision of this file paired it with a 2.0 ms figure for a ~4× ratio,
but no such scenario exists in `scripts/bench.ts` — that number came from a
builder that has since been removed, so it is not reproducible and has been
dropped rather than carried forward. Add a matching scenario to the suite
before republishing that comparison.

## Reading

- **The gap to Rust is a small constant factor**, ~3.6–6× depending on shape.
  That is the expected range for a managed runtime against native code.
- **Deep trees cost more than wide ones** (~106k vs ~358k nodes/s). Misses per
  node grow roughly linearly with depth (about +6 per level), so total work is
  ~O(n·depth). This is inherent to measure-based flex sizing rather than a
  defect — the native engine shows the same growth, which is why the ratio
  stays bounded.
- **The dominant JS-side cost was allocation, not algorithm.** Profiling the
  deep uniform tree found the measurement cache allocating three template
  strings plus a key object on every lookup and a six-object result on every
  hit — about 1.8M short-lived objects per layout run on an 8,191-node tree
  (~218 per node). A native cache compares packed primitives and allocates
  nothing. Making our lookups and hits allocation-free took the deep-tree ratio
  from ~7–8× to ~5.6–6× and raised profiled throughput ~42% (57 → 81 iterations
  in a fixed window), with GC scavenges down ~20%.
- **Reusing `FlexItem` arrays across passes does not help.** It looked like the
  next obvious win — `generateAnonymousFlexItems` rebuilds ~12 nested objects
  per item on every `computeFlexboxLayout` call — but a per-node memo keyed on
  the container's inner size hit only 28.6%, because a container is measured
  under many different inner sizes within one layout. Measured 0.972× (faster
  in 2/5 paired trials) and was reverted. Recorded here so the next attempt
  starts from the measurement rather than repeating it.
- **Remaining hot spots**, in case someone picks this up: GC is still ~9.5%,
  now spread across flexbox item construction rather than concentrated in the
  cache; `determineFlexBaseSize`, `maybeResolve`, and `resolveRectOrZero`
  together account for ~15% of self time.

## Methodology

Performance work on this engine has produced misleading numbers more than once.
These rules exist because each of them was violated during earlier measurement,
and each violation produced a confidently wrong conclusion.

1. **Never monkeypatch for timing.** Patching `Cache.prototype` to A/B a change
   deoptimizes call sites and made a strictly-cheaper cache measure *slower*.
   Build the variant in a separate source tree and run each side in its own
   process. Prototype patching is fine for *counting* invariants (call counts,
   hit rates), which is deopt-immune.
2. **Prefer fixed-window iteration counts to medians on heavy scenarios.** At
   n=10 the medians here are noise-dominated and have disagreed with the
   profile in sign. `pnpm bench` reports both; trust `it/s` when they conflict.
   Override the window with `BENCH_WINDOW_MS`.
3. **Verify the probe measured what you think.** One profiling run silently
   measured the unmodified engine because the probe imported an absolute path
   to the original source tree. Before drawing conclusions, confirm that
   functions you deleted are absent from the profile.
4. **Warm both sides equally.** Comparing a cold tree against a warm one once
   produced a fictitious "8.3× speedup".
5. **State the tree shape next to every figure**, and never publish a
   cross-engine ratio for a shape the other engine does not benchmark.
