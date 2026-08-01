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
  asMaybeClamp,
  isScrollContainer,
  maybeResolveSize,
  resolveRectOrZero,
  trackDefiniteValue,
  trackResolvedPercentageSize,
  trackUsesPercentage,
} from '../../style.js';
import type { LayoutInput, LayoutNode, LayoutOutput } from '../../tree.js';
import { fromOuterSize, fromSizesAndBaselines, internals, layoutWithOrder } from '../../tree.js';
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
  ozResolveAbsolutelyPositionedGridTracks,
  placementLineIntoOriginZero,
} from './types.js';

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
      asMaybeClamp(knownDimensions.width ?? preferredSize.width ?? availableSpace.width, minSize.width, maxSize.width),
      paddingBorderSize.width,
    ),
    height: vMaxAs(
      asMaybeClamp(
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

  const outerNodeSize: Size<Opt> = {
    width: vMaxOpt(
      mClamp(knownDimensions.width ?? preferredSize.width, minSize.width, maxSize.width),
      paddingBorderSize.width,
    ),
    height: vMaxOpt(
      mClamp(knownDimensions.height ?? preferredSize.height, minSize.height, maxSize.height),
      paddingBorderSize.height,
    ),
  };
  const innerNodeSize: Size<Opt> = {
    width: outerNodeSize.width !== null ? outerNodeSize.width - horizontalSum(contentBoxInset) : null,
    height: outerNodeSize.height !== null ? outerNodeSize.height - verticalSum(contentBoxInset) : null,
  };

  // Short-circuit if computing size and size fully determined
  if (runMode === 'compute-size') {
    if (outerNodeSize.width !== null && outerNodeSize.height !== null) {
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
    return cellOccupancyMatrix.columnIsOccupied(occupancyIndex);
  });
  initializeGridTracks(rows, finalRowCounts, style, 'vertical', (rowIndex) =>
    cellOccupancyMatrix.rowIsOccupied(rowIndex),
  );
  if (direction === 'rtl') {
    reverseNonGutterTracks(columns, finalColCounts);
  }

  // 6. Track Sizing
  resolveItemTrackIndexes(items, finalColCounts, finalRowCounts);
  determineIfItemCrossesFlexibleOrIntrinsicTracks(items, columns, rows);

  const hasBaselineAlignedItem = items.some((item) => item.alignSelf.keyword === 'baseline' && !item.alignSelf.safe);

  // Inline axis
  trackSizingAlgorithm(
    'horizontal',
    minSize.width,
    maxSize.width,
    justifyContent,
    alignContent,
    availableGridSpace,
    innerNodeSize,
    columns,
    rows,
    items,
    (track, parentSizeOpt) => trackDefiniteValue(track.maxTrackSizingFunction, parentSizeOpt),
    hasBaselineAlignedItem,
  );
  const initialColumnSum = columns.reduce((sum, track) => sum + track.baseSize, 0);
  innerNodeSize.width = innerNodeSize.width ?? initialColumnSum;

  for (const item of items) item.gridAreaSizeCache = null;

  // Block axis
  trackSizingAlgorithm(
    'vertical',
    minSize.height,
    maxSize.height,
    alignContent,
    justifyContent,
    availableGridSpace,
    innerNodeSize,
    rows,
    columns,
    items,
    (track) => track.baseSize,
    false, // TODO: baseline alignment in the vertical axis
  );
  const initialRowSum = rows.reduce((sum, track) => sum + track.baseSize, 0);
  innerNodeSize.height = innerNodeSize.height ?? initialRowSum;

  // 6b. Compute container size
  const resolvedStyleSize: Size<Opt> = {
    width: knownDimensions.width ?? preferredSize.width,
    height: knownDimensions.height ?? preferredSize.height,
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
    !isScrollContainer(style.overflow.y);
  const rowFloor = (rowSum: number): Opt =>
    heightIsRatioDerived ? Math.max(resolvedStyleSize.height as number, rowSum) : resolvedStyleSize.height;
  const containerBorderBox = {
    width: Math.max(
      vClamp(
        resolvedStyleSize.width ?? initialColumnSum + horizontalSum(contentBoxInset),
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

  // If only the container's size has been requested
  if (runMode === 'compute-size') {
    return fromOuterSize(containerBorderBox);
  }

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
        const availableSpaceForItem: Size<Opt> = { width: null, height: gridAreaSize.height };
        const newMinContentContribution = itemMinContentContribution(
          item,
          'horizontal',
          gridAreaSize,
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
    // Re-run track sizing for the inline axis
    trackSizingAlgorithm(
      'horizontal',
      minSize.width,
      maxSize.width,
      justifyContent,
      alignContent,
      availableGridSpace,
      innerNodeSize,
      columns,
      rows,
      items,
      (track) => track.baseSize,
      hasBaselineAlignedItem,
    );

    let rerunRowSizing: boolean;
    const parentHeightIndefinite = typeof availableSpace.height !== 'number';
    rerunRowSizing = parentHeightIndefinite && hasPercentageRow;

    if (!rerunRowSizing) {
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
        innerNodeSize,
        rows,
        columns,
        items,
        (track) => track.baseSize,
        false,
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
      running -= (columns[columns.length - 1 - i] ?? unreachable()).baseSize;
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
      const logicalColOffset = (line: Opt): Opt => {
        if (line === null) return null;
        const slot = tryIntoTrackVecIndex(line, absColCounts);
        return slot !== null ? (columnLogicalOffsets[slot] ?? unreachable()) : null;
      };
      const logicalColStart = logicalColOffset(colTracks.start);
      const logicalColEnd = logicalColOffset(colTracks.end);

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
        top: maybeRowIndexes.start !== null ? (rows[maybeRowIndexes.start] ?? unreachable()).offset : border.top,
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
    firstRowItems.find((item) => item.alignSelf.keyword === 'baseline' && !item.alignSelf.safe) ??
    firstRowItems[0] ??
    unreachable();
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
    return { left: logicalStart ?? openLeft, right: logicalEnd ?? openRight };
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

/** Reverses only non-gutter column tracks in-place while preserving line/gutter slots. */
function reverseNonGutterTracks(tracks: GridTrack[], trackCounts: TrackCounts): void {
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

  let left = trackCounts.negativeImplicit;
  let right = left + explicitTrackCount - 1;
  while (left < right) {
    const li = 2 * left + 1;
    const ri = 2 * right + 1;
    const tmp = tracks[li] ?? unreachable();
    tracks[li] = tracks[ri] ?? unreachable();
    tracks[ri] = tmp;
    left += 1;
    right = Math.max(right - 1, 0);
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
