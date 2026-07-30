## Context

Third and largest port in the series; see the archived `port-taffy-flexbox` and `port-taffy-block-layout` designs for the established conventions (1:1 module mapping, plain-object data model, fixture pass-count as progress metric, existing suites as regression gates). Reference is the same pinned Taffy clone (commit in `tests/fixtures/TAFFY_COMMIT`). Upstream scope: `compute/grid/` is ~4.4k lines across `track_sizing.rs` (1,424), `mod.rs` (897), `placement.rs` (764), `explicit_grid.rs` (732), `alignment.rs` (378), `implicit_grid.rs` (253), plus `types/` and `util/` helpers and `style/grid.rs` (1,607 — roughly half of which is named-line/area machinery the fixtures never touch).

## Goals / Non-Goals

**Goals:**
- All 1,220 grid-family fixtures passing (1,140 `grid`, 56 `blockgrid`, 24 `gridflex`) and both skip lists emptied.
- Grid style types that are pleasant as plain data (arrays of discriminated unions, no parser required at the public API).
- `src/compute/grid/*` files mapping 1:1 to the Rust modules for future upstream syncs.

**Non-Goals:**
- Named grid lines and `grid-template-areas` (zero fixture usage — deliberately deferred to a future change; style types should not preclude adding them).
- Subgrid and masonry (Taffy doesn't implement them), floats, `calc()`.
- `detailed_layout_info` (Taffy's optional grid track introspection output).

## Decisions

1. **Track sizing function representation**: a discriminated union per track entry, e.g. `number | { percent } | { fr } | 'auto' | 'min-content' | 'max-content' | { fitContent: LengthPercentage } | { min, max }` with `repeat` as a wrapper entry `{ repeat: count | 'auto-fill' | 'auto-fit', tracks: [...] }`. Mirrors Taffy's `TrackSizingFunction`/`GridTemplateComponent` without the `CheapCloneStr` generics (those exist for named lines). Exact shapes finalized during implementation.
2. **Placement**: `{ start, end }` lines where each is `number | { span: number } | 'auto'` — Taffy's `GridPlacement` minus named-line variants. Negative numbers count from the end, as in CSS.
3. **Module mapping**: `src/compute/grid/mod.ts` (orchestration) ← `mod.rs`, plus `explicit.ts`, `implicit.ts`, `placement.ts`, `trackSizing.ts`, `alignment.ts`, `types.ts` (GridTrack, GridItem, CellOccupancyMatrix, coordinates). Taffy's `OriginZero` line coordinate newtypes become plain numbers with conversion helpers — the type-safety they encode in Rust is carried by tests here.
4. **Dispatch**: `display: 'grid'` with children → `computeGridLayout`; the ponytail fall-through in dispatch.ts is deleted. Grid containers with no children still go through the leaf path only if they have no templates? No — match Taffy: `(Display::Grid, true)` → grid, `(_, false)` → leaf. A childless grid with templates behaves as Taffy behaves (leaf), which is what fixtures encode.
5. **Harness track-list parser** lives in the test harness (not the library): fixture attribute strings (`"repeat(auto-fill, 40px)"`, `"minmax(20px,40px)"`, `"1fr 2fr"`) parse into the public style types. The published package stays parser-free.
6. **Porting order**: types → explicit/implicit grid + placement (verifiable via simple fixed-track fixtures) → track sizing (the long pole) → alignment + absolute children → blockgrid/gridflex interop. Fixture subdirectory pass-counts gate each stage.
7. **`justifyItems`/`justifySelf`** reuse the existing `AlignItems` type and safe/unsafe parsing.

## Risks / Trade-offs

- [Track sizing is the most intricate algorithm in Taffy (spanned-item distribution, planned increases, infinitely-growable tracks)] → Port strictly line-by-line as with `flexbox.rs`; 1,140 grid fixtures give dense coverage of the edge cases; do not "simplify" during transcription.
- [Baseline alignment inside grid areas interacts with the flex baseline plumbing] → Shared `LayoutOutput.firstBaselines` already exists; grid fixtures exercise it.
- [CellOccupancyMatrix / OriginZero coordinate conversions are easy to off-by-one in a plain-number port] → Keep the conversion helpers as named functions with the Rust names; add a few direct unit tests for placement before running fixtures.
- [Fixture attr parsing bugs masquerading as layout bugs] → Unit-test the harness track-list parser against the distinct value strings actually present in the vendored fixtures (extractable by grep).

## Open Questions

(none — scope follows the fixtures; named lines/areas explicitly deferred)
