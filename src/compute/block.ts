// The CSS block layout algorithm (floats not implemented).
// Section comments cite the spec steps they implement.

import { unreachable } from '../assert.js';
import type { Point, Rect, Size } from '../geometry.js';
import { applyAspectRatioClamped, maybeApplyAspectRatio, rectAdd, sizeZero, sumAxes } from '../geometry.js';
import type { Opt } from '../math.js';
import { mMax, mSub, vClamp, vMax, vSub } from '../math.js';
import type { AvailableSpace, Direction, Overflow, Position, Style, TextAlign } from '../style.js';
import {
  asMaybeSub,
  isScrollContainer,
  maybeResolve,
  maybeResolveSize,
  resolveOrZero,
  resolveRectOrZero,
} from '../style.js';
import type { CollapsibleMarginSet, Layout, LayoutInput, LayoutNode, LayoutOutput, Line } from '../tree.js';
import {
  collapseWithMargin,
  collapseWithSet,
  collapsibleMarginZero,
  fromOuterSize,
  internals,
  LINE_FALSE,
  layoutWithOrder,
  marginSetFromMargin,
  resolveMarginSet,
} from '../tree.js';
import {
  absoluteAxisStretches,
  applyAlignmentFallback,
  computeAlignmentOffset,
  computeContentSizeContribution,
  insetModifiedContainingBlockSize,
  resolveAbsoluteAxis,
  resolveAlignedAbsoluteAxis,
} from './alignment.js';
import {
  maybeApplyAspectRatioUsed,
  toUsedBorderBoxSize,
  transferMaxSizeThroughAspectRatio,
  transferMinSizeThroughAspectRatio,
  transferUsedConstraintToStretchedAxis,
} from './aspectRatio.js';
import { computeChildLayout, measureChildSize, measureChildSizeBoth, performChildLayout } from './dispatch.js';

const LINE_TRUE: Line<boolean> = { start: true, end: true };

/**
 * Context for each block within a Block Formatting Context. With floats out of
 * scope this reduces to tracking whether the node is the root of its BFC
 * (which gates margin collapse-through).
 */
export interface BlockContext {
  isRoot: boolean;
}

/** Resolve CSS2's inherited `text-align` value for legacy block-child alignment. */
function inheritedTextAlign(node: LayoutNode): TextAlign {
  for (let current: LayoutNode | null = node; current !== null; current = internals(current).parent) {
    const value = internals(current).style.textAlign;
    if (value !== 'auto') return value;
  }
  return 'auto';
}

/** Per-child data accumulated over the course of the layout algorithm */
interface BlockItem {
  node: LayoutNode;
  order: number;

  /** Whether the child is a non-independent block node (same BFC as parent) */
  isInSameBfc: boolean;

  size: Size<Opt>;
  minSize: Size<Opt>;
  maxSize: Size<Opt>;

  /**
   * True when `size.width` came from `aspect-ratio` rather than from a
   * specified width. css-sizing-4 §4.2 makes a ratio-derived size an
   * *automatic* size, so content may grow past it — while a specified width of
   * the same value must not grow (the content simply overflows). The two are
   * otherwise indistinguishable once the ratio has been applied.
   */
  widthIsRatioDerived: boolean;

  /** Child's own `aspect-ratio` and `box-sizing`, for the inset-floor transfer
   *  in the stretch-width decision below. */
  aspectRatio: number | null;
  boxSizing: Style['boxSizing'];

  overflow: Point<Overflow>;
  scrollbarWidth: number;

  position: Position;
  /** Raw style inset (resolved later, per call site) */
  inset: Rect<Style['inset']['left']>;
  /** Raw style margin (resolved later, per call site) */
  margin: Rect<Style['margin']['left']>;
  padding: Rect<number>;
  border: Rect<number>;
  paddingBorderSum: Size<number>;

  computedSize: Size<number>;
  staticPosition: Point<number>;
  canBeCollapsedThrough: boolean;

  /** Pending layout for in-flow items, held back so align-content can shift y before commit */
  finalLayout: Layout | null;
}

/** Computes the layout of a node according to the block layout algorithm */
export function computeBlockLayout(node: LayoutNode, inputs: LayoutInput, blockCtx?: BlockContext): LayoutOutput {
  const { knownDimensions, parentSize, runMode } = inputs;
  const style = internals(node).style;

  const overflow = style.overflow;
  const isScroll = isScrollContainer(overflow.x) || isScrollContainer(overflow.y);
  const aspectRatio = style.aspectRatio;
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSize : sizeZero();

  // Min/max must NOT be pushed through the ratio here: that invents a bound on
  // the other axis, and a specified size on that axis then gets clamped by it.
  // `height: 200; aspect-ratio: 2; max-width: 3` is 3x200 in Chrome — the
  // max-width clamps only the width — but a transferred max-height of 1.5
  // shrank the height to 2. The ratio instead derives from the *clamped*
  // specified size (applyAspectRatioClamped), which still re-derives the
  // partner axis for a same-axis clamp: `width: 200; max-width: 3` is 3x2.
  const minSize = maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
  const clampedStyleSize: Size<Opt> =
    inputs.sizingMode === 'inherent-size'
      ? applyAspectRatioClamped(
          maybeAddSize(maybeResolveSize(style.size, parentSize), boxSizingAdjustment),
          minSize,
          maxSize,
          aspectRatio,
          boxSizingAdjustment,
        )
      : { width: null, height: null };

  // If both min and max in a given axis are set and max <= min then this determines the size in that axis
  const minMaxDefiniteSize: Size<Opt> = {
    width: minSize.width !== null && maxSize.width !== null && maxSize.width <= minSize.width ? minSize.width : null,
    height:
      minSize.height !== null && maxSize.height !== null && maxSize.height <= minSize.height ? minSize.height : null,
  };

  const styledBasedKnownDimensions: Size<Opt> = {
    width: mMax(knownDimensions.width ?? minMaxDefiniteSize.width ?? clampedStyleSize.width, paddingBorderSize.width),
    height: mMax(
      knownDimensions.height ?? minMaxDefiniteSize.height ?? clampedStyleSize.height,
      paddingBorderSize.height,
    ),
  };

  // Short-circuit layout if the container's size is fully determined and the run mode is ComputeSize
  if (runMode === 'compute-size') {
    if (styledBasedKnownDimensions.width !== null && styledBasedKnownDimensions.height !== null) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: styledBasedKnownDimensions.height });
    }
    if (inputs.axis === 'horizontal' && styledBasedKnownDimensions.width !== null) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: 0 });
    }
  }

  // Unwrap the block formatting context if one was passed, or else create a new one
  const innerInputs = { ...inputs, knownDimensions: styledBasedKnownDimensions };
  if (blockCtx !== undefined && !isScroll) {
    return computeInner(node, innerInputs, blockCtx);
  }
  return computeInner(node, innerInputs, { isRoot: true });
}

/** Computes the layout of a block container according to the block layout algorithm */
function computeInner(node: LayoutNode, inputs: LayoutInput, blockCtx: BlockContext): LayoutOutput {
  const nd = internals(node);
  const {
    knownDimensions: knownDimensionsIn,
    parentSize,
    availableSpace,
    runMode,
    verticalMarginsAreCollapsible,
  } = inputs;

  const style = node.style;
  const rawPadding = style.padding;
  const rawBorder = style.border;
  const rawMargin = style.margin;
  const aspectRatio = style.aspectRatio;
  const padding = resolveRectOrZero(rawPadding, parentSize.width);
  const border = resolveRectOrZero(rawBorder, parentSize.width);
  const direction = style.direction;

  // Scrollbar gutters are reserved when `overflow` is Scroll (axes transposed)
  const gutterOffsets = {
    x: style.overflow.y === 'scroll' ? style.scrollbarWidth : 0,
    y: style.overflow.x === 'scroll' ? style.scrollbarWidth : 0,
  };
  const scrollbarGutter: Rect<number> =
    direction === 'rtl'
      ? { top: 0, left: gutterOffsets.x, right: 0, bottom: gutterOffsets.y }
      : { top: 0, left: 0, right: gutterOffsets.x, bottom: gutterOffsets.y };
  const paddingBorder = rectAdd(padding, border);
  const paddingBorderSize = sumAxes(paddingBorder);
  const contentBoxInset = rectAdd(paddingBorder, scrollbarGutter);

  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSize : sizeZero();
  // Same rule as computeBlockLayout above: min/max stay on their own axis and
  // the ratio derives from the clamped specified size.
  const minSize = maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
  // `content-size` asks for the box's intrinsic content contribution while
  // the caller owns its preferred size. As in leaf and flex layout, suppress
  // this box's own preferred size and aspect-ratio transfer in that mode;
  // known dimensions still constrain descendants. This lets an automatic
  // ratio-dependent width query keep a definite height without resolving the
  // queried width straight back through the ratio before measuring children.
  const size =
    inputs.sizingMode === 'inherent-size'
      ? applyAspectRatioClamped(
          maybeAddSize(maybeResolveSize(style.size, parentSize), boxSizingAdjustment),
          minSize,
          maxSize,
          aspectRatio,
          boxSizingAdjustment,
        )
      : { width: null, height: null };

  // css-sizing-4: a definite size in one axis transfers through `aspect-ratio`.
  // Only a newly-filled axis is adopted (and clamped); an incoming known size is
  // left as the parent resolved it. Parent-known sizes are border-box values,
  // so content-box transfer must strip the source insets and add the destination
  // insets: Chrome 151, `height: 1px; padding-bottom: 1px; aspect-ratio: 1`
  // under content-box is 1x2, not 2x2.
  const derived =
    inputs.sizingMode === 'inherent-size'
      ? sizeMaybeClamp(
          maybeApplyAspectRatioUsed(knownDimensionsIn, aspectRatio, style.boxSizing, paddingBorderSize),
          minSize,
          maxSize,
        )
      : { width: null, height: null };
  const knownDimensions: Size<Opt> = {
    width: knownDimensionsIn.width ?? derived.width,
    height: knownDimensionsIn.height ?? derived.height,
  };
  const containerContentBoxSize: Size<Opt> = {
    width: mSub(knownDimensions.width, contentBoxInset.left + contentBoxInset.right),
    height: mSub(knownDimensions.height, contentBoxInset.top + contentBoxInset.bottom),
  };

  // A height that came from `aspect-ratio` rather than from a specified height
  // is an *automatic* size (css-sizing-4 §4.2): content taller than it grows
  // the box, where a specified height of the same value would be overflowed.
  // Chrome, `width: 100; aspect-ratio: 2` around a 100px-tall child:
  //   no max-width          -> 100x100 (ratio's 50 is only a floor)
  //   max-width: 50         ->  50x100 (clamped width, height still content)
  //   plus overflow: hidden -> 100x50  (scroll container: ratio height holds)
  //   height: 50 specified  -> 100x50  (definite: content overflows)
  // The scroll-container carve-out is the same discriminator §4.5 uses.
  const heightIsRatioDerived =
    aspectRatio !== null &&
    knownDimensions.height !== null &&
    maybeResolveSize(style.size, parentSize).height === null &&
    !isScrollContainer(style.overflow.y);

  const overflow = style.overflow;
  const isScroll = isScrollContainer(overflow.x) || isScrollContainer(overflow.y);

  // Determine margin collapsing behaviour
  const ownMarginsCollapseWithChildren: Line<boolean> = {
    start:
      verticalMarginsAreCollapsible.start &&
      !isScroll &&
      style.position === 'relative' &&
      padding.top === 0 &&
      border.top === 0,
    end:
      verticalMarginsAreCollapsible.end &&
      !isScroll &&
      style.position === 'relative' &&
      padding.bottom === 0 &&
      border.bottom === 0 &&
      size.height === null,
  };
  const hasStylesPreventingBeingCollapsedThrough =
    style.display !== 'block' ||
    blockCtx.isRoot ||
    isScroll ||
    style.position === 'absolute' ||
    padding.top > 0 ||
    padding.bottom > 0 ||
    border.top > 0 ||
    border.bottom > 0 ||
    (size.height !== null && size.height > 0) ||
    (minSize.height !== null && minSize.height > 0);

  const textAlign = inheritedTextAlign(node);
  const alignContent = style.alignContent;

  // 1. Generate items
  const items = generateItemList(node, containerContentBoxSize);

  // 2. Compute container width
  const containerOuterWidth =
    knownDimensions.width ??
    ((): number => {
      const availableWidth = asMaybeSub(availableSpace.width, contentBoxInset.left + contentBoxInset.right);
      const intrinsicWidth =
        determineContentBasedContainerWidth(items, availableWidth) + contentBoxInset.left + contentBoxInset.right;
      return vMax(vClamp(intrinsicWidth, minSize.width, maxSize.width), paddingBorderSize.width);
    })();

  // Short-circuit if computing size and both dimensions known
  if (runMode === 'compute-size' && knownDimensions.height !== null) {
    return fromOuterSize({ width: containerOuterWidth, height: knownDimensions.height });
  }

  // We can also short-circuit if the width is known and only the width has been requested
  if (runMode === 'compute-size' && inputs.axis === 'horizontal') {
    return fromOuterSize({ width: containerOuterWidth, height: 0 });
  }

  const containerPercentageResolutionHeight =
    knownDimensions.height ?? mMax(size.height, minSize.height) ?? minSize.height;

  // 3. Perform final item layout and return content height
  // Percentage padding resolves against the containing block's inline size,
  // not this box's eventual width (css-box-3 §4). Keep the values resolved
  // from `parentSize` above: Chrome 151 resolves 1% to 0.55px for an auto-sized
  // 321px block in a 55px flex container, not to 3.21px from the block itself.
  const resolvedContentBoxInset = rectAdd(rectAdd(padding, border), scrollbarGutter);

  const finalLayoutResult = performFinalLayoutOnInFlowChildren(
    runMode,
    items,
    containerOuterWidth,
    containerPercentageResolutionHeight,
    resolvedContentBoxInset,
    textAlign,
    direction,
    ownMarginsCollapseWithChildren,
  );
  let inflowContentSize = finalLayoutResult.inflowContentSize;
  const intrinsicOuterHeight = finalLayoutResult.contentHeight;
  const firstChildTopMarginSet = finalLayoutResult.firstChildTopMarginSet;
  const lastChildBottomMarginSet = finalLayoutResult.lastChildBottomMarginSet;
  let firstBaseline = finalLayoutResult.firstBaseline;

  // A ratio-derived height floors rather than fixes the box (see
  // heightIsRatioDerived): take the taller of it and the content height.
  const resolvedOuterHeight =
    knownDimensions.height !== null && heightIsRatioDerived
      ? Math.max(knownDimensions.height, vClamp(intrinsicOuterHeight, minSize.height, maxSize.height))
      : (knownDimensions.height ?? vClamp(intrinsicOuterHeight, minSize.height, maxSize.height));
  const containerOuterHeight = vMax(resolvedOuterHeight, paddingBorderSize.height);
  const finalOuterSize = { width: containerOuterWidth, height: containerOuterHeight };

  // Apply `align-content` to in-flow items if requested. The entire stack of
  // in-flow children is a single alignment subject (num_items = 1).
  if (alignContent !== null) {
    const containerInnerHeight = containerOuterHeight - resolvedContentBoxInset.top - resolvedContentBoxInset.bottom;
    const inflowContentHeight = intrinsicOuterHeight - resolvedContentBoxInset.top - resolvedContentBoxInset.bottom;
    const freeSpace = containerInnerHeight - inflowContentHeight;
    const anyInFlow = items.some((item) => item.finalLayout !== null);
    if (anyInFlow) {
      const keyword = applyAlignmentFallback(freeSpace, 1, alignContent);
      const groupOffset = computeAlignmentOffset(freeSpace, 1, 0, keyword, false, true);
      if (firstBaseline !== null) firstBaseline += groupOffset;
      for (const item of items) {
        if (item.finalLayout !== null) {
          item.finalLayout.location.y += groupOffset;
        }
      }

      inflowContentSize = sizeZero();
      for (const item of items) {
        if (item.finalLayout !== null) {
          const layout = item.finalLayout;
          const contribution = computeContentSizeContribution(
            {
              x: layout.location.x - resolvedContentBoxInset.left,
              y: layout.location.y - resolvedContentBoxInset.top,
            },
            layout.size,
            layout.contentSize,
            item.overflow,
          );
          inflowContentSize = {
            width: Math.max(inflowContentSize.width, contribution.width),
            height: Math.max(inflowContentSize.height, contribution.height),
          };
        }
      }
    }
  }

  // Determine whether this node can be collapsed through
  const allInFlowChildrenCanBeCollapsedThrough = items.every(
    (item) => item.position === 'absolute' || item.canBeCollapsedThrough,
  );
  const canBeCollapsedThrough = !hasStylesPreventingBeingCollapsedThrough && allInFlowChildrenCanBeCollapsedThrough;

  const output: LayoutOutput = {
    size: finalOuterSize,
    contentSize: sizeZero(),
    firstBaselines: { x: null, y: firstBaseline },
    topMargin: ownMarginsCollapseWithChildren.start
      ? firstChildTopMarginSet
      : marginSetFromMargin(resolveOrZero(rawMargin.top, parentSize.width)),
    bottomMargin: ownMarginsCollapseWithChildren.end
      ? lastChildBottomMarginSet
      : marginSetFromMargin(resolveOrZero(rawMargin.bottom, parentSize.width)),
    marginsCanCollapseThrough: canBeCollapsedThrough,
  };

  // Short-circuit if computing size. (The margin-collapsing outputs matter here:
  // parent block containers use them to compute their own intrinsic height.)
  if (runMode === 'compute-size') {
    return output;
  }

  // Commit deferred in-flow layouts to the tree
  for (const item of items) {
    if (item.finalLayout !== null) {
      internals(item.node).unroundedLayout = item.finalLayout;
    }
  }

  // 4. Layout absolutely positioned children
  const absolutePositionInset = rectAdd(border, scrollbarGutter);
  const absolutePositionArea = {
    width: finalOuterSize.width - absolutePositionInset.left - absolutePositionInset.right,
    height: finalOuterSize.height - absolutePositionInset.top - absolutePositionInset.bottom,
  };
  const absolutePositionOffset = { x: absolutePositionInset.left, y: absolutePositionInset.top };
  const absoluteContentSize = performAbsoluteLayoutOnAbsoluteChildren(
    items,
    absolutePositionArea,
    absolutePositionOffset,
    direction,
  );

  output.contentSize = {
    width: Math.max(inflowContentSize.width, absoluteContentSize.width),
    height: Math.max(inflowContentSize.height, absoluteContentSize.height),
  };

  // 5. Perform hidden layout on hidden children
  for (let order = 0; order < nd.children.length; order++) {
    const child = nd.children[order] ?? unreachable();
    const childNd = internals(child);
    if (childNd.style.display === 'none') {
      childNd.unroundedLayout = layoutWithOrder(order);
      performChildLayout(
        child,
        { width: null, height: null },
        { width: null, height: null },
        { width: 'max-content', height: 'max-content' },
        'inherent-size',
      );
    }
  }

  return output;
}

/** Create a BlockItem for each flow-participating child of the current node */
function generateItemList(node: LayoutNode, nodeInnerSize: Size<Opt>): BlockItem[] {
  const items: BlockItem[] = [];
  let order = 0;
  for (const child of internals(node).children) {
    const childStyle = internals(child).style;
    if (childStyle.display === 'none') continue;

    const aspectRatio = childStyle.aspectRatio;
    // Padding and border percentages resolve against the containing block's
    // INLINE size on all four sides — vertical ones included (css-box-3 §4).
    // Resolving top/bottom against the block size instead inflates vertical
    // padding whenever the container is taller than it is wide; found by
    // differential fuzzing.
    const padding = resolveRectOrZero(childStyle.padding, nodeInnerSize.width);
    const border = resolveRectOrZero(childStyle.border, nodeInnerSize.width);
    const pbSum = sumAxes(rectAdd(padding, border));
    const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? pbSum : sizeZero();

    const position = childStyle.position;
    const overflow = childStyle.overflow;
    const isBlock = childStyle.display === 'block';
    const isScroll = isScrollContainer(overflow.x) || isScrollContainer(overflow.y);
    const isInSameBfc = isBlock && position !== 'absolute' && !isScroll;

    const resolvedStyleSize = maybeResolveSize(childStyle.size, nodeInnerSize);
    const childSpecifiedSize = toUsedBorderBoxSize(resolvedStyleSize, childStyle.boxSizing, pbSum);
    const childMinSize = toUsedBorderBoxSize(
      maybeResolveSize(childStyle.minSize, nodeInnerSize),
      childStyle.boxSizing,
      pbSum,
    );
    const childMaxSize = toUsedBorderBoxSize(
      maybeResolveSize(childStyle.maxSize, nodeInnerSize),
      childStyle.boxSizing,
      pbSum,
    );
    const childRatioSize = applyAspectRatioClamped(
      childSpecifiedSize,
      childMinSize,
      childMaxSize,
      aspectRatio,
      boxSizingAdjustment,
    );

    items.push({
      node: child,
      order: order++,
      isInSameBfc,
      // The ratio derives from the *clamped* specified size, so an axis with a
      // size of its own is never re-derived from the other axis's constraint.
      size: childRatioSize,
      widthIsRatioDerived: childSpecifiedSize.width === null && childRatioSize.width !== null,
      aspectRatio,
      boxSizing: childStyle.boxSizing,
      // A block child in normal flow stretches its inline axis only, so that is
      // the one axis a constraint may transfer into. See
      // transferUsedConstraintToStretchedAxis.
      minSize: transferUsedConstraintToStretchedAxis(
        childMinSize,
        resolvedStyleSize,
        aspectRatio,
        BLOCK_STRETCHES_INLINE_AXIS,
        childStyle.boxSizing,
        pbSum,
        Math.max,
      ),
      maxSize: transferUsedConstraintToStretchedAxis(
        childMaxSize,
        resolvedStyleSize,
        aspectRatio,
        BLOCK_STRETCHES_INLINE_AXIS,
        childStyle.boxSizing,
        pbSum,
        Math.min,
      ),
      overflow: { ...overflow },
      scrollbarWidth: childStyle.scrollbarWidth,
      position,
      inset: { ...childStyle.inset },
      margin: { ...childStyle.margin },
      padding,
      border,
      paddingBorderSum: pbSum,

      computedSize: sizeZero(),
      staticPosition: { x: 0, y: 0 },
      canBeCollapsedThrough: false,
      finalLayout: null,
    });
  }
  return items;
}

// A block child in normal flow fills its containing block's inline axis and is
// content-sized in the block axis, so only the inline axis is "stretched" for
// the purposes of transferring an aspect-ratio constraint.
const BLOCK_STRETCHES_INLINE_AXIS: Size<boolean> = { width: true, height: false };

/** Compute the content-based width in the case that the width of the container is not known */
function determineContentBasedContainerWidth(items: BlockItem[], availableWidth: AvailableSpace): number {
  const availableSpace: Size<AvailableSpace> = { width: availableWidth, height: 'min-content' };

  let maxChildWidth = 0;
  for (const item of items) {
    if (item.position === 'absolute') continue;
    const knownDimensions = sizeMaybeClamp(item.size, item.minSize, item.maxSize);

    // Percentage margins resolve against the width being computed here, so the
    // basis is indefinite and they contribute zero (css-sizing-3 §5.2). Passing
    // the available width instead lets a `margin-left: -50%` shrink the
    // container that defines it — Chrome sizes such a box to 100 for both
    // `-50%` and `+50%`, where this resolved to 50 and 150. Pixel margins do
    // still contribute.
    const itemXMarginSum = resolveOrZero(item.margin.left, null) + resolveOrZero(item.margin.right, null);
    let width =
      knownDimensions.width ??
      measureChildSize(
        item.node,
        knownDimensions,
        { width: null, height: null },
        { width: asMaybeSub(availableSpace.width, itemXMarginSum), height: availableSpace.height },
        'inherent-size',
        'horizontal',
        LINE_TRUE,
      );

    // Intrinsic measurement returns the child's unconstrained content width;
    // clamp that contribution by its used min/max too. This matters when a
    // block-axis constraint transferred through aspect-ratio: Chrome 151 caps
    // a text child's contribution at 2px for `max-height: 1px; aspect-ratio:
    // 2`, rather than keeping the text's 10px min-content width.
    width = vClamp(width, item.minSize.width, item.maxSize.width);
    width = Math.max(width, item.paddingBorderSum.width) + itemXMarginSum;
    maxChildWidth = Math.max(maxChildWidth, width);
  }

  return maxChildWidth;
}

interface FinalLayoutResult {
  inflowContentSize: Size<number>;
  contentHeight: number;
  firstChildTopMarginSet: CollapsibleMarginSet;
  lastChildBottomMarginSet: CollapsibleMarginSet;
  firstBaseline: Opt;
}

/** Compute each in-flow child's final size and position */
function performFinalLayoutOnInFlowChildren(
  runMode: LayoutInput['runMode'],
  items: BlockItem[],
  containerOuterWidth: number,
  containerPercentageResolutionHeightIn: Opt,
  resolvedContentBoxInset: Rect<number>,
  textAlign: TextAlign,
  direction: Direction,
  ownMarginsCollapseWithChildren: Line<boolean>,
): FinalLayoutResult {
  // Resolve container_inner_width for sizing child nodes
  const containerInnerWidth = containerOuterWidth - resolvedContentBoxInset.left - resolvedContentBoxInset.right;
  const containerPercentageResolutionHeight = mSub(
    containerPercentageResolutionHeightIn,
    resolvedContentBoxInset.top + resolvedContentBoxInset.bottom,
  );
  const parentSize: Size<Opt> = { width: containerInnerWidth, height: containerPercentageResolutionHeight };
  // Vertical available space in block flow is indefinite — 'max-content' is
  // how that is represented here.
  const availableSpace: Size<AvailableSpace> = { width: containerInnerWidth, height: 'max-content' };

  let inflowContentSize = sizeZero();
  let committedYOffset = resolvedContentBoxInset.top;
  let yOffsetForAbsolute = resolvedContentBoxInset.top;
  let firstChildTopMarginSet = collapsibleMarginZero();
  let activeCollapsibleMarginSet = collapsibleMarginZero();
  let isCollapsingWithFirstMarginSet = true;
  let firstBaseline: Opt = null;

  for (const item of items) {
    if (item.position === 'absolute') {
      const x =
        direction === 'ltr' ? resolvedContentBoxInset.left : containerOuterWidth - resolvedContentBoxInset.right;
      item.staticPosition = { x, y: yOffsetForAbsolute };
    } else {
      const itemMargin: Rect<Opt> = {
        left: maybeResolve(item.margin.left, containerInnerWidth),
        right: maybeResolve(item.margin.right, containerInnerWidth),
        top: maybeResolve(item.margin.top, containerInnerWidth),
        bottom: maybeResolve(item.margin.bottom, containerInnerWidth),
      };
      const itemNonAutoMargin: Rect<number> = {
        left: itemMargin.left ?? 0,
        right: itemMargin.right ?? 0,
        top: itemMargin.top ?? 0,
        bottom: itemMargin.bottom ?? 0,
      };
      const itemNonAutoXMarginSum = itemNonAutoMargin.left + itemNonAutoMargin.right;

      const scrollbarSize = {
        width: item.overflow.y === 'scroll' ? item.scrollbarWidth : 0,
        height: item.overflow.x === 'scroll' ? item.scrollbarWidth : 0,
      };

      let yMarginOffset = 0;

      let stretchWidth: number;
      let floatAvoidingPosition: Point<number>;
      let floatAvoidingWidth: number;
      if (item.isInSameBfc) {
        stretchWidth = containerInnerWidth - itemNonAutoXMarginSum;
        floatAvoidingPosition = { x: 0, y: 0 };
        floatAvoidingWidth = 0;
      } else {
        // Set y_margin_offset (different bfc child)
        if (!isCollapsingWithFirstMarginSet || !ownMarginsCollapseWithChildren.start) {
          yMarginOffset = resolveMarginSet(collapseWithMargin(activeCollapsibleMarginSet, itemNonAutoMargin.top));
        }
        const minY = committedYOffset + yMarginOffset;

        stretchWidth = containerInnerWidth - itemNonAutoXMarginSum;
        floatAvoidingPosition = { x: resolvedContentBoxInset.left, y: minY };
        floatAvoidingWidth = containerInnerWidth;
      }

      const knownDimensions: Size<Opt> = ((): Size<Opt> => {
        // A width derived from `aspect-ratio` is an *automatic* size
        // (css-sizing-4 §4.2), so content wider than the ratio implies grows
        // the box. A *specified* width of the same value does not — the content
        // overflows instead — which is why the two provenances are tracked
        // apart rather than both read off `item.size.width`.
        let itemWidth = item.size.width;
        if (itemWidth !== null && item.widthIsRatioDerived) {
          // `content-size` mode, not `inherent-size`: the latter lets the
          // child re-derive its width from its own height through the same
          // ratio, so it just measures the ratio again (10, not 97).
          const minContentWidth = measureChildSize(
            item.node,
            { width: null, height: null },
            parentSize,
            { width: 'min-content', height: 'max-content' },
            'content-size',
            'horizontal',
          );
          itemWidth = Math.max(itemWidth, minContentWidth);
        }
        // Under `box-sizing: border-box` a box is never smaller than its own
        // padding+border, so that floor is a height even with no specified
        // height, min-height, or content — and the ratio transfers it into the
        // inline axis. It *floors* the stretch fit rather than replacing it:
        // Chrome, a block child with `aspect-ratio: .5; padding: 320px 0 20px`
        // (a 340 height floor, so 170 wide through the ratio), as the parent's
        // content width varies — 20 -> 170x340, 170 -> 170x340, 171 -> 171x342,
        // 300 -> 300x600. Past the derived width the stretch fit wins and the
        // height follows it back through the ratio.
        // Content-box is excluded: there the ratio relates the content boxes,
        // which are 0x0 here, so the transfer is a no-op (fixture
        // fuzz_ar_contentbox keeps its stretch width).
        const ratioInsetFloorWidth =
          itemWidth === null &&
          item.aspectRatio !== null &&
          item.boxSizing === 'border-box' &&
          item.size.height === null &&
          item.paddingBorderSum.height > 0
            ? item.paddingBorderSum.height * item.aspectRatio
            : 0;
        // A box is never narrower than its own inline padding+border, so a
        // stretch fit smaller than that sum does not shrink the box — it
        // overflows the parent instead. Chrome, a block child with
        // `border-left: 7; border-right: 320` (a 327 floor) in a parent whose
        // content width is 0 -> 327 wide, 100 -> 327, 400 -> 400. Padding
        // behaves identically, and so does `box-sizing: content-box` (there the
        // insets sit outside the content box, so the border box is at least
        // that wide either way). This clamped the child to the parent's width.
        const inlineInsetFloor = item.paddingBorderSum.width;
        const withWidth: Size<Opt> = {
          width: vClamp(
            Math.max(itemWidth ?? stretchWidth, ratioInsetFloorWidth, inlineInsetFloor),
            item.minSize.width,
            item.maxSize.width,
          ),
          height: item.size.height,
        };
        return sizeMaybeClamp(withWidth, item.minSize, item.maxSize);
      })();

      const childInputs: LayoutInput = {
        runMode,
        sizingMode: 'inherent-size',
        axis: 'both',
        knownDimensions,
        parentSize,
        availableSpace: { width: stretchWidth, height: availableSpace.height },
        verticalMarginsAreCollapsible: item.isInSameBfc ? LINE_TRUE : LINE_FALSE,
      };

      let itemLayout: LayoutOutput;
      if (item.isInSameBfc) {
        // Compute child layout within a sub-context of this BFC
        const childBlockCtx: BlockContext = { isRoot: false };
        itemLayout = computeChildLayout(item.node, childInputs, childBlockCtx);
      } else {
        itemLayout = computeChildLayout(item.node, childInputs);
      }
      const finalSize = itemLayout.size;

      const topMarginSet = collapseWithMargin(itemLayout.topMargin, itemMargin.top ?? 0);
      const bottomMarginSet = collapseWithMargin(itemLayout.bottomMargin, itemMargin.bottom ?? 0);

      // Expand auto margins to fill available space.
      // Note: vertical auto-margins for relatively positioned block items resolve to 0.
      const freeXSpace = Math.max(0, stretchWidth - finalSize.width);
      const autoMarginCount = (itemMargin.left === null ? 1 : 0) + (itemMargin.right === null ? 1 : 0);
      const xAxisAutoMarginSize = autoMarginCount > 0 ? freeXSpace / autoMarginCount : 0;
      const resolvedMargin: Rect<number> = {
        left: itemMargin.left ?? xAxisAutoMarginSize,
        right: itemMargin.right ?? xAxisAutoMarginSize,
        top: resolveMarginSet(topMarginSet),
        bottom: resolveMarginSet(bottomMarginSet),
      };

      // Relative percentage insets resolve against the containing block's
      // corresponding size. Keep them unresolved when its height is indefinite
      // (CSS2 §9.4.3; Blink ComputeRelativeOffset). Chrome moves an item with
      // `bottom: 75%` up 12.75px in a 17px-tall block, not zero pixels.
      const inset: Rect<Opt> = {
        left: maybeResolve(item.inset.left, containerInnerWidth),
        right: maybeResolve(item.inset.right, containerInnerWidth),
        top: maybeResolve(item.inset.top, parentSize.height),
        bottom: maybeResolve(item.inset.bottom, parentSize.height),
      };
      const insetOffset: Point<number> = {
        x: direction === 'rtl' ? (negate(inset.right) ?? inset.left ?? 0) : (inset.left ?? negate(inset.right) ?? 0),
        y: inset.top ?? negate(inset.bottom) ?? 0,
      };

      // Set y_margin_offset (same bfc child)
      if (item.isInSameBfc && (!isCollapsingWithFirstMarginSet || !ownMarginsCollapseWithChildren.start)) {
        yMarginOffset = resolveMarginSet(collapseWithMargin(activeCollapsibleMarginSet, resolvedMargin.top));
      }

      item.computedSize = itemLayout.size;
      item.canBeCollapsedThrough = itemLayout.marginsCanCollapseThrough;
      if (item.isInSameBfc) {
        const unclearedY = committedYOffset + resolveMarginSet(activeCollapsibleMarginSet);
        item.staticPosition = {
          x:
            direction === 'ltr'
              ? resolvedContentBoxInset.left
              : containerOuterWidth - resolvedContentBoxInset.right - finalSize.width,
          y: unclearedY,
        };
      } else {
        item.staticPosition = {
          x:
            direction === 'ltr'
              ? floatAvoidingPosition.x
              : floatAvoidingPosition.x + floatAvoidingWidth - finalSize.width,
          y: floatAvoidingPosition.y,
        };
      }
      const location: Point<number> = item.isInSameBfc
        ? {
            x:
              direction === 'ltr'
                ? resolvedContentBoxInset.left + insetOffset.x + resolvedMargin.left
                : containerOuterWidth -
                  resolvedContentBoxInset.right -
                  finalSize.width -
                  resolvedMargin.right +
                  insetOffset.x,
            y: committedYOffset + yMarginOffset + insetOffset.y,
          }
        : {
            x:
              direction === 'ltr'
                ? floatAvoidingPosition.x + resolvedMargin.left + insetOffset.x
                : floatAvoidingPosition.x + floatAvoidingWidth - finalSize.width - resolvedMargin.right + insetOffset.x,
            y: floatAvoidingPosition.y + insetOffset.y,
          };

      // Apply text-align alignment
      const itemOuterWidth = itemLayout.size.width + resolvedMargin.left + resolvedMargin.right;
      if (itemOuterWidth < containerInnerWidth) {
        const freeAlignSpace = containerInnerWidth - itemOuterWidth;
        if (textAlign === 'legacy-left' && direction === 'rtl') location.x -= freeAlignSpace;
        else if (textAlign === 'legacy-right' && direction === 'ltr') location.x += freeAlignSpace;
        else if (textAlign === 'legacy-center' && direction === 'ltr') location.x += freeAlignSpace / 2;
        else if (textAlign === 'legacy-center' && direction === 'rtl') location.x -= freeAlignSpace / 2;
      }

      // A block container's first baseline is the first baseline of its first in-flow child that has one
      if (firstBaseline === null && itemLayout.firstBaselines.y !== null) {
        firstBaseline = location.y + itemLayout.firstBaselines.y;
      }

      // Defer set_unrounded_layout so align-content can shift location.y before commit
      item.finalLayout = {
        order: item.order,
        size: itemLayout.size,
        contentSize: itemLayout.contentSize,
        scrollbarSize,
        location,
        padding: item.padding,
        border: item.border,
        margin: resolvedMargin,
      };

      {
        const contribution = computeContentSizeContribution(
          { x: location.x - resolvedContentBoxInset.left, y: location.y - resolvedContentBoxInset.top },
          finalSize,
          itemLayout.contentSize,
          item.overflow,
        );
        inflowContentSize = {
          width: Math.max(inflowContentSize.width, contribution.width),
          height: Math.max(inflowContentSize.height, contribution.height),
        };
      }

      // Update first_child_top_margin_set
      if (isCollapsingWithFirstMarginSet) {
        if (item.canBeCollapsedThrough) {
          firstChildTopMarginSet = collapseWithSet(
            collapseWithSet(firstChildTopMarginSet, topMarginSet),
            bottomMarginSet,
          );
        } else {
          firstChildTopMarginSet = collapseWithSet(firstChildTopMarginSet, topMarginSet);
          isCollapsingWithFirstMarginSet = false;
        }
      }

      // Update active_collapsible_margin_set
      if (item.canBeCollapsedThrough) {
        activeCollapsibleMarginSet = collapseWithSet(
          collapseWithSet(activeCollapsibleMarginSet, topMarginSet),
          bottomMarginSet,
        );
        yOffsetForAbsolute = committedYOffset + itemLayout.size.height + yMarginOffset;
      } else {
        committedYOffset = location.y - insetOffset.y + itemLayout.size.height;
        activeCollapsibleMarginSet = bottomMarginSet;
        yOffsetForAbsolute = committedYOffset + resolveMarginSet(activeCollapsibleMarginSet);
      }
    }
  }

  const lastChildBottomMarginSet = activeCollapsibleMarginSet;
  const bottomYMarginOffset = ownMarginsCollapseWithChildren.end ? 0 : resolveMarginSet(lastChildBottomMarginSet);

  committedYOffset += resolvedContentBoxInset.bottom + bottomYMarginOffset;
  const contentHeight = Math.max(0, committedYOffset);
  return {
    inflowContentSize,
    contentHeight,
    firstChildTopMarginSet,
    lastChildBottomMarginSet,
    firstBaseline,
  };
}

/** Perform absolute layout on all absolutely positioned children. */
function performAbsoluteLayoutOnAbsoluteChildren(
  items: BlockItem[],
  areaSize: Size<number>,
  areaOffset: Point<number>,
  direction: Direction,
): Size<number> {
  const areaWidth = areaSize.width;
  const areaHeight = areaSize.height;

  let absoluteContentSize = sizeZero();

  for (const item of items) {
    if (item.position !== 'absolute') continue;
    const childStyle = internals(item.node).style;
    if (childStyle.display === 'none' || childStyle.position !== 'absolute') continue;

    const aspectRatio = childStyle.aspectRatio;
    const margin: Rect<Opt> = {
      left: maybeResolve(childStyle.margin.left, areaWidth),
      right: maybeResolve(childStyle.margin.right, areaWidth),
      top: maybeResolve(childStyle.margin.top, areaWidth),
      bottom: maybeResolve(childStyle.margin.bottom, areaWidth),
    };
    const padding = resolveRectOrZero(childStyle.padding, areaWidth);
    const border = resolveRectOrZero(childStyle.border, areaWidth);
    const paddingBorderSum = sumAxes(rectAdd(padding, border));
    const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? paddingBorderSum : sizeZero();

    // Resolve inset
    const left = maybeResolve(childStyle.inset.left, areaWidth);
    const right = maybeResolve(childStyle.inset.right, areaWidth);
    const top = maybeResolve(childStyle.inset.top, areaHeight);
    const bottom = maybeResolve(childStyle.inset.bottom, areaHeight);

    // Compute known dimensions from min/max/inherent size styles
    const resolvedStyleSize = maybeResolveSize(childStyle.size, areaSize);
    const resolvedMinSize = maybeResolveSize(childStyle.minSize, areaSize);
    const resolvedMaxSize = maybeResolveSize(childStyle.maxSize, areaSize);
    const styleSize = maybeAddSize(maybeApplyAspectRatio(resolvedStyleSize, aspectRatio), boxSizingAdjustment);
    const minSizeRaw = maybeAddSize(resolvedMinSize, boxSizingAdjustment);
    let minSize = transferMinSizeThroughAspectRatio(
      {
        width: Math.max(minSizeRaw.width ?? paddingBorderSum.width, paddingBorderSum.width),
        height: Math.max(minSizeRaw.height ?? paddingBorderSum.height, paddingBorderSum.height),
      },
      resolvedMinSize,
      resolvedStyleSize,
      resolvedMaxSize,
      aspectRatio,
      childStyle.boxSizing,
      paddingBorderSum,
    );
    const maxSize = transferMaxSizeThroughAspectRatio(
      resolvedMaxSize,
      resolvedStyleSize,
      minSize,
      aspectRatio,
      childStyle.boxSizing,
      paddingBorderSum,
    );
    const ratioAutoMinInlineApplies =
      aspectRatio !== null &&
      childStyle.minSize.width === 'auto' &&
      childStyle.overflow.x === 'visible' &&
      (childStyle.overflow.y === 'visible' || childStyle.overflow.y === 'clip') &&
      (resolvedStyleSize.height !== null || (top !== null && bottom !== null));
    if (ratioAutoMinInlineApplies) {
      const minContentWidth = measureChildSize(
        item.node,
        { width: null, height: null },
        areaSize,
        { width: 'min-content', height: 'max-content' },
        'content-size',
        'horizontal',
      );
      minSize = { ...minSize, width: Math.max(minSize.width, Math.min(minContentWidth, maxSize.width ?? Infinity)) };
    }
    let knownDimensions = sizeMaybeClamp(styleSize, minSize, maxSize);

    if (
      knownDimensions.width === null &&
      left !== null &&
      right !== null &&
      absoluteAxisStretches(childStyle.justifySelf)
    ) {
      const newWidthRaw = vSub(vSub(areaWidth, margin.left), margin.right) - left - right;
      knownDimensions.width = Math.max(newWidthRaw, 0);
      knownDimensions = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);
    }

    if (knownDimensions.height === null && top !== null && bottom !== null) {
      const newHeightRaw = vSub(vSub(areaHeight, margin.top), margin.bottom) - top - bottom;
      knownDimensions.height = Math.max(newHeightRaw, 0);
      knownDimensions = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);
    }
    if (ratioAutoMinInlineApplies && resolvedStyleSize.height === null && knownDimensions.width !== null) {
      knownDimensions = sizeMaybeClamp(
        maybeApplyAspectRatioUsed(
          { width: knownDimensions.width, height: null },
          aspectRatio,
          childStyle.boxSizing,
          paddingBorderSum,
        ),
        minSize,
        maxSize,
      );
    }

    const availableSpace: Size<AvailableSpace> = {
      width:
        left === null && right === null
          ? vClamp(areaWidth, minSize.width, maxSize.width)
          : insetModifiedContainingBlockSize(areaWidth, { start: left, end: right }),
      height: vClamp(areaHeight, minSize.height, maxSize.height),
    };

    const measuredSize = measureChildSizeBoth(
      item.node,
      knownDimensions,
      { width: areaSize.width, height: areaSize.height },
      availableSpace,
      'content-size',
    );

    const finalSize: Size<number> = {
      width: vClamp(knownDimensions.width ?? measuredSize.width, minSize.width, maxSize.width),
      height: vClamp(knownDimensions.height ?? measuredSize.height, minSize.height, maxSize.height),
    };

    const layoutOutput = performChildLayout(
      item.node,
      { width: finalSize.width, height: finalSize.height },
      { width: areaSize.width, height: areaSize.height },
      availableSpace,
      'content-size',
    );

    const resolvedHorizontal = resolveAlignedAbsoluteAxis(
      areaWidth,
      { start: left, end: right },
      { start: margin.left, end: margin.right },
      finalSize.width,
      true,
      direction !== 'rtl',
      childStyle.justifySelf,
    );
    const resolvedVertical = resolveAbsoluteAxis(
      areaHeight,
      { start: top, end: bottom },
      { start: margin.top, end: margin.bottom },
      finalSize.height,
      false,
      true,
    );
    const resolvedMargin: Rect<number> = {
      left: resolvedHorizontal.margin.start,
      right: resolvedHorizontal.margin.end,
      top: resolvedVertical.margin.start,
      bottom: resolvedVertical.margin.end,
    };
    const usedLeft = resolvedHorizontal.inset.start;
    const usedRight = resolvedHorizontal.inset.end;
    const usedTop = resolvedVertical.inset.start;
    const usedBottom = resolvedVertical.inset.end;

    let xOffset: number;
    if (usedLeft !== null && usedRight !== null) {
      xOffset =
        direction === 'rtl'
          ? areaSize.width - finalSize.width - usedRight - resolvedMargin.right
          : usedLeft + resolvedMargin.left;
    } else if (usedLeft !== null) {
      xOffset = usedLeft + resolvedMargin.left;
    } else if (usedRight !== null) {
      xOffset = areaSize.width - finalSize.width - usedRight - resolvedMargin.right;
    } else {
      xOffset =
        direction === 'rtl'
          ? item.staticPosition.x - finalSize.width - resolvedMargin.right - areaOffset.x
          : item.staticPosition.x + resolvedMargin.left - areaOffset.x;
    }
    const yFromInset =
      usedTop !== null
        ? usedTop + resolvedMargin.top
        : usedBottom !== null
          ? areaSize.height - finalSize.height - usedBottom - resolvedMargin.bottom
          : null;
    const location: Point<number> = {
      x: xOffset + areaOffset.x,
      y: yFromInset !== null ? yFromInset + areaOffset.y : item.staticPosition.y + resolvedMargin.top,
    };
    // Note: axis intentionally switched — scrollbars take up space in the
    // opposite axis to the axis in which scrolling is enabled.
    const scrollbarSize = {
      width: item.overflow.y === 'scroll' ? item.scrollbarWidth : 0,
      height: item.overflow.x === 'scroll' ? item.scrollbarWidth : 0,
    };

    internals(item.node).unroundedLayout = {
      order: item.order,
      size: finalSize,
      contentSize: layoutOutput.contentSize,
      scrollbarSize,
      location,
      padding,
      border,
      margin: resolvedMargin,
    };

    {
      const relativeLocation = { x: location.x - areaOffset.x, y: location.y - areaOffset.y };
      const contribution = computeContentSizeContribution(
        relativeLocation,
        finalSize,
        layoutOutput.contentSize,
        item.overflow,
      );
      absoluteContentSize = {
        width: Math.max(absoluteContentSize.width, contribution.width),
        height: Math.max(absoluteContentSize.height, contribution.height),
      };
    }
  }

  return absoluteContentSize;
}

// --- small local helpers (same semantics as flexbox.ts's)

function maybeAddSize(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: s.width !== null ? s.width + rhs.width : null,
    height: s.height !== null ? s.height + rhs.height : null,
  };
}

function sizeMaybeClamp(s: Size<Opt>, min: Size<Opt>, max: Size<Opt>): Size<Opt> {
  return {
    width: s.width !== null ? vClamp(s.width, min.width, max.width) : null,
    height: s.height !== null ? vClamp(s.height, min.height, max.height) : null,
  };
}

function negate(v: Opt): Opt {
  return v !== null ? -v : null;
}
