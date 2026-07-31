# Tasks: Opaque node API with a curated surface

## 1. Baseline

- [x] 1.1 Record a bench baseline on the current API (`npm run bench`, save output into the change dir as `bench-before.txt`) so task 6.2 has a comparison point

## 2. LayoutNode class

- [x] 2.1 Add `LayoutNode` class in `src/tree.ts` with `#style`, `#children`, `#parent`, `#measure`, `#cache`, `#unroundedLayout`, `#layout` private fields; constructor `(style?: Partial<Style>, children?: LayoutNode[])` resolving style via `resolveStyle`
- [x] 2.2 Add public reads: `get style(): Readonly<Style>`, `get children(): readonly LayoutNode[]`, `get parentNode(): LayoutNode | null`, `get layout(): Readonly<Layout>`, `get unroundedLayout(): Readonly<Layout>`
- [x] 2.3 Add mutators funneled through a single internal `#markDirty()` (no-op body for now): `setStyle(partial)` (shallow merge, doc comment stating nested objects are replaced whole), `setMeasure(fn | null)`, `appendChild`, `insertChild(index, node)`, `removeChild` — with the single-parent invariant (append detaches from prior parent) and self/ancestor-cycle rejection
- [x] 2.4 Expose engine-only internals via a module-scoped friend accessor (static-block trick or equivalent) exported from `tree.ts` but never from the package root; keep the old `Node` interface temporarily so both APIs coexist during migration
- [x] 2.5 Unit tests for tree manipulation: detach→reattach positions under new parent, reparent-on-append, cycle rejection, dropped subtree needs no cleanup call (spec scenarios from the delta)

## 3. Engine reads through internals

- [x] 3.1 Switch `src/index.ts` layout internals (`clearCaches`, `computeRootLayout`, `roundLayout`, `copyUnroundedLayout`) and `src/compute/dispatch.ts` to the friend accessor
- [x] 3.2 Switch `src/compute/block.ts`, `flexbox.ts`, `leaf.ts`, `alignment.ts` to the friend accessor
- [x] 3.3 Switch `src/compute/grid/**` to the friend accessor; full test suite green on the old public API (fixtures still construct plain nodes at this point)

## 4. Consumer migration

- [x] 4.1 Migrate `tests/harness/fixture.ts` (and `harness/measure.ts` if touched) to construct `LayoutNode` trees — this flips all 4417 fixture tests; suite green
- [x] 4.2 Migrate direct construction sites: `tests/api.test.ts`, `tests/scrollbar.test.ts`, `tests/placement.test.ts`, `scripts/bench.ts`
- [x] 4.3 Migrate `scripts/fuzz.ts` and `scripts/fuzz-triage.ts` tree construction; run a short fuzz smoke (a few thousand cases) to confirm the differential harness still agrees with Chrome
- [x] 4.4 Delete `createNode`, `NodeOptions`, and the old `Node` interface; typecheck finds stragglers; suite green

## 5. Typed validation errors

- [x] 5.1 Add exported `InvalidStyleError` (name set, message from typed params, `cause` where wrapping); convert the user-reachable grid throw in `src/compute/grid/types.ts` (non-finite track count; grid line 0 is CSS-conformant treated-as-auto and does not throw); leave internal invariant throws plain
- [x] 5.2 Tests asserting `instanceof InvalidStyleError` for the non-finite-track-count path and treated-as-auto for grid line 0

## 6. Curated barrel & verification

- [x] 6.1 Rewrite `src/index.ts` exports: drop both `export *` lines; explicitly export `LayoutNode`, `computeLayout`, `ComputeLayoutOptions`, `InvalidStyleError`, `MeasureFunction`, `Layout`, and the style/geometry type vocabulary; add a test that snapshots `Object.keys(await import('../src/index.js'))` so surface growth is a deliberate diff
- [x] 6.2 Bench against `bench-before.txt`; if the friend-accessor indirection regresses beyond noise, inline hot accessors before proceeding
- [x] 6.3 Update README examples to the new API; typecheck, lint, full suite, and `npm run build` all green
