// Public API: plain-object node trees + computeLayout.
// Root layout and rounding are ports of compute_root_layout / round_layout
// from taffy/src/compute/mod.rs.

import type { Size } from './geometry.js';
import { applyAspectRatioClamped } from './geometry.js';
import { mMax, round } from './math.js';
import type { Opt } from './math.js';
import { asIntoOption, maybeResolveSize, resolveRectOrZero } from './style.js';
import type { AvailableSpace, Style } from './style.js';
import { LayoutNode, internals, resolveMarginSet } from './tree.js';
import type { Layout, Line } from './tree.js';
import { measureChildSize, performChildLayout } from './compute/dispatch.js';

// --- Public surface (curated; see tests/api.test.ts export snapshot) --------
// Values: the node class, the layout entry point, the validation error.
// Types: the style/geometry/layout vocabulary needed to construct styles and
// read results. Engine helpers stay module-internal (import from src modules
// directly in tests/scripts; they are not part of the npm surface).

export { LayoutNode } from './tree.js';
export type { Layout, MeasureFunction } from './tree.js';
export { InvalidStyleError } from './style.js';
export type {
  // core style vocabulary
  Style,
  StyleInput,
  EdgesInput,
  GapInput,
  OverflowInput,
  Dimension,
  LengthPercentage,
  LengthPercentageAuto,
  AvailableSpace,
  Display,
  BoxSizing,
  Direction,
  Position,
  Overflow,
  FlexWrap,
  TextAlign,
  // alignment
  AlignItems,
  AlignItemsKeyword,
  AlignContent,
  AlignContentKeyword,
  AlignSelf,
  JustifyContent,
  // grid
  MinTrackSizingFunction,
  MaxTrackSizingFunction,
  TrackSizingFunction,
  RepetitionCount,
  GridTemplateComponent,
  GridAutoFlow,
  GridPlacement,
  GridPlacementLine,
} from './style.js';
export type { Size, Rect, Point, FlexDirection } from './geometry.js';
export type { Opt } from './math.js';

/** Options for {@link computeLayout}. */
export interface ComputeLayoutOptions {
  /**
   * Snap the final layout to whole pixels, the way a browser paints.
   *
   * @remarks
   * Rounding is cumulative rather than per-node: each edge is rounded in
   * viewport coordinates and sizes are derived from the rounded edges, so
   * adjacent boxes stay flush and no seams open up between them. Rounding a
   * width in isolation cannot make that guarantee.
   *
   * Turn it off when you do your own subpixel positioning — a canvas or SVG
   * renderer, or a layer that scales the tree. {@link LayoutNode.unroundedLayout}
   * exposes the exact values either way, so disabling this is only necessary if
   * you want {@link LayoutNode.layout} itself left unrounded.
   *
   * @defaultValue `true`
   */
  rounding?: boolean;
}

/**
 * Lay out a tree of nodes, sizing and positioning every node under `root`.
 *
 * @remarks
 * This is the one entry point of the library. It walks the tree, resolves each
 * node's style against its parent, and writes the result into every node —
 * read it back through {@link LayoutNode.layout}. Nothing is returned; the tree
 * itself is the output.
 *
 * Coordinates in `layout.location` are relative to the parent's border box, not
 * to the viewport. Accumulate them down the tree to paint in absolute space.
 *
 * The call is a full recompute: every cache is cleared first, so laying out the
 * same tree twice costs the same both times, and mutating a node between calls
 * always takes effect. Call it once per frame in which something changed, not
 * once per mutation.
 *
 * `availableSpace` is what the root is being laid into — the viewport, or the
 * box you have reserved for this tree. It is an upper bound rather than an
 * assignment: a root sized by content can come out smaller, and one whose
 * content does not fit can overflow it. `'max-content'` means "no constraint,
 * size to content"; `'min-content'` sizes to the narrowest the content allows.
 *
 * @param root - Node to lay out, treated as the top of the tree. It need not be
 *   the true root of a larger tree — laying out a detached subtree directly is
 *   supported and computes it as its own independent root.
 * @param availableSpace - Space the root is laid into, per axis.
 * @param options - See {@link ComputeLayoutOptions}.
 *
 * @throws {@link InvalidStyleError} if the tree contains a style value that
 *   cannot be laid out: a `repeat()` whose track count is not finite, or an
 *   explicit grid line of `0`. Both are detected during layout rather than at
 *   construction time, so it is this call that reports them.
 *
 * @example
 * Two items sharing a fixed-width row.
 * ```typescript
 * import { LayoutNode, computeLayout } from 'bento-layout';
 *
 * const left = LayoutNode.make({ flexGrow: 1 });
 * const right = LayoutNode.make({ flexGrow: 1 });
 * const root = LayoutNode.make({ width: 400, height: 300 }, [left, right]);
 *
 * computeLayout(root, { width: 'max-content', height: 'max-content' });
 *
 * left.layout.size; // { width: 200, height: 300 }
 * right.layout.location; // { x: 200, y: 0 }
 * ```
 *
 * @example
 * Sizing a tree to its content, then re-laying it out after a change.
 * ```typescript
 * const item = LayoutNode.make({ width: 120, height: 40 });
 * const root = LayoutNode.make({ flexDirection: 'column' }, [item]);
 *
 * computeLayout(root, { width: 'max-content', height: 'max-content' });
 * root.layout.size; // { width: 120, height: 40 } — shrink-wrapped
 *
 * root.appendChild(LayoutNode.make({ width: 200, height: 40 }));
 * computeLayout(root, { width: 'max-content', height: 'max-content' });
 * root.layout.size; // { width: 200, height: 80 } — widest child, stacked heights
 * ```
 *
 * @see {@link LayoutNode} for building and mutating the tree.
 */
export function computeLayout(
  root: LayoutNode,
  availableSpace: Size<AvailableSpace>,
  options: ComputeLayoutOptions = {},
): void {
  clearCaches(root);
  computeRootLayout(root, availableSpace);
  if (options.rounding ?? true) {
    roundLayout(root, 0, 0);
  } else {
    copyUnroundedLayout(root);
  }
}

function clearCaches(node: LayoutNode): void {
  const nd = internals(node);
  nd.cache.clear();
  for (const child of nd.children) clearCaches(child);
}

/** Port of compute_root_layout. */
function computeRootLayout(root: LayoutNode, availableSpace: Size<AvailableSpace>): void {
  const rootInternal = internals(root);
  let knownDimensions: Size<Opt> = { width: null, height: null };
  const parentSize: Size<Opt> = {
    width: asIntoOption(availableSpace.width),
    height: asIntoOption(availableSpace.height),
  };

  // Block roots automatically stretch-fit their width to definite available space
  if (rootInternal.style.display === 'block') {
    knownDimensions = blockRootKnownDimensions(rootInternal.style, parentSize, availableSpace);
  }

  // A root block in normal flow is an ordinary in-flow box, so its own margins
  // collapse with its children's (css2 §8.3.1). The conditions that *stop* that
  // — padding or border on the edge, a definite height, a BFC, `position:
  // absolute`, a non-block display — are all checked inside block layout, so
  // this enables the rule rather than forcing it. Chrome, a 600px block whose
  // only child is `height: 100; margin: 1px 2px 3px 4px`:
  //   plain              -> h=100  (both ends collapse through)
  //   + padding-top      -> h=106  (start blocked)
  //   + height: 200      -> h=200  (end blocked)
  //   + overflow: hidden -> h=104  (BFC)
  //   position: absolute -> h=104
  //   display: flex      -> h=104
  // Taffy passes LINE_FALSE here, so a root never collapsed at all and its
  // height absorbed the child margins.
  const rootMarginsCollapse: Line<boolean> = { start: true, end: true };

  // Recursively compute node layout
  let output = performChildLayout(
    root,
    knownDimensions,
    parentSize,
    availableSpace,
    'inherent-size',
    rootMarginsCollapse,
  );

  // A root has no parent to hand it a size, so when both style axes are `auto`
  // its inline size only becomes definite once content resolves it — after the
  // pass above. css-sizing-4 §4.2 transfers the *resolved* preferred size in
  // the ratio-determining axis through the ratio, so re-run with that width
  // known and let the normal transfer produce the block size. Re-running
  // (rather than patching `output.size`) keeps children laid out against the
  // height they actually get.
  //
  // Inline axis only: for a content-sized root Chrome resolves the width first
  // and derives the height, never the reverse — a tall narrow child keeps its
  // content height rather than widening the root.
  const rootSpecified = maybeResolveSize(rootInternal.style.size, parentSize);
  if (
    rootInternal.style.aspectRatio !== null &&
    rootSpecified.width === null &&
    rootSpecified.height === null &&
    knownDimensions.width === null &&
    knownDimensions.height === null &&
    output.size.width > 0
  ) {
    const withResolvedWidth = { width: output.size.width, height: null };
    const rerun = performChildLayout(
      root,
      withResolvedWidth,
      parentSize,
      availableSpace,
      'inherent-size',
      rootMarginsCollapse,
    );
    // Content that overflows the ratio-derived height still wins (the ratio
    // supplies an *automatic* size, not a cap), so never shrink below the
    // height the first pass measured.
    if (rerun.size.height >= output.size.height) output = rerun;
  } else if (
    rootInternal.style.aspectRatio !== null &&
    rootSpecified.width === null &&
    output.size.width > 0
  ) {
    // The mirror case: the root has no specified width, so whatever width it
    // ended up with came from the ratio (via its specified height). That width
    // is an automatic size too, so content wider than it grows the root rather
    // than overflowing — the same rule block layout applies to its children.
    // Measured in `content-size` mode so the child does not simply re-derive
    // the width from the ratio again.
    const contentWidth = measureChildSize(
      root,
      { width: null, height: null },
      parentSize,
      { width: 'min-content', height: 'max-content' },
      'content-size',
      'horizontal',
    );
    if (contentWidth > output.size.width) {
      output = performChildLayout(
        root,
        { width: contentWidth, height: knownDimensions.height },
        parentSize,
        availableSpace,
        'inherent-size',
        rootMarginsCollapse,
      );
    }
  }

  const style = rootInternal.style;
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const margin = resolveRectOrZero(style.margin, parentSize.width);
  const scrollbarSize = {
    width: style.overflow.y === 'scroll' ? style.scrollbarWidth : 0,
    height: style.overflow.x === 'scroll' ? style.scrollbarWidth : 0,
  };
  const location = {
    x:
      style.direction === 'rtl'
        ? parentSize.width !== null
          ? parentSize.width - output.size.width
          : 0
        : 0,
    // A margin that collapsed *through* the root's top edge is outside the
    // root's own box, so it offsets the root rather than growing it — Chrome
    // puts a block whose first child has `margin-top: 20` at y=20, height
    // unchanged. `output.topMargin` is that already-collapsed set; when the
    // root does not collapse (absolute, BFC, padding/border) it holds the
    // root's own margin, which does not move it, so guard on the same flag.
    y: rootMarginsCollapse.start ? resolveMarginSet(output.topMargin) : 0,
  };

  rootInternal.unroundedLayout = {
    order: 0,
    location,
    size: output.size,
    contentSize: output.contentSize,
    scrollbarSize,
    padding,
    border,
    margin,
  };
}

/**
 * Chrome stores layout coordinates as `LayoutUnit` — fixed point in 1/64 px —
 * so a position is quantized to 1/64 *before* being rounded to a device pixel.
 * That second quantization is visible whenever the exact position lands within
 * 1/64 of a .5 boundary: it snaps onto the tie and the rounding then goes the
 * other way. (WPT `grid-flexible-track-free-space-distribution`: 99 `1fr`
 * tracks in 100px put two boundaries at exactly x.5 after snapping.)
 *
 * The truncation is toward the *flow's* start edge, not toward zero, so under
 * RTL it rounds the physical coordinate up. Truncating toward zero in both
 * directions puts those two boundaries a pixel off in RTL only.
 */
const LAYOUT_UNIT = 64;
function snapLU(v: number, towardPositive: boolean): number {
  return (towardPositive ? Math.ceil(v * LAYOUT_UNIT) : Math.floor(v * LAYOUT_UNIT)) / LAYOUT_UNIT;
}

/**
 * Port of round_layout: rounds based on cumulative viewport-relative coordinates
 * and derives sizes from rounded edges so no gaps are introduced.
 */
function roundLayout(node: LayoutNode, cumulativeX: number, cumulativeY: number, parentIsRtl = false): void {
  const nd = internals(node);
  const u = nd.unroundedLayout;
  const cx = cumulativeX + u.location.x;
  const cy = cumulativeY + u.location.y;

  // The x snap follows the flow of the box's *containing* block, which is what
  // positioned it; y always flows downward.
  const roundX = (v: number): number => Math.round(snapLU(v, parentIsRtl));
  const roundY = (v: number): number => Math.round(snapLU(v, false));

  const layout: Layout = {
    order: u.order,
    location: { x: roundX(u.location.x), y: roundY(u.location.y) },
    size: {
      width: roundX(cx + u.size.width) - roundX(cx),
      height: roundY(cy + u.size.height) - roundY(cy),
    },
    contentSize: {
      width: round(cx + u.contentSize.width) - round(cx),
      height: round(cy + u.contentSize.height) - round(cy),
    },
    scrollbarSize: {
      width: round(u.scrollbarSize.width),
      height: round(u.scrollbarSize.height),
    },
    border: {
      left: round(cx + u.border.left) - round(cx),
      right: round(cx + u.size.width) - round(cx + u.size.width - u.border.right),
      top: round(cy + u.border.top) - round(cy),
      bottom: round(cy + u.size.height) - round(cy + u.size.height - u.border.bottom),
    },
    padding: {
      left: round(cx + u.padding.left) - round(cx),
      right: round(cx + u.size.width) - round(cx + u.size.width - u.padding.right),
      top: round(cy + u.padding.top) - round(cy),
      bottom: round(cy + u.size.height) - round(cy + u.size.height - u.padding.bottom),
    },
    margin: { ...u.margin },
  };

  nd.layout = layout;

  const childrenAreRtl = nd.style.direction === 'rtl';
  for (const child of nd.children) {
    roundLayout(child, cx, cy, childrenAreRtl);
  }
}

/** Port of the `is_block` branch of compute_root_layout. */
function blockRootKnownDimensions(
  style: Style,
  parentSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
): Size<Opt> {
  const aspectRatio = style.aspectRatio;
  const margin = resolveRectOrZero(style.margin, parentSize.width);
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorderSize = {
    width: padding.left + padding.right + border.left + border.right,
    height: padding.top + padding.bottom + border.top + border.bottom,
  };
  const boxSizingAdjustment =
    style.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };

  const resolveAxis = (v: Opt, adj: number): Opt => (v !== null ? v + adj : null);

  // Min/max stay on their own axis: pushing them through the ratio invents a
  // bound on the other axis that then clamps a size specified there
  // (`height: 200; aspect-ratio: 2; max-width: 3` is 3x200, not 3x2). The ratio
  // derives from the clamped specified size instead — which still re-derives
  // the partner for a same-axis clamp (`width: 200; max-width: 3` -> 3x2).
  const minSize = maybeResolveSize(style.minSize, parentSize);
  const minSizeAdj: Size<Opt> = {
    width: resolveAxis(minSize.width, boxSizingAdjustment.width),
    height: resolveAxis(minSize.height, boxSizingAdjustment.height),
  };
  const maxSize = maybeResolveSize(style.maxSize, parentSize);
  const maxSizeAdj: Size<Opt> = {
    width: resolveAxis(maxSize.width, boxSizingAdjustment.width),
    height: resolveAxis(maxSize.height, boxSizingAdjustment.height),
  };
  const rawStyleSize = maybeResolveSize(style.size, parentSize);
  const clampedStyleSize: Size<Opt> = applyAspectRatioClamped(
    {
      width: resolveAxis(rawStyleSize.width, boxSizingAdjustment.width),
      height: resolveAxis(rawStyleSize.height, boxSizingAdjustment.height),
    },
    minSizeAdj,
    maxSizeAdj,
    aspectRatio,
    boxSizingAdjustment,
  );

  // If both min and max in a given axis are set and max <= min then this determines the size
  const minMaxDefiniteSize: Size<Opt> = {
    width:
      minSizeAdj.width !== null && maxSizeAdj.width !== null && maxSizeAdj.width <= minSizeAdj.width
        ? minSizeAdj.width
        : null,
    height:
      minSizeAdj.height !== null && maxSizeAdj.height !== null && maxSizeAdj.height <= minSizeAdj.height
        ? minSizeAdj.height
        : null,
  };

  // Block nodes automatically stretch-fit their width to available space if it is definite
  const availableSpaceBasedSize: Size<Opt> = {
    width:
      asIntoOption(availableSpace.width) !== null
        ? (asIntoOption(availableSpace.width) as number) - margin.left - margin.right
        : null,
    height: null,
  };

  return {
    width: mMax(
      minMaxDefiniteSize.width ?? clampedStyleSize.width ?? availableSpaceBasedSize.width,
      paddingBorderSize.width,
    ),
    height: mMax(
      minMaxDefiniteSize.height ?? clampedStyleSize.height ?? availableSpaceBasedSize.height,
      paddingBorderSize.height,
    ),
  };
}

function copyUnroundedLayout(node: LayoutNode): void {
  const nd = internals(node);
  nd.layout = {
    ...nd.unroundedLayout,
    location: { ...nd.unroundedLayout.location },
    size: { ...nd.unroundedLayout.size },
  };
  for (const child of nd.children) copyUnroundedLayout(child);
}
