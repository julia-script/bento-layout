## 1. Fixtures & harness

- [x] 1.1 Vendor `tests/xml/block/*.xml` and `tests/xml/blockflex/*.xml` from the pinned Taffy clone into `tests/fixtures/block/` and `tests/fixtures/blockflex/`
- [x] 1.2 Generalize `tests/fixtures.test.ts` to run all three fixture directories with per-directory skip lists; add `text-align` to the harness style mapping; all block fixtures failing is expected

## 2. Shared type restoration

- [x] 2.1 Add `CollapsibleMarginSet` (`{positive, negative}` + collapse helpers), `topMargin`/`bottomMargin`/`marginsCanCollapseThrough` to `LayoutOutput`, and `verticalMarginsAreCollapsible` to `LayoutInput`; flex/leaf call sites pass zero constants
- [x] 2.2 Add `textAlign` to `Style` with default `'auto'`; restore leaf collapse-through output in `compute/leaf.ts`
- [x] 2.3 Verify flex suite still 2,236 green after type changes

## 3. Block algorithm

- [x] 3.1 Port `compute/block.rs` scaffolding: container sizing short-circuits, constants, item generation (`generate_item_list`)
- [x] 3.2 Port in-flow layout: stretch-fit width sizing, vertical stacking, margin collapsing (siblings, parent/first-last, collapse-through), text-align offsets
- [x] 3.3 Port absolute-positioned children of block containers
- [x] 3.4 Wire dispatch (`display: 'block'` + children → block algorithm) and the block branch of root layout in `src/index.ts`
- [x] 3.5 Drive `block` + `blockflex` fixture pass rate to 100% (896/896)

## 4. Finish

- [x] 4.1 Remove the block-rooted entries from the flex skip list (8 fixtures, not 12 as estimated); full suite green (flex 2,244 / block 868 / blockflex 28, 8 grid-rooted skips remain)
- [x] 4.2 Update README (scope section, conformance counts); `pnpm build` + `pnpm test` green
