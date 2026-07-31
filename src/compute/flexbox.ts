// Port of taffy/src/compute/flexbox.rs — the CSS Flexible Box Layout algorithm.
// Function names and section comments follow the Rust source for traceability.

import type { FlexDirection, Point, Rect, Size } from '../geometry.js';
import {
  applyAspectRatioClamped,
  cross,
  crossAxis,
  isReverse,
  isRow as dirIsRow,
  isColumn as dirIsColumn,
  main,
  mainAxis,
  maybeApplyAspectRatio,
  rectAdd,
  rectCrossAxisSum,
  rectCrossEnd,
  rectCrossStart,
  rectMainAxisSum,
  rectMainEnd,
  rectMainStart,
  setCross,
  setMain,
  sizeFromCross,
  sizeMax,
  sizeZero,
  sumAxes,
  withCross,
  withMain,
} from '../geometry.js';
import { isNormal, mAdd, mClamp, mMax, mMin, mSub, vClamp, vMax, vMin, vSub } from '../math.js';
import type { Opt } from '../math.js';
import {
  ALIGN_CONTENT_STRETCH,
  ALIGN_STRETCH,
  asIntoOption,
  asMapDefinite,
  asMaybeClamp,
  asMaybeSet,
  asMaybeSub,
  isScrollContainer,
  maybeResolve,
  maybeResolveRectPerAxis,
  maybeResolveSize,
  overflowAutoMinSize,
  resolveRectOrZero,
  resolveSizeOrZero,
} from '../style.js';
import type {
  AlignContent,
  AlignItems,
  AvailableSpace,
  Direction,
  JustifyContent,
  Overflow,
  Style,
} from '../style.js';
import type { LayoutInput, LayoutOutput, Node } from '../tree.js';
import { fromOuterSize, fromSizesAndBaselines, layoutWithOrder } from '../tree.js';
import {
  applyAlignmentFallback,
  computeAlignmentOffset,
  computeContentSizeContribution,
  resolveSelfAlignmentSafety,
} from './alignment.js';
import { measureChildSize, measureChildSizeBoth, performChildLayout } from './dispatch.js';

/** The intermediate results of a flexbox calculation for a single item */
/**
 * Per-pass working state for one in-flow child.
 *
 * Fields fall into two classes, and a new field MUST be added to the right one:
 *
 * - **Resolved-from-style** — derived from the child's style and the container's
 *   inner size. Stable for as long as those two inputs are, and recomputed by
 *   `generateAnonymousFlexItems`.
 * - **Per-pass** — working state the algorithm writes as it runs. Items are
 *   rebuilt for every pass, so these always start fresh. Anything that reuses
 *   items across passes must reset all of them, and note that the four size
 *   fields are mutated *in place* (via `setMain`/`setCross`), so resetting
 *   those means overwriting both components rather than reassigning the object.
 *
 * Reusing items across passes was tried and reverted: containers are measured
 * under many different inner sizes within a single layout, so a memo keyed on
 * that size hit only ~29% of the time and measured slightly net-negative.
 */
interface FlexItem {
  // --- Resolved-from-style ---
  node: Node;
  order: number;

  size: Size<Opt>;
  minSize: Size<Opt>;
  maxSize: Size<Opt>;
  aspectRatio: number | null;
  alignSelf: AlignItems;

  overflow: Point<Overflow>;
  scrollbarWidth: number;
  flexShrink: number;
  flexGrow: number;

  inset: Rect<Opt>;
  margin: Rect<number>;
  marginIsAuto: Rect<boolean>;
  padding: Rect<number>;
  border: Rect<number>;

  // --- Per-pass (must be reset on reuse) ---
  resolvedMinimumMainSize: number;

  flexBasis: number;
  /** `flex-basis` was specified (not `auto`), so it replaces the style main size. */
  flexBasisIsExplicit: boolean;
  innerFlexBasis: number;
  violation: number;
  frozen: boolean;

  contentFlexFraction: number;

  /** Mutated in place by setMain/setCross. */
  hypotheticalInnerSize: Size<number>;
  /** Mutated in place by setMain/setCross. */
  hypotheticalOuterSize: Size<number>;
  /**
   * This item's cross size came from its own `aspect-ratio` applied to its
   * main size, so it cannot act as a content floor for the container's
   * ratio-derived cross size — the main size it derives from depends on that
   * cross size in turn. See determineContainerCrossSize.
   */
  crossIsArDerived: boolean;
  /** Mutated in place by setMain/setCross. */
  targetSize: Size<number>;
  /** Mutated in place by setMain/setCross. */
  outerTargetSize: Size<number>;

  baseline: number;

  offsetMain: number;
  offsetCross: number;
}

function itemIsScrollContainer(item: FlexItem): boolean {
  return isScrollContainer(item.overflow.x) || isScrollContainer(item.overflow.y);
}

/** A line of FlexItems used for intermediate computation */
interface FlexLine {
  items: FlexItem[];
  crossSize: number;
  offsetCross: number;
}

/** Values that can be cached during the flexbox algorithm */
interface AlgoConstants {
  dir: FlexDirection;
  layoutDirection: Direction;
  isRow: boolean;
  isColumn: boolean;
  isWrap: boolean;
  isWrapReverse: boolean;

  minSize: Size<Opt>;
  maxSize: Size<Opt>;
  margin: Rect<number>;
  border: Rect<number>;
  contentBoxInset: Rect<number>;
  scrollbarGutter: Point<number>;
  gap: Size<number>;
  alignItems: AlignItems;
  alignContent: AlignContent;
  justifyContent: JustifyContent | null;

  nodeOuterSize: Size<Opt>;
  nodeInnerSize: Size<Opt>;

  /**
   * The cross size came from `aspect-ratio` rather than from a specified size
   * in that axis, making it an *automatic* size (css-sizing-4 §4.2): content
   * larger than it grows the container instead of overflowing. See
   * UPSTREAM_TAFFY.md entry 30 for the Chrome matrix and the
   * scroll-container carve-out.
   */
  crossIsRatioDerived: boolean;

  containerSize: Size<number>;
  innerContainerSize: Size<number>;
}

/** Computes the layout of a box according to the flexbox algorithm */
export function computeFlexboxLayout(node: Node, inputs: LayoutInput): LayoutOutput {
  const { knownDimensions, parentSize, runMode } = inputs;
  const style = node.style;

  const aspectRatio = style.aspectRatio;
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorderSum = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSum : sizeZero();

  // Min/max stay on their own axis and the ratio derives from the *clamped*
  // specified size — see block.ts and UPSTREAM_TAFFY.md entry 23. Applying the
  // ratio first and clamping after (the old order here) transfers a bound onto
  // the other axis: `height: 200; aspect-ratio: 2; max-width: 3` is 3x200 in
  // Chrome for every display type, not 3x2.
  const minSize = maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
  const clampedStyleSize: Size<Opt> =
    inputs.sizingMode === 'inherent-size'
      ? applyAspectRatioClamped(
          maybeAddSize(maybeResolveSize(style.size, parentSize), boxSizingAdjustment),
          minSize,
          maxSize,
          aspectRatio,
        )
      : { width: null, height: null };

  // If both min and max in a given axis are set and max <= min then this determines the size in that axis
  const minMaxDefiniteSize: Size<Opt> = {
    width: minSize.width !== null && maxSize.width !== null && maxSize.width <= minSize.width ? minSize.width : null,
    height:
      minSize.height !== null && maxSize.height !== null && maxSize.height <= minSize.height ? minSize.height : null,
  };

  // css-sizing-4: a definite size in one axis transfers through `aspect-ratio`.
  // `clampedStyleSize` above can only transfer between *style* sizes, so a
  // container whose width is definite solely because the parent said so (both
  // style axes `auto`) never got its ratio-derived height and fell back to the
  // content height — collapsing an `aspect-ratio` flex container to 0 as soon
  // as it had any child. Block layout already does this (block.ts).
  const derivedFromKnown = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);

  // The size of the container should be floored by the padding and border
  const styledBasedKnownDimensions: Size<Opt> = {
    width:
      knownDimensions.width ??
      mMax(minMaxDefiniteSize.width ?? clampedStyleSize.width ?? derivedFromKnown.width, paddingBorderSum.width),
    height:
      knownDimensions.height ??
      mMax(minMaxDefiniteSize.height ?? clampedStyleSize.height ?? derivedFromKnown.height, paddingBorderSum.height),
  };

  // Short-circuit layout if the container's size is fully determined by the container's size and the run mode
  // is ComputeSize (and thus the container's size is all that we're interested in)
  if (runMode === 'compute-size') {
    if (styledBasedKnownDimensions.width !== null && styledBasedKnownDimensions.height !== null) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: styledBasedKnownDimensions.height });
    }
    // We can also short-circuit if the width is known and only the width has been requested.
    if (inputs.axis === 'horizontal' && styledBasedKnownDimensions.width !== null) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: 0 });
    }
  }

  return computePreliminary(node, { ...inputs, knownDimensions: styledBasedKnownDimensions });
}

/** Compute a preliminary size for an item */
function computePreliminary(node: Node, inputs: LayoutInput): LayoutOutput {
  const { knownDimensions, parentSize, availableSpace: outerAvailableSpace, runMode } = inputs;

  // Define some general constants we will need for the remainder of the algorithm.
  const constants = computeConstants(node.style, knownDimensions, parentSize);

  // 9. Flex Layout Algorithm

  // 9.1. Initial Setup

  // 1. Generate anonymous flex items as described in §4 Flex Items.
  const flexItems = generateAnonymousFlexItems(node, constants);

  // 9.2. Line Length Determination

  // 2. Determine the available main and cross space for the flex items
  const availableSpace = determineAvailableSpace(knownDimensions, outerAvailableSpace, constants);

  // 3. Determine the flex base size and hypothetical main size of each item.
  determineFlexBaseSize(constants, availableSpace, flexItems);

  // 4. Determine the main size of the flex container
  // This has already been done as part of compute_constants. The inner size is exposed as constants.node_inner_size.

  // 9.3. Main Size Determination

  // 5. Collect flex items into flex lines.
  const flexLines = collectFlexLines(constants, availableSpace, flexItems);

  // If container size is undefined, determine the container's main size
  // and then re-resolve gaps based on newly determined size
  const knownInnerMainSize = main(constants.nodeInnerSize, constants.dir);
  if (knownInnerMainSize !== null) {
    const outerMainSize = knownInnerMainSize + rectMainAxisSum(constants.contentBoxInset, constants.dir);
    setMain(constants.innerContainerSize, constants.dir, knownInnerMainSize);
    setMain(constants.containerSize, constants.dir, outerMainSize);
  } else {
    // Sets constants.container_size and constants.outer_container_size
    determineContainerMainSize(availableSpace, flexLines, constants);
    setMain(constants.nodeInnerSize, constants.dir, main(constants.innerContainerSize, constants.dir));
    setMain(constants.nodeOuterSize, constants.dir, main(constants.containerSize, constants.dir));

    // Re-resolve percentage gaps
    const innerContainerSize = main(constants.innerContainerSize, constants.dir);
    const newGap = maybeResolve(main(node.style.gap, constants.dir), innerContainerSize) ?? 0;
    setMain(constants.gap, constants.dir, newGap);
  }

  // 6. Resolve the flexible lengths of all the flex items to find their used main size.
  for (const line of flexLines) {
    resolveFlexibleLengths(line, constants);
  }

  // 9.4. Cross Size Determination

  // 7. Determine the hypothetical cross size of each item.
  for (const line of flexLines) {
    determineHypotheticalCrossSize(line, constants, availableSpace);
  }

  // Calculate child baselines. This function is internally smart and only computes child baselines
  // if they are necessary.
  calculateChildrenBaseLines(knownDimensions, availableSpace, flexLines, constants);

  // 8. Calculate the cross size of each flex line.
  calculateCrossSize(flexLines, knownDimensions, constants);

  // 9. Handle 'align-content: stretch'.
  handleAlignContentStretch(flexLines, knownDimensions, constants);

  // 10. Collapse visibility:collapse items. (Not implemented — as in taffy.)

  // 11. Determine the used cross size of each flex item.
  determineUsedCrossSize(flexLines, constants);

  // 9.5. Main-Axis Alignment

  // 12. Distribute any remaining free space.
  distributeRemainingFreeSpace(flexLines, constants);

  // 9.6. Cross-Axis Alignment

  // 13. Resolve cross-axis auto margins (also includes 14).
  resolveCrossAxisAutoMargins(flexLines, constants);

  // 15. Determine the flex container's used cross size.
  const totalLineCrossSize = determineContainerCrossSize(flexLines, knownDimensions, constants);

  // We have the container size.
  // If our caller does not care about performing layout we are done now.
  if (runMode === 'compute-size') {
    return fromOuterSize(constants.containerSize);
  }

  // 16. Align all flex lines per align-content.
  alignFlexLinesPerAlignContent(flexLines, constants, totalLineCrossSize);

  // Do a final layout pass and gather the resulting layouts
  const inflowContentSize = finalLayoutPass(flexLines, constants);

  // Before returning we perform absolute layout on all absolutely positioned children
  const absoluteContentSize = performAbsoluteLayoutOnAbsoluteChildren(node, constants);

  // Hidden layout for display:none children
  for (let order = 0; order < node.children.length; order++) {
    const child = node.children[order]!;
    if (child.style.display === 'none') {
      child.unroundedLayout = layoutWithOrder(order);
      performChildLayout(
        child,
        { width: null, height: null },
        { width: null, height: null },
        { width: 'max-content', height: 'max-content' },
        'inherent-size',
      );
    }
  }

  // 8.5. Flex Container Baselines: calculate the flex container's first baseline
  // See https://www.w3.org/TR/css-flexbox-1/#flex-baselines
  let firstVerticalBaseline: Opt = null;
  if (flexLines.length > 0 && flexLines[0]!.items.length > 0) {
    const firstLine = flexLines[0]!;
    const child =
      firstLine.items.find(
        (item) => constants.isColumn || (item.alignSelf.keyword === 'baseline' && !item.alignSelf.safe),
      ) ?? firstLine.items[0]!;
    const offsetVertical = constants.isRow ? child.offsetCross : child.offsetMain;
    firstVerticalBaseline = offsetVertical + child.baseline;
  }

  return fromSizesAndBaselines(constants.containerSize, sizeMax(inflowContentSize, absoluteContentSize), {
    x: null,
    y: firstVerticalBaseline,
  });
}

/** Compute constants that can be reused during the flexbox algorithm. */
function computeConstants(style: Style, knownDimensions: Size<Opt>, parentSize: Size<Opt>): AlgoConstants {
  const dir = style.flexDirection;
  const isRow = dirIsRow(dir);
  const isColumn = dirIsColumn(dir);
  const isWrap = style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse';
  const isWrapReverse = style.flexWrap === 'wrap-reverse';

  const aspectRatio = style.aspectRatio;
  const margin = resolveRectOrZero(style.margin, parentSize.width);
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorderSum = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSum : sizeZero();

  const alignItems = style.alignItems ?? ALIGN_STRETCH;
  const alignContent = style.alignContent ?? ALIGN_CONTENT_STRETCH;
  const justifyContent = style.justifyContent;
  const layoutDirection = style.direction;

  // Scrollbar gutters are reserved when the `overflow` property is set to `Overflow::Scroll`.
  // Axes are transposed: a node that scrolls vertically needs horizontal space reserved.
  const scrollbarGutter = {
    x: style.overflow.y === 'scroll' ? style.scrollbarWidth : 0,
    y: style.overflow.x === 'scroll' ? style.scrollbarWidth : 0,
  };
  const contentBoxInset = rectAdd(padding, border);
  contentBoxInset.bottom += scrollbarGutter.y;
  if (layoutDirection === 'rtl') {
    contentBoxInset.left += scrollbarGutter.x;
  } else {
    contentBoxInset.right += scrollbarGutter.x;
  }

  const nodeOuterSize: Size<Opt> = { ...knownDimensions };
  const nodeInnerSize: Size<Opt> = {
    width: mSub(nodeOuterSize.width, horizontalSum(contentBoxInset)),
    height: mSub(nodeOuterSize.height, verticalSum(contentBoxInset)),
  };
  const gap = resolveSizeOrZero(style.gap, {
    width: nodeInnerSize.width ?? 0,
    height: nodeInnerSize.height ?? 0,
  });

  return {
    dir,
    layoutDirection,
    isRow,
    isColumn,
    isWrap,
    isWrapReverse,
    // Min/max stay on their own axis — see the matching note in block.ts
    // (UPSTREAM_TAFFY.md entry 23). Pushing them through the ratio invents a
    // bound on the other axis: `height: 200; aspect-ratio: 2; max-width: 3` is
    // 3x200 in Chrome for flex, block and grid alike, but a transferred
    // max-height of 1.5 shrank the height instead.
    minSize: maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment),
    maxSize: maybeAddSize(
      maybeResolveSize(style.maxSize, parentSize),
      boxSizingAdjustment,
    ),
    margin,
    border,
    gap,
    contentBoxInset,
    scrollbarGutter,
    alignItems,
    alignContent,
    justifyContent,
    nodeOuterSize,
    nodeInnerSize,
    crossIsRatioDerived:
      aspectRatio !== null &&
      cross(nodeOuterSize, dir) !== null &&
      cross(maybeResolveSize(style.size, parentSize), dir) === null &&
      !isScrollContainer(isRow ? style.overflow.y : style.overflow.x),
    containerSize: sizeZero(),
    innerContainerSize: sizeZero(),
  };
}

/**
 * Generate anonymous flex items.
 * # [9.1. Initial Setup](https://www.w3.org/TR/css-flexbox-1/#box-manip)
 */
function generateAnonymousFlexItems(node: Node, constants: AlgoConstants): FlexItem[] {
  const items: FlexItem[] = [];
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index]!;
    const childStyle = child.style;
    if (childStyle.position === 'absolute') continue;
    if (childStyle.display === 'none') continue;

    const aspectRatio = childStyle.aspectRatio;
    const padding = resolveRectOrZero(childStyle.padding, constants.nodeInnerSize.width);
    const border = resolveRectOrZero(childStyle.border, constants.nodeInnerSize.width);
    const pbSum = sumAxes(rectAdd(padding, border));
    const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? pbSum : sizeZero();
    items.push({
      node: child,
      order: index,
      size: maybeAddSize(
        maybeApplyAspectRatio(maybeResolveSize(childStyle.size, constants.nodeInnerSize), aspectRatio),
        boxSizingAdjustment,
      ),
      minSize: maybeAddSize(maybeResolveSize(childStyle.minSize, constants.nodeInnerSize), boxSizingAdjustment),
      maxSize: maybeAddSize(maybeResolveSize(childStyle.maxSize, constants.nodeInnerSize), boxSizingAdjustment),
      aspectRatio,

      inset: maybeResolveRectPerAxis(childStyle.inset, constants.nodeInnerSize),
      margin: resolveRectOrZero(childStyle.margin, constants.nodeInnerSize.width),
      marginIsAuto: {
        left: childStyle.margin.left === 'auto',
        right: childStyle.margin.right === 'auto',
        top: childStyle.margin.top === 'auto',
        bottom: childStyle.margin.bottom === 'auto',
      },
      padding,
      border,
      alignSelf: childStyle.alignSelf ?? constants.alignItems,
      overflow: { ...childStyle.overflow },
      scrollbarWidth: childStyle.scrollbarWidth,
      flexGrow: childStyle.flexGrow,
      flexShrink: childStyle.flexShrink,
      flexBasis: 0,
      flexBasisIsExplicit: false,
      innerFlexBasis: 0,
      violation: 0,
      frozen: false,

      resolvedMinimumMainSize: 0,
      hypotheticalInnerSize: sizeZero(),
      hypotheticalOuterSize: sizeZero(),
      crossIsArDerived: false,
      targetSize: sizeZero(),
      outerTargetSize: sizeZero(),
      contentFlexFraction: 0,

      baseline: 0,

      offsetMain: 0,
      offsetCross: 0,
    });
  }

  return items;
}

/**
 * Transfer a size between axes through an item's `aspect-ratio`.
 *
 * The ratio relates the two axes of the box named by `box-sizing`, so under
 * `content-box` it must operate on the *content* box: the source axis's
 * padding+border is stripped before the ratio is applied and the target axis's
 * is added back. Sizes flowing through the flex algorithm are border-box
 * values, so applying the ratio to them directly is correct only under
 * `border-box`.
 *
 * `direction` names which way the transfer runs, in flex-relative terms.
 */
function transferThroughRatio(
  sourceSize: number,
  child: FlexItem,
  dir: FlexDirection,
  direction: 'cross-to-main' | 'main-to-cross',
): number {
  const ratio = child.aspectRatio as number;
  const toMain = direction === 'cross-to-main';
  // Whether the *target* axis is horizontal decides which way the ratio applies:
  // aspect-ratio is width/height, so producing a width multiplies and producing
  // a height divides.
  const targetIsHorizontal = dirIsRow(dir) === toMain;
  const apply = (v: number): number => (targetIsHorizontal ? v * ratio : v / ratio);

  if (child.node.style.boxSizing !== 'content-box') return apply(sourceSize);

  const pb = rectAdd(child.padding, child.border);
  const sourcePb = toMain ? rectCrossAxisSum(pb, dir) : rectMainAxisSum(pb, dir);
  const targetPb = toMain ? rectMainAxisSum(pb, dir) : rectCrossAxisSum(pb, dir);
  return apply(Math.max(sourceSize - sourcePb, 0)) + targetPb;
}

/**
 * Determine the available main and cross space for the flex items.
 * # [9.2. Line Length Determination](https://www.w3.org/TR/css-flexbox-1/#line-sizing)
 */
function determineAvailableSpace(
  knownDimensions: Size<Opt>,
  outerAvailableSpace: Size<AvailableSpace>,
  constants: AlgoConstants,
): Size<AvailableSpace> {
  // Note: min/max/preferred size styles have already been applied to known_dimensions in the `compute` function above
  const width: AvailableSpace =
    knownDimensions.width !== null
      ? knownDimensions.width - horizontalSum(constants.contentBoxInset)
      : asMaybeSub(
          asMaybeSub(outerAvailableSpace.width, horizontalSum(constants.margin)),
          horizontalSum(constants.contentBoxInset),
        );

  const height: AvailableSpace =
    knownDimensions.height !== null
      ? knownDimensions.height - verticalSum(constants.contentBoxInset)
      : asMaybeSub(
          asMaybeSub(outerAvailableSpace.height, verticalSum(constants.margin)),
          verticalSum(constants.contentBoxInset),
        );

  return { width, height };
}

/**
 * Determine the flex base size and hypothetical main size of each item.
 * # [9.2. Line Length Determination](https://www.w3.org/TR/css-flexbox-1/#line-sizing)
 */
function determineFlexBaseSize(
  constants: AlgoConstants,
  availableSpace: Size<AvailableSpace>,
  flexItems: FlexItem[],
): void {
  const dir = constants.dir;

  for (const child of flexItems) {
    const childStyle = child.node.style;

    // Parent size for child sizing
    const crossAxisParentSize = cross(constants.nodeInnerSize, dir);
    const childParentSize = sizeFromCross(dir, crossAxisParentSize);

    // Available space for child sizing
    // Min/max sizes transferred through the aspect ratio are taken into account here
    const crossAxisMarginSum = rectCrossAxisSum(constants.margin, dir);
    // Transferred constraints only apply to axes whose preferred size is auto
    // (css-sizing-4 §5.2.2; matches Chrome). Taffy clamps unconditionally, which
    // diverges from the browser when an axis has a definite size.
    const rawStyleSize = maybeResolveSize(childStyle.size, constants.nodeInnerSize);
    const transferredMinSize = maybeApplyAspectRatio(child.minSize, child.aspectRatio);
    const transferredMaxSize = maybeApplyAspectRatio(child.maxSize, child.aspectRatio);
    if (rawStyleSize.width !== null) {
      transferredMinSize.width = child.minSize.width;
      transferredMaxSize.width = child.maxSize.width;
    }
    if (rawStyleSize.height !== null) {
      transferredMinSize.height = child.minSize.height;
      transferredMaxSize.height = child.maxSize.height;
    }
    const childMinCross = mAdd(cross(transferredMinSize, dir), crossAxisMarginSum);
    const childMaxCross = mAdd(cross(transferredMaxSize, dir), crossAxisMarginSum);

    // Clamp available space by min- and max- size
    const crossAvs = cross(availableSpace, dir);
    let crossAxisAvailableSpace: AvailableSpace;
    if (typeof crossAvs === 'number') {
      crossAxisAvailableSpace = vClamp(crossAxisParentSize ?? crossAvs, childMinCross, childMaxCross);
    } else if (crossAvs === 'min-content') {
      crossAxisAvailableSpace = childMinCross !== null ? childMinCross : 'min-content';
    } else {
      // A max-size caps the cross space but must not *become* it: substituting
      // it for the `max-content` keyword turns a ceiling into a size, and the
      // item is then measured against a space its own max invented. An item
      // whose only styles are `aspect-ratio: 1` and `max-width: 10` is 0x0 in
      // Chrome (no content, so nothing to size) but was 10x10 here — the
      // transferred max-height of 10 became the available cross space, and the
      // ratio carried it back into the main axis. Keeping `max-content` lets
      // the measure return the true content size; the max still clamps it
      // afterwards (`transferredMaxSize` is applied to the used size below).
      crossAxisAvailableSpace = 'max-content';
    }

    // Known dimensions for child sizing
    const childKnownDimensions: Size<Opt> = withMain(child.size, dir, null);
    // Clamp the definite cross size by the cross min/max sizes so that sizes
    // transferred through an intrinsic aspect ratio are based on the used cross size.
    setCross(
      childKnownDimensions,
      dir,
      mClamp(cross(childKnownDimensions, dir), cross(transferredMinSize, dir), cross(transferredMaxSize, dir)),
    );
    if (
      child.alignSelf.keyword === 'stretch' &&
      !child.alignSelf.safe &&
      !rectCrossStart(child.marginIsAuto, constants.dir) &&
      !rectCrossEnd(child.marginIsAuto, constants.dir) &&
      cross(childKnownDimensions, dir) === null
    ) {
      setCross(
        childKnownDimensions,
        dir,
        mSub(asIntoOption(crossAxisAvailableSpace), rectCrossAxisSum(child.margin, dir)),
      );
    }

    const containerWidth = main(constants.nodeInnerSize, dir);
    let boxSizingAdjustment = 0;
    if (childStyle.boxSizing === 'content-box') {
      const padding = resolveRectOrZero(childStyle.padding, containerWidth);
      const border = resolveRectOrZero(childStyle.border, containerWidth);
      boxSizingAdjustment = main(sumAxes(rectAdd(padding, border)), dir);
    }
    const flexBasis = mAdd(maybeResolve(childStyle.flexBasis, containerWidth), boxSizingAdjustment);
    // `flex-basis` other than `auto` replaces the style main size outright, so
    // that size must not resurface as a clamp on the item's intrinsic
    // contribution. See determineContainerMainSize.
    child.flexBasisIsExplicit = flexBasis !== null;

    child.flexBasis = ((): number => {
      // A. If the item has a definite used flex basis, that's the flex base size.
      // B. aspect-ratio + content basis + definite cross size: transfer the cross
      //    size through the ratio (css-flexbox-1 §9.2 step 3B). `child.size` covers
      //    this when the cross size came from the item's own style, but the cross
      //    size can also be *definite by stretching* — that value only lands in
      //    childKnownDimensions above, so read it back from there. Without this an
      //    item whose sole style is `aspect-ratio` measures its content (0) instead
      //    of transferring, e.g. `aspect-ratio: .5` in a 20x40 row is 20 wide in
      //    Chrome and was 0 here.
      const mainSize = main(child.size, dir);
      const crossKnown = cross(childKnownDimensions, dir);
      const transferredMain =
        mainSize === null && child.aspectRatio !== null && crossKnown !== null
          ? transferThroughRatio(crossKnown, child, dir, 'cross-to-main')
          : null;
      const definiteFlexBasis = flexBasis ?? mainSize ?? transferredMain;
      if (definiteFlexBasis !== null) return definiteFlexBasis;

      // C/E. Otherwise, size the item into the available space using its used flex basis
      //      in place of its main size, treating a value of content as max-content.
      const childAvailableSpace = withCross(
        withMain<AvailableSpace>(
          { width: 'max-content', height: 'max-content' },
          dir,
          main(availableSpace, dir) === 'min-content' ? 'min-content' : 'max-content',
        ),
        dir,
        crossAxisAvailableSpace,
      );

      return measureChildSize(
        child.node,
        childKnownDimensions,
        childParentSize,
        childAvailableSpace,
        'content-size',
        mainAxis(dir),
      );
    })();

    // Floor flex-basis by the padding_border_sum (floors inner_flex_basis at zero)
    // This matches Chrome and Firefox's behaviour despite being a spec violation.
    const paddingBorderSum = rectMainAxisSum(child.padding, constants.dir) + rectMainAxisSum(child.border, constants.dir);
    child.flexBasis = Math.max(child.flexBasis, paddingBorderSum);

    // The hypothetical main size is the item's flex base size clamped according to its
    // used min and max main sizes (and flooring the content box size at zero).
    child.innerFlexBasis =
      child.flexBasis - rectMainAxisSum(child.padding, constants.dir) - rectMainAxisSum(child.border, constants.dir);

    const paddingBorderAxesSums = sumAxes(rectAdd(child.padding, child.border));

    // Note: the `parent_size` in the main axis is deliberately not set (percentage size in an
    // axis should not contribute to a min-content contribution in that same axis).
    const styleMinMainSize =
      main(child.minSize, dir) ??
      main({ width: overflowAutoMinSize(child.overflow.x), height: overflowAutoMinSize(child.overflow.y) }, dir);

    child.resolvedMinimumMainSize =
      styleMinMainSize ??
      ((): number => {
        const minContentMainSize = ((): number => {
          const childAvailableSpace = withCross<AvailableSpace>(
            { width: 'min-content', height: 'min-content' },
            dir,
            crossAxisAvailableSpace,
          );
          // The *content* size suggestion must be measured without the cross
          // size imposed: with it, an item that has an `aspect-ratio` derives
          // its main size straight from the ratio and never consults its
          // content, so content wider than the ratio is invisible here. The
          // ratio's own contribution arrives separately as `transferredMain`
          // below, and the two are joined — they are distinct suggestions in
          // css-flexbox-1 §4.5, not alternatives.
          const contentMeasureKnownDimensions =
            child.aspectRatio !== null ? withCross(childKnownDimensions, dir, null) : childKnownDimensions;
          return measureChildSize(
            child.node,
            contentMeasureKnownDimensions,
            childParentSize,
            childAvailableSpace,
            'content-size',
            mainAxis(dir),
          );
        })();

        // 4.5. Automatic Minimum Size of Flex Items.
        //
        // The content-based minimum is the *content size suggestion*, joined by
        // the *transferred size suggestion* when the item's ratio has a definite
        // cross size, and capped by the *specified size suggestion*. The
        // transferred suggestion adds to the content one rather than replacing
        // it: content that overflows the ratio still floors the item.
        //
        // Verified against Chrome, all in a 20px-wide row container:
        //   ratio 2, height 320, width auto  -> floors at 640 (transferred)
        //   ratio 2, height 320, width 900   -> floors at 640 (transferred < specified)
        //   ratio 2, height 320, width 50    -> floors at  50 (specified < transferred)
        //   no ratio, width 50               -> shrinks to 20 (a specified main
        //     size is not a floor by itself; only the ratio creates one)
        // and, in a 200px block with a `aspect-ratio: 4` flex parent:
        //   ratio 1 (cross 50 -> transfers 50), content 100 -> floors at 100
        //   ratio 1, content 20                              -> floors at  50
        //   ratio 1, content 100, `min-width: 0`             -> floors at  50
        //   ratio 1, content 100, `overflow: hidden`         -> floors at  50
        // The last two are the tell that this really is the §4.5 automatic
        // minimum: both remove it, and both collapse the item back to the ratio.
        //
        // The cross size counts as definite when it comes from *stretching* as
        // well as from the item's own style, so this reads childKnownDimensions
        // (which the stretch branch above fills in) rather than the style size:
        // `aspect-ratio: 1.5` alone in a 7x7 row is 11 wide in Chrome, i.e. the
        // transferred 10.5 floors the shrink instead of collapsing to the 7px
        // container.
        //
        // Taffy min's the content suggestion against `child.size` unconditionally
        // (flexbox.rs:812-813). Because `child.size` already carries the
        // ratio-derived value, a 0 content size erases the transferred
        // suggestion entirely and the item shrinks past its ratio.
        const definiteCross = cross(childKnownDimensions, dir);
        const transferredMain =
          child.aspectRatio !== null && definiteCross !== null
            ? transferThroughRatio(definiteCross, child, dir, 'cross-to-main')
            : null;
        const sizeSuggestion =
          transferredMain !== null
            ? mMin(Math.max(transferredMain, minContentMainSize), main(rawStyleSize, dir))
            : mMin(minContentMainSize, main(child.size, dir));
        const clampedMinContentSize = mMin(sizeSuggestion, main(transferredMaxSize, dir)) as number;
        return vMax(clampedMinContentSize, main(paddingBorderAxesSums, dir));
      })();

    // Sizes transferred through the aspect ratio clamp the hypothetical main size,
    // but do not participate in resolving flexible lengths or clamping the final size.
    const hypotheticalInnerMinMain = vMax(
      vMax(child.resolvedMinimumMainSize, main(transferredMinSize, constants.dir)),
      main(paddingBorderAxesSums, constants.dir),
    );
    const hypotheticalInnerSize = vClamp(child.flexBasis, hypotheticalInnerMinMain, main(transferredMaxSize, constants.dir));
    const hypotheticalOuterSize = hypotheticalInnerSize + rectMainAxisSum(child.margin, constants.dir);

    setMain(child.hypotheticalInnerSize, constants.dir, hypotheticalInnerSize);
    setMain(child.hypotheticalOuterSize, constants.dir, hypotheticalOuterSize);
  }
}

/**
 * Collect flex items into flex lines.
 * # [9.3. Main Size Determination](https://www.w3.org/TR/css-flexbox-1/#main-sizing)
 */
function collectFlexLines(
  constants: AlgoConstants,
  availableSpace: Size<AvailableSpace>,
  flexItems: FlexItem[],
): FlexLine[] {
  if (!constants.isWrap) {
    return [{ items: flexItems, crossSize: 0, offsetCross: 0 }];
  }

  const maxMain = main(constants.maxSize, constants.dir);
  const mainAxisAvailableSpace: AvailableSpace =
    maxMain !== null
      ? vMax(asIntoOption(main(availableSpace, constants.dir)) ?? maxMain, main(constants.minSize, constants.dir))
      : main(availableSpace, constants.dir);

  if (mainAxisAvailableSpace === 'max-content') {
    // Sizing under a max-content constraint: the flex items will never wrap
    return [{ items: flexItems, crossSize: 0, offsetCross: 0 }];
  }
  if (mainAxisAvailableSpace === 'min-content') {
    // Sizing under a min-content constraint: take every wrapping opportunity,
    // so each item lands in its own line.
    //
    // Row containers only. A *column* container's min-content height is the
    // sum of its items, not the tallest one — Chrome, three items under
    // `flex-wrap: wrap` and a min-content main axis:
    //   row    (40x10 each) -> 40x30   three lines
    //   column (10x40 each) -> ...x120 one line
    // Taffy applies the split in both axes (flexbox.rs:877), which reports a
    // column container's min-content height as one item's height.
    if (constants.isRow) {
      return flexItems.map((item) => ({ items: [item], crossSize: 0, offsetCross: 0 }));
    }
    return [{ items: flexItems, crossSize: 0, offsetCross: 0 }];
  }

  const lines: FlexLine[] = [];
  let remaining = flexItems;
  const mainAxisGap = main(constants.gap, constants.dir);

  while (remaining.length > 0) {
    // Find index of the first item in the next line
    // (or the last item if all remaining items are in the current line)
    let lineLength = 0;
    let index = remaining.length;
    for (let idx = 0; idx < remaining.length; idx++) {
      const child = remaining[idx]!;
      // Gaps only occur between items (not before the first one or after the last one)
      const gapContribution = idx === 0 ? 0 : mainAxisGap;
      lineLength += main(child.hypotheticalOuterSize, constants.dir) + gapContribution;
      if (lineLength > mainAxisAvailableSpace && idx !== 0) {
        index = idx;
        break;
      }
    }

    lines.push({ items: remaining.slice(0, index), crossSize: 0, offsetCross: 0 });
    remaining = remaining.slice(index);
  }
  return lines;
}

/** Determine the container's main size (if not already known) */
function determineContainerMainSize(
  availableSpace: Size<AvailableSpace>,
  lines: FlexLine[],
  constants: AlgoConstants,
): void {
  const dir = constants.dir;
  const mainContentBoxInset = rectMainAxisSum(constants.contentBoxInset, constants.dir);

  let outerMainSize: number =
    main(constants.nodeOuterSize, constants.dir) ??
    ((): number => {
      const mainAvs = main(availableSpace, dir);
      if (typeof mainAvs === 'number') {
        const longestLineLength = lines.reduce((acc, line) => {
          const lineMainAxisGap = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
          const totalTargetSize = line.items.reduce((sum, child) => {
            const paddingBorderSum = rectMainAxisSum(rectAdd(child.padding, child.border), constants.dir);
            return (
              sum +
              Math.max(
                vMax(child.flexBasis, main(child.minSize, constants.dir)) +
                  rectMainAxisSum(child.margin, constants.dir),
                paddingBorderSum,
              )
            );
          }, 0);
          return Math.max(acc, totalTargetSize + lineMainAxisGap);
        }, 0);
        const size = longestLineLength + mainContentBoxInset;
        return lines.length > 1 ? Math.max(size, mainAvs) : size;
      }

      if (mainAvs === 'min-content' && constants.isWrap) {
        const longestLineLength = lines.reduce((acc, line) => {
          const lineMainAxisGap = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
          const totalTargetSize = line.items.reduce((sum, child) => {
            const paddingBorderSum = rectMainAxisSum(rectAdd(child.padding, child.border), constants.dir);
            // Floor by the *resolved* minimum, not the style `min-*`: with
            // `flex: 1 0 0` and no explicit min, the style min is null and the
            // basis is 0, so a wrapping container reported a min-content main
            // size of 0 and its items' content never contributed. The general
            // path below already uses resolvedMinimumMainSize, which carries
            // the §4.5 automatic minimum.
            const childMin = vMax(
              vMax(child.flexBasis, main(child.minSize, constants.dir)),
              child.resolvedMinimumMainSize,
            );
            return (
              sum + Math.max(childMin + rectMainAxisSum(child.margin, constants.dir), paddingBorderSum)
            );
          }, 0);
          return Math.max(acc, totalTargetSize + lineMainAxisGap);
        }, 0);
        return longestLineLength + mainContentBoxInset;
      }

      // MinContent | MaxContent
      let mainSize = 0;

      for (const line of lines) {
        for (const item of line.items) {
          const styleMin = main(item.minSize, constants.dir);
          const stylePreferred = main(item.size, constants.dir);
          const styleMax = main(item.maxSize, constants.dir);

          // (See the taffy source for the spec-vs-browser rationale here.)
          const clampingBasis = mMax(item.flexBasis, stylePreferred);
          // In a column with an explicit `flex-basis`, the style main size is
          // the §4.5 *specified size suggestion* — a cap on the automatic
          // minimum, never a floor. Both WPT siblings state it as a min():
          //   029: `flex: 1 0 0px; height: 500`, content 100 -> min(100,500)=100
          //   030: `flex: 1 0 0px; height:  70`, content 200 -> min(200, 70)= 70
          // Feeding it to flexBasisMin made 029 report a 500px minimum. It
          // still reaches maxMainSize below, which is what caps 030.
          const basisFloor = item.flexBasisIsExplicit && !constants.isRow ? item.flexBasis : clampingBasis;
          const flexBasisMin = item.flexShrink === 0 ? basisFloor : null;
          const flexBasisMax = item.flexGrow === 0 ? clampingBasis : null;

          const minMainSize = Math.max(
            mMax(styleMin, flexBasisMin) ?? flexBasisMin ?? item.resolvedMinimumMainSize,
            item.resolvedMinimumMainSize,
          );
          const maxMainSize = mMin(styleMax, flexBasisMax) ?? flexBasisMax ?? Infinity;

          let contentContribution: number;
          if (stylePreferred !== null && (maxMainSize <= minMainSize || maxMainSize <= stylePreferred)) {
            contentContribution =
              Math.max(Math.min(stylePreferred, maxMainSize), minMainSize) +
              rectMainAxisSum(item.margin, constants.dir);
          } else if (maxMainSize <= minMainSize) {
            contentContribution = minMainSize + rectMainAxisSum(item.margin, constants.dir);
          } else if (itemIsScrollContainer(item)) {
            contentContribution = item.flexBasis + rectMainAxisSum(item.margin, constants.dir);
          } else {
            // Parent size for child sizing
            const crossAxisParentSize = cross(constants.nodeInnerSize, dir);

            // Available space for child sizing
            const crossAxisMarginSum = rectCrossAxisSum(constants.margin, dir);
            const childMinCross = mAdd(cross(item.minSize, dir), crossAxisMarginSum);
            const childMaxCross = mAdd(cross(item.maxSize, dir), crossAxisMarginSum);
            const crossAxisAvailableSpace = asMaybeClamp(
              asMapDefinite(cross(availableSpace, dir), (val) => crossAxisParentSize ?? val),
              childMinCross,
              childMaxCross,
            );

            const childAvailableSpace = withCross(availableSpace, dir, crossAxisAvailableSpace);

            // Known dimensions for child sizing
            const childKnownDimensions: Size<Opt> = withMain(item.size, dir, null);
            if (item.alignSelf.keyword === 'stretch' && !item.alignSelf.safe && cross(childKnownDimensions, dir) === null) {
              setCross(
                childKnownDimensions,
                dir,
                mSub(asIntoOption(crossAxisAvailableSpace), rectCrossAxisSum(item.margin, dir)),
              );
            }

            // `content-size` for a *column* whose basis is explicit:
            // `inherent-size` lets the item re-read its own style main size,
            // which a specified `flex-basis` has already replaced. Chrome, two
            // `flex-grow: 1; flex-basis: 0; width: 12; height: 12` items:
            //   row    -> 24 wide, the style width still contributes
            //   column ->  0 tall, the style height does not
            // so this applies to the block axis only. Same asymmetry the
            // `constants.isRow` branch below already encodes.
            const measureMode =
              item.flexBasisIsExplicit && !constants.isRow ? 'content-size' : 'inherent-size';
            const contentMainSize =
              measureChildSize(
                item.node,
                childKnownDimensions,
                constants.nodeInnerSize,
                childAvailableSpace,
                measureMode,
                mainAxis(dir),
              ) + rectMainAxisSum(item.margin, constants.dir);

            // NOT floored by `mainContentBoxInset`. That is the *container's*
            // padding+border, and flooring a single *item's* contribution by it
            // double-counts: the same inset is added to the total below, and the
            // total is already floored by it. A container whose only styling is
            // `border-left: 55; border-right: 17` around a `flex-basis: 3` item
            // came out 144 (2x72) where Chrome gives 72; a column with 60px of
            // vertical border came out 120 where Chrome gives 63.
            //
            // Taffy has the same `.max(main_content_box_inset)` on both branches
            // (flexbox.rs:1076-1083) and its comment calls the row/column
            // asymmetry "somewhat bizarre... not found by reading the spec, but
            // by trial and error". The asymmetry that *is* real is the
            // `max(item.flex_basis)` in the column branch; the inset floor is
            // not, and removing it leaves `flex_basis_unconstraint_row`/
            // `_column` — the gentests that comment cites — passing.
            if (constants.isRow) {
              contentContribution = vClamp(contentMainSize, styleMin, styleMax);
            } else {
              // With an explicit `flex-basis`, the style main size is the §4.5
              // *specified size suggestion*: it caps the content-based minimum
              // (and, since the basis replaced it, never floors it). Both WPT
              // siblings write the rule as a min():
              //   029: height 500, content 100 -> min(100, 500) = 100
              //   030: height  70, content 200 -> min(200,  70) =  70
              // 030 needs the cap so the inner container wraps into two
              // columns instead of stacking to 200.
              const suggested =
                item.flexBasisIsExplicit && stylePreferred !== null
                  ? Math.min(contentMainSize, stylePreferred)
                  : contentMainSize;
              contentContribution = vClamp(Math.max(suggested, item.flexBasis), styleMin, styleMax);
            }
          }

          const diff = contentContribution - item.flexBasis;
          if (diff > 0) {
            item.contentFlexFraction = diff / Math.max(1, item.flexGrow);
          } else if (diff < 0) {
            const scaledShrinkFactor = Math.max(1, item.flexShrink * item.innerFlexBasis);
            item.contentFlexFraction = diff / scaledShrinkFactor;
          } else {
            item.contentFlexFraction = 0;
          }
        }

        // Add each item's flex base size to the product of its flex factor and the
        // chosen flex fraction, then clamp.
        const itemMainSizeSum = line.items.reduce((sum, item) => {
          const flexFraction = item.contentFlexFraction;

          let flexContribution: number;
          if (item.contentFlexFraction > 0) {
            flexContribution = Math.max(1, item.flexGrow) * flexFraction;
          } else if (item.contentFlexFraction < 0) {
            const scaledShrinkFactor = Math.max(1, item.flexShrink) * item.innerFlexBasis;
            flexContribution = scaledShrinkFactor * flexFraction;
          } else {
            flexContribution = 0;
          }
          const size = item.flexBasis + flexContribution;
          setMain(item.outerTargetSize, constants.dir, size);
          setMain(item.targetSize, constants.dir, size);
          return sum + size;
        }, 0);

        const gapSum = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
        mainSize = Math.max(mainSize, itemMainSizeSum + gapSum);
      }

      return mainSize + mainContentBoxInset;
    })();

  outerMainSize = Math.max(
    vClamp(outerMainSize, main(constants.minSize, constants.dir), main(constants.maxSize, constants.dir)),
    mainContentBoxInset - pointMainValue(constants.scrollbarGutter, constants.dir),
  );

  const innerMainSize = Math.max(outerMainSize - mainContentBoxInset, 0);
  setMain(constants.containerSize, constants.dir, outerMainSize);
  setMain(constants.innerContainerSize, constants.dir, innerMainSize);
  setMain(constants.nodeInnerSize, constants.dir, innerMainSize);
}

/**
 * Resolve the flexible lengths of the items within a flex line.
 * # [9.7. Resolving Flexible Lengths](https://www.w3.org/TR/css-flexbox-1/#resolve-flexible-lengths)
 */
function resolveFlexibleLengths(line: FlexLine, constants: AlgoConstants): void {
  const totalMainAxisGap = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);

  // 1. Determine the used flex factor.
  const totalHypotheticalOuterMainSize = line.items.reduce(
    (sum, child) => sum + main(child.hypotheticalOuterSize, constants.dir),
    0,
  );
  const usedFlexFactor = totalMainAxisGap + totalHypotheticalOuterMainSize;
  const growing = usedFlexFactor < (main(constants.nodeInnerSize, constants.dir) ?? 0);
  const shrinking = usedFlexFactor > (main(constants.nodeInnerSize, constants.dir) ?? 0);
  const exactlySized = !growing && !shrinking;

  // 2. Size inflexible items.
  for (const child of line.items) {
    const innerTargetSize = main(child.hypotheticalInnerSize, constants.dir);
    setMain(child.targetSize, constants.dir, innerTargetSize);

    if (
      exactlySized ||
      (child.flexGrow === 0 && child.flexShrink === 0) ||
      (growing && child.flexBasis > main(child.hypotheticalInnerSize, constants.dir)) ||
      (shrinking && child.flexBasis < main(child.hypotheticalInnerSize, constants.dir))
    ) {
      child.frozen = true;
      const outerTargetSize = innerTargetSize + rectMainAxisSum(child.margin, constants.dir);
      setMain(child.outerTargetSize, constants.dir, outerTargetSize);
    }
  }

  if (exactlySized) return;

  // 3. Calculate initial free space
  const usedSpaceInitial =
    totalMainAxisGap +
    line.items.reduce(
      (sum, child) =>
        sum +
        (child.frozen
          ? main(child.outerTargetSize, constants.dir)
          : child.flexBasis + rectMainAxisSum(child.margin, constants.dir)),
      0,
    );
  const initialFreeSpace = mSub(main(constants.nodeInnerSize, constants.dir), usedSpaceInitial) ?? 0;

  // 4. Loop
  for (;;) {
    // a. Check for flexible items
    if (line.items.every((child) => child.frozen)) break;

    // b. Calculate the remaining free space
    const usedSpace =
      totalMainAxisGap +
      line.items.reduce(
        (sum, child) =>
          sum +
          (child.frozen
            ? main(child.outerTargetSize, constants.dir)
            : child.flexBasis + rectMainAxisSum(child.margin, constants.dir)),
        0,
      );

    const unfrozen = line.items.filter((child) => !child.frozen);

    let sumFlexGrow = 0;
    let sumFlexShrink = 0;
    for (const item of unfrozen) {
      sumFlexGrow += item.flexGrow;
      sumFlexShrink += item.flexShrink;
    }

    let freeSpace: number;
    if (growing && sumFlexGrow < 1) {
      freeSpace = vMin(
        initialFreeSpace * sumFlexGrow - totalMainAxisGap,
        mSub(main(constants.nodeInnerSize, constants.dir), usedSpace),
      );
    } else if (shrinking && sumFlexShrink < 1) {
      freeSpace = vMax(
        initialFreeSpace * sumFlexShrink - totalMainAxisGap,
        mSub(main(constants.nodeInnerSize, constants.dir), usedSpace),
      );
    } else {
      freeSpace = mSub(main(constants.nodeInnerSize, constants.dir), usedSpace) ?? usedFlexFactor - usedSpace;
    }

    // c. Distribute free space proportional to the flex factors
    if (isNormal(freeSpace)) {
      if (growing && sumFlexGrow > 0) {
        for (const child of unfrozen) {
          setMain(child.targetSize, constants.dir, child.flexBasis + freeSpace * (child.flexGrow / sumFlexGrow));
        }
      } else if (shrinking && sumFlexShrink > 0) {
        let sumScaledShrinkFactor = 0;
        for (const child of unfrozen) {
          sumScaledShrinkFactor += child.innerFlexBasis * child.flexShrink;
        }

        if (sumScaledShrinkFactor > 0) {
          for (const child of unfrozen) {
            const scaledShrinkFactor = child.innerFlexBasis * child.flexShrink;
            setMain(
              child.targetSize,
              constants.dir,
              child.flexBasis + freeSpace * (scaledShrinkFactor / sumScaledShrinkFactor),
            );
          }
        }
      }
    }

    // d. Fix min/max violations.
    let totalViolation = 0;
    for (const child of unfrozen) {
      const resolvedMinMain: Opt = child.resolvedMinimumMainSize;
      const maxMain = main(child.maxSize, constants.dir);
      const clamped = Math.max(vClamp(main(child.targetSize, constants.dir), resolvedMinMain, maxMain), 0);
      child.violation = clamped - main(child.targetSize, constants.dir);
      setMain(child.targetSize, constants.dir, clamped);
      setMain(
        child.outerTargetSize,
        constants.dir,
        main(child.targetSize, constants.dir) + rectMainAxisSum(child.margin, constants.dir),
      );
      totalViolation += child.violation;
    }

    // e. Freeze over-flexed items.
    for (const child of unfrozen) {
      if (totalViolation > 0) {
        child.frozen = child.violation > 0;
      } else if (totalViolation < 0) {
        child.frozen = child.violation < 0;
      } else {
        child.frozen = true;
      }
    }
  }
}

/**
 * Determine the hypothetical cross size of each item.
 * # [9.4. Cross Size Determination](https://www.w3.org/TR/css-flexbox-1/#cross-sizing)
 */
function determineHypotheticalCrossSize(
  line: FlexLine,
  constants: AlgoConstants,
  availableSpace: Size<AvailableSpace>,
): void {
  for (const child of line.items) {
    const paddingBorderSum = rectCrossAxisSum(rectAdd(child.padding, child.border), constants.dir);

    const childKnownMain: AvailableSpace = main(constants.containerSize, constants.dir);

    // Sizes transferred through the aspect ratio clamp the hypothetical cross size —
    // but only when the cross axis's preferred size is auto (css-sizing-4 §5.2.2).
    const crossStyleIsAuto =
      maybeResolve(cross(child.node.style.size, constants.dir), cross(constants.nodeInnerSize, constants.dir)) === null;
    // A *transferred* minimum (AR-derived, not explicitly specified in this axis)
    // is capped by the axis's own explicit maximum (css-sizing-4 §5.2.2; matches
    // Chrome). An explicit minimum still beats the maximum as usual.
    const rawMinCross = cross(child.minSize, constants.dir);
    const arMinCross = cross(maybeApplyAspectRatio(child.minSize, child.aspectRatio), constants.dir);
    const transferredMinCross = !crossStyleIsAuto
      ? rawMinCross
      : rawMinCross !== null
        ? rawMinCross
        : mMin(arMinCross, cross(child.maxSize, constants.dir));
    const transferredMaxCross = crossStyleIsAuto
      ? cross(maybeApplyAspectRatio(child.maxSize, child.aspectRatio), constants.dir)
      : cross(child.maxSize, constants.dir);

    // An aspect-ratio item with a definite used main size derives its automatic
    // cross size from the ratio rather than from content (css-sizing-4 §5.1).
    //
    // The ratio relates the two axes of the box named by `box-sizing`, so under
    // content-box it has to operate on the content box: strip the main-axis
    // padding+border before applying the ratio and add the cross-axis back.
    // `targetSize` is always a border-box value, so dividing it directly is
    // correct only under border-box (same defect as the leaf floor in
    // src/compute/leaf.ts).
    const arDerivedCross =
      child.aspectRatio !== null
        ? transferThroughRatio(main(child.targetSize, constants.dir), child, constants.dir, 'main-to-cross')
        : null;

    // Read the *style* cross size, not `child.size`: the latter has already had
    // the ratio applied (generateAnonymousFlexItems), so an item with only a
    // specified main size looks like it has a definite cross size here.
    child.crossIsArDerived =
      child.aspectRatio !== null &&
      cross(maybeResolveSize(child.node.style.size, constants.nodeInnerSize), constants.dir) === null;

    const childCross = mMax(
      mClamp(cross(child.size, constants.dir) ?? arDerivedCross, transferredMinCross, transferredMaxCross),
      paddingBorderSum,
    );

    const childAvailableCross = asMaybeClampWithMax(
      asMaybeClamp(cross(availableSpace, constants.dir), transferredMinCross, transferredMaxCross),
      paddingBorderSum,
    );

    let childInnerCross: number;
    if (childCross !== null) {
      childInnerCross = childCross;
    } else {
      childInnerCross = Math.max(
        vClamp(
          measureChildSize(
            child.node,
            {
              width: constants.isRow ? main(child.targetSize, constants.dir) : childCross,
              height: constants.isRow ? childCross : main(child.targetSize, constants.dir),
            },
            constants.nodeInnerSize,
            {
              width: constants.isRow ? childKnownMain : childAvailableCross,
              height: constants.isRow ? childAvailableCross : childKnownMain,
            },
            'content-size',
            crossAxis(constants.dir),
          ),
          transferredMinCross,
          transferredMaxCross,
        ),
        paddingBorderSum,
      );
    }
    const childOuterCross = childInnerCross + rectCrossAxisSum(child.margin, constants.dir);

    setCross(child.hypotheticalInnerSize, constants.dir, childInnerCross);
    setCross(child.hypotheticalOuterSize, constants.dir, childOuterCross);
  }
}

/** Calculate the base lines of the children. */
function calculateChildrenBaseLines(
  nodeSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  flexLines: FlexLine[],
  constants: AlgoConstants,
): void {
  // Only compute baselines for flex rows because we only support baseline alignment in the cross axis
  // where that axis is also the inline axis
  if (!constants.isRow) return;

  for (const line of flexLines) {
    // If a flex line has one or zero items participating in baseline alignment then
    // baseline alignment is a no-op so we skip
    const lineBaselineChildCount = line.items.filter(
      (child) => child.alignSelf.keyword === 'baseline' && !child.alignSelf.safe,
    ).length;
    if (lineBaselineChildCount <= 1) continue;

    for (const child of line.items) {
      // Only calculate baselines for children participating in baseline alignment
      if (!(child.alignSelf.keyword === 'baseline' && !child.alignSelf.safe)) continue;

      const measuredSizeAndBaselines = performChildLayout(
        child.node,
        {
          width: constants.isRow ? main(child.targetSize, constants.dir) : child.hypotheticalInnerSize.width,
          height: constants.isRow ? child.hypotheticalInnerSize.height : child.targetSize.height,
        },
        constants.nodeInnerSize,
        {
          width: constants.isRow ? constants.containerSize.width : asMaybeSet(availableSpace.width, nodeSize.width),
          height: constants.isRow ? asMaybeSet(availableSpace.height, nodeSize.height) : constants.containerSize.height,
        },
        'content-size',
      );

      const rawBaseline = measuredSizeAndBaselines.firstBaselines.y;
      const height = measuredSizeAndBaselines.size.height;

      // Scroll containers' baselines are determined from their content as if scrolled to the
      // initial position, but are additionally clamped to their border box.
      const baseline = isScrollContainer(child.overflow.y)
        ? Math.max(Math.min(rawBaseline ?? height, height), 0)
        : (rawBaseline ?? height);

      child.baseline = baseline + child.margin.top;
    }
  }
}

/**
 * Calculate the cross size of each flex line.
 * # [9.4. Cross Size Determination](https://www.w3.org/TR/css-flexbox-1/#cross-sizing)
 */
function calculateCrossSize(flexLines: FlexLine[], nodeSize: Size<Opt>, constants: AlgoConstants): void {
  // If the flex container is single-line and has a definite cross size,
  // the cross size of the flex line is the flex container's inner cross size.
  // A ratio-derived cross size does not *fix* the line — it floors the
  // container later (see determineContainerCrossSize), so the line must keep
  // its content-derived size here. Only applies when the items can actually
  // supply an independent content size.
  const crossFloorsRatherThanFixes =
    constants.crossIsRatioDerived &&
    flexLines.every((line) => line.items.every((item) => !item.crossIsArDerived));
  if (!constants.isWrap && cross(nodeSize, constants.dir) !== null && !crossFloorsRatherThanFixes) {
    const crossAxisPaddingBorder = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
    const crossMinSize = cross(constants.minSize, constants.dir);
    const crossMaxSize = cross(constants.maxSize, constants.dir);
    flexLines[0]!.crossSize =
      mMax(
        mSub(mClamp(cross(nodeSize, constants.dir), crossMinSize, crossMaxSize), crossAxisPaddingBorder),
        0,
      ) ?? 0;
  } else {
    for (const line of flexLines) {
      const maxBaseline = line.items.reduce((acc, child) => Math.max(acc, child.baseline), 0);
      line.crossSize = line.items.reduce((acc, child) => {
        if (
          child.alignSelf.keyword === 'baseline' &&
          !child.alignSelf.safe &&
          !rectCrossStart(child.marginIsAuto, constants.dir) &&
          !rectCrossEnd(child.marginIsAuto, constants.dir)
        ) {
          return Math.max(acc, maxBaseline - child.baseline + cross(child.hypotheticalOuterSize, constants.dir));
        }
        return Math.max(acc, cross(child.hypotheticalOuterSize, constants.dir));
      }, 0);
    }

    // If the flex container is single-line, then clamp the line's cross-size to be
    // within the container's computed min and max cross sizes.
    if (!constants.isWrap) {
      const crossAxisPaddingBorder = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
      const crossMinSize = cross(constants.minSize, constants.dir);
      const crossMaxSize = cross(constants.maxSize, constants.dir);
      flexLines[0]!.crossSize = vClamp(
        flexLines[0]!.crossSize,
        mSub(crossMinSize, crossAxisPaddingBorder),
        mSub(crossMaxSize, crossAxisPaddingBorder),
      );
    }
  }
}

/**
 * Handle 'align-content: stretch'.
 * # [9.4. Cross Size Determination](https://www.w3.org/TR/css-flexbox-1/#cross-sizing)
 */
function handleAlignContentStretch(flexLines: FlexLine[], nodeSize: Size<Opt>, constants: AlgoConstants): void {
  if (constants.alignContent.keyword === 'stretch' && !constants.alignContent.safe) {
    const crossAxisPaddingBorder = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
    const crossMinSize = cross(constants.minSize, constants.dir);
    const crossMaxSize = cross(constants.maxSize, constants.dir);
    const containerMinInnerCross =
      mMax(
        mSub(
          mClamp(cross(nodeSize, constants.dir) ?? crossMinSize, crossMinSize, crossMaxSize),
          crossAxisPaddingBorder,
        ),
        0,
      ) ?? 0;

    const totalCrossAxisGap = sumAxisGaps(cross(constants.gap, constants.dir), flexLines.length);
    const linesTotalCross = flexLines.reduce((acc, line) => acc + line.crossSize, 0) + totalCrossAxisGap;

    if (linesTotalCross < containerMinInnerCross) {
      const remaining = containerMinInnerCross - linesTotalCross;
      const addition = remaining / flexLines.length;
      for (const line of flexLines) line.crossSize += addition;
    }
  }
}

/**
 * Determine the used cross size of each flex item.
 * # [9.4. Cross Size Determination](https://www.w3.org/TR/css-flexbox-1/#cross-sizing)
 */
function determineUsedCrossSize(flexLines: FlexLine[], constants: AlgoConstants): void {
  for (const line of flexLines) {
    const lineCrossSize = line.crossSize;

    for (const child of line.items) {
      const childStyle = child.node.style;
      if (
        child.alignSelf.keyword === 'stretch' &&
        !child.alignSelf.safe &&
        !rectCrossStart(child.marginIsAuto, constants.dir) &&
        !rectCrossEnd(child.marginIsAuto, constants.dir) &&
        cross(childStyle.size, constants.dir) === 'auto'
      ) {
        // For this particular usage, max_size does NOT transfer through the aspect_ratio —
        // matching Chrome and Firefox.
        // Width-relative on all four sides (css-box-3 §4) — see the note in
        // block.ts generateItemList.
        const padding = resolveRectOrZero(childStyle.padding, constants.nodeInnerSize.width);
        const border = resolveRectOrZero(childStyle.border, constants.nodeInnerSize.width);
        const pbSum = sumAxes(rectAdd(padding, border));
        const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? pbSum : sizeZero();

        const maxSizeIgnoringAspectRatio = maybeAddSize(
          maybeResolveSize(childStyle.maxSize, constants.nodeInnerSize),
          boxSizingAdjustment,
        );

        // Floor the stretched cross size by the item's own padding+border: a
        // border box can never be smaller than its borders, so a `max-width`
        // below that sum does not shrink the rendered box. Without the floor
        // the *used* size (which is floored later) and the size the alignment
        // math sees disagree, and RTL column placement offsets the item by the
        // difference — `max-width: 0` with a 123px border placed the item at
        // x=123 instead of x=0.
        setCross(
          child.targetSize,
          constants.dir,
          Math.max(
            vClamp(
              lineCrossSize - rectCrossAxisSum(child.margin, constants.dir),
              cross(child.minSize, constants.dir),
              cross(maxSizeIgnoringAspectRatio, constants.dir),
            ),
            rectCrossAxisSum(rectAdd(child.padding, child.border), constants.dir),
          ),
        );
      } else {
        setCross(child.targetSize, constants.dir, cross(child.hypotheticalInnerSize, constants.dir));
      }

      setCross(
        child.outerTargetSize,
        constants.dir,
        cross(child.targetSize, constants.dir) + rectCrossAxisSum(child.margin, constants.dir),
      );
    }
  }
}

/**
 * Distribute any remaining free space.
 * # [9.5. Main-Axis Alignment](https://www.w3.org/TR/css-flexbox-1/#main-alignment)
 */
function distributeRemainingFreeSpace(flexLines: FlexLine[], constants: AlgoConstants): void {
  for (const line of flexLines) {
    const totalMainAxisGap = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
    const usedSpace =
      totalMainAxisGap + line.items.reduce((sum, child) => sum + main(child.outerTargetSize, constants.dir), 0);
    const freeSpace = main(constants.innerContainerSize, constants.dir) - usedSpace;
    let numAutoMargins = 0;

    for (const child of line.items) {
      if (rectMainStart(child.marginIsAuto, constants.dir)) numAutoMargins++;
      if (rectMainEnd(child.marginIsAuto, constants.dir)) numAutoMargins++;
    }

    // Auto margins absorb the line's positive free space *before* alignment, so
    // `justify-content` then has nothing left to distribute (css-flexbox-1
    // §8.1). Handing the pre-absorption free space to the alignment below
    // distributes the same space twice and pushes items past the container.
    let freeSpaceAfterAutoMargins = freeSpace;
    if (freeSpace > 0 && numAutoMargins > 0) {
      const margin = freeSpace / numAutoMargins;
      freeSpaceAfterAutoMargins = 0;

      for (const child of line.items) {
        if (rectMainStart(child.marginIsAuto, constants.dir)) {
          if (constants.isRow) child.margin.left = margin;
          else child.margin.top = margin;
        }
        if (rectMainEnd(child.marginIsAuto, constants.dir)) {
          if (constants.isRow) child.margin.right = margin;
          else child.margin.bottom = margin;
        }
      }
    }

    const numItems = line.items.length;
    const layoutReverse = isReverse(constants.dir);
    const gap = main(constants.gap, constants.dir);
    const rawJustifyContentMode = constants.justifyContent ?? { keyword: 'flex-start', safe: false };
    const justifyContentMode = applyAlignmentFallback(freeSpaceAfterAutoMargins, numItems, rawJustifyContentMode);

    const justifyItem = (child: FlexItem, i: number): void => {
      child.offsetMain = computeAlignmentOffset(
        freeSpaceAfterAutoMargins,
        numItems,
        gap,
        justifyContentMode,
        layoutReverse,
        i === 0,
      );
    };

    if (layoutReverse) {
      const reversed = [...line.items].reverse();
      reversed.forEach(justifyItem);
    } else {
      line.items.forEach(justifyItem);
    }
  }
}

/**
 * Resolve cross-axis `auto` margins.
 * # [9.6. Cross-Axis Alignment](https://www.w3.org/TR/css-flexbox-1/#cross-alignment)
 */
function resolveCrossAxisAutoMargins(flexLines: FlexLine[], constants: AlgoConstants): void {
  for (const line of flexLines) {
    const lineCrossSize = line.crossSize;
    const maxBaseline = line.items.reduce((acc, child) => Math.max(acc, child.baseline), 0);

    for (const child of line.items) {
      const freeSpace = lineCrossSize - cross(child.outerTargetSize, constants.dir);
      // Auto margins absorb only *positive* free space (css-flexbox-1 §8.1).
      // A negative value would make the margin itself negative and drag the
      // item outside the container: `margin-top: auto` with a 17px bottom
      // margin in a 1px-tall line put the item at y=-16 instead of y=0.
      // The alignment branch below is deliberately NOT floored — overflow
      // alignment needs the true negative value.
      const autoMarginSpace = Math.max(freeSpace, 0);

      if (rectCrossStart(child.marginIsAuto, constants.dir) && rectCrossEnd(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) {
          child.margin.top = autoMarginSpace / 2;
          child.margin.bottom = autoMarginSpace / 2;
        } else {
          child.margin.left = autoMarginSpace / 2;
          child.margin.right = autoMarginSpace / 2;
        }
      } else if (rectCrossStart(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) child.margin.top = autoMarginSpace;
        else child.margin.left = autoMarginSpace;
      } else if (rectCrossEnd(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) child.margin.bottom = autoMarginSpace;
        else child.margin.right = autoMarginSpace;
      } else {
        // 14. Align all flex items along the cross-axis.
        child.offsetCross = alignFlexItemsAlongCrossAxis(child, freeSpace, maxBaseline, constants);
      }
    }
  }
}

/**
 * Align all flex items along the cross-axis.
 * # [9.6. Cross-Axis Alignment](https://www.w3.org/TR/css-flexbox-1/#cross-alignment)
 */
function alignFlexItemsAlongCrossAxis(
  child: FlexItem,
  freeSpace: number,
  maxBaseline: number,
  constants: AlgoConstants,
): number {
  const crossAxisShouldReverse = constants.isColumn && constants.layoutDirection === 'rtl';

  // Safe alignment falls back to logical Start when the item would overflow.
  const alignKeyword = child.alignSelf.safe && freeSpace < 0 ? 'start' : child.alignSelf.keyword;

  switch (alignKeyword) {
    case 'start':
      return crossAxisShouldReverse ? freeSpace : 0;
    case 'flex-start':
      return constants.isWrapReverse !== crossAxisShouldReverse ? freeSpace : 0;
    case 'end':
      return crossAxisShouldReverse ? 0 : freeSpace;
    case 'flex-end':
      return constants.isWrapReverse !== crossAxisShouldReverse ? 0 : freeSpace;
    case 'center':
      return freeSpace / 2;
    case 'baseline':
      if (constants.isRow) {
        return maxBaseline - child.baseline;
      } else {
        // Baseline alignment is treated as flex-start alignment in columns.
        const baselineColumnShouldReverse = crossAxisShouldReverse && !constants.isWrap;
        return constants.isWrapReverse !== baselineColumnShouldReverse ? freeSpace : 0;
      }
    case 'stretch':
      return constants.isWrapReverse !== crossAxisShouldReverse ? freeSpace : 0;
  }
}

/**
 * Determine the flex container's used cross size.
 * # [9.6. Cross-Axis Alignment](https://www.w3.org/TR/css-flexbox-1/#cross-alignment)
 */
function determineContainerCrossSize(flexLines: FlexLine[], nodeSize: Size<Opt>, constants: AlgoConstants): number {
  const totalCrossAxisGap = sumAxisGaps(cross(constants.gap, constants.dir), flexLines.length);
  const totalLineCrossSize = flexLines.reduce((acc, line) => acc + line.crossSize, 0);

  const paddingBorderSum = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
  const crossScrollbarGutter = pointCrossValue(constants.scrollbarGutter, constants.dir);
  const minCrossSize = cross(constants.minSize, constants.dir);
  const maxCrossSize = cross(constants.maxSize, constants.dir);
  // A ratio-derived cross size floors the container rather than fixing it
  // (css-sizing-4 §4.2), so content taller than it wins — but only when that
  // content is genuinely independent. An item whose own cross size came from
  // its own ratio derives it from a main size that depends on this very cross
  // size, so letting it floor here is circular: Chrome keeps `aspect-ratio: 4`
  // at 200x50 around a `aspect-ratio: 1` item, while a plain 100px-tall block
  // in the same slot grows it to 200x100.
  const contentCrossSize = totalLineCrossSize + totalCrossAxisGap + paddingBorderSum;
  const specifiedCross = cross(nodeSize, constants.dir);
  const contentIsIndependent = flexLines.every((line) => line.items.every((item) => !item.crossIsArDerived));
  const resolvedCross =
    specifiedCross !== null && constants.crossIsRatioDerived && contentIsIndependent
      ? Math.max(specifiedCross, contentCrossSize)
      : (specifiedCross ?? contentCrossSize);
  const outerContainerSize = Math.max(
    vClamp(resolvedCross, minCrossSize, maxCrossSize),
    paddingBorderSum - crossScrollbarGutter,
  );
  const innerContainerSize = Math.max(outerContainerSize - paddingBorderSum, 0);

  setCross(constants.containerSize, constants.dir, outerContainerSize);
  setCross(constants.innerContainerSize, constants.dir, innerContainerSize);

  return totalLineCrossSize;
}

/**
 * Align all flex lines per `align-content`.
 * # [9.6. Cross-Axis Alignment](https://www.w3.org/TR/css-flexbox-1/#cross-alignment)
 */
function alignFlexLinesPerAlignContent(flexLines: FlexLine[], constants: AlgoConstants, totalCrossSize: number): void {
  const numLines = flexLines.length;
  const gap = cross(constants.gap, constants.dir);
  const totalCrossAxisGap = sumAxisGaps(gap, numLines);
  const freeSpace = cross(constants.innerContainerSize, constants.dir) - totalCrossSize - totalCrossAxisGap;

  const alignContentMode = applyAlignmentFallback(freeSpace, numLines, constants.alignContent);

  const alignLine = (line: FlexLine, i: number): void => {
    line.offsetCross = computeAlignmentOffset(freeSpace, numLines, gap, alignContentMode, constants.isWrapReverse, i === 0);
  };

  if (constants.isWrapReverse) {
    const reversed = [...flexLines].reverse();
    reversed.forEach(alignLine);
  } else {
    flexLines.forEach(alignLine);
  }
}

/** Calculates the layout for a flex-item */
function calculateFlexItem(
  item: FlexItem,
  totalOffsetMain: { value: number },
  totalOffsetCross: number,
  lineOffsetCross: number,
  totalContentSize: Size<number>,
  containerBorder: Rect<number>,
  containerSize: Size<number>,
  nodeInnerSize: Size<Opt>,
  direction: FlexDirection,
  layoutDirection: Direction,
): void {
  const layoutOutput = performChildLayout(
    item.node,
    { width: item.targetSize.width, height: item.targetSize.height },
    nodeInnerSize,
    { width: containerSize.width, height: containerSize.height },
    'content-size',
  );
  const { size, contentSize } = layoutOutput;

  const isRtlRow = dirIsRow(direction) && layoutDirection === 'rtl';
  const isRtlColumn = dirIsColumn(direction) && layoutDirection === 'rtl';
  const mainRelativeInset = isRtlRow
    ? (rectMainEnd(item.inset, direction) ?? negate(rectMainStart(item.inset, direction)) ?? 0)
    : (rectMainStart(item.inset, direction) ?? negate(rectMainEnd(item.inset, direction)) ?? 0);
  const crossRelativeInset = isRtlColumn
    ? (negate(rectCrossEnd(item.inset, direction)) ?? rectCrossStart(item.inset, direction) ?? 0)
    : (rectCrossStart(item.inset, direction) ?? negate(rectCrossEnd(item.inset, direction)) ?? 0);
  const effectiveLineOffsetCross = isRtlColumn ? 0 : lineOffsetCross;

  const offsetMain = isRtlRow
    ? totalOffsetMain.value -
      item.offsetMain -
      rectMainEnd(item.margin, direction) -
      mainRelativeInset -
      size.width
    : totalOffsetMain.value + item.offsetMain + rectMainStart(item.margin, direction) + mainRelativeInset;

  const offsetCross =
    totalOffsetCross +
    item.offsetCross +
    effectiveLineOffsetCross +
    rectCrossStart(item.margin, direction) +
    crossRelativeInset;

  if (dirIsRow(direction)) {
    const baselineOffsetCross =
      totalOffsetCross + item.offsetCross + effectiveLineOffsetCross + rectCrossStart(item.margin, direction);
    // Scroll containers' baselines are clamped to their border box.
    const rawBaseline = layoutOutput.firstBaselines.y ?? size.height;
    const innerBaseline = isScrollContainer(item.overflow.y)
      ? Math.max(Math.min(rawBaseline, size.height), 0)
      : rawBaseline;
    item.baseline = baselineOffsetCross + innerBaseline;
  } else {
    const baselineOffsetMain = totalOffsetMain.value + item.offsetMain + rectMainStart(item.margin, direction);
    const innerBaseline = layoutOutput.firstBaselines.y ?? size.height;
    item.baseline = baselineOffsetMain + innerBaseline;
  }

  const location: Point<number> = dirIsRow(direction)
    ? { x: offsetMain, y: offsetCross }
    : { x: offsetCross, y: offsetMain };
  const scrollbarSize = {
    width: item.overflow.y === 'scroll' ? item.scrollbarWidth : 0,
    height: item.overflow.x === 'scroll' ? item.scrollbarWidth : 0,
  };

  item.node.unroundedLayout = {
    order: item.order,
    size,
    contentSize,
    scrollbarSize,
    location,
    padding: item.padding,
    border: item.border,
    margin: item.margin,
  };

  if (isRtlRow) {
    totalOffsetMain.value -= item.offsetMain + rectMainAxisSum(item.margin, direction) + main(size, direction);
  } else {
    totalOffsetMain.value += item.offsetMain + rectMainAxisSum(item.margin, direction) + main(size, direction);
  }

  {
    const contributionLocation: Point<number> =
      layoutDirection === 'rtl'
        ? {
            x: containerSize.width - (location.x + size.width) - containerBorder.right,
            y: location.y - containerBorder.top,
          }
        : { x: location.x - containerBorder.left, y: location.y - containerBorder.top };
    const contribution = computeContentSizeContribution(contributionLocation, size, contentSize, item.overflow);
    totalContentSize.width = Math.max(totalContentSize.width, contribution.width);
    totalContentSize.height = Math.max(totalContentSize.height, contribution.height);
  }
}

/** Calculates the layout line */
function calculateLayoutLine(
  line: FlexLine,
  totalOffsetCross: { value: number },
  contentSize: Size<number>,
  containerBorder: Rect<number>,
  containerSize: Size<number>,
  nodeInnerSize: Size<Opt>,
  paddingBorder: Rect<number>,
  direction: FlexDirection,
  layoutDirection: Direction,
): void {
  const totalOffsetMain = {
    value:
      layoutDirection === 'rtl' && dirIsRow(direction)
        ? containerSize.width - rectMainEnd(paddingBorder, direction)
        : rectMainStart(paddingBorder, direction),
  };
  const lineOffsetCross = line.offsetCross;

  const isRtlColumn = layoutDirection === 'rtl' && dirIsColumn(direction);
  if (isRtlColumn) {
    totalOffsetCross.value -= lineOffsetCross + line.crossSize;
  }

  const items = isReverse(direction) ? [...line.items].reverse() : line.items;
  for (const item of items) {
    calculateFlexItem(
      item,
      totalOffsetMain,
      totalOffsetCross.value,
      lineOffsetCross,
      contentSize,
      containerBorder,
      containerSize,
      nodeInnerSize,
      direction,
      layoutDirection,
    );
  }

  if (!isRtlColumn) {
    totalOffsetCross.value += lineOffsetCross + line.crossSize;
  }
}

/** Do a final layout pass and collect the resulting layouts. */
function finalLayoutPass(flexLines: FlexLine[], constants: AlgoConstants): Size<number> {
  const totalOffsetCross = {
    value:
      constants.isColumn && constants.layoutDirection === 'rtl'
        ? constants.containerSize.width - rectCrossEnd(constants.contentBoxInset, constants.dir)
        : rectCrossStart(constants.contentBoxInset, constants.dir),
  };

  const contentSize = sizeZero();

  const lines = constants.isWrapReverse ? [...flexLines].reverse() : flexLines;
  for (const line of lines) {
    calculateLayoutLine(
      line,
      totalOffsetCross,
      contentSize,
      constants.border,
      constants.containerSize,
      constants.nodeInnerSize,
      constants.contentBoxInset,
      constants.dir,
      constants.layoutDirection,
    );
  }

  contentSize.width +=
    constants.layoutDirection === 'rtl'
      ? constants.contentBoxInset.left - constants.border.left - constants.scrollbarGutter.x
      : constants.contentBoxInset.right - constants.border.right - constants.scrollbarGutter.x;
  contentSize.height += constants.contentBoxInset.bottom - constants.border.bottom - constants.scrollbarGutter.y;

  return contentSize;
}

/** Perform absolute layout on all absolutely positioned children. */
function performAbsoluteLayoutOnAbsoluteChildren(node: Node, constants: AlgoConstants): Size<number> {
  const containerWidth = constants.containerSize.width;
  const containerHeight = constants.containerSize.height;
  const insetRelativeSize = {
    width: constants.containerSize.width - horizontalSum(constants.border) - constants.scrollbarGutter.x,
    height: constants.containerSize.height - verticalSum(constants.border) - constants.scrollbarGutter.y,
  };

  const contentSize = sizeZero();

  for (let order = 0; order < node.children.length; order++) {
    const child = node.children[order]!;
    const childStyle = child.style;

    // Skip items that are display:none or are not position:absolute
    if (childStyle.display === 'none' || childStyle.position !== 'absolute') continue;

    const overflow = childStyle.overflow;
    const scrollbarWidth = childStyle.scrollbarWidth;
    const aspectRatio = childStyle.aspectRatio;
    const alignSelf = childStyle.alignSelf ?? constants.alignItems;
    const margin: Rect<Opt> = {
      left: maybeResolve(childStyle.margin.left, insetRelativeSize.width),
      right: maybeResolve(childStyle.margin.right, insetRelativeSize.width),
      top: maybeResolve(childStyle.margin.top, insetRelativeSize.width),
      bottom: maybeResolve(childStyle.margin.bottom, insetRelativeSize.width),
    };
    const padding = resolveRectOrZero(childStyle.padding, insetRelativeSize.width);
    const border = resolveRectOrZero(childStyle.border, insetRelativeSize.width);
    const paddingBorderSum = sumAxes(rectAdd(padding, border));
    const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? paddingBorderSum : sizeZero();

    // Resolve inset — insets are resolved against the container size minus border
    const left = maybeResolve(childStyle.inset.left, insetRelativeSize.width);
    const right = maybeResolve(childStyle.inset.right, insetRelativeSize.width);
    const top = maybeResolve(childStyle.inset.top, insetRelativeSize.height);
    const bottom = maybeResolve(childStyle.inset.bottom, insetRelativeSize.height);

    // Compute known dimensions from min/max/inherent size styles
    const styleSize = maybeAddSize(
      maybeApplyAspectRatio(maybeResolveSize(childStyle.size, insetRelativeSize), aspectRatio),
      boxSizingAdjustment,
    );
    const minSizeRaw = maybeAddSize(
      maybeApplyAspectRatio(maybeResolveSize(childStyle.minSize, insetRelativeSize), aspectRatio),
      boxSizingAdjustment,
    );
    const minSize: Size<Opt> = {
      width: mMax(minSizeRaw.width ?? paddingBorderSum.width, paddingBorderSum.width),
      height: mMax(minSizeRaw.height ?? paddingBorderSum.height, paddingBorderSum.height),
    };
    const maxSize = maybeAddSize(
      maybeApplyAspectRatio(maybeResolveSize(childStyle.maxSize, insetRelativeSize), aspectRatio),
      boxSizingAdjustment,
    );
    let knownDimensions = sizeMaybeClamp(styleSize, minSize, maxSize);

    // Fill in width from left/right and reapply aspect ratio if:
    //   - Width is not already known  - Item has both left and right inset properties set
    if (knownDimensions.width === null && left !== null && right !== null) {
      const newWidthRaw = vSub(vSub(insetRelativeSize.width, margin.left), margin.right) - left - right;
      knownDimensions.width = Math.max(newWidthRaw, 0);
      knownDimensions = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);
    }

    // Fill in height from top/bottom and reapply aspect ratio if:
    //   - Height is not already known  - Item has both top and bottom inset properties set
    if (knownDimensions.height === null && top !== null && bottom !== null) {
      const newHeightRaw = vSub(vSub(insetRelativeSize.height, margin.top), margin.bottom) - top - bottom;
      knownDimensions.height = Math.max(newHeightRaw, 0);
      knownDimensions = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);
    }

    const measuredSize = measureChildSizeBoth(
      child,
      knownDimensions,
      constants.nodeInnerSize,
      {
        width: vClamp(containerWidth, minSize.width, maxSize.width),
        height: vClamp(containerHeight, minSize.height, maxSize.height),
      },
      'inherent-size',
    );
    const finalSize: Size<number> = {
      width: vClamp(knownDimensions.width ?? measuredSize.width, minSize.width, maxSize.width),
      height: vClamp(knownDimensions.height ?? measuredSize.height, minSize.height, maxSize.height),
    };

    const layoutOutput = performChildLayout(
      child,
      { width: finalSize.width, height: finalSize.height },
      constants.nodeInnerSize,
      {
        width: vClamp(containerWidth, minSize.width, maxSize.width),
        height: vClamp(containerHeight, minSize.height, maxSize.height),
      },
      'inherent-size',
    );

    const nonAutoMargin = {
      left: margin.left ?? 0,
      right: margin.right ?? 0,
      top: margin.top ?? 0,
      bottom: margin.bottom ?? 0,
    };

    const freeSpace = {
      width: Math.max(constants.containerSize.width - finalSize.width - horizontalSum(nonAutoMargin), 0),
      height: Math.max(constants.containerSize.height - finalSize.height - verticalSum(nonAutoMargin), 0),
    };

    // Expand auto margins to fill available space
    const autoMarginWidthCount = (margin.left === null ? 1 : 0) + (margin.right === null ? 1 : 0);
    const autoMarginHeightCount = (margin.top === null ? 1 : 0) + (margin.bottom === null ? 1 : 0);
    const autoMarginSize = {
      width: autoMarginWidthCount > 0 ? freeSpace.width / autoMarginWidthCount : 0,
      height: autoMarginHeightCount > 0 ? freeSpace.height / autoMarginHeightCount : 0,
    };
    const resolvedMargin: Rect<number> = {
      left: margin.left ?? autoMarginSize.width,
      right: margin.right ?? autoMarginSize.width,
      top: margin.top ?? autoMarginSize.height,
      bottom: margin.bottom ?? autoMarginSize.height,
    };

    // Determine flex-relative insets
    const [startMain, endMain] = constants.isRow ? [left, right] : [top, bottom];
    const [startCross, endCross] = constants.isRow ? [top, bottom] : [left, right];
    const mainAxisIsHorizontal = constants.isRow;
    const crossAxisIsHorizontal = !constants.isRow;
    const mainIsRtl = mainAxisIsHorizontal && constants.layoutDirection === 'rtl';
    const crossIsRtl = crossAxisIsHorizontal && constants.layoutDirection === 'rtl';
    const mainAxisFlexStartReversed = isReverse(constants.dir) !== mainIsRtl;
    const crossAxisFlexStartReversed = constants.isWrapReverse !== crossIsRtl;
    const mainStartScrollbarOffset = mainIsRtl ? pointMainValue(constants.scrollbarGutter, constants.dir) : 0;
    const crossStartScrollbarOffset = crossIsRtl ? pointCrossValue(constants.scrollbarGutter, constants.dir) : 0;
    const mainEndScrollbarOffset = mainIsRtl ? 0 : pointMainValue(constants.scrollbarGutter, constants.dir);
    const crossEndScrollbarOffset = crossIsRtl ? 0 : pointCrossValue(constants.scrollbarGutter, constants.dir);

    // Apply main-axis alignment
    let offsetMain: number;
    if (startMain !== null || endMain !== null) {
      if (mainIsRtl && endMain !== null) {
        offsetMain =
          main(constants.containerSize, constants.dir) -
          rectMainEnd(constants.border, constants.dir) -
          mainEndScrollbarOffset -
          main(finalSize, constants.dir) -
          endMain -
          rectMainEnd(resolvedMargin, constants.dir);
      } else if (startMain !== null) {
        offsetMain =
          startMain +
          rectMainStart(constants.border, constants.dir) +
          mainStartScrollbarOffset +
          rectMainStart(resolvedMargin, constants.dir);
      } else {
        offsetMain =
          main(constants.containerSize, constants.dir) -
          rectMainEnd(constants.border, constants.dir) -
          mainEndScrollbarOffset -
          main(finalSize, constants.dir) -
          (endMain ?? 0) -
          rectMainEnd(resolvedMargin, constants.dir);
      }
    } else {
      // Stretch is an invalid value for justify_content in the flexbox algorithm, so we
      // treat it as if it wasn't set (and thus we default to FlexStart behaviour).
      // The `safe` keyword is deliberately NOT applied here (matches Chrome).
      const keyword = (constants.justifyContent ?? { keyword: 'start', safe: false }).keyword;
      const startOffset = rectMainStart(constants.contentBoxInset, constants.dir) + rectMainStart(resolvedMargin, constants.dir);
      const endOffset =
        main(constants.containerSize, constants.dir) -
        rectMainEnd(constants.contentBoxInset, constants.dir) -
        main(finalSize, constants.dir) -
        rectMainEnd(resolvedMargin, constants.dir);
      const centerOffset =
        (main(constants.containerSize, constants.dir) +
          rectMainStart(constants.contentBoxInset, constants.dir) -
          rectMainEnd(constants.contentBoxInset, constants.dir) -
          main(finalSize, constants.dir) +
          rectMainStart(resolvedMargin, constants.dir) -
          rectMainEnd(resolvedMargin, constants.dir)) /
        2;

      if (keyword === 'space-between') {
        offsetMain = startOffset;
      } else if (keyword === 'stretch' || keyword === 'flex-start') {
        offsetMain = mainAxisFlexStartReversed ? endOffset : startOffset;
      } else if (keyword === 'flex-end') {
        offsetMain = mainAxisFlexStartReversed ? startOffset : endOffset;
      } else if (keyword === 'start') {
        offsetMain = mainAxisFlexStartReversed ? endOffset : startOffset;
      } else if (keyword === 'end') {
        offsetMain = mainAxisFlexStartReversed ? startOffset : endOffset;
      } else {
        // space-evenly | space-around | center
        offsetMain = centerOffset;
      }
    }

    // Apply cross-axis alignment
    let offsetCross: number;
    if (startCross !== null || endCross !== null) {
      if (crossIsRtl && endCross !== null) {
        offsetCross =
          cross(constants.containerSize, constants.dir) -
          rectCrossEnd(constants.border, constants.dir) -
          crossEndScrollbarOffset -
          cross(finalSize, constants.dir) -
          endCross -
          rectCrossEnd(resolvedMargin, constants.dir);
      } else if (startCross !== null) {
        offsetCross =
          startCross +
          rectCrossStart(constants.border, constants.dir) +
          crossStartScrollbarOffset +
          rectCrossStart(resolvedMargin, constants.dir);
      } else {
        offsetCross =
          cross(constants.containerSize, constants.dir) -
          rectCrossEnd(constants.border, constants.dir) -
          crossEndScrollbarOffset -
          cross(finalSize, constants.dir) -
          (endCross ?? 0) -
          rectCrossEnd(resolvedMargin, constants.dir);
      }
    } else {
      const crossOverflows =
        cross(finalSize, constants.dir) + rectCrossAxisSum(resolvedMargin, constants.dir) >
        cross(constants.containerSize, constants.dir) - rectCrossAxisSum(constants.contentBoxInset, constants.dir);
      const crossKeyword = resolveSelfAlignmentSafety(alignSelf, crossOverflows);
      const startOffset =
        rectCrossStart(constants.contentBoxInset, constants.dir) + rectCrossStart(resolvedMargin, constants.dir);
      const endOffset =
        cross(constants.containerSize, constants.dir) -
        rectCrossEnd(constants.contentBoxInset, constants.dir) -
        cross(finalSize, constants.dir) -
        rectCrossEnd(resolvedMargin, constants.dir);

      // Stretch alignment does not apply to absolutely positioned items.
      if (crossKeyword === 'start') {
        offsetCross = crossAxisFlexStartReversed ? endOffset : startOffset;
      } else if (crossKeyword === 'end') {
        offsetCross = crossAxisFlexStartReversed ? startOffset : endOffset;
      } else if (crossKeyword === 'baseline' || crossKeyword === 'stretch' || crossKeyword === 'flex-start') {
        offsetCross = crossAxisFlexStartReversed ? endOffset : startOffset;
      } else if (crossKeyword === 'flex-end') {
        offsetCross = crossAxisFlexStartReversed ? startOffset : endOffset;
      } else {
        // center
        offsetCross =
          (cross(constants.containerSize, constants.dir) +
            rectCrossStart(constants.contentBoxInset, constants.dir) -
            rectCrossEnd(constants.contentBoxInset, constants.dir) -
            cross(finalSize, constants.dir) +
            rectCrossStart(resolvedMargin, constants.dir) -
            rectCrossEnd(resolvedMargin, constants.dir)) /
          2;
      }
    }

    const location: Point<number> = constants.isRow
      ? { x: offsetMain, y: offsetCross }
      : { x: offsetCross, y: offsetMain };
    const scrollbarSize = {
      width: overflow.y === 'scroll' ? scrollbarWidth : 0,
      height: overflow.x === 'scroll' ? scrollbarWidth : 0,
    };
    child.unroundedLayout = {
      order,
      size: finalSize,
      contentSize: layoutOutput.contentSize,
      scrollbarSize,
      location,
      padding,
      border,
      margin: resolvedMargin,
    };

    {
      const sizeContentSizeContribution = {
        width:
          overflow.x === 'visible' ? Math.max(finalSize.width, layoutOutput.contentSize.width) : finalSize.width,
        height:
          overflow.y === 'visible' ? Math.max(finalSize.height, layoutOutput.contentSize.height) : finalSize.height,
      };
      if (sizeContentSizeContribution.width > 0 && sizeContentSizeContribution.height > 0) {
        const absoluteAreaOffset = {
          x: constants.border.left + (constants.layoutDirection === 'rtl' ? constants.scrollbarGutter.x : 0),
          y: constants.border.top,
        };
        const relativeLocation = { x: location.x - absoluteAreaOffset.x, y: location.y - absoluteAreaOffset.y };
        const contentSizeContribution = {
          width:
            constants.layoutDirection === 'rtl'
              ? Math.max(insetRelativeSize.width - relativeLocation.x, 0) +
                Math.max(sizeContentSizeContribution.width - finalSize.width, 0)
              : relativeLocation.x + sizeContentSizeContribution.width,
          height: relativeLocation.y + sizeContentSizeContribution.height,
        };
        contentSize.width = Math.max(contentSize.width, contentSizeContribution.width);
        contentSize.height = Math.max(contentSize.height, contentSizeContribution.height);
      }
    }
  }

  return contentSize;
}

/** Computes the total space taken up by gaps in an axis */
function sumAxisGaps(gap: number, numItems: number): number {
  // Gaps only exist between items
  return numItems <= 1 ? 0 : gap * (numItems - 1);
}

// --- small local helpers

function maybeAddSize(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: s.width !== null ? s.width + rhs.width : null,
    height: s.height !== null ? s.height + rhs.height : null,
  };
}

function sizeMaybeClamp(s: Size<Opt>, min: Size<Opt>, max: Size<Opt>): Size<Opt> {
  return { width: mClamp(s.width, min.width, max.width), height: mClamp(s.height, min.height, max.height) };
}

function horizontalSum(r: Rect<number>): number {
  return r.left + r.right;
}

function verticalSum(r: Rect<number>): number {
  return r.top + r.bottom;
}

function pointMainValue(p: Point<number>, dir: FlexDirection): number {
  return dirIsRow(dir) ? p.x : p.y;
}

function pointCrossValue(p: Point<number>, dir: FlexDirection): number {
  return dirIsRow(dir) ? p.y : p.x;
}

function negate(v: Opt): Opt {
  return v !== null ? -v : null;
}

/** AvailableSpace::maybe_max with a plain-number rhs (definite values only). */
function asMaybeClampWithMax(avs: AvailableSpace, max: number): AvailableSpace {
  return asMapDefinite(avs, (v) => Math.max(v, max));
}
