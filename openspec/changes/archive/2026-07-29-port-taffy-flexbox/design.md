## Context

Greenfield repo. Reference implementation is Taffy (Rust) at a pinned commit, cloned locally for reading. The flexbox-relevant core is ~5.5k lines of Rust: `compute/flexbox.rs` (2,604 — the algorithm, structured section-by-section after the CSS spec), geometry/style types, percentage resolution, leaf sizing, cache, and rounding. Taffy's 2,252 flex XML fixtures encode Chrome ground truth, so conformance never requires running Rust. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- Faithful port of the *algorithm* (keep the spec-section structure of `compute_flexbox_layout` so the Rust and TS sources can be diffed side-by-side during the port).
- JS-idiomatic data model: plain objects, discriminated unions, GC-managed tree.
- 100% pass rate on vendored flex fixtures.

**Non-Goals:**
- Grid, block layout, float, `calc()`, `detailed_layout_info` — later changes.
- Performance parity with Rust; only asymptotic sanity (caching) is in scope.
- Taffy's generic tree traits / partial-tree layouts for host frameworks.

## Decisions

1. **Data model: one concrete `Node` class-like object, no arena.** Taffy's `NodeId` + slotmap + five tree traits exist for Rust hosts (Dioxus, Bevy). A standalone TS lib needs none of it: nodes are plain objects holding `style`, `children`, optional `measure`, plus internal `cache` and output `layout`/`unroundedLayout` slots. Alternative (mirroring TaffyTree with handles) rejected: pure ceremony in a GC language.

2. **Style representation: discriminated unions, not bit-packing.** Taffy's `CompactLength` packs tag+f32 into a u64 for cache density. In TS: `type Dimension = number | { percent: number } | 'auto'` style unions (exact shapes decided during implementation; bare number = px keeps authoring terse). Rejected: numeric tag-encoding — unreadable, no measured need.

3. **Port structure mirrors Taffy's module layout.** `src/geometry.ts` ← geometry.rs, `src/style.ts` ← style/*, `src/resolve.ts` ← util/resolve.rs, `src/compute/flexbox.ts` ← compute/flexbox.rs, `src/compute/leaf.ts`, `src/compute/mod.ts` (root/cached/hidden layout), `src/round.ts`. Function names and section comments follow the Rust source. Rationale: the 2,600-line algorithm is the risk; 1:1 traceability is the mitigation.

4. **`LayoutInput`/`LayoutOutput` protocol kept as-is.** The sizing-vs-layout run-mode distinction, known-dimensions, parent-size, and available-space inputs are the algorithm's backbone; the cache keys on them. Simplifying this invites subtle divergence.

5. **Cache: port Taffy's 9-slot cache semantics.** Keyed on known-dimensions + available-space + run-mode, stored per node, cleared on (re)layout entry. This is what makes nested flex non-exponential.

6. **Rounding: separate pass over unrounded layout,** cumulative (round absolute edges, derive sizes), matching `round_layout`. Toggleable because fixtures come in both flavors.

7. **Harness: vendor fixtures, hand-roll the tiny XML subset parser or use `fast-xml-parser` (dev-dep only).** One vitest suite globs `tests/fixtures/flex/**/*.xml`; each file becomes a named test. Ahem measure function ported from `tests/common/src/lib.rs`. Viewport `max-content` maps to max-content available space.

8. **Porting order inside the algorithm:** leaf + hidden + root orchestration first (gets absolute-child and fixed-size fixtures passing), then the flex algorithm's steps in spec order (available space → flex basis → lines → main size resolution → cross size → alignment → absolute children → content size). Fixture pass-count is the progress metric.

## Risks / Trade-offs

- [Mistranslation of Rust semantics (Option handling, f32 NaN/infinity conventions, integer rounding)] → Fixtures catch outcome bugs; for ambiguous spots, read the Rust line-by-line; use `null` (not `undefined`) for "None" consistently to keep checks explicit.
- [`f32` vs f64 drift: Rust computes in f32, JS in f64] → 0.1px tolerance absorbs it; fixtures were generated from Chrome (f64-ish) anyway. If a fixture fails only due to precision, compare against Math.fround-ed math before touching the algorithm.
- [Ahem text measure subtly wrong → ~196 text fixtures fail misleadingly] → Port measure function early and unit-test it directly against a few hand-computed cases before debugging layout.
- [Scope creep into block/grid because some `blockflex` fixtures look adjacent] → Only `tests/xml/flex` is vendored in this change.

## Open Questions

- Package name on npm (placeholder `flexboxjs` in package.json until the user picks; private until then).
- Whether to also emit CJS — decide at publish-polish time; ESM-only is the default.
