// The grid item placement algorithm.
// https://www.w3.org/TR/css-grid-1/#placement

import type { AbsoluteAxis } from '../../geometry.js';
import type { AlignItems, Direction, GridAutoFlow, Style } from '../../style.js';
import { gridAutoFlowIsDense, gridAutoFlowPrimaryAxis } from '../../style.js';
import type { LayoutNode } from '../../tree.js';
import { internals } from '../../tree.js';
import type { OzOffsets } from './implicit.js';
import type { CellOccupancyState, GridItem, LineOf, OzGridPlacement } from './types.js';
import {
  absOther,
  type CellOccupancyMatrix,
  implicitEndLine,
  implicitStartLine,
  newGridItem,
  ozIndefiniteSpan,
  ozPlacementIsDefinite,
  ozResolveDefiniteGridLines,
  placementLineIntoOriginZero,
} from './types.js';

/** Translate line placements by an axis coalescing offset (see implicit.ts). */
function ozLineTranslate(line: LineOf<OzGridPlacement>, offset: number): LineOf<OzGridPlacement> {
  if (offset === 0) return line;
  const shift = (p: OzGridPlacement): OzGridPlacement =>
    typeof p === 'object' && p !== null && 'line' in p ? { line: p.line + offset } : p;
  return { start: shift(line.start), end: shift(line.end) };
}

/** Returns whether placement/search should run in reverse for this axis. */
function axisIsReversed(direction: Direction, axis: AbsoluteAxis): boolean {
  return direction === 'rtl' && axis === 'horizontal';
}

/** Advances the cursor by one track in the active search direction. */
function advancePosition(position: number, reversed: boolean): number {
  return reversed ? position - 1 : position + 1;
}

/** Returns the initial search line for sparse/dense placement in the given axis direction. */
function searchStartLine(gridStartLine: number, gridEndLine: number, reversed: boolean): number {
  return reversed ? gridEndLine - 1 : gridStartLine;
}

/** Resolves an indefinite span at `position`, respecting the active axis direction. */
function resolveIndefiniteGridSpan(position: number, span: number, reversed: boolean): LineOf<number> {
  return reversed ? { start: position - span + 1, end: position + 1 } : { start: position, end: position + span };
}

/** Mirrors a horizontal span around the explicit grid width. */
function mirrorHorizontalSpan(span: LineOf<number>, explicitColCount: number): LineOf<number> {
  return { start: explicitColCount - span.end, end: explicitColCount - span.start };
}

/** Mirrors horizontal spans for RTL while leaving all other spans unchanged. */
function maybeMirrorSpan(
  span: LineOf<number>,
  axis: AbsoluteAxis,
  direction: Direction,
  explicitColCount: number,
): LineOf<number> {
  return axis === 'horizontal' && direction === 'rtl' ? mirrorHorizontalSpan(span, explicitColCount) : span;
}

interface PlacedChild {
  index: number;
  node: LayoutNode;
  style: Style;
  placement: { horizontal: LineOf<OzGridPlacement>; vertical: LineOf<OzGridPlacement> };
}

function placementGet(p: PlacedChild['placement'], axis: AbsoluteAxis): LineOf<OzGridPlacement> {
  return axis === 'horizontal' ? p.horizontal : p.vertical;
}

/**
 * 8.5. Grid Item Placement Algorithm — place items into the grid, generating
 * new rows/columns in the implicit grid as required.
 */
export function placeGridItems(
  cellOccupancyMatrix: CellOccupancyMatrix,
  items: GridItem[],
  children: { index: number; node: LayoutNode }[],
  direction: Direction,
  gridAutoFlow: GridAutoFlow,
  alignItems: AlignItems,
  justifyItems: AlignItems,
  ozOffsets: OzOffsets = { col: 0, row: 0 },
): void {
  const primaryAxis = gridAutoFlowPrimaryAxis(gridAutoFlow);
  const secondaryAxis = absOther(primaryAxis);
  const explicitColCount = cellOccupancyMatrix.trackCounts('horizontal').explicit;
  const explicitRowCount = cellOccupancyMatrix.trackCounts('vertical').explicit;

  const mapped: PlacedChild[] = children.map(({ index, node }) => {
    const style = internals(node).style;
    return {
      index,
      node,
      style,
      placement: {
        horizontal: ozLineTranslate(placementLineIntoOriginZero(style.gridColumn, explicitColCount), ozOffsets.col),
        vertical: ozLineTranslate(placementLineIntoOriginZero(style.gridRow, explicitRowCount), ozOffsets.row),
      },
    };
  });

  // 1. Place children with definite positions
  for (const child of mapped) {
    if (!(ozPlacementIsDefinite(child.placement.horizontal) && ozPlacementIsDefinite(child.placement.vertical))) {
      continue;
    }
    const [rowSpan, colSpan] = placeDefiniteGridItem(child.placement, primaryAxis, direction, explicitColCount);
    recordGridPlacement(
      cellOccupancyMatrix,
      items,
      child,
      alignItems,
      justifyItems,
      primaryAxis,
      rowSpan,
      colSpan,
      'definitely-placed',
    );
  }

  // 2. Place remaining children with definite secondary axis positions
  for (const child of mapped) {
    if (
      !(
        ozPlacementIsDefinite(placementGet(child.placement, secondaryAxis)) &&
        !ozPlacementIsDefinite(placementGet(child.placement, primaryAxis))
      )
    ) {
      continue;
    }
    const [primarySpan, secondarySpan] = placeDefiniteSecondaryAxisItem(
      cellOccupancyMatrix,
      child.placement,
      gridAutoFlow,
      direction,
      explicitColCount,
    );

    recordGridPlacement(
      cellOccupancyMatrix,
      items,
      child,
      alignItems,
      justifyItems,
      primaryAxis,
      primarySpan,
      secondarySpan,
      'auto-placed',
    );
  }

  // 3. Determine the number of columns in the implicit grid — already accounted
  // for by the grid size estimate and by expanding the occupancy matrix to fit.

  // 4. Position the remaining grid items
  const primaryAxisGridStartLine = implicitStartLine(cellOccupancyMatrix.trackCounts(primaryAxis));
  const primaryAxisGridEndLine = implicitEndLine(cellOccupancyMatrix.trackCounts(primaryAxis));
  const secondaryAxisGridStartLine = implicitStartLine(cellOccupancyMatrix.trackCounts(secondaryAxis));
  const secondaryAxisGridEndLine = implicitEndLine(cellOccupancyMatrix.trackCounts(secondaryAxis));
  const primaryAxisIsReversed = axisIsReversed(direction, primaryAxis);
  const gridStartPosition: [number, number] = [
    searchStartLine(primaryAxisGridStartLine, primaryAxisGridEndLine, primaryAxisIsReversed),
    searchStartLine(secondaryAxisGridStartLine, secondaryAxisGridEndLine, axisIsReversed(direction, secondaryAxis)),
  ];
  let gridPosition: [number, number] = gridStartPosition;

  for (const child of mapped) {
    if (ozPlacementIsDefinite(placementGet(child.placement, secondaryAxis))) continue;

    // Compute placement
    const [primarySpan, secondarySpan] = placeIndefinitelyPositionedItem(
      cellOccupancyMatrix,
      child.placement,
      gridAutoFlow,
      gridPosition,
      direction,
      explicitColCount,
    );

    // Record item
    recordGridPlacement(
      cellOccupancyMatrix,
      items,
      child,
      alignItems,
      justifyItems,
      primaryAxis,
      primarySpan,
      secondarySpan,
      'auto-placed',
    );

    // If using "dense" placement, reset the search position for the next item;
    // otherwise place the next item after the current one.
    if (gridAutoFlowIsDense(gridAutoFlow)) {
      gridPosition = gridStartPosition;
    } else if (primaryAxisIsReversed) {
      gridPosition = [primarySpan.start, secondarySpan.start];
    } else {
      gridPosition = [primarySpan.end, secondarySpan.start];
    }
  }
}

/** Place a single definitely-placed item into the grid. Returns [primarySpan, secondarySpan]. */
function placeDefiniteGridItem(
  placement: PlacedChild['placement'],
  primaryAxis: AbsoluteAxis,
  direction: Direction,
  explicitColCount: number,
): [LineOf<number>, LineOf<number>] {
  const primarySpan = maybeMirrorSpan(
    ozResolveDefiniteGridLines(placementGet(placement, primaryAxis)),
    primaryAxis,
    direction,
    explicitColCount,
  );
  const secondarySpan = maybeMirrorSpan(
    ozResolveDefiniteGridLines(placementGet(placement, absOther(primaryAxis))),
    absOther(primaryAxis),
    direction,
    explicitColCount,
  );
  return [primarySpan, secondarySpan];
}

/** Step 2. Place remaining children with definite secondary axis positions. */
function placeDefiniteSecondaryAxisItem(
  cellOccupancyMatrix: CellOccupancyMatrix,
  placement: PlacedChild['placement'],
  autoFlow: GridAutoFlow,
  direction: Direction,
  explicitColCount: number,
): [LineOf<number>, LineOf<number>] {
  const primaryAxis = gridAutoFlowPrimaryAxis(autoFlow);
  const secondaryAxis = absOther(primaryAxis);
  const primaryAxisIsReversed = axisIsReversed(direction, primaryAxis);
  const primaryAxisGridStartLine = implicitStartLine(cellOccupancyMatrix.trackCounts(primaryAxis));
  const primaryAxisGridEndLine = implicitEndLine(cellOccupancyMatrix.trackCounts(primaryAxis));

  const secondaryAxisPlacement = maybeMirrorSpan(
    ozResolveDefiniteGridLines(placementGet(placement, secondaryAxis)),
    secondaryAxis,
    direction,
    explicitColCount,
  );

  let startingPosition: number;
  if (gridAutoFlowIsDense(autoFlow)) {
    startingPosition = searchStartLine(primaryAxisGridStartLine, primaryAxisGridEndLine, primaryAxisIsReversed);
  } else {
    const lookupResult = primaryAxisIsReversed
      ? cellOccupancyMatrix.firstOfType(primaryAxis, secondaryAxisPlacement.start, 'auto-placed')
      : cellOccupancyMatrix.lastOfType(primaryAxis, secondaryAxisPlacement.start, 'auto-placed');
    startingPosition =
      lookupResult ?? searchStartLine(primaryAxisGridStartLine, primaryAxisGridEndLine, primaryAxisIsReversed);
  }

  const primaryAxisSpan = ozIndefiniteSpan(placementGet(placement, primaryAxis));

  let position = startingPosition;
  for (;;) {
    const primaryAxisPlacement = resolveIndefiniteGridSpan(position, primaryAxisSpan, primaryAxisIsReversed);

    const doesFit = cellOccupancyMatrix.lineAreaIsUnoccupied(primaryAxis, primaryAxisPlacement, secondaryAxisPlacement);
    if (doesFit) {
      return [primaryAxisPlacement, secondaryAxisPlacement];
    }
    position = advancePosition(position, primaryAxisIsReversed);
  }
}

/** Step 4. Position the remaining grid items. */
function placeIndefinitelyPositionedItem(
  cellOccupancyMatrix: CellOccupancyMatrix,
  placement: PlacedChild['placement'],
  autoFlow: GridAutoFlow,
  gridPosition: [number, number],
  direction: Direction,
  explicitColCount: number,
): [LineOf<number>, LineOf<number>] {
  const primaryAxis = gridAutoFlowPrimaryAxis(autoFlow);
  const secondaryAxis = absOther(primaryAxis);
  const primaryAxisIsReversed = axisIsReversed(direction, primaryAxis);
  const secondaryAxisIsReversed = axisIsReversed(direction, secondaryAxis);

  const primaryPlacementStyle = placementGet(placement, primaryAxis);
  const secondaryPlacementStyle = placementGet(placement, secondaryAxis);

  const secondarySpanLength = ozIndefiniteSpan(secondaryPlacementStyle);
  const hasDefinitePrimaryAxisPosition = ozPlacementIsDefinite(primaryPlacementStyle);
  const primaryAxisGridStartLine = implicitStartLine(cellOccupancyMatrix.trackCounts(primaryAxis));
  const primaryAxisGridEndLine = implicitEndLine(cellOccupancyMatrix.trackCounts(primaryAxis));
  const secondaryAxisGridStartLine = implicitStartLine(cellOccupancyMatrix.trackCounts(secondaryAxis));
  const secondaryAxisGridEndLine = implicitEndLine(cellOccupancyMatrix.trackCounts(secondaryAxis));
  const primaryStartPosition = searchStartLine(primaryAxisGridStartLine, primaryAxisGridEndLine, primaryAxisIsReversed);
  const secondaryStartPosition = searchStartLine(
    secondaryAxisGridStartLine,
    secondaryAxisGridEndLine,
    secondaryAxisIsReversed,
  );

  const lineAreaIsOccupied = (primarySpan: LineOf<number>, secondarySpan: LineOf<number>): boolean =>
    !cellOccupancyMatrix.lineAreaIsUnoccupied(primaryAxis, primarySpan, secondarySpan);

  let [primaryIdx, secondaryIdx] = gridPosition;

  if (hasDefinitePrimaryAxisPosition) {
    const primarySpan = maybeMirrorSpan(
      ozResolveDefiniteGridLines(primaryPlacementStyle),
      primaryAxis,
      direction,
      explicitColCount,
    );

    // Compute secondary axis starting position for search.
    //
    // The non-dense branch advances to the next secondary track when this
    // item's primary start lies *behind* the flow cursor — i.e. placement
    // wrapped backwards, so the item cannot share a track with what came
    // before. That test must be relative to where the cursor could have
    // legitimately reached: an item anchored to a negative line (in an axis
    // whose implicit grid starts below zero) sits behind the *initial* cursor
    // without anything having been placed yet, and must not skip a track.
    // Comparing against the grid's own start line, rather than the raw cursor,
    // keeps the wrap heuristic while excluding that case. Comparing against the
    // raw cursor instead leaves the first item a track too far along; found by
    // differential fuzzing.
    if (gridAutoFlowIsDense(autoFlow)) {
      secondaryIdx = secondaryStartPosition;
    } else {
      const cursorHasMoved = primaryIdx !== primaryStartPosition;
      const shouldAdvanceSecondary =
        cursorHasMoved && (primaryAxisIsReversed ? primarySpan.start > primaryIdx : primarySpan.start < primaryIdx);
      if (shouldAdvanceSecondary) {
        secondaryIdx = advancePosition(secondaryIdx, secondaryAxisIsReversed);
      }
    }

    // Fixed primary axis position: increment secondary until the item fits
    for (;;) {
      const secondarySpan = resolveIndefiniteGridSpan(secondaryIdx, secondarySpanLength, secondaryAxisIsReversed);

      if (lineAreaIsOccupied(primarySpan, secondarySpan)) {
        secondaryIdx = advancePosition(secondaryIdx, secondaryAxisIsReversed);
        continue;
      }

      return [primarySpan, secondarySpan];
    }
  } else {
    const primarySpanLength = ozIndefiniteSpan(primaryPlacementStyle);

    // No fixed axis: search along primary; on hitting the end of existing tracks,
    // reset primary and advance secondary. Repeat until the item fits.
    for (;;) {
      const primarySpan = resolveIndefiniteGridSpan(primaryIdx, primarySpanLength, primaryAxisIsReversed);
      const secondarySpan = resolveIndefiniteGridSpan(secondaryIdx, secondarySpanLength, secondaryAxisIsReversed);

      const primaryOutOfBounds = primaryAxisIsReversed
        ? primarySpan.start < primaryAxisGridStartLine
        : primarySpan.end > primaryAxisGridEndLine;
      if (primaryOutOfBounds) {
        secondaryIdx = advancePosition(secondaryIdx, secondaryAxisIsReversed);
        primaryIdx = primaryStartPosition;
        continue;
      }

      if (lineAreaIsOccupied(primarySpan, secondarySpan)) {
        primaryIdx = advancePosition(primaryIdx, primaryAxisIsReversed);
        continue;
      }

      return [primarySpan, secondarySpan];
    }
  }
}

/** Record the grid item in both CellOccupancyMatrix and the GridItems list. */
function recordGridPlacement(
  cellOccupancyMatrix: CellOccupancyMatrix,
  items: GridItem[],
  child: PlacedChild,
  parentAlignItems: AlignItems,
  parentJustifyItems: AlignItems,
  primaryAxis: AbsoluteAxis,
  primarySpan: LineOf<number>,
  secondarySpan: LineOf<number>,
  placementType: CellOccupancyState,
): void {
  // Mark area of grid as occupied
  cellOccupancyMatrix.markAreaAs(primaryAxis, primarySpan, secondarySpan, placementType);

  // Create grid item
  const [colSpan, rowSpan] = primaryAxis === 'horizontal' ? [primarySpan, secondarySpan] : [secondarySpan, primarySpan];
  items.push(
    newGridItem(
      child.node,
      { ...colSpan },
      { ...rowSpan },
      child.style,
      parentAlignItems,
      parentJustifyItems,
      child.index,
    ),
  );
}
