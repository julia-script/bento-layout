// The CSS Flexible Box Layout algorithm.
// https://www.w3.org/TR/css-flexbox-1/#layout-algorithm
// Function names and section comments follow the spec's numbered steps.

import { unreachable } from '../assert.js';
import type { FlexDirection, Point, Rect, Size } from '../geometry.js';
import {
  applyAspectRatioClamped,
  cross,
  crossAxis,
  isColumn as dirIsColumn,
  isRow as dirIsRow,
  isReverse,
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
  sizeMax,
  sizeZero,
  sumAxes,
  withCross,
  withMain,
} from '../geometry.js';
import type { Opt } from '../math.js';
import { isNormal, mAdd, mClamp, mMax, mMin, mSub, vClamp, vMax, vMin, vSub } from '../math.js';
import type { AlignContent, AlignItems, AvailableSpace, Direction, JustifyContent, Overflow, Style } from '../style.js';
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
import { traceLayout } from '../trace.js';
import type { LayoutInput, LayoutNode, LayoutOutput } from '../tree.js';
import { fromOuterSize, fromSizesAndBaselines, internals, layoutWithOrder, LINE_FALSE } from '../tree.js';
import {
  absoluteAxisStretches,
  applyAlignmentFallback,
  computeAlignmentOffset,
  computeContentSizeContribution,
  insetModifiedContainingBlockSize,
  resolveAbsoluteAxis,
  resolveAlignedAbsoluteAxis,
  resolveSelfAlignmentSafety,
} from './alignment.js';
import {
  maybeApplyAspectRatioUsed,
  toUsedBorderBoxSize,
  transferMaxSizeThroughAspectRatio,
  transferMinSizeThroughAspectRatio,
  transferUsedConstraintToStretchedAxis,
} from './aspectRatio.js';
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
  node: LayoutNode;
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
  minContentContribution: number;
  /** A definite cross minimum transferred through the item's aspect ratio. */
  transferredMinMainSize: Opt;
  /** A definite cross maximum transferred through the item's aspect ratio. */
  transferredMaxMainSize: Opt;

  flexBasis: number;
  /** `flex-basis` was specified (not `auto`), so it replaces the style main size. */
  flexBasisIsExplicit: boolean;
  /** The used flex basis came from a definite basis, main size, or ratio transfer. */
  flexBasisIsDefinite: boolean;
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
  /** The container's own ratio and box-sizing — the cross-axis inset floor
   *  transfers through the ratio into the main size (determineContainerMainSize). */
  aspectRatio: number | null;
  boxSizing: Style['boxSizing'];
  paddingBorderSize: Size<number>;
  mainSizeIsAuto: boolean;
  mainSizeIsDefinite: boolean;
  crossSizeIsAuto: boolean;
  /** Numeric cross space inherited from a parent that remains CSS-indefinite. */
  crossSizeIsIndefinite: boolean;
  /** Out-of-flow containers receive containing-block space, not a stretched used cross size. */
  isOutOfFlow: boolean;
  /** An automatic cross size was made numeric solely by a min/max pair. */
  crossSizeIsMinMaxDefinite: boolean;
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
   * larger than it grows the container instead of overflowing, except in a
   * scroll container.
   */
  crossIsRatioDerived: boolean;
  /** Width was resolved from column-item intrinsic contributions before flexing. */
  crossIsIntrinsicColumn: boolean;

  containerSize: Size<number>;
  innerContainerSize: Size<number>;
}

/** Computes the layout of a box according to the flexbox algorithm */
export function computeFlexboxLayout(node: LayoutNode, inputs: LayoutInput): LayoutOutput {
  const { knownDimensions, parentSize, runMode } = inputs;
  const style = internals(node).style;
  const dir = style.flexDirection;

  const aspectRatio = style.aspectRatio;
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorderSum = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSum : sizeZero();

  // Min/max stay on their own axis and the ratio derives from the *clamped*
  // specified size — see the matching note in block.ts. Applying the ratio
  // first and clamping after transfers a bound onto the other axis:
  // `height: 200; aspect-ratio: 2; max-width: 3` is 3x200 in
  // Chrome for every display type, not 3x2.
  const minSize = toUsedBorderBoxSize(maybeResolveSize(style.minSize, parentSize), style.boxSizing, paddingBorderSum);
  const maxSize = toUsedBorderBoxSize(maybeResolveSize(style.maxSize, parentSize), style.boxSizing, paddingBorderSum);
  // The preferred ratio works in the box selected by `box-sizing` (Sizing 4
  // §4.1). A definite border-box source is therefore floored by its own
  // padding/border before it determines the automatic axis. Blink 7922's
  // BlockSizeFromAspectRatio receives the already-used inline border box and
  // asserts it is at least BorderPadding().InlineSum(). Applying the ratio to
  // an authored `width: 0` first lost that floor: 40px of inline padding at
  // ratio 2 became 40x0 instead of Chrome's 40x20.
  const resolvedStyleSize = toUsedBorderBoxSize(
    maybeResolveSize(style.size, parentSize),
    style.boxSizing,
    paddingBorderSum,
  );
  const clampedStyleSize: Size<Opt> =
    inputs.sizingMode === 'inherent-size'
      ? applyAspectRatioClamped(resolvedStyleSize, minSize, maxSize, aspectRatio, boxSizingAdjustment)
      : { width: null, height: null };
  for (const axis of ['width', 'height'] as const) {
    if (resolvedStyleSize[axis] !== null) {
      traceLayout(node, {
        phase: 'container-input',
        source: 'preferred-size',
        axis,
        value: resolvedStyleSize[axis],
      });
    } else if (aspectRatio !== null && clampedStyleSize[axis] !== null) {
      traceLayout(node, {
        phase: 'container-input',
        source: 'aspect-ratio',
        axis,
        value: clampedStyleSize[axis],
        detail: `ratio=${aspectRatio}`,
      });
    }
  }

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
  // `knownDimensions` are border-box sizes, but a content-box ratio relates
  // the content boxes (css-sizing-4 §4.1). Strip the source-axis insets before
  // transferring and add the destination-axis insets back. Chrome 151 sizes an
  // auto-width root with 150px inline insets, 50px block insets and ratio 1.5
  // to 150x50 in content-box mode, not 150x100.
  // `content-size` asks for the child's intrinsic content contribution while
  // the caller owns preferred sizing. Preserve known dimensions on their own
  // axes, but do not derive the other axis through the child's ratio: doing so
  // makes both axes known and short-circuits before descendants are measured.
  // Leaf layout follows the same protocol by nulling its aspect ratio in this
  // mode. Blink's flex BlockSizeFunc likewise bypasses its ratio kContent path
  // when it asks for the separate kIntrinsic size.
  const derivedFromKnown =
    inputs.sizingMode === 'inherent-size'
      ? sizeMaybeClamp(
          applyAspectRatioClamped(knownDimensions, minSize, maxSize, aspectRatio, boxSizingAdjustment),
          minSize,
          maxSize,
        )
      : { width: null, height: null };

  // The size of the container should be floored by the padding and border
  const styledBasedKnownDimensions: Size<Opt> = {
    // Parent-known dimensions are border-box sizes too, so they cannot bypass
    // this floor (css-sizing-3 §3.3). Chrome, a block child with `height: 0`
    // and 1px of border, uses a 1px border box; keeping the parent-known zero
    // collapsed both the child and its block parent to zero.
    width: mMax(
      knownDimensions.width ?? minMaxDefiniteSize.width ?? clampedStyleSize.width ?? derivedFromKnown.width,
      paddingBorderSum.width,
    ),
    height: mMax(
      knownDimensions.height ?? minMaxDefiniteSize.height ?? clampedStyleSize.height ?? derivedFromKnown.height,
      paddingBorderSum.height,
    ),
  };

  // Remember when the automatic main size came from the ratio rather than the
  // parent. CSS Sizing 4 §4.2 gives that ratio-dependent axis an automatic
  // min-content floor; a parent-imposed flexed size must remain authoritative.
  // Clamp the derived value on its own axis now as well: ratio transfer happens
  // after the source axis is clamped, so an explicit min/max on the dependent
  // axis cannot participate until after transfer.
  const mainIsRatioDerived =
    aspectRatio !== null &&
    main(knownDimensions, dir) === null &&
    main(resolvedStyleSize, dir) === null &&
    main(styledBasedKnownDimensions, dir) !== null;
  if (mainIsRatioDerived) {
    const beforeClamp = main(styledBasedKnownDimensions, dir) ?? 0;
    const afterClamp = vClamp(beforeClamp, main(minSize, dir), main(maxSize, dir));
    setMain(styledBasedKnownDimensions, dir, afterClamp);
    traceLayout(node, {
      phase: 'container-main',
      source: beforeClamp === afterClamp ? 'aspect-ratio' : 'min-max-clamp',
      axis: dirIsRow(dir) ? 'width' : 'height',
      value: afterClamp,
      detail: `ratio-derived; before-clamp=${beforeClamp}`,
    });
  }
  const ratioMainAutoMinApplies =
    mainIsRatioDerived &&
    main(minSize, dir) === null &&
    !isScrollContainer(dirIsRow(dir) ? style.overflow.x : style.overflow.y);

  // Blink resolves flex gaps from CalculateChildPercentageSize before layout.
  // An inline percentage basis is definite for a row, but an automatic column
  // block size does not become definite merely because content or min/max
  // eventually gives it a used height. An authored/parent-supplied height or
  // the initial preferred-ratio transfer does establish the block basis; if a
  // ratio automatic minimum later enlarges the box, that basis is not redone.
  const mainGapPercentageBasisIsDefinite =
    dirIsRow(dir) || main(knownDimensions, dir) !== null || main(resolvedStyleSize, dir) !== null || mainIsRatioDerived;

  // Short-circuit layout if the container's size is fully determined by the container's size and the run mode
  // is ComputeSize (and thus the container's size is all that we're interested in)
  if (runMode === 'compute-size') {
    if (
      styledBasedKnownDimensions.width !== null &&
      styledBasedKnownDimensions.height !== null &&
      !ratioMainAutoMinApplies
    ) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: styledBasedKnownDimensions.height });
    }
    // We can also short-circuit if the width is known and only the width has been requested.
    if (inputs.axis === 'horizontal' && styledBasedKnownDimensions.width !== null) {
      return fromOuterSize({ width: styledBasedKnownDimensions.width, height: 0 });
    }
  }

  return computePreliminary(
    node,
    { ...inputs, knownDimensions: styledBasedKnownDimensions },
    ratioMainAutoMinApplies,
    mainGapPercentageBasisIsDefinite,
  );
}

/** Compute a preliminary size for an item */
function computePreliminary(
  node: LayoutNode,
  inputs: LayoutInput,
  ratioMainAutoMinApplies: boolean,
  mainGapPercentageBasisIsDefinite: boolean,
): LayoutOutput {
  const nd = internals(node);
  const { knownDimensions: inputKnownDimensions, parentSize, availableSpace: outerAvailableSpace, runMode } = inputs;
  const knownDimensions = { ...inputKnownDimensions };

  // Define some general constants we will need for the remainder of the algorithm.
  const constants = computeConstants(
    nd.style,
    knownDimensions,
    parentSize,
    inputs.knownDimensionsAreHard,
    inputs.knownDimensionsAreIndefinite,
  );
  if (!mainGapPercentageBasisIsDefinite && typeof main(nd.style.gap, constants.dir) === 'object') {
    setMain(constants.gap, constants.dir, 0);
  }

  // 9. Flex Layout Algorithm

  // 9.1. Initial Setup

  // 1. Generate anonymous flex items as described in §4 Flex Items.
  let flexItems = generateAnonymousFlexItems(node, constants);

  // css-flexbox-1 §9.9.2: a multi-line column's min-content cross size is
  // the largest min-content contribution of its items. The sum of flex line
  // cross sizes is its *max-content* size instead. Keep running the normal
  // algorithm so the other requested axis is still available, then replace
  // only this intrinsic result before returning. Chrome, two 0px-tall items
  // forced onto separate column lines with cross contributions 3px and 2px,
  // reports min-content width 3px and max-content width 5px.
  const intrinsicMinColumnCross =
    runMode === 'compute-size' &&
    inputs.axis !== 'vertical' &&
    constants.isColumn &&
    constants.isWrap &&
    cross(constants.nodeOuterSize, constants.dir) === null &&
    cross(outerAvailableSpace, constants.dir) === 'min-content'
      ? determineIntrinsicColumnCrossSize(flexItems, constants, outerAvailableSpace)
      : null;

  // Blink resolves the intrinsic inline size of a non-wrapping column before
  // flexing (FlexLayoutAlgorithm::ComputeMinMaxSizes). Do that two-pass setup
  // when an item subtree contains an aspect ratio: a descendant's ratio can
  // make the ordering observable even when the direct flex item has no ratio.
  // css-flexbox-1 §9.9.2 defines the width from item contributions, not from
  // their post-flexed main sizes.
  const subtreeHasAspectRatio = (item: LayoutNode): boolean => {
    const itemInternals = internals(item);
    return itemInternals.style.aspectRatio !== null || itemInternals.children.some(subtreeHasAspectRatio);
  };
  if (
    constants.isColumn &&
    !constants.isWrap &&
    flexItems.some((child) => subtreeHasAspectRatio(child.node)) &&
    cross(constants.nodeOuterSize, constants.dir) === null &&
    typeof cross(outerAvailableSpace, constants.dir) !== 'number'
  ) {
    const intrinsicOuterCross = determineIntrinsicColumnCrossSize(flexItems, constants, outerAvailableSpace);
    const intrinsicInnerCross = Math.max(
      intrinsicOuterCross - rectCrossAxisSum(constants.contentBoxInset, constants.dir),
      0,
    );
    setCross(knownDimensions, constants.dir, intrinsicOuterCross);
    setCross(constants.nodeOuterSize, constants.dir, intrinsicOuterCross);
    setCross(constants.nodeInnerSize, constants.dir, intrinsicInnerCross);
    constants.crossIsIntrinsicColumn = true;
    // Percentage child styles resolve only after the intrinsic width is known.
    flexItems = generateAnonymousFlexItems(node, constants);
  }

  // 9.2. Line Length Determination

  // 2. Determine the available main and cross space for the flex items
  const availableSpace = determineAvailableSpace(knownDimensions, outerAvailableSpace, constants);

  // 3. Determine the flex base size and hypothetical main size of each item.
  determineFlexBaseSize(constants, availableSpace, flexItems);

  // 4. Determine the main size of the flex container
  // This has already been done as part of compute_constants. The inner size is exposed as constants.node_inner_size.

  // 9.3. Main Size Determination

  const knownInnerMainSize = main(constants.nodeInnerSize, constants.dir);

  // 5. Collect flex items into flex lines.
  //
  // An auto-height column does not wrap against the block space left by its
  // parent. Blink's FlexLayoutAlgorithm::MainAxisContentExtent instead uses
  // the column's max-height, or infinity when it has no maximum, as the line
  // breaking extent. This is the column form of §9.2's indefinite available
  // main space: two empty items with a 40px row gap stay on one line and give
  // the auto-height container a 40px intrinsic height, even when its margins
  // leave 0px in the parent. A max-height below 40px still makes them wrap.
  const lineBreakingAvailableSpace =
    constants.isColumn && constants.isWrap && knownInnerMainSize === null
      ? withMain(
          availableSpace,
          constants.dir,
          main(constants.maxSize, constants.dir) === null
            ? 'max-content'
            : Math.max(
                (main(constants.maxSize, constants.dir) ?? 0) -
                  rectMainAxisSum(constants.contentBoxInset, constants.dir),
                0,
              ),
        )
      : availableSpace;
  let flexLines = collectFlexLines(constants, lineBreakingAvailableSpace, flexItems);

  // If container size is undefined, determine the container's main size
  // and then re-resolve gaps based on newly determined size
  if (knownInnerMainSize !== null) {
    const mainContentBoxInset = rectMainAxisSum(constants.contentBoxInset, constants.dir);
    let outerMainSize = knownInnerMainSize + mainContentBoxInset;

    if (ratioMainAutoMinApplies) {
      // CSS Sizing 4 §4.2: the automatic minimum in a ratio-dependent
      // axis is min-content (capped by max-size). Blink feeds a column flex
      // container's `max_sum_hypothetical_main_size` to
      // ComputeBlockSizeForFragment; its inline-size path applies the same
      // floor for rows. Chrome, a zero-sized ratio source around one 10px text
      // item therefore becomes 10px in the main axis, while overflow:hidden or
      // an explicit min-size of zero leaves it at zero; max-size:5 caps it at 5.
      const intrinsicInnerMain = flexLines.reduce((largest, line) => {
        const itemSum = line.items.reduce((sum, item) => sum + main(item.hypotheticalOuterSize, constants.dir), 0);
        const gapSum = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
        return Math.max(largest, itemSum + gapSum);
      }, 0);
      const beforeFloor = outerMainSize;
      outerMainSize = vClamp(
        Math.max(outerMainSize, intrinsicInnerMain + mainContentBoxInset),
        main(constants.minSize, constants.dir),
        main(constants.maxSize, constants.dir),
      );
      traceLayout(node, {
        phase: 'container-main',
        source: 'intrinsic-content',
        axis: constants.isRow ? 'width' : 'height',
        value: outerMainSize,
        detail: `ratio automatic minimum; before-floor=${beforeFloor}; intrinsic=${intrinsicInnerMain}`,
      });
    }

    const innerMainSize = Math.max(outerMainSize - mainContentBoxInset, 0);
    setMain(constants.nodeOuterSize, constants.dir, outerMainSize);
    setMain(constants.nodeInnerSize, constants.dir, innerMainSize);
    setMain(constants.innerContainerSize, constants.dir, innerMainSize);
    setMain(constants.containerSize, constants.dir, outerMainSize);

    // An automatic inline size can become definite during flex intrinsic
    // sizing. Blink's child percentage inline size observes that result;
    // automatic block sizes remain indefinite, so columns never take this
    // post-layout resolution path.
    if (constants.isRow) {
      const newGap = maybeResolve(main(nd.style.gap, constants.dir), innerMainSize) ?? 0;
      setMain(constants.gap, constants.dir, newGap);
    }
  } else {
    // Sets constants.container_size and constants.outer_container_size
    determineContainerMainSize(availableSpace, flexLines, constants);
    setMain(constants.nodeInnerSize, constants.dir, main(constants.innerContainerSize, constants.dir));
    setMain(constants.nodeOuterSize, constants.dir, main(constants.containerSize, constants.dir));

    const innerContainerSize = main(constants.innerContainerSize, constants.dir);
    if (constants.isRow) {
      const newGap = maybeResolve(main(nd.style.gap, constants.dir), innerContainerSize) ?? 0;
      setMain(constants.gap, constants.dir, newGap);
    }

    // Line collection ran before the container's automatic main size was
    // resolved. Under a max-content constraint that meant "never wrap", which
    // holds only while each item's hypothetical size is covered by its
    // contribution to the container. `flex-basis` breaks that:
    // it sets the hypothetical main size but contributes nothing of its own
    // (§9.9.1 works from the items' content), so a container of
    // `flex-basis: 30px` items ends up narrower than the line they want and
    // they have to wrap after all.
    //
    // Chrome, two items with `flex-basis: 30px/40px` and `column-gap: 20px` in
    // a shrink-to-fit wrapping container: 20x13 — the width is the gap alone
    // and each item takes its own line. Swap `flex-basis` for `width` and it is
    // 90x5 on one line, because then the items do contribute. Mixed,
    // `flex-basis: 30px` beside `width: 40px`, gives 60 = 40 + gap, still two
    // lines.
    //
    // A numeric ancestor constraint can be provisional too: a start-aligned
    // shrink-to-fit item may resolve wider than that inherited space. Blink
    // resolves the container main size before Flexbox §9.3 line collection,
    // so re-break every wrapping auto-sized container against its used size.
    // This can either split an intrinsic line or merge provisional numeric
    // lines; nowrap remains untouched.
    if (constants.isWrap) {
      flexLines = collectFlexLines(
        constants,
        { ...availableSpace, [constants.isRow ? 'width' : 'height']: innerContainerSize },
        flexItems,
      );
    }
  }

  // An intrinsic row main size is not known when computeConstants first tries
  // the preferred ratio. Once §9.9 resolves that main size, transfer its used
  // outer value into an automatic cross size before cross-axis layout. Blink
  // likewise makes the single-line cross definite only after intrinsic inline
  // sizing: an empty grid item with fixed 1200px rows in an auto-sized ratio
  // row is laid out into the ratio's 0px cross size, rather than making the
  // container 1200px tall.
  if (
    constants.isRow &&
    constants.aspectRatio !== null &&
    cross(constants.nodeOuterSize, constants.dir) === null &&
    cross(nd.style.size, constants.dir) === 'auto'
  ) {
    const ratioBox = constants.boxSizing === 'content-box' ? constants.paddingBorderSize : sizeZero();
    const ratioSize = applyAspectRatioClamped(
      constants.nodeOuterSize,
      constants.minSize,
      constants.maxSize,
      constants.aspectRatio,
      ratioBox,
    );
    const outerCross = cross(ratioSize, constants.dir);
    if (outerCross !== null) {
      const innerCross = Math.max(outerCross - rectCrossAxisSum(constants.contentBoxInset, constants.dir), 0);
      setCross(knownDimensions, constants.dir, outerCross);
      setCross(constants.nodeOuterSize, constants.dir, outerCross);
      setCross(constants.nodeInnerSize, constants.dir, innerCross);
      constants.crossIsRatioDerived =
        cross(nd.style.minSize, constants.dir) === 'auto' &&
        !isScrollContainer(constants.isRow ? nd.style.overflow.y : nd.style.overflow.x);
    }
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

  // 10. Collapse visibility:collapse items. (Not implemented.)

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
    if (intrinsicMinColumnCross !== null) {
      setCross(constants.containerSize, constants.dir, intrinsicMinColumnCross);
    }
    return fromOuterSize(constants.containerSize);
  }

  // 16. Align all flex lines per align-content.
  alignFlexLinesPerAlignContent(flexLines, constants, totalLineCrossSize);

  // Do a final layout pass and gather the resulting layouts
  const inflowContentSize = finalLayoutPass(flexLines, constants);

  // Before returning we perform absolute layout on all absolutely positioned children
  const absoluteContentSize = performAbsoluteLayoutOnAbsoluteChildren(node, constants);

  // Hidden layout for display:none children
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

  // 8.5. Flex Container Baselines: calculate the flex container's first baseline
  // See https://www.w3.org/TR/css-flexbox-1/#flex-baselines
  let firstVerticalBaseline: Opt = null;
  if (flexLines.length > 0 && (flexLines[0] ?? unreachable()).items.length > 0) {
    const firstLine = flexLines[0] ?? unreachable();
    // Flexbox §8.5 determines container baselines after taking
    // flex-direction into account. Blink's reverse-direction line stores items in
    // visual order, so its first fallback baseline comes from the source-last
    // item at main-start. Our line retains source order: use the matching end
    // here. Two empty items separated by a 1px gap therefore expose baseline
    // 0, not the source-first item's baseline at 1px.
    const baselineItems = isReverse(constants.dir) ? [...firstLine.items].reverse() : firstLine.items;
    const child =
      baselineItems.find(
        (item) => constants.isColumn || (item.alignSelf.keyword === 'baseline' && !item.alignSelf.safe),
      ) ??
      baselineItems[0] ??
      unreachable();
    // `finalLayoutPass` stores the child's baseline in the container's
    // coordinate space, including its resolved cross/main-axis offset. Do not
    // add that offset again when exporting the container baseline. This
    // matches Blink's BaselineAccumulator::AccumulateItem and keeps a 130px
    // child in a 7px column-reverse container at baseline 7, not -116.
    firstVerticalBaseline = child.baseline;
  }

  return fromSizesAndBaselines(constants.containerSize, sizeMax(inflowContentSize, absoluteContentSize), {
    x: null,
    y: firstVerticalBaseline,
  });
}

function determineIntrinsicColumnCrossSize(
  flexItems: FlexItem[],
  constants: AlgoConstants,
  availableSpace: Size<AvailableSpace>,
): number {
  const largestContribution = flexItems.reduce(
    (largest, child) =>
      Math.max(
        largest,
        measureChildSize(
          child.node,
          { width: null, height: null },
          constants.nodeInnerSize,
          availableSpace,
          'inherent-size',
          'horizontal',
        ) +
          child.margin.left +
          child.margin.right,
      ),
    0,
  );
  const inset = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
  const ratioInsetFloor =
    constants.aspectRatio !== null && constants.boxSizing === 'border-box'
      ? main(constants.paddingBorderSize, constants.dir) * constants.aspectRatio
      : 0;
  return Math.max(
    vClamp(Math.max(largestContribution + inset, ratioInsetFloor), constants.minSize.width, constants.maxSize.width),
    inset - constants.scrollbarGutter.x,
  );
}

/** Compute constants that can be reused during the flexbox algorithm. */
function computeConstants(
  style: Style,
  knownDimensions: Size<Opt>,
  parentSize: Size<Opt>,
  knownDimensionsAreHard?: Size<boolean>,
  knownDimensionsAreIndefinite?: Size<boolean>,
): AlgoConstants {
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
  const minSize = maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
  const resolvedStyleSize = maybeResolveSize(style.size, parentSize);

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
    // Min/max stay on their own axis — see the matching note in block.ts.
    // Pushing them through the ratio invents a
    // bound on the other axis: `height: 200; aspect-ratio: 2; max-width: 3` is
    // 3x200 in Chrome for flex, block and grid alike, but a transferred
    // max-height of 1.5 shrank the height instead.
    minSize,
    maxSize,
    aspectRatio,
    boxSizing: style.boxSizing,
    paddingBorderSize: paddingBorderSum,
    mainSizeIsAuto: main(resolvedStyleSize, dir) === null,
    mainSizeIsDefinite:
      main(resolvedStyleSize, dir) !== null ||
      main(knownDimensionsAreHard ?? { width: false, height: false }, dir),
    crossSizeIsAuto: cross(resolvedStyleSize, dir) === null,
    crossSizeIsIndefinite: cross(knownDimensionsAreIndefinite ?? { width: false, height: false }, dir),
    isOutOfFlow: style.position === 'absolute',
    crossSizeIsMinMaxDefinite:
      cross(resolvedStyleSize, dir) === null &&
      !cross(knownDimensionsAreHard ?? { width: false, height: false }, dir) &&
      cross(minSize, dir) !== null &&
      cross(maxSize, dir) !== null &&
      (cross(maxSize, dir) ?? 0) <= (cross(minSize, dir) ?? 0),
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
      cross(style.minSize, dir) === 'auto' &&
      !cross(knownDimensionsAreHard ?? { width: false, height: false }, dir) &&
      !isScrollContainer(isRow ? style.overflow.y : style.overflow.x),
    crossIsIntrinsicColumn: false,
    containerSize: sizeZero(),
    innerContainerSize: sizeZero(),
  };
}

/**
 * Generate anonymous flex items.
 * # [9.1. Initial Setup](https://www.w3.org/TR/css-flexbox-1/#box-manip)
 */
function generateAnonymousFlexItems(node: LayoutNode, constants: AlgoConstants): FlexItem[] {
  const nd = internals(node);
  const items: FlexItem[] = [];
  for (let index = 0; index < nd.children.length; index++) {
    const child = nd.children[index] ?? unreachable();
    const childStyle = internals(child).style;
    if (childStyle.position === 'absolute') continue;
    if (childStyle.display === 'none') continue;

    const aspectRatio = childStyle.aspectRatio;
    const padding = resolveRectOrZero(childStyle.padding, constants.nodeInnerSize.width);
    const border = resolveRectOrZero(childStyle.border, constants.nodeInnerSize.width);
    const pbSum = sumAxes(rectAdd(padding, border));
    const boxSizingAdjustment = childStyle.boxSizing === 'content-box' ? pbSum : sizeZero();
    // Flex layout operates on used border-box sizes. A specified border-box
    // zero cannot make the rendered box smaller than its own padding+border;
    // Blink's length resolution floors every definite axis at that inset sum
    // before aspect-ratio transfer or intrinsic contribution sizing. Containers
    // already use this normalization in computeFlexboxLayout; preserve the
    // same used-size model for their items.
    const minSize = toUsedBorderBoxSize(
      maybeResolveSize(childStyle.minSize, constants.nodeInnerSize),
      childStyle.boxSizing,
      pbSum,
    );
    const maxSize = toUsedBorderBoxSize(
      maybeResolveSize(childStyle.maxSize, constants.nodeInnerSize),
      childStyle.boxSizing,
      pbSum,
    );
    const resolvedSize = toUsedBorderBoxSize(
      maybeResolveSize(childStyle.size, constants.nodeInnerSize),
      childStyle.boxSizing,
      pbSum,
    );
    const marginIsAuto = {
      left: childStyle.margin.left === 'auto',
      right: childStyle.margin.right === 'auto',
      top: childStyle.margin.top === 'auto',
      bottom: childStyle.margin.bottom === 'auto',
    };
    const specifiedAlignSelf = childStyle.alignSelf ?? constants.alignItems;
    // An auto cross-axis margin makes align-self ineffective (css-flexbox-1
    // §8.1). Blink resolves the item's alignment to flex-start at this point,
    // before baseline groups and stretch sizing are constructed.
    const alignSelf: AlignItems =
      rectCrossStart(marginIsAuto, constants.dir) || rectCrossEnd(marginIsAuto, constants.dir)
        ? { keyword: 'flex-start', safe: false }
        : specifiedAlignSelf;
    items.push({
      node: child,
      order: index,
      // CSS Sizing 4 §4.2 transfers the *used* preferred size through the
      // ratio, so clamp the ratio-determining axis by its own min/max first.
      // Chrome gives `height: 55px; max-height: 20px; aspect-ratio: .5`
      // an automatic width of 10px, not 27.5px subsequently capped elsewhere.
      size: applyAspectRatioClamped(resolvedSize, minSize, maxSize, aspectRatio, boxSizingAdjustment),
      minSize,
      maxSize,
      aspectRatio,

      inset: maybeResolveRectPerAxis(childStyle.inset, constants.nodeInnerSize),
      margin: resolveRectOrZero(childStyle.margin, constants.nodeInnerSize.width),
      marginIsAuto,
      padding,
      border,
      alignSelf,
      overflow: { ...childStyle.overflow },
      scrollbarWidth: childStyle.scrollbarWidth,
      flexGrow: childStyle.flexGrow,
      flexShrink: childStyle.flexShrink,
      flexBasis: 0,
      flexBasisIsExplicit: false,
      flexBasisIsDefinite: false,
      innerFlexBasis: 0,
      violation: 0,
      frozen: false,

      resolvedMinimumMainSize: 0,
      minContentContribution: 0,
      transferredMinMainSize: null,
      transferredMaxMainSize: null,
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

  if (internals(child.node).style.boxSizing !== 'content-box') return apply(sourceSize);

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
  // Flexbox §9.2 uses the container's cross size here only when that size is
  // definite. A row's automatic block size does not become definite merely
  // because max-height supplied a numeric used size before flex layout; Blink
  // keeps ChildAvailableSize().block_size indefinite in that case. Preserve
  // the distinction instead of leaking the clamped number into a ratio item's
  // flex basis. Chrome: auto height + min-height:1 + max-height:0 around an
  // empty 1:1 item gives a 0px flex basis, then stretches the item to 0x1.
  // A column's cross axis is inline, which Blink always considers definite;
  // a preferred ratio on the container also makes the clamped cross size a
  // sizing input (its automatic main size is then derived from that value).
  const availableKnownDimensions =
    constants.isColumn || !constants.crossSizeIsMinMaxDefinite || constants.aspectRatio !== null
      ? knownDimensions
      : withCross(knownDimensions, constants.dir, null);

  const width: AvailableSpace =
    availableKnownDimensions.width !== null
      ? availableKnownDimensions.width - horizontalSum(constants.contentBoxInset)
      : asMaybeSub(
          asMaybeSub(outerAvailableSpace.width, horizontalSum(constants.margin)),
          horizontalSum(constants.contentBoxInset),
        );

  const height: AvailableSpace =
    availableKnownDimensions.height !== null
      ? availableKnownDimensions.height - verticalSum(constants.contentBoxInset)
      : asMaybeSub(
          asMaybeSub(outerAvailableSpace.height, verticalSum(constants.margin)),
          verticalSum(constants.contentBoxInset),
        );

  // A column item's automatic inline size is fit-content when that inline
  // size is needed to determine its block-axis flex base (§9.2 step 3E).
  // Preserve a max-content constraint in general, but when the column itself
  // has a definite max cross size Blink uses that inner maximum as the
  // fit-content available space for both flex-base and hypothetical-cross
  // measurement. Chrome, `max-width: 20px` around text with a 50px
  // min-content width, measures 50x30 before stretch rather than 100x10.
  const maxInnerColumnWidth =
    constants.isColumn && width === 'max-content' && constants.maxSize.width !== null
      ? Math.max(constants.maxSize.width - horizontalSum(constants.contentBoxInset), 0)
      : width;

  return { width: maxInnerColumnWidth, height };
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
    const childStyle = internals(child.node).style;

    // Parent size for child sizing.
    //
    // The main axis is withheld from the *style size* resolution — a percentage
    // size in an axis must not feed its own contribution in that axis (see the
    // `styleMinMainSize` note below) — but percentage padding and border always
    // resolve against the container's inline size, which is definite here and
    // independent of the item, so zeroing them is wrong. `content-size` mode
    // reads `parentSize` only for padding/border/margin (leaf.ts nulls the
    // style sizes outright), so the measure below can be handed the full size
    // while the cycle stays closed.
    //
    // Chrome, a 3px-wide row containing a text item with
    // `padding-left: 55; padding-right: 50%`: the item is 107 wide (50 of text
    // + 55 + 1.5, rounded), where dropping the 50% gave 105. The error is not
    // always small — a 100px-wide row with `padding-right: 50%` around the same
    // text is 100 in Chrome and came out 50 here.
    const crossAxisParentSize = cross(constants.nodeInnerSize, dir);
    const childInsetParentSize: Size<Opt> = { ...constants.nodeInnerSize };

    // Available space for child sizing
    // Min/max sizes transferred through the aspect ratio are taken into account here
    // The constraint is for this item's margin box, and the stretch step below
    // subtracts this same item's margins. Using the container margin here made
    // Chrome's 0x1 item (`min-height: 1; margin-bottom: 1; aspect-ratio: 1`)
    // acquire a false zero cross size and then a frozen 1px main size.
    const crossAxisMarginSum = rectCrossAxisSum(child.margin, dir);
    // Transferred constraints only apply to axes whose preferred size is auto
    // (css-sizing-4 §5.2.2; matches Chrome). Clamping unconditionally diverges
    // from the browser when an axis has a definite size.
    const rawStyleSize = maybeResolveSize(childStyle.size, constants.nodeInnerSize);
    const ratioDependentAxes = { width: rawStyleSize.width === null, height: rawStyleSize.height === null };
    const childPb = rectAdd(child.padding, child.border);
    const childPbSum = sumAxes(childPb);
    const minSizeForTransfer: Size<Opt> = {
      width: mMax(child.minSize.width, childPbSum.width),
      height: mMax(child.minSize.height, childPbSum.height),
    };
    const transferredMinSize = transferUsedConstraintToStretchedAxis(
      minSizeForTransfer,
      rawStyleSize,
      child.aspectRatio,
      ratioDependentAxes,
      childStyle.boxSizing,
      childPbSum,
      Math.max,
    );
    const specifiedMain = main(rawStyleSize, dir);
    const specifiedMainBorderBox =
      specifiedMain !== null && childStyle.boxSizing === 'content-box'
        ? specifiedMain + main(childPbSum, dir)
        : specifiedMain;
    const rawMaxMain = main(child.maxSize, dir);
    // Keep the transfer's provenance before storing it for intrinsic
    // contribution sizing. Sizing 4 §4.4 caps a transferred minimum by a
    // definite preferred/maximum size in the destination axis; an authored
    // minimum in that axis remains independent and can still outrank max-size.
    // Chrome: min-height:0 plus 1px block padding transfers 1px through a 1:1
    // ratio, but max-width:0 caps that transferred inline minimum back to 0.
    const transferredMinMainCap =
      specifiedMainBorderBox === null
        ? rawMaxMain
        : rawMaxMain === null
          ? specifiedMainBorderBox
          : Math.min(specifiedMainBorderBox, rawMaxMain);
    child.transferredMinMainSize =
      child.aspectRatio !== null && main(rawStyleSize, dir) === null
        ? mMin(main(transferredMinSize, dir), transferredMinMainCap)
        : null;
    // A max-size below the box's own padding+border cannot be honoured — a
    // border box is never smaller than its insets — so the axis settles at the
    // floor, and it is that *used* size the ratio transfers, not the
    // unsatisfiable maximum. Chrome, a row item with `aspect-ratio: 1.5;
    // padding: 320px 0 1px` (a 321 height floor): `max-height: 321` and above
    // give 482x321 (=321x1.5), and so does `max-height: 40` — while
    // transferring the raw 40 gave 60x321. Above the floor the max is
    // satisfiable and clamps normally.
    const maxSizeForTransfer: Size<Opt> = {
      width: mMax(child.maxSize.width, horizontalSum(childPb)),
      height: mMax(child.maxSize.height, verticalSum(childPb)),
    };
    const transferredMaxSize = transferUsedConstraintToStretchedAxis(
      maxSizeForTransfer,
      rawStyleSize,
      child.aspectRatio,
      ratioDependentAxes,
      childStyle.boxSizing,
      childPbSum,
      Math.min,
    );
    child.transferredMaxMainSize =
      child.aspectRatio !== null && main(rawStyleSize, dir) === null ? main(transferredMaxSize, dir) : null;
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
    // `child.size` includes a ratio-derived automatic cross size, but that does
    // not make the preferred cross size definite. Blink checks the raw
    // computed Width/Height for `auto` before allowing a transfer; otherwise a
    // specified main size can derive an auto cross size which transfers back
    // into the automatic main minimum and circularly prevents flex shrink.
    if (cross(rawStyleSize, dir) === null) setCross(childKnownDimensions, dir, null);
    // Clamp the definite cross size by the cross min/max sizes so that sizes
    // transferred through an intrinsic aspect ratio are based on the used cross size.
    setCross(
      childKnownDimensions,
      dir,
      mClamp(cross(childKnownDimensions, dir), cross(transferredMinSize, dir), cross(transferredMaxSize, dir)),
    );
    if (
      !constants.isWrap &&
      ((cross(constants.nodeInnerSize, dir) !== null &&
        (constants.isColumn ||
          (!constants.crossSizeIsMinMaxDefinite &&
            !constants.crossSizeIsIndefinite &&
            !(constants.isOutOfFlow && constants.crossSizeIsAuto)))) ||
        (constants.aspectRatio !== null && !constants.isOutOfFlow)) &&
      child.alignSelf.keyword === 'stretch' &&
      !child.alignSelf.safe &&
      !rectCrossStart(child.marginIsAuto, constants.dir) &&
      !rectCrossEnd(child.marginIsAuto, constants.dir) &&
      cross(childKnownDimensions, dir) === null
    ) {
      // Only a single-line container with its own definite cross size makes
      // this stretched size definite during flex-base calculation
      // (css-flexbox-1 §9.8; Blink gates the same path on !is_multi_line_ and
      // is_cross_size_definite_). Numeric available space from an ancestor is
      // not enough: an auto-height nested row constrained only by min-height
      // stretches its ratio child later, without changing the child's main
      // size. A wrapping 97x20 row with an empty 3:1 item likewise has a 0px
      // base in Chrome; transferring the future 20px line stretch made it 60px.
      // An in-flow ratio container can still receive its cross space from its
      // parent's flex line during an intrinsic query (WPT
      // flex-aspect-ratio-cross-size-002). An out-of-flow root instead receives
      // the containing block's available height, which is not its used cross
      // size; its ratio must not turn the 800px page viewport into 800x800.
      // Its automatic cross size can also arrive numerically from shrink-to-fit
      // content layout, but remains indefinite during flex-base sizing: Chrome
      // stretches an empty 1:1 item to a sibling's 10px height only after
      // keeping that item's main flex base at 0px.
      // Floor the stretched cross size by the item's own cross padding+border:
      // a box never shrinks below its insets, so stretching to a smaller
      // container leaves a *used* cross size larger than the space offered —
      // and it is the used size the ratio transfers from. Chrome, a row item
      // with `aspect-ratio: 1.5; padding: 100% 0 97px` in a 120x97 container:
      // the percentage resolves against the inline size to 120, so the item is
      // 217 tall and 326 wide (=217x1.5), where transferring the container's
      // 97 gave 146.
      setCross(
        childKnownDimensions,
        dir,
        mMax(
          mSub(asIntoOption(crossAxisAvailableSpace), rectCrossAxisSum(child.margin, dir)),
          rectCrossAxisSum(rectAdd(child.padding, child.border), dir),
        ),
      );
    }

    // Percentage padding always resolves against the containing block's inline
    // size, even when it becomes a column item's main-axis inset. Using the
    // flex main size here made that reference indefinite in columns and erased
    // the content-box adjustment: Chrome gives 245px for `flex-basis: 55px`
    // plus 190px of percentage block padding in a 200px-wide container.
    const containerInlineSize = constants.nodeInnerSize.width;
    const containerMainSize = main(constants.nodeInnerSize, dir);
    let boxSizingAdjustment = 0;
    if (childStyle.boxSizing === 'content-box') {
      const padding = resolveRectOrZero(childStyle.padding, containerInlineSize);
      const border = resolveRectOrZero(childStyle.border, containerInlineSize);
      boxSizingAdjustment = main(sumAxes(rectAdd(padding, border)), dir);
    }
    const flexBasis = mAdd(maybeResolve(childStyle.flexBasis, containerMainSize), boxSizingAdjustment);
    // `flex-basis` other than `auto` replaces the style main size outright,
    // even when its percentage cannot resolve. Flexbox §7.2.3 makes that
    // unresolved percentage's used basis `content`; it does not turn it into
    // `auto` and fall back to width/height. Keep authored provenance separate
    // from numeric resolvability so later contribution sizing observes the
    // same distinction.
    child.flexBasisIsExplicit = childStyle.flexBasis !== 'auto';

    const childAvailableSpace = withCross(
      withMain<AvailableSpace>(
        { width: 'max-content', height: 'max-content' },
        dir,
        main(availableSpace, dir) === 'min-content' ? 'min-content' : 'max-content',
      ),
      dir,
      crossAxisAvailableSpace,
    );

    const mainSize = main(child.size, dir);
    const crossKnown = cross(childKnownDimensions, dir);
    const crossMin = cross(child.minSize, dir);
    // A column item's main size is in its block axis, so when its automatic
    // cross size is still indefinite §9.2 step 3E says to use the item's
    // fit-content cross size. Blink's InlineSizeFunc obtains that border-box
    // size before measuring the block size (and before
    // BlockSizeFromAspectRatio applies a ratio, when present).
    // Chrome: a non-stretched empty item with 1px of inline border and
    // `aspect-ratio: 1` has a 1px basis under border-box, but 0px under
    // content-box. Safe stretch and safe baseline are invalid declarations in
    // CSS and therefore retain the default stretch behavior in Chrome.
    const usesFitContentCross = constants.isColumn && flexBasis === null;
    const fitContentCross =
      mainSize === null && crossKnown === null && usesFitContentCross
        ? measureFitContentCrossSize(
            child.node,
            childKnownDimensions,
            childInsetParentSize,
            childAvailableSpace,
            child.margin,
            dir,
          )
        : null;
    if (fitContentCross !== null) setCross(childKnownDimensions, dir, fitContentCross);
    // With no definite preferred/minimum cross size, only the item's own
    // padding+border floor can supply the ratio transfer used by the automatic
    // main minimum. Measuring all cross-axis content here would incorrectly
    // transfer descendants/text. Chrome, an empty non-stretched 1:1 item in a
    // zero-sized row: no inset -> 0x0, 10px border -> 10x10.
    const autoMinCrossFloor =
      child.aspectRatio !== null && crossKnown === null && crossMin === null
        ? rectCrossAxisSum(rectAdd(child.padding, child.border), dir)
        : null;

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
      // A cross minimum is a constraint, not the definite *used cross size*
      // required by §9.2 step 3B. It participates later in the automatic main
      // minimum/content-size suggestion; treating it as the exact transfer
      // source makes `min-height: 0` turn a content-based basis into a definite
      // zero and skips max-content measurement entirely.
      const transferSource = crossKnown ?? fitContentCross;
      const transferredMain =
        mainSize === null && child.aspectRatio !== null && transferSource !== null
          ? transferThroughRatio(transferSource, child, dir, 'cross-to-main')
          : null;
      // Flexbox §9.2 determines the flex base size while ignoring the item's
      // min/max main sizes; those constraints only clamp the hypothetical main
      // size below. When the author supplied the main size, `child.size` has
      // already been min/max-clamped, so prefer the raw border-box value here.
      // Keep `child.size` as the fallback for a main size derived through an
      // aspect ratio from the opposite axis. Chrome, in a 20px column with a
      // 4px gap, treats `height: 3px; max-height: 2px` as a 3px flex base and a
      // 2px hypothetical size, yielding final item heights 14px and 2px.
      const preferredMainForFlexBasis = specifiedMainBorderBox ?? mainSize;
      const definiteFlexBasis =
        flexBasis ?? (child.flexBasisIsExplicit ? null : preferredMainForFlexBasis) ?? transferredMain;
      child.flexBasisIsDefinite = definiteFlexBasis !== null;
      if (definiteFlexBasis !== null) return definiteFlexBasis;

      // C/E. Otherwise, size the item into the available space using its used flex basis
      //      in place of its main size, treating a value of content as max-content.
      return measureChildSize(
        child.node,
        childKnownDimensions,
        childInsetParentSize,
        childAvailableSpace,
        'content-size',
        mainAxis(dir),
      );
    })();

    // Floor flex-basis by the padding_border_sum (floors inner_flex_basis at zero)
    // This matches Chrome and Firefox's behaviour despite being a spec violation.
    const paddingBorderSum =
      rectMainAxisSum(child.padding, constants.dir) + rectMainAxisSum(child.border, constants.dir);
    child.flexBasis = Math.max(child.flexBasis, paddingBorderSum);

    // The hypothetical main size is the item's flex base size clamped according to its
    // used min and max main sizes (and flooring the content box size at zero).
    child.innerFlexBasis =
      child.flexBasis - rectMainAxisSum(child.padding, constants.dir) - rectMainAxisSum(child.border, constants.dir);

    const paddingBorderAxesSums = sumAxes(rectAdd(child.padding, child.border));

    // Note: the `parent_size` in the main axis is deliberately not set (percentage size in an
    // axis should not contribute to a min-content contribution in that same axis).
    const styleMinMainSize = main(child.minSize, dir) ?? overflowAutoMinSize(child.overflow);
    const needsMinContentContribution =
      constants.isRow && constants.isWrap && typeof main(availableSpace, dir) !== 'number';
    const minContentMainSize =
      styleMinMainSize === null || needsMinContentContribution
        ? ((): number => {
            // Flex §4.5's content-size suggestion in a column is the child's
            // intrinsic block size at its resolved inline size. Blink 7922's
            // BlockSizeFunc obtains it from an unconstrained child layout,
            // not a min-content block constraint. The distinction is visible
            // for grid: a `minmax(3px, 1fr)` row around 98px of content has a
            // 98px automatic flex minimum, while min-content constrains it to
            // the 3px track minimum and lets the flex item shrink to 30px.
            const intrinsicMainAvailableSpace = constants.isColumn ? 'max-content' : 'min-content';
            const minContentAvailableSpace = withCross<AvailableSpace>(
              withMain<AvailableSpace>(
                { width: 'min-content', height: 'min-content' },
                dir,
                intrinsicMainAvailableSpace,
              ),
              dir,
              crossAxisAvailableSpace,
            );
            // A row's *content* size suggestion must be measured without the
            // imposed cross size: otherwise its ratio derives the inline main
            // size before intrinsic content is consulted. In a column the
            // content suggestion is the intrinsic block size at the item's
            // used inline size (Flexbox §4.5 and §9.2 step 3E), so keep that
            // cross-size provenance. Chrome: a 1px-wide column ratio item with
            // `padding-top: 100%` has a 1px automatic block minimum; clearing
            // the inline size made the percentage basis indefinite and gave 0.
            // The ratio contribution remains separate as `transferredMain`.
            const contentMeasureKnownDimensions =
              child.aspectRatio !== null && constants.isRow
                ? withCross(childKnownDimensions, dir, null)
                : childKnownDimensions;
            return measureChildSize(
              child.node,
              contentMeasureKnownDimensions,
              childInsetParentSize,
              minContentAvailableSpace,
              'content-size',
              mainAxis(dir),
            );
          })()
        : 0;

    child.resolvedMinimumMainSize =
      styleMinMainSize ??
      ((): number => {
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
        // The cross size counts as definite when it comes from *stretching* or
        // a definite cross minimum as well as from the item's own style. Blink
        // includes that ratio transfer in the intrinsic content-size suggestion
        // used for the automatic minimum (ComputeMinMaxSizes(kIntrinsic)).
        // Therefore read childKnownDimensions (which the stretch branch above
        // fills in), then fall back to the resolved cross minimum:
        // `aspect-ratio: 1.5` alone in a 7x7 row is 11 wide in Chrome, i.e. the
        // transferred 10.5 floors the shrink instead of collapsing to the 7px
        // container.
        //
        // Min'ing the content suggestion against `child.size` unconditionally
        // is wrong here: `child.size` already carries the ratio-derived value,
        // so a 0 content size erases the transferred suggestion entirely and
        // the item shrinks past its ratio.
        const definiteCross = crossKnown ?? crossMin ?? fitContentCross ?? autoMinCrossFloor;
        const transferredMain =
          child.aspectRatio !== null && definiteCross !== null
            ? transferThroughRatio(definiteCross, child, dir, 'cross-to-main')
            : null;
        // The cap is the *specified* main size, and it has to be compared in
        // the same box as the values it caps. `rawStyleSize` is the style
        // value, which under `box-sizing: content-box` measures the content box
        // while `transferredMain`/`minContentMainSize` are border-box, so the
        // comparison lost the ratio by exactly the inset sum: Chrome gives a
        // content-box row item with `width: 320; height: 1; aspect-ratio: 1.5`
        // and 327px of horizontal border a width of 329 (the 1px content height
        // transfers to 1.5 of content; 328.5 rounds to 329), where capping at
        // the raw 320 fell back to the 327 border floor.
        //
        // `child.size` is not the fix: it already carries the ratio-derived
        // value, so using it caps the content suggestion by the ratio and the
        // item shrinks past its content — WPT flex-aspect-ratio-051 (`height:
        // 100%; aspect-ratio: .5` around a 100px child) expects 100, the
        // min-content contribution, not the derived 50. Add the box-sizing
        // adjustment to the *specified* size instead, so the cap stays "the
        // width the author wrote" and only the box changes.
        const specifiedMain = main(rawStyleSize, dir);
        const specifiedMainBorderBox =
          specifiedMain !== null && childStyle.boxSizing === 'content-box'
            ? specifiedMain + main(paddingBorderAxesSums, dir)
            : specifiedMain;
        // Flexbox §4.5 defines the content-size suggestion as min-content
        // clamped by definite cross min/max constraints converted through the
        // preferred ratio. This is an earlier stage than the final used
        // automatic minimum, where Blink deliberately ignores transferred
        // constraints. Preserve both provenance gates: the container and item
        // must still have automatic preferred cross sizes. A definite container
        // cross size selects Blink's final TransferredSizesMode::kIgnore path,
        // while an explicitly preferred item `height: 0` is itself the cross
        // source; both keep the intrinsic content contribution.
        const contentSizeSuggestion =
          child.aspectRatio !== null && constants.crossSizeIsAuto && cross(rawStyleSize, dir) === null
            ? vClamp(minContentMainSize, child.transferredMinMainSize, child.transferredMaxMainSize)
            : minContentMainSize;
        const sizeSuggestion =
          transferredMain !== null
            ? mMin(Math.max(transferredMain, contentSizeSuggestion), specifiedMainBorderBox)
            : mMin(contentSizeSuggestion, main(child.size, dir));
        // For a definite inline flex layout, clamp the automatic minimum only
        // by the item's own maximum main size. Blink deliberately ignores
        // transferred constraints while applying the inline auto-min length
        // (`TransferredSizesMode::kIgnore`): Chrome 151 keeps a grid item's
        // 320px intrinsic width with `aspect-ratio: 2; max-height: 0`, while a
        // direct `max-width: 10px` caps it at 10px. Its block-size path has no
        // such ignore mode, and intrinsic flex contributions still honor the
        // transferred maximum (the same item in an auto-width root contributes
        // 0px), so retain the transferred clamp in those paths.
        const autoMinMax =
          constants.isRow && typeof main(availableSpace, dir) === 'number'
            ? main(child.maxSize, dir)
            : main(transferredMaxSize, dir);
        const clampedMinContentSize = mMin(sizeSuggestion, autoMinMax) as number;
        return vMax(clampedMinContentSize, main(paddingBorderAxesSums, dir));
      })();

    // Use the provenance-preserving transferred minimum stored above: unlike
    // the combined working min-size, it has already been capped by a definite
    // destination preferred/maximum size (Sizing 4 §4.4). Keep the transferred
    // maximum independent — Chrome still clamps 80px of row content to 40px
    // for `max-height:20px; aspect-ratio:2`. An explicit flex-basis bypasses
    // both transferred bounds at this hypothetical boundary.
    const transferredHypotheticalMin = child.flexBasisIsExplicit ? null : child.transferredMinMainSize;
    const hypotheticalMax = child.flexBasisIsExplicit
      ? main(child.maxSize, constants.dir)
      : main(transferredMaxSize, constants.dir);
    const hypotheticalInnerMinMain = vMax(child.resolvedMinimumMainSize, main(paddingBorderAxesSums, constants.dir));
    const hypotheticalInnerSize = vClamp(
      child.flexBasis,
      vMax(hypotheticalInnerMinMain, transferredHypotheticalMin),
      hypotheticalMax,
    );
    const hypotheticalOuterSize = hypotheticalInnerSize + rectMainAxisSum(child.margin, constants.dir);

    setMain(child.hypotheticalInnerSize, constants.dir, hypotheticalInnerSize);
    setMain(child.hypotheticalOuterSize, constants.dir, hypotheticalOuterSize);

    if (needsMinContentContribution) {
      // css-flexbox-1 §9.9.1: the min-content main size of a multi-line
      // container is the largest *min-content contribution*. Blink records
      // ComputeMinAndMaxContentContribution(...).min_size before the flex
      // grow/shrink contribution arithmetic. Crucially, that helper resolves a
      // definite LogicalWidth directly instead of comparing it with overflowing
      // intrinsic content: a wrapping item with `width: 0` and a 10px glyph
      // contributes 0px in Chrome 151, while `width: auto; flex-basis: 0`
      // contributes the glyph's 10px. Preserve that provenance here rather
      // than reconstructing the contribution as max(preferred, intrinsic).
      const specifiedMain = main(rawStyleSize, dir);
      const specifiedMainBorderBox =
        specifiedMain !== null && childStyle.boxSizing === 'content-box'
          ? specifiedMain + main(paddingBorderAxesSums, dir)
          : specifiedMain;
      const intrinsicMinContribution =
        specifiedMainBorderBox ?? Math.max(minContentMainSize, child.resolvedMinimumMainSize);
      child.minContentContribution =
        vClamp(
          intrinsicMinContribution,
          mMax(main(child.minSize, dir), child.transferredMinMainSize) ?? child.transferredMinMainSize,
          mMin(main(child.maxSize, dir), child.transferredMaxMainSize) ?? child.transferredMaxMainSize,
        ) + rectMainAxisSum(child.margin, dir);
    }
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
    // Applying the split in both axes would report a column container's
    // min-content height as one item's height.
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
      const child = remaining[idx] ?? unreachable();
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
  const longestHypotheticalLine = (): number =>
    lines.reduce((acc, line) => {
      const lineMainAxisGap = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
      const totalTargetSize = line.items.reduce(
        (sum, child) => sum + main(child.hypotheticalOuterSize, constants.dir),
        0,
      );
      return Math.max(acc, totalTargetSize + lineMainAxisGap);
    }, 0);

  let outerMainSize: number =
    main(constants.nodeOuterSize, constants.dir) ??
    ((): number => {
      const mainAvs = main(availableSpace, dir);
      if (typeof mainAvs === 'number') {
        // Use the §9.2 hypothetical main size, which has already been clamped
        // by the used minimum. Reconstructing it from flex-basis and the style
        // min drops the §4.5 automatic minimum: Chrome gives a `flex-basis: 0`
        // text item 10px here, not 0. Blink likewise sizes this path from
        // `max_sum_hypothetical_main_size`.
        const longestLineLength = longestHypotheticalLine();
        const size = longestLineLength + mainContentBoxInset;
        return lines.length > 1 ? Math.max(size, mainAvs) : size;
      }

      // Flex §9.2 makes an automatic block size the max-content size. For a
      // column, Blink 7922 obtains that intrinsic block size directly from
      // `max_sum_hypothetical_main_size` in PlaceFlexItems, after §4.5 has
      // applied the item's automatic minimum. Do not run the generic
      // contribution arithmetic below: it can re-open a definite `height: 0`
      // flex item to its 10px content merely because the item is growable.
      if (mainAvs === 'max-content' && !constants.isRow) {
        return longestHypotheticalLine() + mainContentBoxInset;
      }

      // Keep this shortcut to wrapping rows. Under a min-content constraint
      // they put each item on its own line, so the largest minimum contribution
      // determines the container (§9.9.1). A wrapping *column* stays on one
      // line and must use the regular contribution path below: Chrome sizes
      // preferred-height items of 120px and 320px to 440px (450px with a 10px
      // gap), while this minimum-only shortcut collapses both empty items to 0.
      if (mainAvs === 'min-content' && constants.isWrap && constants.isRow) {
        const largestContribution = lines.reduce(
          (largest, line) =>
            line.items.reduce((lineLargest, item) => Math.max(lineLargest, item.minContentContribution), largest),
          0,
        );
        return largestContribution + mainContentBoxInset;
      }

      // MinContent | MaxContent
      let mainSize = 0;

      for (const line of lines) {
        for (const item of line.items) {
          const styleMin = main(item.minSize, constants.dir);
          const stylePreferred = main(item.size, constants.dir);
          const styleMax = main(item.maxSize, constants.dir);

          // An explicit `flex-basis` *replaces* the style main size as the flex
          // base size (css-flexbox §9.2.3), so it also replaces it when capping
          // the contribution — raising the cap to the style size would report a
          // size the item can never reach. Chrome, a row item with
          // `width: 120; flex-basis: 17` (shrink 1, grow 0): max-content is 17,
          // not 120; same in a column with `height: 120; flex-basis: 17`.
          // Only when the basis is *not* explicit does the style size stand in.
          const clampingBasis = item.flexBasisIsExplicit ? item.flexBasis : mMax(item.flexBasis, stylePreferred);
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
            item.transferredMinMainSize ?? 0,
          );
          // CSS Sizing 4 §4.4 transfers definite cross-axis constraints
          // through an aspect ratio to every indefinite size in the
          // destination axis. Blink applies those effective bounds inside
          // ComputeMinAndMaxContentContribution, before flex's contribution
          // arithmetic. A row item with `max-height: 10px; aspect-ratio: 2`
          // therefore contributes at most 20px even when its descendants have
          // 297px of inline padding.
          const specifiedMaxMainSize = mMin(styleMax, flexBasisMax) ?? flexBasisMax;
          const maxMainSize =
            mMin(item.transferredMaxMainSize, specifiedMaxMainSize) ?? specifiedMaxMainSize ?? Infinity;

          let contentContribution: number;
          // A content-based automatic block size is produced by the regular
          // flex layout algorithm, whose indefinite column extent is the sum
          // of the items' hypothetical main sizes (Flex §9.2/9.7). An
          // explicit main-axis minimum disables §4.5's automatic content
          // minimum, so descendants may overflow without enlarging that
          // contribution. Blink 7922's PlaceFlexItems passes
          // `max_sum_hypothetical_main_size` to MainAxisContentExtent: an
          // empty grid with a 55px row, `flex-basis:40px`, and `min-height:7px`
          // therefore contributes 40px; changing the minimum to `auto` makes
          // the same grid contribute 55px.
          if (!constants.isRow && styleMin !== null) {
            contentContribution = main(item.hypotheticalOuterSize, constants.dir);
          } else if (stylePreferred !== null && (maxMainSize <= minMainSize || maxMainSize <= stylePreferred)) {
            contentContribution =
              Math.max(Math.min(stylePreferred, maxMainSize), minMainSize) +
              rectMainAxisSum(item.margin, constants.dir);
          } else if (maxMainSize <= minMainSize) {
            contentContribution = minMainSize + rectMainAxisSum(item.margin, constants.dir);
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
            // Flex §9.4 derives an item's hypothetical cross size from its
            // used main size; a future stretch cross size must not feed back
            // into the intrinsic main contribution. Blink's
            // WillChildCrossSizeBeContainerCrossSize requires a definite,
            // single-line container cross size. The numeric page height is
            // merely available space when this auto-height row's own inner
            // height is still null, and a ratio-derived height is provisional.
            // Columns have a definite inline cross axis by construction.
            const canUseStretchedCrossForContribution =
              !constants.isRow ||
              (!constants.isWrap && !constants.crossIsRatioDerived && crossAxisParentSize !== null);
            if (
              canUseStretchedCrossForContribution &&
              item.alignSelf.keyword === 'stretch' &&
              !item.alignSelf.safe &&
              !rectCrossStart(item.marginIsAuto, constants.dir) &&
              !rectCrossEnd(item.marginIsAuto, constants.dir) &&
              cross(childKnownDimensions, dir) === null
            ) {
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
            const measureMode = item.flexBasisIsExplicit && !constants.isRow ? 'content-size' : 'inherent-size';
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
            // The row/column asymmetry here is easy to get wrong: the part that
            // *is* real is the `max(item.flexBasis)` in the column branch. An
            // inset floor on both branches is not, and removing it leaves
            // `flex_basis_unconstraint_row`/
            // `_column` — the gentests that comment cites — passing.
            if (constants.isRow) {
              // §9.9.3: the contribution is "capped by the item's flex base
              // size if the item is not growable, floored by [it] if the item
              // is not shrinkable, and then further clamped by the item's
              // min/max main size". `minMainSize`/`maxMainSize` above carry
              // exactly those basis bounds on top of the style min/max, so
              // clamping by them applies both halves at once.
              //
              // The cap only bites when the automatic minimum does not already
              // hold the item open, which is why it shows up on scroll
              // containers: §4.5 gives them a zero automatic minimum. Chrome,
              // 40px of text with `flex-basis: 20px; flex: 0 1`, contributes
              // its full 28.89 when overflow is visible but exactly the 20px
              // cap once the item scrolls or clips.
              // Blink adds the main-axis margins only after choosing and
              // clamping the item's border-box contribution. Clamping the
              // already-outer size lets a large end margin disappear behind
              // a small flex-basis cap: an empty item with `flex-basis: 7px`
              // and 203px of horizontal margins contributes 203px, not 7px.
              const marginSum = rectMainAxisSum(item.margin, constants.dir);
              // Blink's ComputeMinAndMaxContentContribution resolves a
              // definite LogicalWidth directly, before consulting intrinsic
              // content. Chrome therefore gives `width: 0; flex-grow: 1` a 0px
              // contribution even when an aspect-ratio descendant overflows it;
              // without a preferred width, use the measured content instead.
              // Keep margins outside both this choice and the clamps.
              const intrinsicContribution = stylePreferred ?? contentMainSize - marginSum;
              contentContribution = vClamp(intrinsicContribution, minMainSize, maxMainSize) + marginSum;
            } else {
              // With an explicit `flex-basis`, the style main size is the §4.5
              // *specified size suggestion*: it caps the content-based minimum
              // (and, since the basis replaced it, never floors it). Both WPT
              // siblings write the rule as a min():
              //   029: height 500, content 100 -> min(100, 500) = 100
              //   030: height  70, content 200 -> min(200,  70) =  70
              // 030 needs the cap so the inner container wraps into two
              // columns instead of stacking to 200.
              // `contentMainSize` already carries the item's margins, so the
              // basis has to be compared against the margin-*exclusive* size and
              // the margins re-added afterwards. Comparing it against the
              // inflated value let any margin swallow the basis outright: a
              // column item with `flex-basis: 3; margin: 20px ... 200px` came
              // out 0 tall (container 220) where Chrome keeps the 3 (223).
              const marginSum = rectMainAxisSum(item.margin, constants.dir);
              // A scroll container holds nothing open: §4.5 gives it a zero
              // automatic minimum, so its content contributes nothing and only
              // its own box remains. Chrome, taffy issue 696 — a
              // `flex-basis: 0` column item with `overflow: hidden`, 20px
              // padding and 200px of content — is 40 tall (the padding alone)
              // where the same tree with `overflow: visible` is 240.
              //
              // Row items reach the equivalent rule through `minMainSize` in
              // the branch above; the column branch floors by the *specified*
              // size suggestion instead, which a scroll container does not get.
              const innerContent = itemIsScrollContainer(item)
                ? Math.min(contentMainSize - marginSum, item.resolvedMinimumMainSize)
                : contentMainSize - marginSum;
              const suggested =
                item.flexBasisIsExplicit && stylePreferred !== null
                  ? Math.min(innerContent, stylePreferred)
                  : innerContent;
              contentContribution = vClamp(Math.max(suggested, item.flexBasis), styleMin, styleMax) + marginSum;
            }
          }

          const diff = contentContribution - item.flexBasis;
          if (diff > 0) {
            item.contentFlexFraction = diff / Math.max(1, item.flexGrow);
          } else if (diff < 0) {
            // §9.9.1 step 1: divide by the scaled flex shrink factor, "if
            // dividing by zero, treat the result as negative infinity". An item
            // that cannot shrink must not drag the line's chosen flex fraction
            // down — -Infinity loses the `max` in step 2, so the item keeps its
            // flex base size. Substituting 1 for the zero factor instead made a
            // `flex: 1 0 320px` item report a desired fraction of -320, which
            // step 4 then scaled by the basis into -102400 and clamped to 0.
            const scaledShrinkFactor = item.flexShrink * item.innerFlexBasis;
            item.contentFlexFraction = scaledShrinkFactor === 0 ? Number.NEGATIVE_INFINITY : diff / scaledShrinkFactor;
          } else {
            item.contentFlexFraction = 0;
          }
        }

        // Add each item's flex base size to the product of its flex factor and
        // its flex fraction, then clamp.
        //
        // §9.9.1 steps 2-4 read as though one *line-wide* chosen fraction (the
        // greatest) applies to every item, but browsers use each item's own:
        // two `flex: 1 0 0` items whose contents are 70px and 20px come out
        // 70+20=90 in Chrome, where the line-wide reading gives 70+70=140.
        // A -Infinity fraction means an item that cannot shrink, which
        // contributes nothing and keeps its flex base size.
        const itemMainSizeSum = line.items.reduce((sum, item) => {
          const flexFraction = Number.isFinite(item.contentFlexFraction) ? item.contentFlexFraction : 0;

          let flexContribution: number;
          if (flexFraction > 0) {
            flexContribution = Math.max(1, item.flexGrow) * flexFraction;
          } else if (flexFraction < 0) {
            const scaledShrinkFactor = Math.max(1, item.flexShrink) * item.innerFlexBasis;
            flexContribution = scaledShrinkFactor * flexFraction;
          } else {
            flexContribution = 0;
          }
          // css-flexbox-1 §9.9.1 substitutes the hypothetical main size when
          // an item with a definite basis cannot move toward its intrinsic
          // contribution. Blink's ComputeMinMaxSizeOfRowContainer performs
          // the same `cant_move` check. This matters when min/max clamps the
          // basis itself: `flex-basis: 10px; flex-shrink: 0; max-width: 7px`
          // contributes 7px in Chrome, not the unclamped 10px basis.
          const hypotheticalInner = main(item.hypotheticalInnerSize, constants.dir);
          const cantMoveToContribution =
            item.flexBasisIsDefinite &&
            ((item.flexShrink === 0 && hypotheticalInner < item.flexBasis) ||
              (item.flexGrow === 0 && hypotheticalInner > item.flexBasis));
          const size = cantMoveToContribution
            ? main(item.hypotheticalOuterSize, constants.dir)
            : item.flexBasis + flexContribution;
          setMain(item.outerTargetSize, constants.dir, size);
          setMain(item.targetSize, constants.dir, size);
          return sum + size;
        }, 0);

        const gapSum = sumAxisGaps(main(constants.gap, constants.dir), line.items.length);
        mainSize = Math.max(mainSize, itemMainSizeSum + gapSum);
      }

      if (constants.isWrap && constants.isRow) {
        const largestContribution = lines.reduce(
          (largest, line) =>
            line.items.reduce((lineLargest, item) => Math.max(lineLargest, item.minContentContribution), largest),
          0,
        );
        mainSize = Math.max(mainSize, largestContribution);
      }

      return mainSize + mainContentBoxInset;
    })();

  // The container's *cross*-axis padding+border is itself a cross size — a box
  // is never smaller than its own insets — and `aspect-ratio` transfers it into
  // the main axis. Without this the container floored at its main inset sum
  // alone: an `aspect-ratio: 2` row with 440px of vertical border and 47px of
  // horizontal border came out 47x440 where Chrome gives 880x440 (=440x2). The
  // same tree with no children was already correct, because leaf layout applies
  // this floor (src/compute/leaf.ts) — the divergence appeared the moment the
  // node became a flex container.
  //
  // Border-box and an automatic main size only: under content-box the ratio
  // relates the *content* boxes, which the insets sit outside of, so there is
  // nothing to transfer. With two definite preferred axes, css-sizing-4 §4.2
  // says the ratio has no effect; their inset floors apply independently.
  const crossInsetFloor =
    constants.boxSizing === 'content-box' || !constants.mainSizeIsAuto
      ? 0
      : rectCrossAxisSum(constants.contentBoxInset, constants.dir);
  const ratioMainFloor =
    constants.aspectRatio === null || crossInsetFloor === 0
      ? 0
      : constants.isRow
        ? crossInsetFloor * constants.aspectRatio
        : crossInsetFloor / constants.aspectRatio;

  outerMainSize = Math.max(
    vClamp(outerMainSize, main(constants.minSize, constants.dir), main(constants.maxSize, constants.dir)),
    mainContentBoxInset - pointMainValue(constants.scrollbarGutter, constants.dir),
    ratioMainFloor,
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
        // initialFreeSpace already excludes the line's gaps. Flexbox §9.7
        // scales that value directly when the unfrozen factor sum is below 1;
        // Blink's LineFlexer likewise subtracts each gap while computing
        // initial_free_space_ and never subtracts it again. Chrome: 320px with
        // a 55px gap and grow .5 gives (320 - 55) * .5 = 132.5px, not 77.5px.
        initialFreeSpace * sumFlexGrow,
        mSub(main(constants.nodeInnerSize, constants.dir), usedSpace),
      );
    } else if (shrinking && sumFlexShrink < 1) {
      freeSpace = vMax(
        initialFreeSpace * sumFlexShrink,
        mSub(main(constants.nodeInnerSize, constants.dir), usedSpace),
      );
    } else {
      freeSpace = mSub(main(constants.nodeInnerSize, constants.dir), usedSpace) ?? usedFlexFactor - usedSpace;
    }

    // c. Distribute free space proportional to the flex factors
    if (isNormal(freeSpace)) {
      const flexFactors = unfrozen.map((child) => (growing ? child.flexGrow : child.innerFlexBasis * child.flexShrink));
      const totalFlexFactor = flexFactors.reduce((sum, factor) => sum + factor, 0);
      if ((growing && sumFlexGrow > 0) || (shrinking && sumFlexShrink > 0 && totalFlexFactor > 0)) {
        // Blink's LineFlexer distributes in reverse order. Each share is
        // rounded to its 1/64px LayoutUnit and subtracted from the remaining
        // free space; the first item receives the exact remainder. This keeps
        // the line sum exact while preserving a half-pixel that independent
        // floating-point shares lose: 193px of negative space split with
        // scaled shrink factors 10:193 leaves the first item at exactly 0.5px.
        const fractions: number[] = [];
        let cumulativeFactor = 0;
        for (const factor of flexFactors) {
          cumulativeFactor += factor;
          fractions.push(cumulativeFactor === 0 ? 0 : factor / cumulativeFactor);
        }
        let remainingFreeSpace = freeSpace;
        for (let index = unfrozen.length - 1; index >= 0; index--) {
          const child = unfrozen[index] ?? unreachable();
          const fraction = fractions[index] ?? unreachable();
          const proportional = remainingFreeSpace * fraction;
          const extraSize =
            fraction === 1
              ? remainingFreeSpace
              : (Math.sign(proportional) * Math.round(Math.abs(proportional) * 64)) / 64;
          remainingFreeSpace -= extraSize;
          setMain(child.targetSize, constants.dir, child.flexBasis + extraSize);
        }
      }
    }

    // d. Fix min/max violations.
    let totalViolation = 0;
    for (const child of unfrozen) {
      const resolvedMinMain: Opt = child.resolvedMinimumMainSize;
      const maxMain = main(child.maxSize, constants.dir);
      // This engine stores target sizes as border-box values, so §9.7's
      // "floor its content-box size at zero" is a padding+border floor here.
      // Blink stores the content size separately and clamps that to zero.
      const paddingBorderFloor = rectMainAxisSum(rectAdd(child.padding, child.border), constants.dir);
      const clamped = Math.max(
        vClamp(main(child.targetSize, constants.dir), resolvedMinMain, maxMain),
        paddingBorderFloor,
      );
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
    const childStyle = internals(child.node).style;
    const paddingBorder = rectAdd(child.padding, child.border);
    const paddingBorderSum = rectCrossAxisSum(paddingBorder, constants.dir);

    const childKnownMain: AvailableSpace = main(constants.containerSize, constants.dir);

    // Sizes transferred through the aspect ratio clamp the hypothetical cross size —
    // but only when the cross axis's preferred size is auto (css-sizing-4 §5.2.2).
    const crossStyleIsAuto =
      maybeResolve(cross(childStyle.size, constants.dir), cross(constants.nodeInnerSize, constants.dir)) === null;
    // A *transferred* minimum (AR-derived, not explicitly specified in this axis)
    // is capped by the axis's own explicit maximum (css-sizing-4 §5.2.2; matches
    // Chrome). An explicit minimum still beats the maximum as usual.
    const rawMinCross = cross(child.minSize, constants.dir);
    const rawMinMain = main(child.minSize, constants.dir);
    // Min/max values in the flex algorithm are border-box sizes, but an
    // explicit ratio under `box-sizing: content-box` relates the content boxes
    // (css-sizing-4 §4.1). Blink likewise passes BoxSizingForAspectRatio into
    // ComputeTransferredMinMaxBlockSizes. Transfer through the shared helper
    // so the source inset is stripped and the target inset restored: Chrome
    // transfers `min-width: 0; padding-right: 1px; aspect-ratio: 1` to a 0px
    // content-box height, not the already-expanded 1px border-box width.
    const arMinCross =
      rawMinCross ??
      (child.aspectRatio !== null && rawMinMain !== null
        ? transferThroughRatio(rawMinMain, child, constants.dir, 'main-to-cross')
        : null);
    const transferredMinCross = !crossStyleIsAuto
      ? rawMinCross
      : rawMinCross !== null
        ? rawMinCross
        : mMin(arMinCross, cross(child.maxSize, constants.dir));
    const rawMaxCross = cross(child.maxSize, constants.dir);
    const rawMaxMain = main(child.maxSize, constants.dir);
    // A maximum smaller than the source axis's own insets is unsatisfiable, so
    // transfer the inset-floored used maximum. Blink's transferred min/max
    // helpers receive the border-padding strut for this conversion. Chrome,
    // `max-width: 0; border-right: 1px; aspect-ratio: 1` under border-box,
    // transfers 1px to the automatic height rather than clamping it to zero.
    const usedMaxMain =
      rawMaxMain === null ? null : Math.max(rawMaxMain, rectMainAxisSum(paddingBorder, constants.dir));
    const transferredMaxCross = crossStyleIsAuto
      ? (rawMaxCross ??
        (child.aspectRatio !== null && usedMaxMain !== null
          ? transferThroughRatio(usedMaxMain, child, constants.dir, 'main-to-cross')
          : null))
      : rawMaxCross;

    // An aspect-ratio item with a definite used main size derives its automatic
    // cross size from the ratio rather than from content (css-sizing-4 §5.1).
    //
    // The ratio relates the two axes of the box named by `box-sizing`, so under
    // content-box it has to operate on the content box: strip the main-axis
    // padding+border before applying the ratio and add the cross-axis back.
    // `targetSize` is always a border-box value, so dividing it directly is
    // correct only under border-box (same defect as the leaf floor in
    // src/compute/leaf.ts).
    const flexedMainDerivedCross =
      child.aspectRatio !== null
        ? transferThroughRatio(main(child.targetSize, constants.dir), child, constants.dir, 'main-to-cross')
        : null;
    // Blink's non-wrapping column intrinsic-width path takes each child's
    // inline contribution directly (ComputeMinMaxSizes), before main-axis flex
    // growth. Feeding the post-flexed height back through the ratio is circular:
    // Chrome keeps an empty 1:2 item at width 0 in a 10px-tall `flex-grow: 1`
    // column, not 5px. css-flexbox-1 §9.9.2 likewise defines this cross size in
    // terms of item contributions.
    const intrinsicColumnCross =
      constants.crossIsIntrinsicColumn && crossStyleIsAuto
        ? measureChildSize(
            child.node,
            { width: null, height: null },
            constants.nodeInnerSize,
            availableSpace,
            'inherent-size',
            'horizontal',
          )
        : null;
    const arDerivedCross =
      child.aspectRatio !== null && intrinsicColumnCross !== null ? intrinsicColumnCross : flexedMainDerivedCross;

    // Read the *style* cross size, not `child.size`: the latter has already had
    // the ratio applied (generateAnonymousFlexItems), so an item with only a
    // specified main size looks like it has a definite cross size here.
    child.crossIsArDerived =
      child.aspectRatio !== null &&
      cross(maybeResolveSize(childStyle.size, constants.nodeInnerSize), constants.dir) === null;

    // Transfer from the *used* main size when the cross size is ratio-derived.
    // `child.size` applied the ratio before flex sizing, so it still reflects a
    // specified border-box main size that can be smaller than its own insets.
    // Chrome floors `width: 7px` plus 330px of horizontal border to 330px, then
    // transfers a 1:2 ratio to 660px; transferring the raw 7px gave 14px here,
    // which was then merely floored to the 60px vertical border. CSS Sizing 4
    // §4.1 defines the ratio over the box selected by `box-sizing`, and Blink's
    // BlockSizeFromAspectRatio likewise receives the used border-box inline size.
    const preferredCross = child.crossIsArDerived ? arDerivedCross : cross(child.size, constants.dir);
    const childAvailableCross = asMaybeClampWithMax(
      asMaybeClamp(cross(availableSpace, constants.dir), transferredMinCross, transferredMaxCross),
      paddingBorderSum,
    );

    // CSS Sizing 4 §4.2 gives a non-scroll, non-replaced ratio box an
    // intrinsic automatic minimum in its ratio-dependent axis. Blink's
    // BlockSizeFunc likewise joins its ratio-derived kContent size with its
    // kIntrinsic block size. Keep that content floor separate from the ratio:
    // a 0px-wide 1:1 flex item around 1px of vertical padding contributes 1px
    // of height, not zero. A specified (including percentage) minimum or a
    // scroll container disables the floor, and max-size still caps it.
    const ratioAutomaticMinimumApplies =
      child.crossIsArDerived &&
      cross(childStyle.minSize, constants.dir) === 'auto' &&
      overflowAutoMinSize(child.overflow) === null &&
      // Measurement-backed leaves already return their used size for the
      // known flexed main axis. Blink 7922 likewise takes the child's layout
      // result directly in the hypothetical cross-size pass; adding its
      // intrinsic block size again would defeat the ratio (`H` at 10px wide
      // and 1.5:1 is 10x7 in Chrome, not its intrinsic 10x10).
      internals(child.node).measure === undefined;
    const intrinsicCrossMinimum = ratioAutomaticMinimumApplies
      ? measureChildSize(
          child.node,
          {
            width: constants.isRow ? main(child.targetSize, constants.dir) : null,
            height: constants.isRow ? null : main(child.targetSize, constants.dir),
          },
          constants.nodeInnerSize,
          {
            width: constants.isRow ? childKnownMain : childAvailableCross,
            height: constants.isRow ? childAvailableCross : childKnownMain,
          },
          'content-size',
          crossAxis(constants.dir),
        )
      : null;
    // Sizing 4 §4.3 caps this automatic minimum by the maximum in the
    // ratio-dependent axis itself. A main-axis maximum has already clamped the
    // flexed main size and its ratio-derived preferred cross size; transferring
    // it a second time must not erase intrinsic cross content. Blink 7922's
    // ComputeMinMaxBlockSizes likewise caps MinIntrinsic with LogicalMaxHeight:
    // `max-width: 0; aspect-ratio: 1` around a 10px line stays 0x10, not 0x0.
    const cappedIntrinsicCrossMinimum = mMin(intrinsicCrossMinimum, rawMaxCross);
    const childCross = mMax(
      mMax(mClamp(preferredCross, transferredMinCross, transferredMaxCross), cappedIntrinsicCrossMinimum),
      paddingBorderSum,
    );

    let childInnerCross: number;
    if (childCross !== null) {
      childInnerCross = childCross;
    } else {
      const childAvailableSpace: Size<AvailableSpace> = {
        width: constants.isRow ? childKnownMain : childAvailableCross,
        height: constants.isRow ? childAvailableCross : childKnownMain,
      };
      childInnerCross = Math.max(
        vClamp(
          measureFitContentCrossSize(
            child.node,
            {
              width: constants.isRow ? main(child.targetSize, constants.dir) : childCross,
              height: constants.isRow ? childCross : main(child.targetSize, constants.dir),
            },
            constants.nodeInnerSize,
            childAvailableSpace,
            child.margin,
            constants.dir,
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

/**
 * Resolve the fit-content cross size used by §9.2 step 3E and §9.4 step 7.
 *
 * Blink gives ComputeInlineSizeForFragment the flex container's child
 * available size. In this engine an auto-sized nested flex container otherwise
 * reports its max-content width even under numeric available space, so spell
 * out the fit-content clamp around its intrinsic measurements.
 */
function measureFitContentCrossSize(
  node: LayoutNode,
  knownDimensions: Size<Opt>,
  parentSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  margin: Rect<number>,
  dir: FlexDirection,
): number {
  const availableCross = cross(availableSpace, dir);
  const measure = (constraint: AvailableSpace): number =>
    measureChildSize(
      node,
      knownDimensions,
      parentSize,
      withCross(availableSpace, dir, constraint),
      'inherent-size',
      crossAxis(dir),
    );

  if (typeof availableCross !== 'number') return measure(availableCross);

  // Flexbox §9.4 step 7 treats only an automatic *width* as fit-content.
  // A row item's cross axis is its block axis, where auto height remains
  // content-sized even when the flex container supplies finite available
  // space. Blink therefore gives an auto-height grid with a 200px intrinsic
  // row plus a fixed 320px row a 520px hypothetical cross size, not the 321px
  // min-content size clamped around the parent's 200px height.
  if (dirIsRow(dir)) return measure('max-content');

  const minContent = measure('min-content');
  const maxContent = measure('max-content');
  const stretchFit = Math.max(availableCross - rectCrossAxisSum(margin, dir), 0);
  return Math.min(maxContent, Math.max(minContent, stretchFit));
}

/** Calculate the base lines of the children. */
function calculateChildrenBaseLines(
  nodeSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  flexLines: FlexLine[],
  constants: AlgoConstants,
): void {
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

      if (constants.isColumn) {
        // A horizontal-writing item has no baseline in a column flexbox's
        // inline-axis alignment context, so CSS Align §9.3 synthesizes one
        // from its border box. Blink uses the physical left border edge for
        // that synthesized coordinate: in a 3px column, an empty item with
        // margin-left: 90% aligns its zero-margin peer at x=3 in LTR and
        // x=-317 with a 320px right margin in RTL.
        child.baseline = child.margin.left;
        continue;
      }

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
    constants.crossIsRatioDerived && flexLines.every((line) => line.items.every((item) => !item.crossIsArDerived));
  if (!constants.isWrap && cross(nodeSize, constants.dir) !== null && !crossFloorsRatherThanFixes) {
    const crossAxisPaddingBorder = rectCrossAxisSum(constants.contentBoxInset, constants.dir);
    const crossMinSize = cross(constants.minSize, constants.dir);
    const crossMaxSize = cross(constants.maxSize, constants.dir);
    (flexLines[0] ?? unreachable()).crossSize =
      mMax(mSub(mClamp(cross(nodeSize, constants.dir), crossMinSize, crossMaxSize), crossAxisPaddingBorder), 0) ?? 0;
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
      const firstLine = flexLines[0] ?? unreachable();
      firstLine.crossSize = vClamp(
        firstLine.crossSize,
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
      const childStyle = internals(child.node).style;
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
        traceLayout(child.node, {
          phase: 'flex-item-cross',
          source: 'stretch',
          axis: constants.isRow ? 'height' : 'width',
          value: cross(child.targetSize, constants.dir),
          detail: 'stretched to the flex line cross size',
        });
      } else {
        // Flexbox §9.4 step 11 recalculates a cross size that depends on
        // available cross space against the flex line, not the container.
        // This matters for a column item's auto inline size: Blink's
        // BuildSpaceForLayout replaces its available inline size with
        // `line_cross_size` before ComputeInlineSizeForFragment. Chrome 151,
        // a 97px-wide wrapping column whose sibling makes the line 255px wide,
        // expands text from its 97px hypothetical width to its 120px
        // max-content width while preserving the already-resolved 20px height.
        const autoInlineDependsOnLine =
          constants.isColumn && child.aspectRatio === null && cross(childStyle.size, constants.dir) === 'auto';
        if (autoInlineDependsOnLine) {
          const usedCross = Math.max(
            vClamp(
              measureFitContentCrossSize(
                child.node,
                withMain({ width: null, height: null }, constants.dir, main(child.targetSize, constants.dir)),
                constants.nodeInnerSize,
                withCross(
                  withMain<AvailableSpace>(
                    { width: 'max-content', height: 'max-content' },
                    constants.dir,
                    main(constants.containerSize, constants.dir),
                  ),
                  constants.dir,
                  lineCrossSize,
                ),
                child.margin,
                constants.dir,
              ),
              cross(child.minSize, constants.dir),
              cross(child.maxSize, constants.dir),
            ),
            rectCrossAxisSum(rectAdd(child.padding, child.border), constants.dir),
          );
          setCross(child.targetSize, constants.dir, usedCross);
        } else {
          setCross(child.targetSize, constants.dir, cross(child.hypotheticalInnerSize, constants.dir));
        }
      }

      setCross(
        child.outerTargetSize,
        constants.dir,
        cross(child.targetSize, constants.dir) + rectCrossAxisSum(child.margin, constants.dir),
      );
    }

    // Blink treats the ratio-derived cross size as the size of a definite
    // single line: ordinary stretched content is laid out into it and may
    // overflow, but does not enlarge it. Non-stretched items and hard stretch
    // floors (min-size, padding/border, margins) can still grow the line.
    // Chrome, `width: 1px; aspect-ratio: .5` around a stretched 10px-high text
    // item stays 1x2; `align-items: flex-start` grows to 10px, and a stretched
    // item with `min-height: 20px` grows to 20px. This mirrors Blink's
    // GiveItemsFinalPositionAndSize guard for a definite single-line cross size.
    if (constants.crossIsRatioDerived && !constants.isWrap) {
      const ratioOuterCross = vClamp(
        cross(constants.nodeOuterSize, constants.dir) ?? 0,
        cross(constants.minSize, constants.dir),
        cross(constants.maxSize, constants.dir),
      );
      const ratioInnerCross = Math.max(ratioOuterCross - rectCrossAxisSum(constants.contentBoxInset, constants.dir), 0);
      line.crossSize = line.items.reduce((lineExtent, item) => {
        const itemStyle = internals(item.node).style;
        const stretches =
          item.alignSelf.keyword === 'stretch' &&
          !item.alignSelf.safe &&
          !rectCrossStart(item.marginIsAuto, constants.dir) &&
          !rectCrossEnd(item.marginIsAuto, constants.dir) &&
          cross(itemStyle.size, constants.dir) === 'auto';
        if (!stretches) return Math.max(lineExtent, cross(item.outerTargetSize, constants.dir));

        const hardFloor =
          Math.max(
            cross(item.minSize, constants.dir) ?? 0,
            rectCrossAxisSum(rectAdd(item.padding, item.border), constants.dir),
          ) + rectCrossAxisSum(item.margin, constants.dir);
        return Math.max(lineExtent, hardFloor);
      }, ratioInnerCross);

      // The first pass above sized stretch targets from the intrinsic line.
      // Reapply stretch against the ratio-derived line we just rebuilt; Blink
      // likewise lays final children out with the definite line cross size.
      for (const item of line.items) {
        const itemStyle = internals(item.node).style;
        const stretches =
          item.alignSelf.keyword === 'stretch' &&
          !item.alignSelf.safe &&
          !rectCrossStart(item.marginIsAuto, constants.dir) &&
          !rectCrossEnd(item.marginIsAuto, constants.dir) &&
          cross(itemStyle.size, constants.dir) === 'auto';
        if (!stretches) continue;

        const padding = resolveRectOrZero(itemStyle.padding, constants.nodeInnerSize.width);
        const border = resolveRectOrZero(itemStyle.border, constants.nodeInnerSize.width);
        const pbSum = sumAxes(rectAdd(padding, border));
        const boxSizingAdjustment = itemStyle.boxSizing === 'content-box' ? pbSum : sizeZero();
        const maxSizeIgnoringAspectRatio = maybeAddSize(
          maybeResolveSize(itemStyle.maxSize, constants.nodeInnerSize),
          boxSizingAdjustment,
        );
        setCross(
          item.targetSize,
          constants.dir,
          Math.max(
            vClamp(
              line.crossSize - rectCrossAxisSum(item.margin, constants.dir),
              cross(item.minSize, constants.dir),
              cross(maxSizeIgnoringAspectRatio, constants.dir),
            ),
            rectCrossAxisSum(rectAdd(item.padding, item.border), constants.dir),
          ),
        );
        traceLayout(item.node, {
          phase: 'flex-item-cross',
          source: 'stretch',
          axis: constants.isRow ? 'height' : 'width',
          value: cross(item.targetSize, constants.dir),
          detail: 'reapplied against a ratio-derived definite line',
        });
        setCross(
          item.outerTargetSize,
          constants.dir,
          cross(item.targetSize, constants.dir) + rectCrossAxisSum(item.margin, constants.dir),
        );
      }
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

    const visualItems = layoutReverse ? [...line.items].reverse() : line.items;
    const distributed =
      freeSpaceAfterAutoMargins > 0 &&
      (justifyContentMode === 'space-around' ||
        justifyContentMode === 'space-between' ||
        justifyContentMode === 'space-evenly') &&
      (justifyContentMode !== 'space-between' || numItems > 1);
    if (distributed) {
      // Blink 7922 performs distributed alignment in 1/64px LayoutUnits and
      // dithers the division remainder across successive gaps with
      // LayoutUnitDiffuser (flex_layout_algorithm.cc §9.5). Equal floating-
      // point gaps put 41px, 20px, 0px items in 200px at x=23.166…, 110.5,
      // 176.833…; Blink instead uses 23.15625 and gaps 46.328125/46.34375,
      // placing the middle item at 110.484375 so it paints at x=110.
      const rawFreeSpace = Math.trunc(freeSpaceAfterAutoMargins * 64);
      const buckets =
        justifyContentMode === 'space-between'
          ? numItems - 1
          : justifyContentMode === 'space-evenly'
            ? numItems + 1
            : numItems;
      const base = Math.trunc(rawFreeSpace / buckets);
      const remainder = rawFreeSpace % buckets;
      const dx = remainder * 2;
      const dy = buckets * 2;
      let x = 0;
      let y = buckets;
      const nextSpace = (): number => {
        x += dx;
        if (x >= y) {
          y += dy;
          return (base + 1) / 64;
        }
        return base / 64;
      };
      const initialOffset =
        justifyContentMode === 'space-between'
          ? 0
          : Math.trunc(rawFreeSpace / (justifyContentMode === 'space-around' ? 2 * numItems : numItems + 1)) / 64;
      visualItems.forEach((child, index) => {
        child.offsetMain = index === 0 ? initialOffset : gap + nextSpace();
      });
    } else {
      visualItems.forEach((child, index) => {
        child.offsetMain = computeAlignmentOffset(
          freeSpaceAfterAutoMargins,
          numItems,
          gap,
          justifyContentMode,
          layoutReverse,
          index === 0,
        );
      });
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

    // Under `wrap-reverse` the cross-start edge is the line's *end* (§5.2), so
    // the baseline-aligned group hangs from the bottom instead of the top. The
    // group moves as a unit — its items stay aligned to one another — so the
    // whole thing shifts by the gap between the group's lowest margin-box edge
    // and the line's end. Computed per line because it depends on every
    // participating item, not just the one being placed.
    const baselineGroupShift = ((): number => {
      const columnCrossAxisReversed = constants.isColumn && constants.layoutDirection === 'rtl';
      const groupAlignsToLineEnd = constants.isRow
        ? constants.isWrapReverse
        : constants.isWrapReverse !== columnCrossAxisReversed;
      if (!groupAlignsToLineEnd) return 0;
      let groupEnd = 0;
      for (const child of line.items) {
        if (child.alignSelf.keyword !== 'baseline' || child.alignSelf.safe) continue;
        // Flexbox §9.4 builds the line's baseline group from each item's
        // hypothetical outer cross size. Final layout can later enlarge an
        // automatic cross size; using that target here silently changes the
        // already-established group extent and over-shifts reversed columns.
        groupEnd = Math.max(
          groupEnd,
          maxBaseline - child.baseline + cross(child.hypotheticalOuterSize, constants.dir),
        );
      }
      return lineCrossSize - groupEnd;
    })();

    for (const child of line.items) {
      const freeSpace = lineCrossSize - cross(child.outerTargetSize, constants.dir);
      // Auto margins absorb only *positive* free space (css-flexbox-1 §8.1).
      // A negative value would make the margin itself negative and drag the
      // item outside the container: `margin-top: auto` with a 17px bottom
      // margin in a 1px-tall line put the item at y=-16 instead of y=0.
      // The alignment branch below is deliberately NOT floored — overflow
      // alignment needs the true negative value.
      const autoMarginSpace = Math.max(freeSpace, 0);
      // A column's cross axis is horizontal, so `direction: rtl` reverses it.
      const isRtlCross = constants.isColumn && constants.layoutDirection === 'rtl';

      if (rectCrossStart(child.marginIsAuto, constants.dir) && rectCrossEnd(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) {
          child.margin.top = autoMarginSpace / 2;
          child.margin.bottom = autoMarginSpace / 2;
        } else {
          child.margin.left = autoMarginSpace / 2;
          child.margin.right = autoMarginSpace / 2;
          // css-flexbox-1 §9.6 step 13 keeps the logical cross-start
          // auto margin at zero when the item overflows, then assigns the
          // negative remainder to the opposite margin. In an RTL column,
          // inline-start is physical right, so physical left must carry that
          // remainder: Chrome 151 places a 323px item in a 97px line at
          // x = -226, rather than pinning its left edge to zero.
          if (isRtlCross && freeSpace < 0) child.margin.left = freeSpace;
        }
      } else if (rectCrossStart(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) child.margin.top = autoMarginSpace;
        // An RTL column measures the cross axis from the right edge, but the
        // item is positioned later from `margin.left`. While free space is
        // positive the two agree (the auto margin fills the gap). When it is
        // negative the auto margin floors at 0 and the *other* margin still
        // has to place the box, so the left margin has to carry the whole
        // offset: `containerCross - itemCross - marginRight`, which is allowed
        // to go negative. Chrome, a 10px item in a 40px RTL column with
        // `margin-left: auto; margin-right: 97`, is at x = -67 (40-10-97),
        // where flooring alone pinned it to 0.
        else if (isRtlCross) {
          child.margin.left = lineCrossSize - cross(child.targetSize, constants.dir) - child.margin.right;
        } else {
          child.margin.left = autoMarginSpace;
        }
      } else if (rectCrossEnd(child.marginIsAuto, constants.dir)) {
        if (constants.isRow) child.margin.bottom = autoMarginSpace;
        else child.margin.right = autoMarginSpace;
        // Mirror of the case above: with the *end* margin auto and the start
        // margin overflowing, an RTL column still places from the right edge,
        // so the start margin must be rewritten to the equivalent left offset.
        // Chrome puts a 10px item with `margin-left: 97; margin-right: auto`
        // in a 40px RTL column at x = 30 (40-10-0), not 97.
        if (!constants.isRow && isRtlCross) {
          child.margin.left = lineCrossSize - cross(child.targetSize, constants.dir) - child.margin.right;
        }
      } else {
        // 14. Align all flex items along the cross-axis.
        child.offsetCross = alignFlexItemsAlongCrossAxis(child, freeSpace, maxBaseline, baselineGroupShift, constants);
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
  baselineGroupShift: number,
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
    case 'center': {
      // Blink stores free space as a 1/64px LayoutUnit, then divides that
      // integer by two toward zero. Preserve both truncations here: with
      // -1.01px of free space Chrome centers at exactly -0.5px, while direct
      // floating-point division gives -0.505px and the final LTR edge snap
      // incorrectly paints the item one pixel farther left. Under a reversed
      // cross axis the physical start gets the other half, including the
      // discarded remainder: 63 LayoutUnits split into 31 from logical start
      // and 32 from physical left, matching Blink's logical-to-physical flip.
      const startHalf = Math.trunc(Math.trunc(freeSpace * 64) / 2) / 64;
      return crossAxisShouldReverse ? freeSpace - startHalf : startHalf;
    }
    case 'baseline':
      // Baseline members move as one group. For rows, `wrap-reverse` hangs the
      // group from the line's end (§5.2); for columns Chrome also reverses that
      // group edge under RTL. A 50px RTL column line holding 20px and 10px
      // synthesized-baseline items places both at x=30, not at their separate
      // flex-start offsets of 30 and 40.
      return maxBaseline - child.baseline + baselineGroupShift;
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
  // (css-sizing-4 §4.2). determineUsedCrossSize has already expanded lines by
  // any larger used item margin boxes, matching Blink's row relayout pass.
  const contentCrossSize = totalLineCrossSize + totalCrossAxisGap + paddingBorderSum;
  const specifiedCross = cross(nodeSize, constants.dir);
  const resolvedCross =
    specifiedCross !== null && constants.crossIsRatioDerived
      ? Math.max(specifiedCross, contentCrossSize)
      : (specifiedCross ?? contentCrossSize);

  // CSS Sizing 4 §4.2 transfers the ratio-determining axis's initial
  // constraint through the preferred ratio. For an automatic-width column,
  // its own block-axis padding+border is that minimum constraint; arbitrary
  // intrinsic child height is not. Blink's ComputeMinMaxInlineSizes likewise
  // transfers ResolveInitialMinBlockLength (the block inset floor), not the
  // final content-driven block size. Chrome therefore gives a border-box
  // column with 217px of block border and `aspect-ratio: 3` a 651px width,
  // while a borderless column around a 97px-tall child stays at the child's
  // intrinsic 10px width rather than growing to 145.5px.
  const ratioCrossInsetFloor =
    constants.isColumn &&
    constants.aspectRatio !== null &&
    constants.boxSizing === 'border-box' &&
    (specifiedCross === null || constants.crossIsRatioDerived)
      ? main(constants.paddingBorderSize, constants.dir) * constants.aspectRatio
      : 0;
  const outerContainerSize = Math.max(
    vClamp(Math.max(resolvedCross, ratioCrossInsetFloor), minCrossSize, maxCrossSize),
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
    line.offsetCross = computeAlignmentOffset(
      freeSpace,
      numLines,
      gap,
      alignContentMode,
      constants.isWrapReverse,
      i === 0,
    );
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
  containerMainSizeIsDefinite: boolean,
): void {
  const itemInternals = internals(item.node);
  const itemStyle = itemInternals.style;
  const resolvedCrossStyle = maybeResolve(cross(itemStyle.size, direction), cross(nodeInnerSize, direction));
  const resolvedCrossMin = maybeResolve(cross(itemStyle.minSize, direction), cross(nodeInnerSize, direction));
  const resolvedCrossMax = maybeResolve(cross(itemStyle.maxSize, direction), cross(nodeInnerSize, direction));
  const crossIsFixedByMinMax =
    resolvedCrossMin !== null && resolvedCrossMax !== null && resolvedCrossMax <= resolvedCrossMin;
  const stretches =
    item.alignSelf.keyword === 'stretch' &&
    !item.alignSelf.safe &&
    !rectCrossStart(item.marginIsAuto, direction) &&
    !rectCrossEnd(item.marginIsAuto, direction);
  const knownDimensions = { width: item.targetSize.width, height: item.targetSize.height };

  // Preserve an auto block-axis cross size for a non-stretched, ratio-less
  // nested flex container. Blink supplies the line cross size as available space
  // and fixes only the flexed main size; it fixes the cross size only for
  // stretch.
  // Passing the hypothetical cross size as known lets a nested container feed
  // that later size through a descendant's ratio and change its already-
  // resolved main size, contrary to css-flexbox §9.4 step 11. Chrome, an
  // auto-height nested row around an empty 1:1 item and one 10px glyph, keeps
  // the ratio item at 0x10; fixing the row's cross size early makes it 10x10.
  // The explicit-minimum case follows the same rule (f93ee102). This is row-
  // only: a column's cross axis is the inline axis, where the previously
  // resolved shrink-to-fit width is the used size. Chrome keeps a non-
  // stretched nested row around a 320px flex-basis item 320px wide; clearing
  // that inline size here recomputes it as zero in content-size mode.
  if (
    dirIsRow(direction) &&
    itemStyle.display === 'flex' &&
    resolvedCrossStyle === null &&
    !crossIsFixedByMinMax &&
    itemStyle.aspectRatio === null &&
    itemInternals.children.length > 0 &&
    !stretches
  ) {
    setCross(knownDimensions, direction, null);
  }

  // Flexbox §9.8 makes a post-flex main size definite only when the
  // container's main size or the item's flex basis was definite. Preserve a
  // numeric-but-indefinite main size across nested flex layout; otherwise a
  // nested row treats its eventual stretched cross size as definite during
  // §9.2 and transfers it through a descendant's aspect ratio too early.
  const knownDimensionsAreIndefinite = withMain(
    { width: false, height: false },
    direction,
    itemStyle.display === 'flex' && !containerMainSizeIsDefinite && !item.flexBasisIsDefinite,
  );

  const layoutOutput = performChildLayout(
    item.node,
    knownDimensions,
    nodeInnerSize,
    { width: containerSize.width, height: containerSize.height },
    'content-size',
    LINE_FALSE,
    // css-flexbox §9.4 step 11 re-lays out a stretched item with its
    // used cross size treated as definite. Preserve that provenance for a
    // nested flex container: its own aspect ratio and overflowing content
    // must not enlarge the already-resolved line cross size. Chrome keeps a
    // 9px-wide 1:1 item at 9x0 when its parent's flex line is 0px tall, even
    // though the item's child has 47px of intrinsic block size.
    withCross({ width: false, height: false }, direction, stretches && resolvedCrossStyle === null),
    knownDimensionsAreIndefinite,
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
    ? totalOffsetMain.value - item.offsetMain - rectMainEnd(item.margin, direction) - mainRelativeInset - size.width
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

  internals(item.node).unroundedLayout = {
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
  containerMainSizeIsDefinite: boolean,
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
      containerMainSizeIsDefinite,
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
      constants.mainSizeIsDefinite,
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
function performAbsoluteLayoutOnAbsoluteChildren(node: LayoutNode, constants: AlgoConstants): Size<number> {
  const nd = internals(node);
  const containerWidth = constants.containerSize.width;
  const containerHeight = constants.containerSize.height;
  const insetRelativeSize = {
    width: constants.containerSize.width - horizontalSum(constants.border) - constants.scrollbarGutter.x,
    height: constants.containerSize.height - verticalSum(constants.border) - constants.scrollbarGutter.y,
  };

  const contentSize = sizeZero();

  for (let order = 0; order < nd.children.length; order++) {
    const child = nd.children[order] ?? unreachable();
    const childNd = internals(child);
    const childStyle = childNd.style;

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

    // The child's own align-self controls whether opposing cross-axis insets
    // resolve an automatic block size (an abspos child is not a flex item).
    const crossStretches = (childStyle.alignSelf ?? { keyword: 'stretch' }).keyword === 'stretch';
    const fillHeightFromInsets = constants.isRow ? crossStretches : true;
    // justify-self always governs the containing block's physical inline
    // axis, independent of the flex direction. `auto`/normal and explicit
    // stretch fill between opposing insets; positional values use fit-content.
    const fillWidthFromInsets = absoluteAxisStretches(childStyle.justifySelf);

    // Compute known dimensions from min/max/inherent size styles
    const resolvedStyleSize = maybeResolveSize(childStyle.size, insetRelativeSize);
    const resolvedMinSize = maybeResolveSize(childStyle.minSize, insetRelativeSize);
    const resolvedMaxSize = maybeResolveSize(childStyle.maxSize, insetRelativeSize);
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
      overflow.x === 'visible' &&
      (overflow.y === 'visible' || overflow.y === 'clip') &&
      (resolvedStyleSize.height !== null || (top !== null && bottom !== null && fillHeightFromInsets));
    if (ratioAutoMinInlineApplies) {
      // css-sizing-4 §4.3: an abspos box whose ratio can use a resolved block
      // size has a min-content automatic inline minimum, capped by max-width.
      // Blink applies this even when width itself is specified: 20px around
      // five 10px glyphs becomes 50px while overflow-inline is visible.
      const minContentWidth = measureChildSize(
        child,
        { width: null, height: null },
        insetRelativeSize,
        { width: 'min-content', height: 'max-content' },
        'content-size',
        'horizontal',
      );
      minSize = { ...minSize, width: Math.max(minSize.width, Math.min(minContentWidth, maxSize.width ?? Infinity)) };
    }
    let knownDimensions = sizeMaybeClamp(styleSize, minSize, maxSize);

    // Opposing insets only *stretch* the box in the axis alignment governs when
    // the alignment is stretch — the default. `align-self: center | start | end`
    // leaves the size auto and instead positions the box inside the band the
    // insets describe. Chrome, an empty abspos child with `top: 10; bottom: 10`
    // in a 100px-tall row container:
    //   align-self: stretch (or unset) -> y=10, height 80
    //   align-self: start              -> y=10, height  0
    //   align-self: center             -> y=50, height  0
    //   align-self: end                -> y=90, height  0
    // The engine stretched to 80 for every keyword. `align-items: center` on
    // the container does not do this (the child is not a flex item, so it takes
    // the container's alignment only as its static-position default), which is
    // why this reads the child's own `align-self`.
    //
    // Main axis is unaffected: only the cross axis is aligned, so a row's width
    // still fills between left/right regardless of `align-self`.
    // Cross axis is vertical in a row, horizontal in a column.
    //
    // The child's OWN `align-self` decides this, not the container's
    // `align-items`: an abspos child is not a flex item, so it inherits the
    // container's alignment only as a static-position default and keeps
    // stretching between its insets. Chrome, `align-items: center` on the
    // container with `top: 10; bottom: 10` on the child, is still y=10 h=80 —
    // reading the resolved `alignSelf` here collapsed it to y=50 h=0.
    // Fill in width from left/right and reapply aspect ratio if:
    //   - Width is not already known  - Item has both left and right inset properties set
    if (knownDimensions.width === null && left !== null && right !== null && fillWidthFromInsets) {
      const newWidthRaw = vSub(vSub(insetRelativeSize.width, margin.left), margin.right) - left - right;
      knownDimensions.width = Math.max(newWidthRaw, 0);
      knownDimensions = sizeMaybeClamp(maybeApplyAspectRatio(knownDimensions, aspectRatio), minSize, maxSize);
    }

    // Fill in height from top/bottom and reapply aspect ratio if:
    //   - Height is not already known  - Item has both top and bottom inset properties set
    if (knownDimensions.height === null && top !== null && bottom !== null && fillHeightFromInsets) {
      const newHeightRaw = vSub(vSub(insetRelativeSize.height, margin.top), margin.bottom) - top - bottom;
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

    // CSS2 §10.3.7 measures shrink-to-fit width in the inset-modified
    // containing block, then §10.4 clamps the tentative result by min/max.
    // Do not clamp before removing the inset: in a 12px container,
    // `right: 1; max-width: 11` is 11px wide in Chrome, not 10px.
    const insetReservedHeight = top !== null && bottom !== null ? 0 : (top ?? bottom ?? 0);
    const staticPositionInlineSize = (() => {
      // With both inline insets auto, CSS2 §10.3.7 first substitutes the
      // static position. Blink's ComputeUnclampedIMCBInOneAxis then grows the
      // available band from that point toward the selected alignment edge.
      // The point is inside the padding box, in logical inline coordinates.
      const inlineStartInset =
        constants.layoutDirection === 'rtl'
          ? constants.contentBoxInset.right - constants.border.right
          : constants.contentBoxInset.left - constants.border.left;
      const inlineEndInset =
        constants.layoutDirection === 'rtl'
          ? constants.contentBoxInset.left - constants.border.left - constants.scrollbarGutter.x
          : constants.contentBoxInset.right - constants.border.right - constants.scrollbarGutter.x;
      const contentInlineSize = Math.max(insetRelativeSize.width - inlineStartInset - inlineEndInset, 0);

      type StaticEdge = 'start' | 'center' | 'end';
      let edge: StaticEdge;
      if (constants.isRow) {
        const keyword = constants.justifyContent?.keyword;
        if (keyword === 'center' || keyword === 'space-around' || keyword === 'space-evenly') {
          edge = 'center';
        } else if (keyword === 'start') {
          edge = 'start';
        } else if (keyword === 'end') {
          edge = 'end';
        } else if (keyword === 'flex-end') {
          edge = isReverse(constants.dir) ? 'start' : 'end';
        } else {
          // The initial value is flex-start; stretch and space-between use its
          // single-subject fallback for the static-position rectangle.
          edge = isReverse(constants.dir) ? 'end' : 'start';
        }
      } else {
        const keyword = alignSelf.keyword;
        if (keyword === 'center') {
          edge = 'center';
        } else if (keyword === 'end') {
          edge = 'end';
        } else if (keyword === 'flex-end') {
          edge = constants.isWrapReverse ? 'start' : 'end';
        } else if (keyword === 'flex-start' || keyword === 'stretch') {
          edge = constants.isWrapReverse ? 'end' : 'start';
        } else {
          edge = 'start';
        }
      }

      const staticOffset =
        edge === 'start'
          ? inlineStartInset
          : edge === 'end'
            ? inlineStartInset + contentInlineSize
            : inlineStartInset + contentInlineSize / 2;
      if (edge === 'start') return Math.max(insetRelativeSize.width - staticOffset, 0);
      if (edge === 'end') return Math.max(staticOffset, 0);
      return Math.max(2 * Math.min(staticOffset, insetRelativeSize.width - staticOffset), 0);
    })();
    const shrinkToFitWidth =
      left === null && right === null
        ? vClamp(staticPositionInlineSize, minSize.width, maxSize.width)
        : insetModifiedContainingBlockSize(insetRelativeSize.width, { start: left, end: right });
    const shrinkToFitHeight = asMaybeSub(vClamp(containerHeight, minSize.height, maxSize.height), insetReservedHeight);
    // An abspos child's percentage-resolution size is its containing block's
    // padding box, not the flex container's content box. Blink's
    // OutOfFlowLayoutPart builds `container_rect` by removing only border and
    // scrollbar, then passes that rect to SetPercentageResolutionSize. Chrome
    // 151, a 360px border-box flex container whose content width is 0 resolves
    // `padding-top: 1%` on its abspos child to 4px; using nodeInnerSize resolves
    // it to 0 and turns the child's 4px content offset into descendant height.
    const absoluteChildParentSize = insetRelativeSize;
    // An automatic abspos inline size is fit-content, not ordinary layout at
    // the numeric available width (CSS2 §10.3.7). Blink's absolute_utils
    // resolves min/max inline contributions and applies the fit-content clamp
    // before final layout. Without that intrinsic pass, a shrinkable empty
    // flex item with `flex-basis: 40px` made its abspos flex parent 40px wide;
    // Chrome gives both boxes 0px because their min/max contributions are 0.
    // A non-shrinkable item still contributes its 40px hypothetical size.
    if (knownDimensions.width === null) {
      const contributionKnownDimensions = { ...knownDimensions, width: null };
      const contributionAvailableSpace = { width: 'min-content' as const, height: shrinkToFitHeight };
      const minContentWidth = measureChildSize(
        child,
        contributionKnownDimensions,
        absoluteChildParentSize,
        contributionAvailableSpace,
        'inherent-size',
        'horizontal',
      );
      const maxContentWidth = measureChildSize(
        child,
        contributionKnownDimensions,
        absoluteChildParentSize,
        { ...contributionAvailableSpace, width: 'max-content' },
        'inherent-size',
        'horizontal',
      );
      knownDimensions.width = Math.min(maxContentWidth, Math.max(minContentWidth, shrinkToFitWidth));
    }
    const ratioAutoMinBlockApplies =
      aspectRatio !== null &&
      childStyle.size.height === 'auto' &&
      childStyle.minSize.height === 'auto' &&
      internals(child).measure === undefined;
    if (ratioAutoMinBlockApplies) {
      // OOF sizing resolves the fit-content inline size before the automatic
      // ratio-dependent block size (Blink 7922 absolute_utils.cc:
      // ComputeOofInlineDimensions, then ComputeOofBlockDimensions). Sizing 4
      // §4.3 gives that automatic axis a min-content floor. Preserve the
      // authored `auto` provenance after the ratio has produced a number:
      // Chrome gives an empty 0px-wide abspos grid with a 1px explicit row a
      // 1px height, not the ratio-derived 0px. Blink's OOF layout keeps this
      // intrinsic floor for hidden/scroll/clip overflow as well.
      const minContentHeight = measureChildSize(
        child,
        { width: knownDimensions.width, height: null },
        absoluteChildParentSize,
        { width: knownDimensions.width, height: 'max-content' },
        'content-size',
        'vertical',
      );
      minSize = {
        ...minSize,
        height: Math.max(minSize.height, Math.min(minContentHeight, maxSize.height ?? Infinity)),
      };
      knownDimensions = sizeMaybeClamp(knownDimensions, minSize, maxSize);
    }
    const measuredSize = measureChildSizeBoth(
      child,
      knownDimensions,
      absoluteChildParentSize,
      { width: shrinkToFitWidth, height: shrinkToFitHeight },
      'inherent-size',
    );
    const finalSize: Size<number> = {
      width: vClamp(knownDimensions.width ?? measuredSize.width, minSize.width, maxSize.width),
      height: vClamp(knownDimensions.height ?? measuredSize.height, minSize.height, maxSize.height),
    };

    const layoutOutput = performChildLayout(
      child,
      { width: finalSize.width, height: finalSize.height },
      absoluteChildParentSize,
      {
        width: vClamp(containerWidth, minSize.width, maxSize.width),
        height: vClamp(containerHeight, minSize.height, maxSize.height),
      },
      'inherent-size',
    );

    const resolvedHorizontal = resolveAlignedAbsoluteAxis(
      insetRelativeSize.width,
      { start: left, end: right },
      { start: margin.left, end: margin.right },
      finalSize.width,
      true,
      constants.layoutDirection !== 'rtl',
      childStyle.justifySelf,
    );
    // CSS Align §4.4: default abspos overflow alignment uses the union of
    // the inset-modified and original containing blocks. Blink's
    // absolute_utils::ComputeInsets therefore moves a specified-height row
    // child from `top: 1px` back to y=0 when its margin box cannot fit even in
    // that union; explicit `safe` continues to honor the IMCB's start edge.
    const verticalSizeIsAuto = maybeResolve(childStyle.size.height, insetRelativeSize.height) === null;
    const resolvedVertical =
      constants.isRow && !verticalSizeIsAuto
        ? resolveAlignedAbsoluteAxis(
            insetRelativeSize.height,
            { start: top, end: bottom },
            { start: margin.top, end: margin.bottom },
            finalSize.height,
            false,
            true,
            childStyle.alignSelf,
          )
        : resolveAbsoluteAxis(
            insetRelativeSize.height,
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

    // Determine flex-relative insets
    const [startMain, endMain] = constants.isRow ? [usedLeft, usedRight] : [usedTop, usedBottom];
    const [startCross, endCross] = constants.isRow ? [usedTop, usedBottom] : [usedLeft, usedRight];
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
      const keyword = (constants.justifyContent ?? { keyword: 'flex-start', safe: false }).keyword;
      const startOffset =
        rectMainStart(constants.contentBoxInset, constants.dir) + rectMainStart(resolvedMargin, constants.dir);
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

      // Blink maps abspos static positions by alignment edge: logical
      // start/end follow inline direction but not `*-reverse`; flex-start/end
      // follow the flex main axis. A lone space-between subject falls back to
      // flex-start (css-align-3 §5.1.3).
      if (keyword === 'space-between' || keyword === 'stretch' || keyword === 'flex-start') {
        offsetMain = mainAxisFlexStartReversed ? endOffset : startOffset;
      } else if (keyword === 'flex-end') {
        offsetMain = mainAxisFlexStartReversed ? startOffset : endOffset;
      } else if (keyword === 'start') {
        offsetMain = mainIsRtl ? endOffset : startOffset;
      } else if (keyword === 'end') {
        offsetMain = mainIsRtl ? startOffset : endOffset;
      } else {
        // space-evenly | space-around | center
        offsetMain = centerOffset;
      }
    }

    // Apply cross-axis alignment
    let offsetCross: number;
    // Both insets set but the box was not stretched to fill them (a non-stretch
    // `align-self`, see `fillHeightFromInsets` above): the band the insets
    // describe becomes the alignment container, and the box is aligned inside
    // it rather than pinned to its start edge. Chrome, an empty abspos child
    // with `top: 10; bottom: 10` in a 100px row: `start` -> y=10, `center` ->
    // y=50, `end` -> y=90, all with height 0.
    //
    // Only when the cross size is *automatic*. A specified size leaves nothing
    // for alignment to distribute — the insets pin the box at the start edge.
    // WPT abspos_align-self-with-flex-grid-parent: `align-self: center` with
    // `top/left/bottom/right: 0` and an explicit `width/height: 100px` expects
    // (0,0), not a centered box.
    const crossSizeIsAuto = cross(maybeResolveSize(childStyle.size, insetRelativeSize), constants.dir) === null;
    const horizontalJustifySelfWasApplied =
      !constants.isRow &&
      left !== null &&
      right !== null &&
      margin.left !== null &&
      margin.right !== null &&
      !absoluteAxisStretches(childStyle.justifySelf);
    const alignsWithinInsetBand =
      startCross !== null &&
      endCross !== null &&
      !crossStretches &&
      crossSizeIsAuto &&
      alignSelf.keyword !== 'baseline' &&
      !horizontalJustifySelfWasApplied;
    if (alignsWithinInsetBand) {
      const bandStart =
        (startCross as number) +
        rectCrossStart(constants.border, constants.dir) +
        crossStartScrollbarOffset +
        rectCrossStart(resolvedMargin, constants.dir);
      const bandEnd =
        cross(constants.containerSize, constants.dir) -
        rectCrossEnd(constants.border, constants.dir) -
        crossEndScrollbarOffset -
        cross(finalSize, constants.dir) -
        (endCross as number) -
        rectCrossEnd(resolvedMargin, constants.dir);
      const keyword = resolveSelfAlignmentSafety(alignSelf, bandEnd < bandStart);
      const atEnd = keyword === 'end' || keyword === 'flex-end';
      const atStart = keyword === 'start' || keyword === 'flex-start';
      offsetCross = atEnd
        ? crossAxisFlexStartReversed
          ? bandStart
          : bandEnd
        : atStart
          ? crossAxisFlexStartReversed
            ? bandEnd
            : bandStart
          : (bandStart + bandEnd) / 2;
    } else if (startCross !== null || endCross !== null) {
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

    if (
      constants.isRow &&
      childStyle.alignSelf !== null &&
      !childStyle.alignSelf.safe &&
      usedTop !== null &&
      usedBottom !== null &&
      crossSizeIsAuto
    ) {
      // CSS Align §4.4 gives a plain (neither `safe` nor `unsafe`) abspos
      // alignment special overflow behavior. If its margin box does not fit
      // the inset-modified containing block, constrain the aligned position to
      // the union of that rectangle and the original containing block. Blink's
      // `ComputeInsets` applies this after alignment and prioritizes block-start.
      // Chrome, a 0px-tall containing block with `top: 1; bottom: 0` around a
      // 1px-tall auto-sized child, moves plain `align-self: start` from y=1 to
      // y=0; explicit `safe start` stays at y=1.
      const marginBoxSize = finalSize.height + resolvedMargin.top + resolvedMargin.bottom;
      const imcbSize = insetRelativeSize.height - usedTop - usedBottom;
      const imcbStart = constants.border.top + usedTop + resolvedMargin.top;
      const imcbEnd =
        containerHeight -
        constants.border.bottom -
        constants.scrollbarGutter.y -
        finalSize.height -
        usedBottom -
        resolvedMargin.bottom;

      let safeStart = imcbStart;
      let safeEnd = imcbEnd;
      if (marginBoxSize > imcbSize) {
        const containingBlockStart = constants.border.top + resolvedMargin.top;
        const containingBlockEnd =
          containerHeight -
          constants.border.bottom -
          constants.scrollbarGutter.y -
          finalSize.height -
          resolvedMargin.bottom;
        safeStart = Math.min(safeStart, containingBlockStart);
        safeEnd = Math.max(safeEnd, containingBlockEnd);
      }

      offsetCross = safeEnd < safeStart ? safeStart : Math.min(Math.max(offsetCross, safeStart), safeEnd);
    }

    const location: Point<number> = constants.isRow
      ? { x: offsetMain, y: offsetCross }
      : { x: offsetCross, y: offsetMain };
    const scrollbarSize = {
      width: overflow.y === 'scroll' ? scrollbarWidth : 0,
      height: overflow.x === 'scroll' ? scrollbarWidth : 0,
    };
    childNd.unroundedLayout = {
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
        width: overflow.x === 'visible' ? Math.max(finalSize.width, layoutOutput.contentSize.width) : finalSize.width,
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
