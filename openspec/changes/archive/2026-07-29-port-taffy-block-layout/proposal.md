## Why

The flexbox port skips 12 conformance fixtures whose roots are `display: block`, and real-world layout trees (documents, UIs embedding text flows) routinely mix block and flex containers. Taffy's block algorithm is its smallest (~1.4k lines of Rust), making it the cheapest way to grow coverage: it unlocks 896 additional Chrome-derived fixtures (868 `block` + 28 `blockflex`) using the harness that already exists.

## What Changes

- Port Taffy's CSS block layout algorithm (`compute/block.rs`) to `src/compute/block.ts`: in-flow block stacking, stretch-fit ("fill available") width sizing, vertical margin collapsing (adjacent siblings, parent/first-last child, collapse-through empty blocks), `text-align` (`-webkit-left/right/center` for block children), and absolutely positioned children of block containers.
- Restore the block-only machinery deliberately dropped in the flexbox port: `CollapsibleMarginSet` on `LayoutOutput`, the `verticalMarginsAreCollapsible` layout input, leaf collapse-through detection, and block-aware root sizing in `computeLayout` (block roots stretch to definite available width).
- Dispatch `display: 'block'` containers to the block algorithm instead of the current fall-through-to-flex behavior. (`display: 'grid'` keeps the fall-through.)
- Vendor `tests/xml/block` and `tests/xml/blockflex` fixtures at the already-pinned Taffy commit; extend the harness's style mapping with `text-align`; un-skip the 12 block-rooted fixtures in the flex skip list (the 4 grid-rooted ones remain skipped).
- Out of scope: CSS Grid, floats/clear (Taffy feature-gates them; zero vendored block fixtures use them), `calc()`, inline layout.

## Capabilities

### New Capabilities

- `block-layout`: Computing CSS block layout for `display: block` containers — vertical stacking, width stretch-fit, margin collapsing, text-align of block children, absolute children — interoperating with flexbox in mixed trees.

### Modified Capabilities

- `conformance-harness`: The harness SHALL also run the vendored `block` and `blockflex` fixture directories, and the flex skip list shrinks to grid-rooted fixtures only.

## Impact

- New: `src/compute/block.ts`; vendored `tests/fixtures/block/` and `tests/fixtures/blockflex/`.
- Modified: `src/tree.ts` (LayoutOutput margin fields, LayoutInput flag), `src/compute/dispatch.ts` (block routing), `src/compute/leaf.ts` (collapse-through output), `src/index.ts` (block root sizing), `src/style.ts` (`textAlign`), test harness style mapping and skip list.
- No new dependencies. Flexbox behavior must not regress: the existing 2,236 passing fixtures stay green.
