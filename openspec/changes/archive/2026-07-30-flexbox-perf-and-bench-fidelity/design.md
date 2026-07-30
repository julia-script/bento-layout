## Context

See proposal.md — Why, for motivation and the headline measurements.

Constraints that shape the approach:

- **Conformance is the hard gate.** 4,410 fixtures currently pass with zero
  skips. No step here may change a single layout value.
- **`Cache` semantics are load-bearing and not a pure taffy port.** Taffy's
  `Cache::get` matches on `known_dimensions` + `available_space` only. Ours
  additionally keys on `parentSize` and `axis`. Both extras were tested during
  exploration: dropping `axis` from the key **fails 4 grid baseline fixtures**,
  and adopting taffy's `known_dimensions == cached_size` relaxation **fails 12
  more**. So the cache cannot simply be replaced with a literal taffy port —
  only its *allocation behavior* is in scope, not its match predicate.
- **`parentSize.height` participates only in the `perform-layout` slot.** The
  current `compute-size` path compares `parentSizeW` but not `parentSizeH`
  (mirroring taffy masking out the y-axis bits). Preserving this asymmetry
  exactly is required.
- **Measurement is unusually error-prone here.** During exploration, three
  separate measurement attempts produced misleading numbers: monkeypatching
  `Cache.prototype` deoptimizes call sites and made a strictly-cheaper cache
  look *slower*; a profile silently measured the unmodified engine because the
  probe imported an absolute path to the original source tree; and a warm-vs-cold
  comparison produced a fictitious "8.3× speedup". The methodology decision below
  exists because of these.

## Goals / Non-Goals

**Goals:**

- Published figures that a reader can reproduce and that compare like with like.
- Remove per-lookup and per-hit allocation from the cache without touching its
  match predicate.
- Reduce `FlexItem` construction churn, the largest remaining GC source.
- Leave behind a measurement procedure that resists the specific errors above.

**Non-Goals:**

- Closing the gap to Rust entirely. A managed-runtime engine will not match
  native; the realistic target is a small constant factor, not parity.
- Changing the cache's match predicate, slot assignment, or the set of inputs
  that distinguish entries. That is a correctness question, deliberately
  separated from this performance work.
- Incremental relayout (`markDirty`, parent pointers, dirty subtree tracking).
  That is a larger design with an API surface and belongs in its own change.
- Algorithmic reduction of the ~O(n·depth) measure-call growth. Misses per node
  rise ~+6 per level; taffy exhibits the same growth, so this is a property of
  measure-based flex sizing rather than a defect.

## Decisions

### D1: Fix the benchmark builder before optimizing anything

Correct `BENCHMARKS.md` and `scripts/bench.ts` first, as their own commit,
before any engine change. Optimizing against a builder known to be
non-representative would tune for the wrong workload, and the corrected
baseline is needed to judge every later step.

*Alternative considered:* optimize first, correct docs at the end. Rejected —
the wrong figure stays published for the duration, and intermediate
measurements would not be comparable to the final ones.

### D2: Keep the alternating-axis tree, but demote it

Taffy's `Deep tree (auto size)` uses `flex_grow: 1` + uniform margin, default
row direction, no padding, no leaf sizes. Ours alternated `row`/`column` per
level and added padding plus leaf sizes. Alternation alone is a ~3.8× work
multiplier (128 vs 34 compute-size calls/node).

Add a taffy-equivalent scenario for the published ratio, and retain the
alternating tree as an explicitly-labeled engine-only stress case. It is a
legitimate workload — real UIs nest rows in columns — and it is the most
sensitive regression detector we have. It simply cannot carry a cross-engine
ratio.

### D3: Allocation-free cache via inline primitive fields

Replace the `CacheKey` object + string-concatenation key with entries that store
each key field as a primitive (`kw`, `kh`, `aw`, `ah`, `pw`, `axis`, plus `ph`
on the final-layout entry) and compare them with `===`. Store a prebuilt
`LayoutOutput` per measure slot so a hit returns an existing object.

Rationale: the string key existed to disambiguate a known-dimension of `v` from
a definite available-space of `v` (the `k`/`a` prefixes). Comparing the fields
separately makes that disambiguation structural — `kw` and `aw` are distinct
fields and cannot collide — so the encoding is unnecessary.

Prototyped during exploration: **4,410/4,410 pass**, +35% throughput on the deep
tree (57 → 77 iterations in a fixed 6s window), GC scavenges 227 → 177 per 20
runs.

*Alternatives considered:* (a) numeric bit-packing as taffy does — rejected, JS
numbers are doubles and the packing would need care around `null` and the
`min-content`/`max-content` sentinels, for no gain over field comparison;
(b) a `Map` keyed by string — that is essentially today's behavior and is the
thing being removed.

Returning a shared `LayoutOutput` on hit means callers must not mutate it. Today
they do not — `computeChildLayout` returns it straight through and callers read
`.size`. T4 adds an assertion pass to confirm this before the change is trusted.

### D4: Reduce `FlexItem` churn by reusing per-node item arrays

`generateAnonymousFlexItems` rebuilds the entire item array on every
`computeFlexboxLayout` call — ~12 nested objects per item, ~200k calls per deep
tree run, ~128 MB churned per 20 runs.

Approach: cache the constructed `FlexItem[]` on the parent node, keyed by the
resolution inputs that affect it (`nodeInnerSize` and child count/identity), and
reset the mutable per-pass fields (`flexBasis`, `targetSize`, `frozen`,
`violation`, …) rather than reallocating. The immutable-per-resolution fields
(`padding`, `border`, `margin`, `size`, `minSize`, `maxSize`) are recomputed only
when the keying inputs change.

This is the riskiest step: `FlexItem` carries substantial mutable state across
the algorithm's phases, and a missed reset is a silent wrong-layout bug rather
than a crash. Hence D5, and hence it lands last and separately.

*Alternative considered:* a free-list object pool. Rejected as more machinery
with the same reset-correctness risk and no better locality.

### D5: Every optimization step is independently revertible and fixture-gated

Each of T3 and T4 is a standalone commit that must leave 4,410/4,410 passing.
If T4's reset logic proves hard to make safe, T3 has already banked most of the
measured win and T4 can be dropped without unwinding anything.

### D6: Benchmark methodology

Adopt, and document in `BENCHMARKS.md`:

1. **No monkeypatching for timing.** A/B by building the variant in a separate
   source tree and running each in its own process. Prototype patching is fine
   for *counting* invariants (call counts, hit rates), which is deopt-immune.
2. **Fixed-time iteration counts over medians** as the headline metric for
   heavy scenarios. At n=10 the medians here were noise-dominated and disagreed
   with the profile in sign; iterations-per-6s was stable and agreed.
3. **Verify the probe measured what you think.** Profiles must resolve to the
   intended source tree; check that functions you deleted are absent from the
   profile before drawing conclusions.
4. **Warm both sides equally.** Never compare a cold tree against a warm one.
5. **State the tree shape** next to every published figure.

## Risks / Trade-offs

- **Shared `LayoutOutput` on cache hit is mutated by some caller** → T4's
  assertion pass (freeze returned outputs in a debug run across the full fixture
  suite) before relying on the change. Cheap to detect, and reverting to a copy
  on hit costs one allocation while keeping the key-comparison win.
- **`FlexItem` reuse misses a mutable field reset** → silent wrong layout, not a
  crash. Mitigation: enumerate mutable fields against the struct definition,
  reset explicitly rather than by omission, and gate on the full suite. D5 keeps
  this revertible in isolation.
- **Item-array cache keyed too loosely** (e.g. a style mutated between runs) →
  stale items. Mitigation: key on the same inputs the items are derived from,
  and clear alongside the existing per-run cache clear.
- **Optimization gains do not survive on other shapes** → the corrected bench
  covers wide, deep, grid, block, and mixed; report all of them, including any
  scenario that regresses.
- **The +35% prototype figure does not reproduce in the real implementation** →
  it was measured on a real source edit in a separate process, not a
  monkeypatch, so this is unlikely; but T3 re-measures and publishes whatever it
  actually finds, including a null result.

## Migration Plan

No user-facing migration. No public API change, no fixture changes. Each task is
a separate commit; revert is `git revert` of that commit. `BENCHMARKS.md` states
that the prior ~75–90× figure was withdrawn and why, rather than quietly
replacing it.
