## Context

See proposal.md — Why. Builds directly on `browser-conformance-gentest`: Puppeteer + pinned Chrome, the in-page geometry extractor, the XML pipeline, and `KNOWN_DIVERGENCES.md` all exist by the time this change starts. Prior art: differential fuzzing of layout engines is how Yoga/Taffy-class bugs are found in practice, but Taffy itself has no such tool — this is net-new leverage for the project.

## Goals / Non-Goals

**Goals:**
- Deterministic, seed-reproducible runs (debuggability beats raw throughput).
- High-signal reports: shrunk reproductions, no known-divergence noise.
- Every confirmed finding becomes a committed regression fixture — the corpus grows itself.
- Batched Chrome rendering so a run of thousands of trees is minutes, not hours.

**Non-Goals:**
- CI gating (on-demand tool; optional smoke budget later), coverage-guided mutation (plain generative fuzzing first), multi-browser, perf/stress fuzzing, fuzzing unsupported features (floats, calc(), named lines, subgrid).

## Decisions

1. **Seeded PRNG with per-tree derived seeds.** One run seed; tree N uses `hash(seed, N)` so any single failing tree reproduces in isolation (`--seed X --only N`). Simple xorshift/mulberry32 in-repo — no dependency. (`Math.random` is banned in the generator.)
2. **Grammar-based generation with weighted style tables, per-mode profiles** (`flex`/`grid`/`block`/`mixed`). Weights favor interaction-heavy combos (percentages, auto margins, min/max + aspect-ratio, spanning grid items, nested container-type switches); tree size capped (~default depth ≤ 4, ≤ 40 nodes) — small trees shrink and debug better. Values drawn from a small quantized palette (0, 1px, tenths, percentages, fr units) rather than arbitrary floats, to generate boundary conditions more often than noise.
3. **Comparison via the engine's own tolerance (0.1px) against unrounded engine output vs Chrome's `getBoundingClientRect`**, same as the fixture harness semantics (rounding enabled to match fixtures). Known divergences are matched structurally (by the divergence's minimized signature) and skipped.
4. **Batched rendering**: serialize many trees into one page (or reuse one Puppeteer page sequentially with `setContent`) to amortize browser startup; batch size tunable. Determinism controls inherited from gentest (Ahem, DPR 1, classic scrollbars).
5. **Shrinking = greedy delta debugging**: alternate passes of (a) node removal (leaf-first), (b) style-property resetting to defaults, re-checking the mismatch after each step, until a fixed point. Each re-check re-renders in Chrome — acceptable because shrinking only runs on failures.
6. **Style→inline-CSS serializer** lives beside the generator and is property-table-driven so it stays in lockstep with the style types; round-trip tested against the harness's attribute parser (serialize → parse → deep-equal).
7. **Findings directory**: `tests/html/fuzz-found/<short-hash>.html` with a comment header recording seed, date, and Chrome version. Regenerated into XML by the standard `pnpm gentest` path — no parallel pipeline.

## Risks / Trade-offs

- [Chrome quirks vs spec: the fuzzer may surface cases where Chrome itself is arguably non-conformant] → Policy stays "browser wins" for consistency; genuinely disputed cases go to `KNOWN_DIVERGENCES.md` with a spec citation instead of an engine change.
- [Flaky comparisons from sub-pixel text or scroll heuristics] → Ahem-only text, quantized value palette, and the gentest determinism controls; a mismatch must reproduce from its seed before it is reported (auto re-check).
- [Shrinker loops or shrinks away the bug] → Fixed-point iteration with a step budget; the pre-shrink tree is kept in the report as a fallback reproduction.
- [Generator drift as engine gains features] → Property tables colocated with style types; adding a style feature without extending the fuzzer table is caught in review (table is exhaustive over the Style interface via a type-level check).

## Open Questions

- Default iteration budget for a standard `pnpm fuzz` run (pick empirically once throughput is known; not blocking).
