// The grid layout orchestrator.
// Phases: resolve explicit grid → place items → size tracks → align & position.

import { unreachable } from '../../assert.js';
import type { Rect, Size } from '../../geometry.js';
import { applyAspectRatioClamped, rectAdd, sumAxes } from '../../geometry.js';
import type { Opt } from '../../math.js';
import { mClamp, mSub, vClamp } from '../../math.js';
import type { AvailableSpace, Direction } from '../../style.js';
import {
  ALIGN_CONTENT_STRETCH,
  ALIGN_STRETCH,
  isScrollContainer,
  maybeResolveSize,
  resolveRectOrZero,
  trackDefiniteValue,
  trackResolvedPercentageSize,
  trackUsesPercentage,
} from '../../style.js';
import type { LayoutInput, LayoutNode, LayoutOutput } from '../../tree.js';
import { fromOuterSize, fromSizesAndBaselines, internals, layoutWithOrder } from '../../tree.js';
import { maybeApplyAspectRatioUsed } from '../aspectRatio.js';
import { performChildLayout } from '../dispatch.js';
import { alignAndPositionItem, alignTracks } from './alignment.js';
import type { AutoRepeatStrategy } from './explicit.js';
import { computeExplicitGridSizeInAxis, initializeGridTracks } from './explicit.js';
import { computeGridSizeEstimate } from './implicit.js';
import { placeGridItems } from './placement.js';
import {
  determineIfItemCrossesFlexibleOrIntrinsicTracks,
  resolveItemTrackIndexes,
  trackSizingAlgorithm,
} from './trackSizing.js';
import type { GridItem, GridTrack, TrackCounts } from './types.js';
import {
  CellOccupancyMatrix,
  itemGridAreaSize,
  itemMinContentContribution,
  itemParticipatesInBlockBaselineAlignment,
  ozResolveAbsolutelyPositionedGridTracks,
  placementLineIntoOriginZero,
  trackIsFlexible,
} from './types.js';

/** CSS Grid's available-grid-space rule clamps definite min/max constraints. */
function clampGridAvailableSpace(space: AvailableSpace, min: Opt, max: Opt): AvailableSpace {
  if (typeof space === 'number') return vClamp(space, min, max);
  // An intrinsic constraint remains indefinite without an upper bound, but a
  // definite maximum becomes the finite space tracks size into. Chrome 151,
  // `display:grid; max-width:15px` around `H<ZWSP>H` produces a 15px track and
  // two text lines; sizing under max-content first produced a 20px single line.
  // A min-content query must remain a min-content query: a nested grid with
  // `max-width:80px` can still contribute only 40px to a min-content parent.
  // For max-content, however, the definite cap supplies the finite space to
  // fill. (The full spec model carries separate available/min/max sizes.)
  return space === 'max-content' && max !== null ? Math.max(max, min ?? max) : space;
}

/** Translate an oz line placement by the axis coalescing offset (implicit.ts). */
function ozLineTranslateAbs(
  line: { start: import('./types.js').OzGridPlacement; end: import('./types.js').OzGridPlacement },
  offset: number,
): { start: import('./types.js').OzGridPlacement; end: import('./types.js').OzGridPlacement } {
  if (offset === 0) return line;
  const shift = (p: import('./types.js').OzGridPlacement): import('./types.js').OzGridPlacement =>
    typeof p === 'object' && 'line' in p ? { line: p.line + offset } : p;
  return { start: shift(line.start), end: shift(line.end) };
}

/** Grid layout algorithm entry point */
export function computeGridLayout(node: LayoutNode, inputs: LayoutInput): LayoutOutput {
  const nd = internals(node);
  const { knownDimensions, parentSize, availableSpace, runMode } = inputs;

  const style = nd.style;
  const direction = style.direction;

  // 1. Compute "available grid space" — https://www.w3.org/TR/css-grid-1/#available-grid-space
  const aspectRatio = style.aspectRatio;
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorder = rectAdd(padding, border);
  const paddingBorderSize = sumAxes(paddingBorder);
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };

  // See the matching note in block.ts: pushing min/max through the ratio
  // invents a bound on the other axis, which then clamps a size specified there.
  const minSize = maybeAddSize(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
  const preferredSize: Size<Opt> =
    inputs.sizingMode === 'inherent-size'
      ? applyAspectRatioClamped(
          maybeAddSize(maybeResolveSize(style.size, parentSize), boxSizingAdjustment),
          minSize,
          maxSize,
          aspectRatio,
          boxSizingAdjustment,
        )
      : { width: null, height: null };

  // Scrollbar gutters (axes transposed)
  const scrollbarGutter = {
    x: style.overflow.y === 'scroll' ? style.scrollbarWidth : 0,
    y: style.overflow.x === 'scroll' ? style.scrollbarWidth : 0,
  };
  const contentBoxInset: Rect<number> = { ...paddingBorder };
  contentBoxInset.bottom += scrollbarGutter.y;
  if (direction === 'rtl') {
    contentBoxInset.left += scrollbarGutter.x;
  } else {
    contentBoxInset.right += scrollbarGutter.x;
  }

  const alignContent = style.alignContent ?? ALIGN_CONTENT_STRETCH;
  const justifyContent = style.justifyContent ?? ALIGN_CONTENT_STRETCH;
  const alignItems = style.alignItems;
  const justifyItems = style.justifyItems;

  const constrainedAvailableSpace: Size<AvailableSpace> = {
    width: vMaxAs(
      clampGridAvailableSpace(
        knownDimensions.width ?? preferredSize.width ?? availableSpace.width,
        minSize.width,
        maxSize.width,
      ),
      paddingBorderSize.width,
    ),
    height: vMaxAs(
      clampGridAvailableSpace(
        knownDimensions.height ?? preferredSize.height ?? availableSpace.height,
        minSize.height,
        maxSize.height,
      ),
      paddingBorderSize.height,
    ),
  };

  const availableGridSpace: Size<AvailableSpace> = {
    width: mapDefinite(constrainedAvailableSpace.width, (space) => space - horizontalSum(contentBoxInset)),
    height: mapDefinite(constrainedAvailableSpace.height, (space) => space - verticalSum(contentBoxInset)),
  };

  // css-sizing-4: a definite size in one axis transfers through `aspect-ratio`.
  // `preferredSize` above can only transfer between *style* sizes, so a grid
  // whose width is definite solely because the caller said so (both style axes
  // `auto`) never got its ratio-derived height and fell back to the content
  // height. Flex and block layout already do this (the `derivedFromKnown` step
  // in flexbox.ts); a grid root with `aspect-ratio: .5` around a `min-width: 97`
  // item was 97x10 in Chrome's 97x194.
  // `content-size` is the intrinsic-content query, not a second preferred-size
  // pass. Preserve known dimensions as constraints for descendants, but do
  // not let this grid's own ratio fill the queried axis before track sizing.
  // CSS Sizing 4 §4.3 then allows the caller to compare the actual min-content
  // result with the ratio-derived automatic size. Chrome 151, a 0px-tall 1:1
  // grid around 5px of inline padding, reports a 5px automatic minimum rather
  // than short-circuiting its intrinsic query at the ratio-derived 0px.
  const derivedFromKnown =
    inputs.sizingMode === 'inherent-size'
      ? maybeApplyAspectRatioUsed(knownDimensions, aspectRatio, style.boxSizing, paddingBorderSize)
      : { width: null, height: null };

  const outerNodeSize: Size<Opt> = {
    width: vMaxOpt(
      mClamp(knownDimensions.width ?? preferredSize.width ?? derivedFromKnown.width, minSize.width, maxSize.width),
      paddingBorderSize.width,
    ),
    height: vMaxOpt(
      mClamp(knownDimensions.height ?? preferredSize.height ?? derivedFromKnown.height, minSize.height, maxSize.height),
      paddingBorderSize.height,
    ),
  };
  const innerNodeSize: Size<Opt> = {
    width: outerNodeSize.width !== null ? outerNodeSize.width - horizontalSum(contentBoxInset) : null,
    height: outerNodeSize.height !== null ? outerNodeSize.height - verticalSum(contentBoxInset) : null,
  };

  // A ratio-derived automatic block size is definite, but its automatic
  // minimum can still be the grid's intrinsic row extent (css-sizing-4 §4.3).
  // During flex hypothetical-cross-size measurement Blink compares the ratio
  // content size with an intrinsic child layout. Do not return the former
  // before track sizing has produced the latter: a zero-width 1:1 grid with a
  // 1px row contributes 1px to its flex line, not zero. Explicit min-height or
  // scrollable block overflow disables that automatic minimum.
  const mustMeasureAutomaticRatioBlockMinimum =
    aspectRatio !== null &&
    maybeResolveSize(style.size, parentSize).height === null &&
    style.minSize.height === 'auto' &&
    !isScrollContainer(style.overflow.y);

  // Short-circuit if computing size and size fully determined
  if (runMode === 'compute-size') {
    if (
      outerNodeSize.width !== null &&
      outerNodeSize.height !== null &&
      !(inputs.axis === 'vertical' && mustMeasureAutomaticRatioBlockMinimum)
    ) {
      return fromOuterSize({ width: outerNodeSize.width, height: outerNodeSize.height });
    }
    if (inputs.axis === 'horizontal' && outerNodeSize.width !== null) {
      return fromOuterSize({ width: outerNodeSize.width, height: 0 });
    }
  }

  // 2. Resolve the explicit grid
  // Like inner_node_size, but falling back to min/max sizes when indefinite
  const autoFitContainerSize: Size<Opt> = {
    width: mSub(
      vMaxOpt(
        mClamp(outerNodeSize.width ?? maxSize.width ?? minSize.width, minSize.width, maxSize.width),
        paddingBorderSize.width,
      ),
      horizontalSum(contentBoxInset),
    ),
    height: mSub(
      vMaxOpt(
        mClamp(outerNodeSize.height ?? maxSize.height ?? minSize.height, minSize.height, maxSize.height),
        paddingBorderSize.height,
      ),
      verticalSum(contentBoxInset),
    ),
  };

  const autoRepeatFitStrategy = (axisValue: Opt): AutoRepeatStrategy =>
    axisValue !== null ? 'max-repetitions-that-do-not-overflow' : 'min-repetitions-that-do-overflow';

  const [, gridTemplateColCount] = computeExplicitGridSizeInAxis(
    style,
    autoFitContainerSize.width,
    autoRepeatFitStrategy(outerNodeSize.width ?? maxSize.width),
    'horizontal',
  );
  const [, gridTemplateRowCount] = computeExplicitGridSizeInAxis(
    style,
    autoFitContainerSize.height,
    autoRepeatFitStrategy(outerNodeSize.height ?? maxSize.height),
    'vertical',
  );

  const explicitColCount = gridTemplateColCount;
  const explicitRowCount = gridTemplateRowCount;

  // 3. Implicit Grid: estimate track counts
  const inFlowChildren: { index: number; node: LayoutNode }[] = [];
  for (let index = 0; index < nd.children.length; index++) {
    const child = nd.children[index] ?? unreachable();
    const childStyle = internals(child).style;
    if (childStyle.display === 'none' || childStyle.position === 'absolute') continue;
    inFlowChildren.push({ index, node: child });
  }
  const [estColCounts, estRowCounts, ozOffsets] = computeGridSizeEstimate(
    explicitColCount,
    explicitRowCount,
    direction,
    inFlowChildren.map((c) => internals(c.node).style),
  );

  // 4. Grid Item Placement
  const items: GridItem[] = [];
  const cellOccupancyMatrix = new CellOccupancyMatrix(estColCounts, estRowCounts);
  placeGridItems(
    cellOccupancyMatrix,
    items,
    inFlowChildren,
    direction,
    style.gridAutoFlow,
    alignItems ?? ALIGN_STRETCH,
    justifyItems ?? ALIGN_STRETCH,
    ozOffsets,
  );

  // Extract track counts from the placement step (auto-placement can expand the grid)
  const finalColCounts: TrackCounts = { ...cellOccupancyMatrix.trackCounts('horizontal') };
  const finalRowCounts: TrackCounts = { ...cellOccupancyMatrix.trackCounts('vertical') };

  // Chrome (Blink) resolves placement on the full implicit grid — an item at
  // `auto / -4` in a template-less axis sits four line numbers below the origin
  // and the auto-placement cursor may roam that whole width — but only tracks
  // spanned by the explicit grid or a placed item ever *materialize*. Implicit
  // lines past those stay line numbers: they contribute no track and, crucially,
  // no gutter. Keeping them inflated the container by one gap per phantom
  // track. With zero explicit tracks the explicit grid is a lone line
  // (css-grid-1 §7.1) and floors nothing, which is why `auto / -4` alone still
  // yields a single-column grid. Interior unoccupied tracks (between a placed
  // item and the explicit grid) are kept — Chrome keeps them at 0px, gutters
  // and all. Verified against Blink @ refs/branch-heads/7922 (our pinned
  // Chrome): grid_placement.cc places on untranslated lines and the trailing
  // region simply never reaches the track builder.
  //
  // Returns the number of *leading* tracks trimmed: item oz coordinates stay
  // consistent (track index = oz + negativeImplicit, both sides shrink
  // together), but the CellOccupancyMatrix keeps its original indices, so
  // occupancy queries must shift by this amount. In RTL, placement mirrors item
  // coordinates, which lands the phantom tracks on the leading side.
  const trimUnmaterializedTracks = (counts: TrackCounts, occupiedStart: number, occupiedEnd: number): number => {
    const keepOzStart = counts.explicit > 0 ? Math.min(0, occupiedStart) : occupiedStart;
    const keepOzEnd = Math.max(counts.explicit, occupiedEnd);
    const newNegative = Math.min(counts.negativeImplicit, Math.max(0, -keepOzStart));
    const leadTrim = counts.negativeImplicit - newNegative;
    counts.negativeImplicit = newNegative;
    counts.positiveImplicit = Math.min(counts.positiveImplicit, Math.max(0, keepOzEnd - counts.explicit));
    return leadTrim;
  };
  const colLeadTrim = trimUnmaterializedTracks(
    finalColCounts,
    items.reduce((m, item) => Math.min(m, item.column.start), 0),
    items.reduce((m, item) => Math.max(m, item.column.end), 0),
  );
  const rowLeadTrim = trimUnmaterializedTracks(
    finalRowCounts,
    items.reduce((m, item) => Math.min(m, item.row.start), 0),
    items.reduce((m, item) => Math.max(m, item.row.end), 0),
  );

  // 5. Initialize Tracks
  const columns: GridTrack[] = [];
  const rows: GridTrack[] = [];
  const columnTrackCountsForInit: TrackCounts = { ...finalColCounts };
  if (direction === 'rtl' && finalColCounts.explicit <= 1) {
    columnTrackCountsForInit.negativeImplicit = finalColCounts.positiveImplicit;
    columnTrackCountsForInit.positiveImplicit = finalColCounts.negativeImplicit;
  }
  initializeGridTracks(columns, columnTrackCountsForInit, style, 'horizontal', (columnIndex) => {
    const occupancyIndex =
      direction === 'rtl' ? rtlColumnOccupancyIndexForInitialization(columnIndex, finalColCounts) : columnIndex;
    // The matrix keeps its pre-trim indices; leading trimmed tracks shift it.
    return cellOccupancyMatrix.columnIsOccupied(occupancyIndex + colLeadTrim);
  });
  initializeGridTracks(rows, finalRowCounts, style, 'vertical', (rowIndex) =>
    cellOccupancyMatrix.rowIsOccupied(rowIndex + rowLeadTrim),
  );
  if (direction === 'rtl') {
    mirrorColumnTracksAndGutters(columns, finalColCounts);
  }

  // 6. Track Sizing
  resolveItemTrackIndexes(items, finalColCounts, finalRowCounts);
  determineIfItemCrossesFlexibleOrIntrinsicTracks(items, columns, rows);

  const hasBaselineAlignedItem = items.some(itemParticipatesInBlockBaselineAlignment);

  // `min-width`/`min-height` are border-box, but the track sizer measures the
  // *inner* grid: it compares this against a sum of track base sizes and uses
  // it as a percentage basis, both content-box quantities. Passing the border
  // box added the container's insets on top of them — Chrome gives a grid with
  // `min-height: 500` and 321px of vertical border a height of 500, where this
  // stretched the auto row to 500 and then added the border for 821.
  const innerMinSize: Size<Opt> = {
    width: mSub(minSize.width, horizontalSum(contentBoxInset)),
    height: mSub(minSize.height, verticalSum(contentBoxInset)),
  };

  // Inline axis
  trackSizingAlgorithm(
    'horizontal',
    innerMinSize.width,
    maxSize.width,
    justifyContent,
    alignContent,
    availableGridSpace,
    runMode === 'compute-size' &&
      (inputs.axis === 'both' || inputs.axis === 'horizontal') &&
      typeof availableGridSpace.width !== 'number'
      ? availableGridSpace.width
      : null,
    innerNodeSize,
    columns,
    rows,
    items,
    (track, parentSizeOpt) => trackDefiniteValue(track.maxTrackSizingFunction, parentSizeOpt),
    hasBaselineAlignedItem,
    direction,
  );
  const initialColumnSum = columns.reduce((sum, track) => sum + track.baseSize, 0);
  innerNodeSize.width = innerNodeSize.width ?? initialColumnSum;

  for (const item of items) item.gridAreaSizeCache = null;

  // Block axis
  trackSizingAlgorithm(
    'vertical',
    innerMinSize.height,
    maxSize.height,
    alignContent,
    justifyContent,
    availableGridSpace,
    runMode === 'compute-size' &&
      (inputs.axis === 'both' || inputs.axis === 'vertical') &&
      typeof availableGridSpace.height !== 'number'
      ? availableGridSpace.height
      : null,
    innerNodeSize,
    rows,
    columns,
    items,
    (track) => track.baseSize,
    false, // TODO: baseline alignment in the vertical axis
    direction,
  );
  const initialRowSum = rows.reduce((sum, track) => sum + track.baseSize, 0);
  innerNodeSize.height = innerNodeSize.height ?? initialRowSum;

  // 6b. Compute container size
  // Blink passes the resolved inline size into ComputeBlockSizeForFragment,
  // which uses it for an automatic aspect-ratio block size. Keep the same
  // transfer when the size became definite through the caller rather than a
  // style declaration (css-sizing-4 §4.2). Chrome 151: an empty two-column
  // grid whose only inline extent is a 17px gutter and aspect-ratio is .5 is
  // 17x34; without derivedFromKnown here the second root pass stayed 17x0.
  const resolvedStyleSize: Size<Opt> = {
    width: knownDimensions.width ?? preferredSize.width ?? derivedFromKnown.width,
    height: knownDimensions.height ?? preferredSize.height ?? derivedFromKnown.height,
  };

  // See the matching note in block.ts: a height that came from `aspect-ratio`
  // rather than from a specified height is an *automatic* size, so the row sum
  // floors it instead of being discarded. `max-width` clamping the width and
  // the ratio then halving the height is the case WPT
  // grid-content-distribution-029 pins ("alignment must work after max-width
  // clamps the aspect ratio"): 50x100, not 50x25.
  const heightIsRatioDerived =
    aspectRatio !== null &&
    resolvedStyleSize.height !== null &&
    maybeResolveSize(style.size, parentSize).height === null &&
    style.minSize.height === 'auto' &&
    !isScrollContainer(style.overflow.y);
  const rowFloor = (rowSum: number): Opt =>
    heightIsRatioDerived ? Math.max(resolvedStyleSize.height as number, rowSum) : resolvedStyleSize.height;
  // Under border-box sizing the block-axis padding/border floor is itself a
  // used outer size, so it transfers through the preferred ratio into an
  // automatic inline size. Chrome 151 sizes an empty ratio-20 grid with 50px
  // of vertical and 320px of horizontal insets to 1000x50, while content-box
  // keeps 320x50 because its ratio relates the zero-sized content boxes.
  const ratioInlineInsetFloor =
    style.boxSizing === 'border-box' && aspectRatio !== null && maybeResolveSize(style.size, parentSize).width === null
      ? paddingBorderSize.height * aspectRatio
      : 0;
  const containerBorderBox = {
    width: Math.max(
      vClamp(
        Math.max(resolvedStyleSize.width ?? initialColumnSum + horizontalSum(contentBoxInset), ratioInlineInsetFloor),
        minSize.width,
        maxSize.width,
      ),
      paddingBorderSize.width,
    ),
    height: Math.max(
      vClamp(
        rowFloor(initialRowSum + verticalSum(contentBoxInset)) ?? initialRowSum + verticalSum(contentBoxInset),
        minSize.height,
        maxSize.height,
      ),
      paddingBorderSize.height,
    ),
  };
  const containerContentBox = {
    width: Math.max(0, containerBorderBox.width - horizontalSum(contentBoxInset)),
    height: Math.max(0, containerBorderBox.height - verticalSum(contentBoxInset)),
  };

  // 7. Resolve percentage track base sizes (indefinite container case)
  if (typeof availableGridSpace.width !== 'number') {
    for (const column of columns) {
      const min = trackResolvedPercentageSize(column.minTrackSizingFunction, containerContentBox.width);
      const max = trackResolvedPercentageSize(column.maxTrackSizingFunction, containerContentBox.width);
      column.baseSize = vClamp(column.baseSize, min, max);
    }
  }
  if (typeof availableGridSpace.height !== 'number') {
    for (const row of rows) {
      const min = trackResolvedPercentageSize(row.minTrackSizingFunction, containerContentBox.height);
      const max = trackResolvedPercentageSize(row.maxTrackSizingFunction, containerContentBox.height);
      row.baseSize = vClamp(row.baseSize, min, max);
    }
  }

  // Column sizing must re-run if the container width was indefinite with percentage
  // columns, or an intrinsic-column-crossing item's min-content width changed.
  let rerunColumnSizing: boolean;
  let intrinsicColumnContributionChanged = false;

  const hasPercentageColumn = columns.some(
    (track) => trackUsesPercentage(track.minTrackSizingFunction) || trackUsesPercentage(track.maxTrackSizingFunction),
  );
  const hasPercentageRow = rows.some(
    (track) => trackUsesPercentage(track.minTrackSizingFunction) || trackUsesPercentage(track.maxTrackSizingFunction),
  );
  const parentWidthIndefinite = typeof availableSpace.width !== 'number';
  rerunColumnSizing = parentWidthIndefinite && hasPercentageColumn;

  if (!rerunColumnSizing) {
    intrinsicColumnContributionChanged = items
      .filter((item) => item.crossesIntrinsicColumn)
      .some((item) => {
        const gridAreaSize = itemGridAreaSize(
          item,
          'horizontal',
          columns,
          rows,
          innerNodeSize,
          (track) => track.baseSize,
        );
        // CSS Sizing 3 §5.2.1 treats a cyclic percentage max/preferred size as
        // its initial value while calculating intrinsic contributions. If a
        // ratio item crosses intrinsic tracks in both axes, its first row pass
        // can nevertheless contain a block size derived from that percentage.
        // Feeding that self-derived block size back into the column rerun
        // applies the percentage twice. Chrome 151 keeps a 20px intrinsic gap
        // as the column contribution and only clamps the final item to 60% =
        // 12px; the feedback loop produced a 12px track and a 7.2px item.
        const cyclicPercentageInlineConstraint =
          gridAreaSize.width === null &&
          item.aspectRatio !== null &&
          item.crossesIntrinsicRow &&
          (typeof item.size.width === 'object' || typeof item.maxSize.width === 'object');
        const contributionGridAreaSize = cyclicPercentageInlineConstraint
          ? { ...gridAreaSize, height: null }
          : gridAreaSize;
        const availableSpaceForItem: Size<Opt> = { width: null, height: contributionGridAreaSize.height };
        const newMinContentContribution = itemMinContentContribution(
          item,
          'horizontal',
          contributionGridAreaSize,
          availableSpaceForItem,
        );

        const hasChanged = newMinContentContribution !== item.minContentContributionCache.width;

        item.gridAreaSizeCache = gridAreaSize;
        item.minContentContributionCache.width = newMinContentContribution;
        item.maxContentContributionCache.width = null;
        item.minimumContributionCache.width = null;

        return hasChanged;
      });
    rerunColumnSizing = intrinsicColumnContributionChanged;
  } else {
    // Clear intrinsic width caches
    for (const item of items) {
      item.gridAreaSizeCache = null;
      item.minContentContributionCache.width = null;
      item.maxContentContributionCache.width = null;
      item.minimumContributionCache.width = null;
    }
  }

  let intrinsicRowContributionChanged = false;

  if (rerunColumnSizing) {
    // An intrinsic dependency pass does not make an automatic inline size
    // definite. Keep flexible-track expansion in its indefinite-space branch
    // so the resulting flex fraction expands every flexible track (Grid §11.7;
    // Blink 7922 ExpandFlexibleTracks). Chrome, with two 2fr tracks and a
    // 363px contribution in one of them, makes both tracks 363px; reusing the
    // first-pass 17px inner sum left the empty flex track at zero.
    const columnRerunInnerNodeSize =
      intrinsicColumnContributionChanged && outerNodeSize.width === null
        ? { ...innerNodeSize, width: null }
        : innerNodeSize;
    // Re-run track sizing for the inline axis
    trackSizingAlgorithm(
      'horizontal',
      minSize.width,
      maxSize.width,
      justifyContent,
      alignContent,
      availableGridSpace,
      null,
      columnRerunInnerNodeSize,
      columns,
      rows,
      items,
      (track) => track.baseSize,
      hasBaselineAlignedItem,
      direction,
    );
  }

  {
    // Whether the rows need re-sizing is independent of what happened in the
    // inline axis: a percentage row could not resolve on the first pass because
    // the container height was still unknown, and that stays true whether or
    // not the columns changed. Nesting this in the column re-run left such a
    // grid with its first-pass row split — equal shares of the final height
    // rather than the percentage's actual share.
    let rerunRowSizing: boolean;
    const parentHeightIndefinite = typeof availableSpace.height !== 'number';
    // An auto block size is intrinsic on the first row pass, but becomes a
    // definite used size before items are laid out. Flexible rows depend on
    // that transition: Grid §11.7 switches from its indefinite flex fraction
    // to `find-fr` against the resolved available space. Blink 7922's
    // NeedsAdditionalLayoutPass tests the row collection's dependency on the
    // available size for exactly this case. With `minmax(auto, .5fr)` around a
    // 55px max-content item whose automatic minimum is zero, Chrome's first
    // pass makes the grid 28px tall and its final pass makes the row 14px;
    // retaining the intrinsic-pass track instead stretched the item to 28px.
    const flexibleRowsNeedDefinitePass = typeof availableGridSpace.height !== 'number' && rows.some(trackIsFlexible);
    rerunRowSizing = (parentHeightIndefinite && hasPercentageRow) || flexibleRowsNeedDefinitePass;

    if (!rerunRowSizing && !intrinsicColumnContributionChanged) {
      // Blink 7922 does not start a second row dependency pass merely because
      // its additional column pass changed an item's inline contribution.
      // CompleteTrackSizingAlgorithm records the item row span after the
      // first row pass and repeats both axes only when finalizing that row
      // geometry changes the span. Chrome therefore keeps the first-pass row
      // for cyclic percentage padding: with 320px inline padding and ratio 3,
      // padding-bottom from 0%..100% produces row heights 108, 108, 108, 167,
      // 247, 327 while the finally wider item is allowed to overflow it.
      intrinsicRowContributionChanged = items
        .filter((item) => item.crossesIntrinsicColumn)
        .some((item) => {
          const gridAreaSize = itemGridAreaSize(
            item,
            'vertical',
            rows,
            columns,
            innerNodeSize,
            (track) => track.baseSize,
          );
          const availableSpaceForItem: Size<Opt> = { width: gridAreaSize.width, height: null };
          const newMinContentContribution = itemMinContentContribution(
            item,
            'vertical',
            gridAreaSize,
            availableSpaceForItem,
          );

          const hasChanged = newMinContentContribution !== item.minContentContributionCache.height;

          item.gridAreaSizeCache = gridAreaSize;
          item.minContentContributionCache.height = newMinContentContribution;
          item.maxContentContributionCache.height = null;
          item.minimumContributionCache.height = null;

          return hasChanged;
        });
      rerunRowSizing = intrinsicRowContributionChanged;
    } else {
      for (const item of items) {
        // Clear intrinsic height caches
        item.gridAreaSizeCache = null;
        item.minContentContributionCache.height = null;
        item.maxContentContributionCache.height = null;
        item.minimumContributionCache.height = null;
      }
    }

    if (rerunRowSizing) {
      trackSizingAlgorithm(
        'vertical',
        minSize.height,
        maxSize.height,
        alignContent,
        justifyContent,
        availableGridSpace,
        null,
        innerNodeSize,
        rows,
        columns,
        items,
        (track) => track.baseSize,
        false,
        direction,
      );
    }
  }

  if (
    (intrinsicColumnContributionChanged && !hasPercentageColumn) ||
    (intrinsicRowContributionChanged && !hasPercentageRow)
  ) {
    const finalColumnSum = columns.reduce((sum, track) => sum + track.baseSize, 0);
    const finalRowSum = rows.reduce((sum, track) => sum + track.baseSize, 0);

    if (intrinsicColumnContributionChanged && !hasPercentageColumn) {
      containerBorderBox.width = Math.max(
        vClamp(
          resolvedStyleSize.width ?? finalColumnSum + horizontalSum(contentBoxInset),
          minSize.width,
          maxSize.width,
        ),
        paddingBorderSize.width,
      );
      containerContentBox.width = Math.max(0, containerBorderBox.width - horizontalSum(contentBoxInset));
    }

    if (intrinsicRowContributionChanged && !hasPercentageRow) {
      containerBorderBox.height = Math.max(
        vClamp(
          rowFloor(finalRowSum + verticalSum(contentBoxInset)) ?? finalRowSum + verticalSum(contentBoxInset),
          minSize.height,
          maxSize.height,
        ),
        paddingBorderSize.height,
      );
      containerContentBox.height = Math.max(0, containerBorderBox.height - verticalSum(contentBoxInset));
    }
  }

  // Blink's intrinsic grid sizing completes block-axis tracks and, when an
  // aspect-ratio item's inline contribution depends on their used size,
  // performs the additional column pass before returning min/max sizes.
  // The dependency reruns above are therefore part of `compute-size`, while
  // alignment and item layout below are not.
  if (runMode === 'compute-size') {
    return fromOuterSize(containerBorderBox);
  }

  // 8. Track Alignment
  const inlineSizeWithoutScrollbar = Math.max(containerBorderBox.width - paddingBorderSize.width, 0);
  const inlineScrollbarGutterForAlignment = Math.min(scrollbarGutter.x, inlineSizeWithoutScrollbar);
  alignTracks(
    containerContentBox.width,
    {
      start: padding.left + (direction === 'rtl' ? inlineScrollbarGutterForAlignment : 0),
      end: padding.right + (direction === 'rtl' ? 0 : inlineScrollbarGutterForAlignment),
    },
    { start: border.left, end: border.right },
    columns,
    justifyContent,
    direction === 'rtl',
  );
  alignTracks(
    containerContentBox.height,
    { start: padding.top, end: padding.bottom },
    { start: border.top, end: border.bottom },
    rows,
    alignContent,
    false,
  );

  // Grid placement is flow-relative while the offset properties are physical
  // (css-grid-1 §9.1), so absolute placement resolves against a flow-ordered
  // offset table and converts to a physical rect exactly once, in
  // resolveAbsColumnEdges.
  //
  // In LTR the physical offsets already are the flow-ordered ones. In RTL the
  // track vector was reversed in place before sizing, so walk it back to
  // recover flow order and re-accumulate. The line->slot arithmetic is then
  // the plain `2*(line + negativeImplicit)` in-flow items use, with no
  // direction term anywhere.
  const columnLogicalOffsets: number[] = new Array(columns.length);
  // Content-box edges. The first track slot's offset is the flow's physical
  // start edge; the far edge comes from the container box rather than the last
  // slot, which coincides with the first when the axis has no tracks.
  const columnContentLeft = columns[0]?.offset ?? border.left;
  const columnContentRight = Math.max(
    columnContentLeft,
    containerBorderBox.width - border.right - padding.right - scrollbarGutter.x,
  );
  if (direction === 'rtl') {
    if (columns.length === 1) {
      // Blink content-aligns the sole line of an empty grid. In RTL that line
      // is already a physical offset: `center` in a 20px container is 10px,
      // while logical `end` is the physical left edge at 0. Re-accumulating
      // from the right edge would erase that zero-track alignment.
      columnLogicalOffsets[0] = (columns[0] ?? unreachable()).offset;
    } else {
      // Walk the tracks in flow order (right to left) and accumulate from the
      // flow's own start edge, so slot 0 lands on the right content edge where
      // line 1 sits. Reversing the *whole* sequence -- not just the explicit
      // range that reverseNonGutterTracks touches -- is what keeps this table in
      // the same frame as `absColCounts` below: mirroring the implicit counts
      // moves an implicit track from one end of the line numbering to the other,
      // so the offsets it indexes have to move with it.
      let running = columnContentRight;
      for (let i = 0; i < columns.length; i++) {
        columnLogicalOffsets[i] = running;
        const physicalIndex = columns.length - 1 - i;
        const track = columns[physicalIndex] ?? unreachable();
        // Distributed track alignment effectively thickens the gutter at the
        // next track's offset. Its raw base size therefore cannot rebuild the
        // RTL flow table (`gap: 5px; space-between` can make this 60px).
        const effectiveSize =
          physicalIndex % 2 === 0 && physicalIndex + 1 < columns.length
            ? (columns[physicalIndex + 1] ?? unreachable()).offset - track.offset
            : track.baseSize;
        running -= effectiveSize;
      }
    }
  } else {
    for (let i = 0; i < columns.length; i++) columnLogicalOffsets[i] = (columns[i] ?? unreachable()).offset;
  }
  // Placement mirrors the implicit track counts under RTL (an implicit track
  // added past the flow's end edge lands on the physical left), so the counts
  // the line numbers are expressed in are the mirrored ones.
  //
  // The exception is an axis with no explicit grid whose implicit tracks are
  // all on the positive side: there is no explicit range for negative lines to
  // count back from, so positive line numbers address those tracks directly
  // from the flow's start and mirroring would shift every line one track past
  // the grid. An all-*negative*-implicit axis (WPT
  // `positioned-grid-items-negative-indices-003`) still needs the mirror.
  const mirrorImplicitCounts =
    direction === 'rtl' && !(finalColCounts.explicit === 0 && finalColCounts.negativeImplicit === 0);
  const absColCounts: TrackCounts = mirrorImplicitCounts
    ? {
        negativeImplicit: finalColCounts.positiveImplicit,
        explicit: finalColCounts.explicit,
        positiveImplicit: finalColCounts.negativeImplicit,
      }
    : finalColCounts;

  // 9. Size, Align, and Position Grid Items
  let itemContentSizeContribution = { width: 0, height: 0 };

  // Sort items back into source order
  items.sort((a, b) => a.sourceOrder - b.sourceOrder);

  const containerAlignmentStyles = { horizontal: justifyItems, vertical: alignItems };

  // Position in-flow children
  for (let index = 0; index < items.length; index++) {
    const item = items[index] ?? unreachable();
    const gridArea: Rect<number> = {
      top: (rows[item.rowIndexes.start + 1] ?? unreachable()).offset,
      bottom: (rows[item.rowIndexes.end] ?? unreachable()).offset,
      left: (columns[item.columnIndexes.start + 1] ?? unreachable()).offset,
      right: (columns[item.columnIndexes.end] ?? unreachable()).offset,
    };
    const [contribution, yPosition, height] = alignAndPositionItem(
      item.node,
      index,
      gridArea,
      containerAlignmentStyles,
      item.baselineShim,
      direction,
    );
    item.yPosition = yPosition;
    item.height = height;

    itemContentSizeContribution = {
      width: Math.max(itemContentSizeContribution.width, contribution.width),
      height: Math.max(itemContentSizeContribution.height, contribution.height),
    };
  }

  // Position hidden and absolutely positioned children
  let order = items.length;
  for (let index = 0; index < nd.children.length; index++) {
    const child = nd.children[index] ?? unreachable();
    const childNd = internals(child);
    const childStyle = childNd.style;

    // Hidden children
    if (childStyle.display === 'none') {
      childNd.unroundedLayout = layoutWithOrder(order);
      performChildLayout(
        child,
        { width: null, height: null },
        { width: null, height: null },
        { width: 'max-content', height: 'max-content' },
        'inherent-size',
      );
      order += 1;
      continue;
    }

    // Absolutely positioned children
    if (childStyle.position === 'absolute') {
      // Convert grid-col placements into (optional) indexes into the columns vector
      // Apply the same coalescing offset the in-flow placement used, so
      // absolute children resolve against the shifted grid lines.
      const colPlacementOz = ozLineTranslateAbs(
        placementLineIntoOriginZero(childStyle.gridColumn, finalColCounts.explicit),
        ozOffsets.col,
      );
      const colTracks = ozResolveAbsolutelyPositionedGridTracks(colPlacementOz);
      // Resolve both ends against the flow-ordered offset table built above, so
      // the arithmetic is the same in either direction and the width comes out
      // direction-independent by construction. `null` means the end is open: a
      // line outside the grid "is instead treated as specifying auto"
      // (css-grid-1 §9.1), which resolveAbsColumnEdges turns into the container
      // edge the flow leaves open.
      const logicalColOffset = (line: Opt, isStart: boolean): Opt => {
        if (line === null) return null;
        const slot = tryIntoTrackVecIndex(line, absColCounts);
        if (slot === null) return null;
        // Gutters make grid lines thick (css-grid-1 §10.1): a start edge uses
        // the far side of the line's gutter, while an end edge uses its near
        // side. Blink expresses the same split as TrackStartOffset versus
        // TrackEndOffset. The last line has no following gutter/track slot.
        const edgeSlot = isStart && slot + 1 < columnLogicalOffsets.length ? slot + 1 : slot;
        return columnLogicalOffsets[edgeSlot] ?? unreachable();
      };
      const logicalColStart = logicalColOffset(colTracks.start, true);
      const logicalColEnd = logicalColOffset(colTracks.end, false);

      const rowPlacementOz = ozLineTranslateAbs(
        placementLineIntoOriginZero(childStyle.gridRow, finalRowCounts.explicit),
        ozOffsets.row,
      );
      const rowTracks = ozResolveAbsolutelyPositionedGridTracks(rowPlacementOz);
      const maybeRowIndexes = {
        start: rowTracks.start !== null ? tryIntoTrackVecIndex(rowTracks.start, finalRowCounts) : null,
        end: rowTracks.end !== null ? tryIntoTrackVecIndex(rowTracks.end, finalRowCounts) : null,
      };

      const gridArea: Rect<number> = {
        top:
          maybeRowIndexes.start !== null
            ? (rows[maybeRowIndexes.start + 1] ?? rows[maybeRowIndexes.start] ?? unreachable()).offset
            : border.top,
        bottom:
          maybeRowIndexes.end !== null
            ? (rows[maybeRowIndexes.end] ?? unreachable()).offset
            : containerBorderBox.height - border.bottom - scrollbarGutter.y,
        ...resolveAbsColumnEdges(
          logicalColStart,
          logicalColEnd,
          direction,
          border,
          scrollbarGutter,
          containerBorderBox,
        ),
      };

      const [contribution] = alignAndPositionItem(child, order, gridArea, containerAlignmentStyles, 0, direction);
      itemContentSizeContribution = {
        width: Math.max(itemContentSizeContribution.width, contribution.width),
        height: Math.max(itemContentSizeContribution.height, contribution.height),
      };

      order += 1;
    }
  }

  // If there are no items then return just the container size (no baseline)
  if (items.length === 0) {
    return fromOuterSize(containerBorderBox);
  }

  // Determine the grid container baseline (first baseline only)
  items.sort((a, b) => a.rowIndexes.start - b.rowIndexes.start);
  const firstRow = (items[0] ?? unreachable()).rowIndexes.start;
  const firstRowItems = items.filter((item) => item.rowIndexes.start === firstRow);
  const baselineItem =
    firstRowItems.find(itemParticipatesInBlockBaselineAlignment) ?? firstRowItems[0] ?? unreachable();
  const gridContainerBaseline = baselineItem.yPosition + (baselineItem.baseline ?? baselineItem.height);

  return fromSizesAndBaselines(containerBorderBox, itemContentSizeContribution, {
    x: null,
    y: gridContainerBaseline,
  });
}

/**
 * Converts a resolved column placement into physical left/right.
 *
 * `null` on an end means that end is open and reaches the container edge on the
 * side the *flow* leaves open -- a different physical side per direction, which
 * is why the fallback is chosen here rather than baked into the offsets. The
 * offsets themselves already run in flow order, so this only orders the pair;
 * the width is direction-independent by construction.
 */
function resolveAbsColumnEdges(
  logicalStart: Opt,
  logicalEnd: Opt,
  direction: Direction,
  border: Rect<number>,
  scrollbarGutter: { x: number; y: number },
  containerBorderBox: Size<number>,
): { left: number; right: number } {
  // An `auto` (or out-of-grid) line contributes a line at the container's own
  // edge on that side (css-grid-1 §9.1).
  const openLeft = border.left;
  const openRight = containerBorderBox.width - border.right - scrollbarGutter.x;
  if (direction !== 'rtl') {
    const left = logicalStart ?? openLeft;
    // Blink builds this rectangle from the padding box with
    // LogicalRect::ShiftInlineEndEdgeTo, which clamps an end line before the
    // start edge to a zero-width area at that start edge. This matters when
    // content alignment shifts tracks beyond the container: percentage
    // margins must resolve against 0, never a negative containing-block size.
    return { left, right: Math.max(logicalEnd ?? openRight, left) };
  }
  // RTL: the offsets are already physical (the table runs right-to-left from
  // the flow's start edge), so the pair only needs ordering. An open end still
  // reaches the container edge on the side the flow leaves open, which is the
  // opposite physical side from LTR.
  const near = logicalStart ?? openRight;
  const far = logicalEnd ?? openLeft;
  // The flow runs leftward, so the end lies at or before the start. An *open*
  // end extends only as far as the container edge actually reaches in that
  // direction — it never doubles back past the explicit line. WPT
  // positioned-grid-items-025 places `grid-column-start: -1` at x=-80 (the
  // tracks overflow a 150px container padded 50/80); the left padding edge sits
  // at 0, to the *right* of the start, so Chrome gives that item width 0 rather
  // than the 80 that ordering the pair would produce.
  const left = logicalEnd ?? Math.min(near, openLeft);
  const right = logicalStart ?? Math.max(far, openRight);
  return { left: Math.min(left, right), right: Math.max(left, right) };
}

/** Mirrors column tracks and their adjoining gutters into physical RTL order. */
function mirrorColumnTracksAndGutters(tracks: GridTrack[], trackCounts: TrackCounts): void {
  const totalTracks = trackCounts.negativeImplicit + trackCounts.explicit + trackCounts.positiveImplicit;
  void totalTracks;
  if (trackCounts.explicit <= 1) {
    const MIN_TRACK_VEC_LEN_TO_REVERSE_COLUMNS = 5;
    if (tracks.length < MIN_TRACK_VEC_LEN_TO_REVERSE_COLUMNS) return;
    let left = 1;
    let right = tracks.length - 2;
    while (left < right) {
      const tmp = tracks[left] ?? unreachable();
      tracks[left] = tracks[right] ?? unreachable();
      tracks[right] = tmp;
      left += 2;
      right = Math.max(right - 2, 0);
    }
    return;
  }

  const explicitTrackCount = trackCounts.explicit;
  if (explicitTrackCount < 2) return;

  let leftTrack = trackCounts.negativeImplicit;
  let rightTrack = leftTrack + explicitTrackCount - 1;
  while (leftTrack < rightTrack) {
    const leftIndex = 2 * leftTrack + 1;
    const rightIndex = 2 * rightTrack + 1;
    const tmp = tracks[leftIndex] ?? unreachable();
    tracks[leftIndex] = tracks[rightIndex] ?? unreachable();
    tracks[rightIndex] = tmp;
    leftTrack += 1;
    rightTrack = Math.max(rightTrack - 1, 0);
  }

  // css-grid-1 §7.2.3.2 collapses the gutters on either side of an empty
  // auto-fit track. Those collapsed internal gutters are part of the mirrored
  // track geometry: Chrome 151 moves a 7px gutter along with two occupied
  // tracks in an RTL auto-fit grid. Reversing only the track objects leaves
  // the live gutter beside the now-empty tracks and makes a spanning grid area
  // 7px too narrow. Do not include the boundary gutters: they may border
  // implicit tracks, so their physical side does not change with the explicit
  // track list.
  let leftGutter = 2 * trackCounts.negativeImplicit + 2;
  let rightGutter = 2 * (trackCounts.negativeImplicit + explicitTrackCount - 1);
  while (leftGutter < rightGutter) {
    const tmp = tracks[leftGutter] ?? unreachable();
    tracks[leftGutter] = tracks[rightGutter] ?? unreachable();
    tracks[rightGutter] = tmp;
    leftGutter += 2;
    rightGutter = Math.max(rightGutter - 2, 0);
  }
}

/** Maps initialized column indexes to occupancy-matrix indexes for auto-fit collapsing in RTL. */
function rtlColumnOccupancyIndexForInitialization(columnIndex: number, trackCounts: TrackCounts): number {
  const total = trackCounts.negativeImplicit + trackCounts.explicit + trackCounts.positiveImplicit;
  if (trackCounts.explicit <= 1) {
    return total - columnIndex - 1;
  }

  const explicitStart = trackCounts.negativeImplicit;
  const explicitEnd = explicitStart + trackCounts.explicit;
  if (columnIndex >= explicitStart && columnIndex < explicitEnd) {
    return explicitStart + (explicitEnd - columnIndex - 1);
  }
  return columnIndex;
}

/** OriginZeroLine::try_into_track_vec_index */
function tryIntoTrackVecIndex(ozLine: number, trackCounts: TrackCounts): Opt {
  if (ozLine < -trackCounts.negativeImplicit) return null;
  if (ozLine > trackCounts.explicit + trackCounts.positiveImplicit) return null;
  return 2 * (ozLine + trackCounts.negativeImplicit);
}

// --- local helpers

function maybeAddSize(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: s.width !== null ? s.width + rhs.width : null,
    height: s.height !== null ? s.height + rhs.height : null,
  };
}

function horizontalSum(r: Rect<number>): number {
  return r.left + r.right;
}

function verticalSum(r: Rect<number>): number {
  return r.top + r.bottom;
}

function mapDefinite(avs: AvailableSpace, f: (v: number) => number): AvailableSpace {
  return typeof avs === 'number' ? f(avs) : avs;
}

function vMaxAs(avs: AvailableSpace, rhs: number): AvailableSpace {
  return typeof avs === 'number' ? Math.max(avs, rhs) : avs;
}

function vMaxOpt(v: Opt, rhs: number): Opt {
  return v !== null ? Math.max(v, rhs) : null;
}
