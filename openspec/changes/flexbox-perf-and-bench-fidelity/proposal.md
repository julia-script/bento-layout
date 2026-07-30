## Why

`BENCHMARKS.md` currently publishes a "~75–90× slower than Rust taffy on branching
deep flex trees" figure and attributes it to "redundant measure passes or cache
misses". Profiling shows that claim is a benchmark artifact, not an engine defect:
our `deepFlex` builder alternates `flexDirection` per level and adds padding plus
leaf sizes, none of which taffy's `Deep tree (auto size)` bench does. On taffy's
actual tree shape the gap is **~7–10×**, and alternation alone accounts for a ~3.8×
work multiplier (128 vs 34 compute-size calls per node).

Profiling the corrected workload found a real and unrelated hot spot: the
measurement cache allocates on every lookup — three template strings plus a
`CacheKey` object per `get`, and a six-object `LayoutOutput` per hit — about
**1.8M short-lived objects per layout run** on an 8,191-node tree (~218/node).
Taffy's cache compares packed primitives and allocates nothing. A prototype that
removes this allocation while preserving key semantics exactly gives **+35%
throughput** on deep trees (57 → 77 iterations in a fixed 6s window) and cuts GC
scavenges 22% (227 → 177 per 20 runs), with all 4,410 fixtures still passing.

Publishing a wrong performance claim is actively misleading, and the correction
should land before differential fuzzing starts generating its own numbers.

## What Changes

- **Correct `BENCHMARKS.md`**: retract the ~75–90× claim and the "redundant
  measure passes" diagnosis; publish like-for-like ~7–10× ratios measured against
  taffy's own deep-tree shape. Record the alternating-axis result as a separate,
  explicitly-labeled stress case rather than as the headline deep-tree number.
- **Align `scripts/bench.ts` deep-tree builder** with taffy's
  `build_deep_hierarchy` (`flexGrow: 1`, uniform margin, single flex direction,
  no leaf sizes) so published ratios are comparable. Keep the alternating-axis
  tree as an additional named scenario.
- **Make the measurement cache allocation-free**: store key fields inline as
  primitives and compare them directly; keep a prebuilt `LayoutOutput` per
  measure slot so hits allocate nothing. Key semantics (which inputs distinguish
  entries, including `axis`) are unchanged — this is an allocation change, not a
  behavior change.
- **Reduce per-call `FlexItem` allocation**: `generateAnonymousFlexItems`
  rebuilds the full item array (~12 nested objects per item) on every
  `computeFlexboxLayout` invocation, ~200k times per run on the deep-tree
  benchmark. This is the largest remaining GC source (~128 MB churned per 20
  runs) and the main lever left after the cache fix.
- **Re-profile and republish** benchmark numbers once the above land, so the
  documented figures reflect the optimized engine.

Not in scope: incremental relayout (`markDirty` + parent pointers), and any
change to layout results. Every fixture must produce byte-identical output.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `flexbox-layout`: the existing **Layout caching** requirement is strengthened.
  It currently constrains only asymptotic behavior ("no exponential blowup");
  it gains a requirement that cache lookups and hits do not allocate per call,
  since per-lookup allocation was measured as a dominant cost. Adds a
  requirement that published benchmark figures be measured against comparable
  tree shapes.

## Impact

- `src/tree.ts` — `Cache` class internals (key representation, entry storage).
  Public shape of `Cache.get`/`store`/`clear` is unchanged.
- `src/compute/flexbox.ts` — `generateAnonymousFlexItems` and the `FlexItem`
  lifecycle.
- `scripts/bench.ts` — deep-tree builder and scenario list.
- `BENCHMARKS.md` — corrected figures, methodology note, retraction of the prior
  claim.
- No public API change; no fixture expectation changes. The full conformance
  suite (4,410 fixtures) is the correctness gate for every step.
- Unblocks `chrome-differential-fuzzing`, which should start from trustworthy
  baseline numbers.
