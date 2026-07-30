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

/** Per-axis translation applied to origin-zero line placements (see below). */
export interface OzOffsets {
  col: number;
  row: number;
}

/**
 * Estimate the number of rows and columns in the grid.
 * Returns [columnCounts, rowCounts, ozOffsets].
 *
 * The offsets implement a coalescing rule observed in Chrome: when an axis has
 * NO explicit tracks and every definite placement ends at a negative line, the
 * would-be implicit tracks between the occupied range and the explicit grid
 * origin are not materialized — the lines coalesce. (E.g. `grid-row: -3/auto`
 * in a template-less grid yields ONE row, not a row plus an empty trailing
 * one.) Modeling negative implicit tracks as contiguous down to the origin —
 * as this function did, following taffy — produces phantom empty tracks;
 * found by differential fuzzing. Note taffy documents this estimate as a
 * pre-sizing optimisation with final counts coming from placement, so the
 * upstream defect may not live in the equivalent function (see
 * UPSTREAM_TAFFY.md). The offset translates all line placements forward so the maximum
 * occupied end line is 0, which removes the phantom while keeping the
 * line→track-index arithmetic unchanged. Offsets are computed in raw
 * (pre-RTL-mirror) coordinates so track counts stay direction-independent.
 */
export function computeGridSizeEstimate(
  explicitColCount: number,
  explicitRowCount: number,
  direction: Direction,
  childStyles: Style[],
): [TrackCounts, TrackCounts, OzOffsets] {
  // Pass 1: raw (unmirrored, unshifted) aggregates to derive the offsets.
  // Starts at -Infinity so an all-negative aggregate stays negative; a
  // span-only or auto child contributes max=0, disabling the offset — that is
  // deliberate: auto-placed items may flow anywhere, so coalescing is only
  // safe when every child is line-anchored strictly before the origin.
  let rawColMax = -Infinity;
  let rawRowMax = -Infinity;
  for (const childStyle of childStyles) {
    rawColMax = Math.max(rawColMax, childMinLineMaxLineSpan(childStyle.gridColumn, explicitColCount)[1]);
    rawRowMax = Math.max(rawRowMax, childMinLineMaxLineSpan(childStyle.gridRow, explicitRowCount)[1]);
  }
  const ozOffsets: OzOffsets = {
    col: explicitColCount === 0 && Number.isFinite(rawColMax) && rawColMax < 0 ? -rawColMax : 0,
    row: explicitRowCount === 0 && Number.isFinite(rawRowMax) && rawRowMax < 0 ? -rawRowMax : 0,
  };

  let colMin = 0;
  let colMax = 0;
  let colMaxSpan = 0;
  let rowMin = 0;
  let rowMax = 0;
  let rowMaxSpan = 0;

  for (const childStyle of childStyles) {
    let [childColMin, childColMax, childColSpan] = childMinLineMaxLineSpan(childStyle.gridColumn, explicitColCount);
    let [childRowMin, childRowMax, childRowSpan] = childMinLineMaxLineSpan(childStyle.gridRow, explicitRowCount);
    // When an offset is active every child is line-anchored (see above), so the
    // translation applies uniformly.
    childColMin += ozOffsets.col;
    childColMax += ozOffsets.col;
    childRowMin += ozOffsets.row;
    childRowMax += ozOffsets.row;

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
    ozOffsets,
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
