// Estimates grid size for pre-sizing the CellOccupancyMatrix (a necessary step
// in auto-placement).

import type { Direction, Style } from '../../style.js';
import type { LineOf, OzGridPlacement, TrackCounts } from './types.js';
import {
  impliedNegativeImplicitTracks,
  impliedPositiveImplicitTracks,
  ozIndefiniteSpan,
  ozIsLine,
  ozIsSpan,
  placementLineIntoOriginZero,
} from './types.js';

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
 * as this function once did — produces phantom empty tracks; found by
 * differential fuzzing. This estimate is only a pre-sizing optimisation, with
 * the final counts coming from placement.
 * The offset translates all line placements forward so the maximum
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
  //
  // The offset translates the occupied region so its first track starts at the
  // origin, so it is derived from the smallest occupied *start* line. Deriving
  // it from end lines instead leaves the region one track below the origin for
  // auto-start items, which then forces a spurious negative track.
  //
  // Starts at +Infinity so an all-negative aggregate stays negative; a
  // span-only child contributes 0, disabling the offset — deliberate, since a
  // fully auto-placed item may flow anywhere and coalescing is only safe when
  // every child is anchored strictly before the origin.
  let rawColMin = Infinity;
  let rawRowMin = Infinity;
  for (const childStyle of childStyles) {
    rawColMin = Math.min(rawColMin, childOccupiedStartLine(childStyle.gridColumn, explicitColCount));
    rawRowMin = Math.min(rawRowMin, childOccupiedStartLine(childStyle.gridRow, explicitRowCount));
  }
  const ozOffsets: OzOffsets = {
    col: explicitColCount === 0 && Number.isFinite(rawColMin) && rawColMin < 0 ? -rawColMin : 0,
    row: explicitRowCount === 0 && Number.isFinite(rawRowMin) && rawRowMin < 0 ? -rawRowMin : 0,
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
 * The oz line an item's occupied track *starts* at, or 0 when the item is not
 * line-anchored (which disables coalescing — see computeGridSizeEstimate).
 * A lone end line at L means the item occupies L-1 → L, so its start is L-1.
 */
function childOccupiedStartLine(
  line: { start: import('../../style.js').GridPlacement; end: import('../../style.js').GridPlacement },
  explicitTrackCount: number,
): number {
  const { start, end } = placementLineIntoOriginZero(line, explicitTrackCount);
  if (ozIsLine(start) && ozIsLine(end)) {
    return start.line === end.line ? start.line : Math.min(start.line, end.line);
  }
  if (ozIsLine(start)) return start.line;
  if (ozIsLine(end)) return ozIsSpan(start) ? end.line - start.span : end.line - 1;
  return 0;
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
    // `auto / L` occupies L-1 → L; counting from L creates a phantom
    // positive track when a later auto-placed item has the largest span.
    min = ozIsSpan(start) ? end.line - start.span : end.line - 1;
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
