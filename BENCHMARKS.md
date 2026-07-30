# Benchmarks

Run with `pnpm bench` (scripts/bench.ts). Median of 10 samples after 3 warmups;
every run is a full from-scratch layout (`computeLayout` clears all caches).

**Environment:** Apple M1 Max, 32 GB, Node v26.5.0, 2026-07-30.

## flexboxjs results

| Scenario | Nodes | Median | Throughput |
|---|--:|--:|--:|
| flex: wide (10 children) | 11 | 0.18 ms | 62k nodes/s |
| flex: wide (100 children) | 101 | 0.58 ms | 175k nodes/s |
| flex: wide (1,000 children) | 1,001 | 4.10 ms | 244k nodes/s |
| flex: wide (10,000 children) | 10,001 | 32.6 ms | 307k nodes/s |
| flex: deep (depth 10, branch 2) | 2,047 | 361 ms | 5.7k nodes/s |
| flex: deep (depth 7, branch 3) | 3,280 | 439 ms | 7.5k nodes/s |
| grid: 10×10 | 101 | 1.35 ms | 75k nodes/s |
| grid: 32×32 | 1,025 | 26.0 ms | 39k nodes/s |
| grid: 100×100 | 10,001 | 170 ms | 59k nodes/s |
| block: 1,000 stacked (margin collapsing) | 1,001 | 1.16 ms | 863k nodes/s |
| block: 10,000 stacked | 10,001 | 12.9 ms | 773k nodes/s |
| mixed page: 10 sections | 271 | 4.99 ms | 54k nodes/s |
| mixed page: 100 sections | 2,701 | 37.7 ms | 72k nodes/s |

## Reference: Taffy (Rust) on the same machine

Taffy's criterion benches (`cargo bench --bench flexbox`, reporting the
"Taffy 0.7" harness), same M1 Max. Tree shapes are equivalent but not
identical (Taffy's use randomized styles; ours are fixed), so treat ratios as
order-of-magnitude indicators, not precise comparisons.

| Scenario | Taffy (Rust) | flexboxjs (TS) | Ratio |
|---|--:|--:|--:|
| Wide 2-level, 10k nodes | 7.8 ms | 32.6 ms | ~4× |
| Super-deep chain, 100 levels | 0.50 ms | 2.0 ms | ~4× |
| Deep branch-2, ~4k nodes | 5.4 ms | 404 ms (4,095 nodes) | **~75×** |
| Deep branch-2, ~10k nodes | 12.8 ms | 1,195 ms (8,191 nodes) | **~90×** |

## Reading

- **Wide flex, block stacks, grids, single chains: healthy.** The ~4× gap to
  Rust on wide trees and deep *chains* is the expected JS-vs-native overhead.
- **Branching deep flex trees are anomalously slow** (~75–90× vs Rust,
  ~100–250 µs/node vs ~3 µs/node for wide trees). Scaling is roughly linear in
  node count — the measurement cache prevents exponential blowup — but the
  constant factor points at redundant measure passes or cache misses specific
  to nested alternating-axis containers. Tracked as a follow-up investigation;
  conformance is unaffected.
- Depth-scaling detail (branch-2 alternating row/column, grow + padding):
  127 nodes → 24 ms · 511 → 56 ms · 1,023 → 121 ms · 2,047 → 521 ms ·
  4,095 → 404 ms · 8,191 → 1,195 ms (noisy but ~linear per node).
