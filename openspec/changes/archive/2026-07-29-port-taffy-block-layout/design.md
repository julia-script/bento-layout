## Context

Follows the archived `port-taffy-flexbox` change; see its design for the established porting conventions (1:1 module mapping to the Rust source, plain-object data model, fixture pass-count as progress metric). Reference is the same pinned Taffy clone (commit in `tests/fixtures/TAFFY_COMMIT`). Taffy's `compute/block.rs` is 1,419 lines; the float/clear paths inside it are feature-gated (`float_layout`) and none of the 896 target fixtures exercise them. The flexbox port deliberately dropped block-only machinery (margin-collapse fields, the collapsible-margins layout input, block root sizing) that must now be restored.

## Goals / Non-Goals

**Goals:**
- `src/compute/block.ts` mapping section-by-section to `compute/block.rs` (minus `float_layout` blocks).
- All 868 `block` + 28 `blockflex` fixtures passing; flex suite stays at 2,236 passing with the 12 block-rooted skips removed.
- Margin-collapsing data flow restored end-to-end (leaf → block → root) without disturbing flexbox results.

**Non-Goals:**
- Floats and `clear` (fixture-unused, feature-gated upstream), CSS Grid, `calc()`, inline-level layout, `text-align: justify`.

## Decisions

1. **Restore Taffy's LayoutOutput/LayoutInput shape rather than special-casing block.** Add `topMargin`/`bottomMargin` (`CollapsibleMarginSet` as a tiny `{positive, negative}` object) and `marginsCanCollapseThrough` to `LayoutOutput`, and `verticalMarginsAreCollapsible: {start, end}` to `LayoutInput`. Flexbox call sites pass the zero/false constants exactly as the Rust does (`Line::FALSE`, `CollapsibleMarginSet::ZERO`). Alternative — side-channel margin info — rejected: diverges from the Rust and the cache key/protocol would no longer be comparable line-by-line.
2. **Cache key gains the collapsible-margins flag only if Taffy's does.** Taffy's `CacheKey` ignores `vertical_margins_are_collapsible`; ours continues to ignore it. Any block-specific cache-correctness quirks upstream are ported as-is.
3. **Dispatch: `display: 'block'` with children → `computeBlockLayout`; leaf and `display: 'grid'` behavior unchanged.** The `ponytail:` fall-through comment in dispatch.ts narrows to grid only.
4. **Root sizing: port the `is_block` branch of `compute_root_layout`** (block roots stretch width to definite available space minus margins, floored by padding+border) — this is exactly what the currently-skipped `blitz_issue_88` needs.
5. **`textAlign` style field**: `'auto' | 'legacy-left' | 'legacy-right' | 'legacy-center'` mirroring Taffy's `TextAlign`, parsed in the harness from `-webkit-*` values.
6. **BlockContext/BlockFormattingContext**: Taffy threads an optional `BlockContext` through `compute_block_child_layout` for float support. With floats out of scope, port the degenerate no-context path only (as upstream does when `float_layout` is disabled).
7. **Fixture layout**: vendor into `tests/fixtures/block/` and `tests/fixtures/blockflex/`; generalize `tests/fixtures.test.ts` to iterate the three directories with one shared runner and a per-directory skip list.

## Risks / Trade-offs

- [Margin-collapsing plumbing touches shared types (`LayoutOutput`) used by flexbox] → Flex call sites keep passing the zero constants; the untouched flex fixture suite (2,236 green) is the regression gate on every step.
- [Collapse-through logic in `leaf.ts` was partially dropped (`has_styles_preventing_being_collapsed_through` exists but its output field was removed)] → Restore the field; the existing computation is already faithful, so this is low-risk re-wiring.
- [`blockflex` fixtures exercise flex-inside-block sizing negotiation (min/max-content widths of flex containers under block constraints)] → These paths already exist in the flexbox port's `compute-size` mode; fixtures will catch any gaps.
- [Only 28 blockflex fixtures — mixed-tree coverage is thinner than pure-block coverage] → Acceptable; upstream has the same ratio, and the 12 un-skipped flex fixtures add more mixed cases.

## Open Questions

(none — scope and approach follow the established flexbox-port conventions)
