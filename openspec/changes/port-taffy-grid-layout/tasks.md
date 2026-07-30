## 1. Fixtures, styles & harness

- [x] 1.1 Vendor `tests/xml/{grid,blockgrid,gridflex}/*.xml` from the pinned Taffy clone into `tests/fixtures/`
- [x] 1.2 Add grid style types to `src/style.ts` (track sizing unions, repeat, placements, `gridAutoFlow`, `justifyItems`/`justifySelf`) with defaults
- [x] 1.3 Harness: track-list/placement attribute parser + wire the three new fixture directories (all grid fixtures failing is expected); unit-test the parser against the distinct attribute values present in the vendored fixtures
- [x] 1.4 Verify flex/block suites still green after style changes

## 2. Grid structure

- [x] 2.1 Port grid types: `GridTrack`, `GridItem`, `CellOccupancyMatrix`, origin-zero coordinate helpers (`src/compute/grid/types.ts`)
- [x] 2.2 Port `explicit_grid.rs` (template resolution incl. repeat/auto-fill/auto-fit) and `implicit_grid.rs` (grid size estimation)
- [x] 2.3 Port `placement.rs` (definite placement, auto-placement, dense packing, column flow) with direct unit tests for placement coordinates

## 3. Track sizing & layout

- [ ] 3.1 Port `mod.rs` orchestration (compute_grid_layout: available space, track resolution, item generation)
- [ ] 3.2 Port `track_sizing.rs` (intrinsic contributions, spanned-item distribution, fr resolution, minmax clamping, stretch)
- [ ] 3.3 Port `alignment.rs` (item alignment in areas, content alignment of tracks) and final item layout
- [ ] 3.4 Port absolute positioning of grid children; wire `display: 'grid'` dispatch and delete the fall-through
- [ ] 3.5 Drive `grid` fixture pass rate to 1,140/1,140

## 4. Interop & finish

- [ ] 4.1 Drive `blockgrid` (56) and `gridflex` (24) to green; empty the flex skip list (8 grid-rooted fixtures pass); full suite green with zero skips
- [ ] 4.2 Update README (scope, conformance counts, grid style docs); `pnpm build` + `pnpm test` green
