// Port of taffy/src/compute/grid/implicit_grid.rs — estimates grid size for
// pre-sizing the CellOccupancyMatrix (a necessary step in auto-placement).

import type { Direction, Style } from '../../style.js';
import {
  impliedNegativeImplicitTracks,
  impliedPositiveImplicitTracks,
  ozIndefiniteSpan,
  ozIsLine,
  ozIsSpan,
  placementLineIntoOriginZero,
} from './types.js';
import type { LineOf, OzGridPlacement, TrackCounts } from './types.js';

/**
 * Estimate the number of rows and columns in the grid.
 * Returns [columnCounts, rowCounts].
 */
export function computeGridSizeEstimate(
  explicitColCount: number,
  explicitRowCount: number,
  direction: Direction,
  childStyles: Style[],
): [TrackCounts, TrackCounts] {
  let colMin = 0;
  let colMax = 0;
  let colMaxSpan = 0;
  let rowMin = 0;
  let rowMax = 0;
  let rowMaxSpan = 0;

  for (const childStyle of childStyles) {
    let [childColMin, childColMax, childColSpan] = childMinLineMaxLineSpan(childStyle.gridColumn, explicitColCount);
    const [childRowMin, childRowMax, childRowSpan] = childMinLineMaxLineSpan(childStyle.gridRow, explicitRowCount);

    // Placement mirrors horizontal spans in RTL; mirror known column line bounds here
    // to keep implicit-grid pre-sizing consistent with actual placement.
    if (direction === 'rtl' && (childColMin !== 0 || childColMax !== 0)) {
      const mirroredMin = explicitColCount - childColMax;
      const mirroredMax = explicitColCount - childColMin;
      childColMin = mirroredMin;
      childColMax = mirroredMax;
    }

    colMin = Math.min(colMin, childColMin);
    colMax = Math.max(colMax, childColMax);
    colMaxSpan = Math.max(colMaxSpan, childColSpan);
    rowMin = Math.min(rowMin, childRowMin);
    rowMax = Math.max(rowMax, childRowMax);
    rowMaxSpan = Math.max(rowMaxSpan, childRowSpan);
  }

  const negativeImplicitInlineTracks = impliedNegativeImplicitTracks(colMin);
  const explicitInlineTracks = explicitColCount;
  let positiveImplicitInlineTracks = impliedPositiveImplicitTracks(colMax, explicitColCount);
  const negativeImplicitBlockTracks = impliedNegativeImplicitTracks(rowMin);
  const explicitBlockTracks = explicitRowCount;
  let positiveImplicitBlockTracks = impliedPositiveImplicitTracks(rowMax, explicitRowCount);

  // Adjust positive track estimates for spans that don't fit
  const totInlineTracks = negativeImplicitInlineTracks + explicitInlineTracks + positiveImplicitInlineTracks;
  if (totInlineTracks < colMaxSpan) {
    positiveImplicitInlineTracks = colMaxSpan - explicitInlineTracks - negativeImplicitInlineTracks;
  }

  const totBlockTracks = negativeImplicitBlockTracks + explicitBlockTracks + positiveImplicitBlockTracks;
  if (totBlockTracks < rowMaxSpan) {
    positiveImplicitBlockTracks = rowMaxSpan - explicitBlockTracks - negativeImplicitBlockTracks;
  }

  return [
    {
      negativeImplicit: negativeImplicitInlineTracks,
      explicit: explicitInlineTracks,
      positiveImplicit: positiveImplicitInlineTracks,
    },
    {
      negativeImplicit: negativeImplicitBlockTracks,
      explicit: explicitBlockTracks,
      positiveImplicit: positiveImplicitBlockTracks,
    },
  ];
}

/**
 * Conservative estimate of the greatest/smallest oz grid lines used by an item,
 * plus its span. Returns [min, max, span].
 */
function childMinLineMaxLineSpan(
  line: { start: import('../../style.js').GridPlacement; end: import('../../style.js').GridPlacement },
  explicitTrackCount: number,
): [number, number, number] {
  const ozLine: LineOf<OzGridPlacement> = placementLineIntoOriginZero(line, explicitTrackCount);
  const { start, end } = ozLine;

  let min = 0;
  if (ozIsLine(start) && ozIsLine(end)) {
    min = start.line === end.line ? start.line : Math.min(start.line, end.line);
  } else if (ozIsLine(start)) {
    min = start.line;
  } else if (ozIsLine(end)) {
    min = ozIsSpan(start) ? end.line - start.span : end.line;
  }

  let max = 0;
  if (ozIsLine(start) && ozIsLine(end)) {
    max = start.line === end.line ? start.line + 1 : Math.max(start.line, end.line);
  } else if (ozIsLine(start)) {
    max = ozIsSpan(end) ? start.line + end.span : start.line + 1;
  } else if (ozIsLine(end)) {
    max = end.line;
  }

  const span = !ozIsLine(start) && !ozIsLine(end) ? ozIndefiniteSpan(ozLine) : 1;

  return [min, max, span];
}
