// Public API: plain-object node trees + computeLayout.
// Root layout and rounding are ports of compute_root_layout / round_layout
// from taffy/src/compute/mod.rs.

import type { Size } from './geometry.js';
import { applyAspectRatioClamped } from './geometry.js';
import { mClamp, mMax, round } from './math.js';
import type { Opt } from './math.js';
import { asIntoOption, maybeResolveSize, resolveRectOrZero, resolveStyle } from './style.js';
import type { AvailableSpace, Style } from './style.js';
import { Cache, layoutWithOrder } from './tree.js';
import type { Layout, MeasureFunction, Node } from './tree.js';
import { performChildLayout } from './compute/dispatch.js';

export * from './geometry.js';
export * from './style.js';
export type { Layout, LayoutInput, LayoutOutput, MeasureFunction, Node, RunMode, SizingMode } from './tree.js';

export interface NodeOptions {
  style?: Partial<Style>;
  children?: Node[];
  measure?: MeasureFunction;
}

/** Create a layout node from a partial style and optional children/measure function. */
export function createNode(options: NodeOptions = {}): Node {
  return {
    style: resolveStyle(options.style),
    children: options.children ?? [],
    measure: options.measure,
    unroundedLayout: layoutWithOrder(0),
    layout: layoutWithOrder(0),
    cache: new Cache(),
  };
}

export interface ComputeLayoutOptions {
  /** Snap the final layout to whole pixels (defaults to true, like browsers). */
  rounding?: boolean;
}

/**
 * Compute layout for a tree of nodes. Results are stored on each node's
 * `layout` property (and `unroundedLayout` for the pre-rounding values).
 */
export function computeLayout(
  root: Node,
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

function clearCaches(node: Node): void {
  node.cache.clear();
  for (const child of node.children) clearCaches(child);
}

/** Port of compute_root_layout. */
function computeRootLayout(root: Node, availableSpace: Size<AvailableSpace>): void {
  let knownDimensions: Size<Opt> = { width: null, height: null };
  const parentSize: Size<Opt> = {
    width: asIntoOption(availableSpace.width),
    height: asIntoOption(availableSpace.height),
  };

  // Block roots automatically stretch-fit their width to definite available space
  if (root.style.display === 'block') {
    knownDimensions = blockRootKnownDimensions(root.style, parentSize, availableSpace);
  }

  // Recursively compute node layout
  const output = performChildLayout(root, knownDimensions, parentSize, availableSpace, 'inherent-size');

  const style = root.style;
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
    y: 0,
  };

  root.unroundedLayout = {
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
 * Port of round_layout: rounds based on cumulative viewport-relative coordinates
 * and derives sizes from rounded edges so no gaps are introduced.
 */
function roundLayout(node: Node, cumulativeX: number, cumulativeY: number): void {
  const u = node.unroundedLayout;
  const cx = cumulativeX + u.location.x;
  const cy = cumulativeY + u.location.y;

  const layout: Layout = {
    order: u.order,
    location: { x: round(u.location.x), y: round(u.location.y) },
    size: {
      width: round(cx + u.size.width) - round(cx),
      height: round(cy + u.size.height) - round(cy),
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

  node.layout = layout;

  for (const child of node.children) {
    roundLayout(child, cx, cy);
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

function copyUnroundedLayout(node: Node): void {
  node.layout = {
    ...node.unroundedLayout,
    location: { ...node.unroundedLayout.location },
    size: { ...node.unroundedLayout.size },
  };
  for (const child of node.children) copyUnroundedLayout(child);
}
