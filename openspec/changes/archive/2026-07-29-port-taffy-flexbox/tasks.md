## 1. Scaffold & fixtures

- [x] 1.1 Init pnpm package (ESM, strict TS, vitest) with placeholder name `flexboxjs`, private
- [x] 1.2 Vendor `tests/xml/flex/*.xml` from pinned Taffy clone; record commit hash in `tests/fixtures/TAFFY_COMMIT`
- [x] 1.3 Write fixture XML parser (test → viewport/input/expectations tree)

## 2. Core types & utilities

- [x] 2.1 Port geometry (`Size`/`Rect`/`Point` helpers) and style types (dimensions, alignment enums, flex properties, defaults)
- [x] 2.2 Port resolve/math utilities (percentage resolution, maybe-math on nullable numbers)
- [x] 2.3 Define `Node`, `Layout`, `LayoutInput`/`LayoutOutput`, and the style-of-fixture-attribute mapping used by the harness

## 3. Harness & leaf layout

- [x] 3.1 Port Ahem/fixed/aspect-ratio test measure function; unit-test against hand-computed cases
- [x] 3.2 Wire vitest suite: glob fixtures, build trees, compute, compare with 0.1 tolerance (all failing is OK)
- [x] 3.3 Port `compute/mod.rs` orchestration (root layout, cached layout, hidden layout) and `leaf.rs`; simple fixed-size fixtures pass

## 4. Flexbox algorithm

- [x] 4.1 Port flexbox steps 1–5 (available space, flex items, flex basis, line collection)
- [x] 4.2 Port main-size resolution (grow/shrink loop, min/max clamping)
- [x] 4.3 Port cross sizing, alignment (justify/align/baseline), gaps, wrap-reverse
- [x] 4.4 Port absolute children positioning and content-size accumulation
- [x] 4.5 Port 9-slot layout cache; verify deep-nesting perf sanity
- [x] 4.6 Port rounding pass; drive fixture pass rate to 100% (2,236/2,236 passing; 16 fixtures skipped because their roots require grid/block layout — documented in tests/fixtures.test.ts)

## 5. Publish polish

- [x] 5.1 Public API surface: exports from package root, README with usage example
- [x] 5.2 Build setup (tsc emit, types, package.json exports map), `pnpm build` + `pnpm test` green from clean checkout
