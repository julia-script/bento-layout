## Why

CSS Grid is the last layout algorithm keeping flexboxjs from full Taffy fixture coverage: 8 flex-suite fixtures remain skipped, and 1,220 vendored-fixture candidates (1,140 `grid` + 56 `blockgrid` + 24 `gridflex`) are untestable without it. It is also the most-requested layout mode after flexbox for real UI work. Scoping shows the port is smaller than feared: the fixtures use no named lines or template areas, cutting Taffy's grid style machinery roughly in half (~6k lines of Rust to port: ~4.4k compute + types/util + the unnamed-track subset of style).

## What Changes

- Port Taffy's CSS Grid algorithm (`compute/grid/`) to `src/compute/grid/`: explicit grid resolution from templates (`explicit_grid.rs`), implicit grid estimation (`implicit_grid.rs`), auto-placement including dense packing and column flow (`placement.rs`), the track sizing algorithm (`track_sizing.rs` — intrinsic sizing, fr distribution, spanned items), and item/track alignment (`alignment.rs`, reusing the shared alignment helpers).
- New grid style properties: `gridTemplateRows`/`gridTemplateColumns` (fixed, percent, `fr`, `auto`, `min-content`, `max-content`, `fit-content()`, `minmax()`, `repeat()` with counts and `auto-fill`/`auto-fit`), `gridAutoRows`/`gridAutoColumns`, `gridAutoFlow` (row/column, dense), `gridRow`/`gridColumn` placements (line numbers incl. negative, `span n`, auto), and `justifyItems`/`justifySelf`.
- Dispatch `display: 'grid'` containers to the grid algorithm, removing the current fall-through-to-flex behavior entirely — after this change every display mode has a real implementation.
- Vendor `tests/xml/grid`, `tests/xml/blockgrid`, and `tests/xml/gridflex` at the pinned Taffy commit; extend the harness's style mapping with the grid attributes (including a small track-list parser for fixture strings like `repeat(auto-fill, 40px)`); empty the remaining skip lists (the 8 grid-rooted flex fixtures pass).
- Out of scope: named grid lines, `grid-template-areas` (zero fixture usage; can be a follow-up change), floats, `calc()`, subgrid (Taffy doesn't implement it either), masonry.

## Capabilities

### New Capabilities

- `grid-layout`: Computing CSS Grid layout — explicit/implicit track resolution, auto-placement, the track sizing algorithm with fr units and intrinsic tracks, gaps, alignment (`justify/align` × `items/self/content`), absolute children, and interop with flex/block nodes in mixed trees.

### Modified Capabilities

- `conformance-harness`: The harness SHALL also run the vendored `grid`, `blockgrid`, and `gridflex` fixture directories, and no fixtures remain skipped.
- `layout-tree-api`: Style input gains the grid properties (track lists, placements, auto-flow, justify-items/self) as plain data.

## Impact

- New: `src/compute/grid/` (multiple modules mirroring Taffy's), grid style types in `src/style.ts`; vendored `tests/fixtures/{grid,blockgrid,gridflex}/`.
- Modified: `src/compute/dispatch.ts` (grid routing, fall-through removed), harness style mapping + track-list parsing, skip lists deleted.
- No new dependencies. Regression gates: flex suite (2,244) and block suites (896) stay green throughout.
- This is the largest remaining change (~2× the block port); expect the track sizing algorithm to be the long pole, as `flexbox.rs` was for the first change.
