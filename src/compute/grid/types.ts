// Port of taffy/src/compute/grid/types/* — GridTrack, TrackCounts,
// CellOccupancyMatrix, GridItem, and origin-zero coordinate helpers.
//
// Coordinate systems (see taffy grid_track_counts.rs for the full docs):
// - "CSS Grid Line": 1-based, negative counts from the end, 0 invalid
// - "OriginZero" (oz): explicit grid's start line is 0 (plain numbers here)
// - "TrackVec index": even indices are lines/gutters, odd indices are tracks

import type { AbsoluteAxis, Point, Rect, Size } from '../../geometry.js';
import { maybeApplyAspectRatio, rectAdd, sumAxes } from '../../geometry.js';
import { mAdd, mClamp, mMin, mSub } from '../../math.js';
import type { Opt } from '../../math.js';
import {
  maybeResolveSize,
  overflowAutoMinSize,
  resolveOrZero,
  trackDefiniteValue,
  maxDefiniteLimit,
  maxIsFr,
  maxIsFitContent,
  minIsIntrinsic,
  maxIsIntrinsic,
  trackUsesPercentage,
} from '../../style.js';
import type {
  AlignItems,
  AvailableSpace,
  BoxSizing,
  Dimension,
  GridPlacement,
  LengthPercentage,
  LengthPercentageAuto,
  MaxTrackSizingFunction,
  MinTrackSizingFunction,
  Overflow,
  Style,
} from '../../style.js';
import type { Node } from '../../tree.js';
import { measureChildSize } from '../dispatch.js';

// --- Axis helpers (AbstractAxis Inline≡horizontal, Block≡vertical)

export function absGet<T>(size: Size<T>, axis: AbsoluteAxis): T {
  return axis === 'horizontal' ? size.width : size.height;
}

export function absSet<T>(size: Size<T>, axis: AbsoluteAxis, value: T): void {
  if (axis === 'horizontal') size.width = value;
  else size.height = value;
}

export function absOther(axis: AbsoluteAxis): AbsoluteAxis {
  return axis === 'horizontal' ? 'vertical' : 'horizontal';
}

export interface LineOf<T> {
  start: T;
  end: T;
}

// --- Origin-zero line helpers

/** CSS grid line (1-based, negative from end) → origin-zero line */
export function gridLineIntoOriginZero(line: number, explicitTrackCount: number): number {
  if (line > 0) return line - 1;
  if (line < 0) return line + explicitTrackCount + 1;
  throw new Error('Grid line of zero is invalid');
}

/** The minimum number of negative implicit tracks if an item starts at this oz line */
export function impliedNegativeImplicitTracks(ozLine: number): number {
  return ozLine < 0 ? -ozLine : 0;
}

/** The minimum number of positive implicit tracks if an item ends at this oz line */
export function impliedPositiveImplicitTracks(ozLine: number, explicitTrackCount: number): number {
  return ozLine > explicitTrackCount ? ozLine - explicitTrackCount : 0;
}

export function lineSpan(line: LineOf<number>): number {
  return Math.max(line.end - line.start, 0);
}

// --- Origin-zero grid placements

export type OzGridPlacement = 'auto' | { line: number } | { span: number };

export const ozIsLine = (p: OzGridPlacement): p is { line: number } => typeof p === 'object' && 'line' in p;
export const ozIsSpan = (p: OzGridPlacement): p is { span: number } => typeof p === 'object' && 'span' in p;

/** Style GridPlacement → origin-zero placement (line 0 treated as auto) */
export function placementIntoOriginZero(placement: GridPlacement, explicitTrackCount: number): OzGridPlacement {
  if (placement === 'auto') return 'auto';
  if ('span' in placement) return { span: placement.span };
  if (placement.line === 0) return 'auto';
  return { line: gridLineIntoOriginZero(placement.line, explicitTrackCount) };
}

export function placementLineIntoOriginZero(
  line: LineOf<GridPlacement>,
  explicitTrackCount: number,
): LineOf<OzGridPlacement> {
  return {
    start: placementIntoOriginZero(line.start, explicitTrackCount),
    end: placementIntoOriginZero(line.end, explicitTrackCount),
  };
}

export function ozPlacementIsDefinite(line: LineOf<OzGridPlacement>): boolean {
  return ozIsLine(line.start) || ozIsLine(line.end);
}

/** Span for an indefinite placement (throws on a fully definite one) */
export function ozIndefiniteSpan(line: LineOf<OzGridPlacement>): number {
  const { start, end } = line;
  if (ozIsLine(start) && ozIsLine(end)) {
    throw new Error('indefiniteSpan should only be called on indefinite grid placements');
  }
  if (ozIsSpan(start)) return start.span;
  if (ozIsSpan(end)) return end.span;
  return 1;
}

/** Resolve a fully/partially definite placement to concrete oz lines */
export function ozResolveDefiniteGridLines(line: LineOf<OzGridPlacement>): LineOf<number> {
  const { start, end } = line;
  if (ozIsLine(start) && ozIsLine(end)) {
    if (start.line === end.line) return { start: start.line, end: start.line + 1 };
    return { start: Math.min(start.line, end.line), end: Math.max(start.line, end.line) };
  }
  if (ozIsLine(start) && ozIsSpan(end)) return { start: start.line, end: start.line + end.span };
  if (ozIsLine(start)) return { start: start.line, end: start.line + 1 };
  if (ozIsSpan(start) && ozIsLine(end)) return { start: end.line - start.span, end: end.line };
  if (ozIsLine(end)) return { start: end.line - 1, end: end.line };
  throw new Error('resolveDefiniteGridLines should only be called on definite grid placements');
}

/** For absolutely positioned items: resolve to definite tracks where possible */
export function ozResolveAbsolutelyPositionedGridTracks(line: LineOf<OzGridPlacement>): LineOf<Opt> {
  const { start, end } = line;
  if (ozIsLine(start) && ozIsLine(end)) {
    if (start.line === end.line) return { start: start.line, end: start.line + 1 };
    return { start: Math.min(start.line, end.line), end: Math.max(start.line, end.line) };
  }
  if (ozIsLine(start) && ozIsSpan(end)) return { start: start.line, end: start.line + end.span };
  if (ozIsLine(start)) return { start: start.line, end: null };
  if (ozIsSpan(start) && ozIsLine(end)) return { start: end.line - start.span, end: end.line };
  if (ozIsLine(end)) return { start: null, end: end.line };
  return { start: null, end: null };
}

// --- TrackCounts

export interface TrackCounts {
  negativeImplicit: number;
  explicit: number;
  positiveImplicit: number;
}

export const trackCountsLen = (c: TrackCounts): number => {
  const len = c.negativeImplicit + c.explicit + c.positiveImplicit;
  // A non-finite count silently defeats every `range.end > len` bounds check
  // (comparisons against NaN are false), which turns a sizing bug upstream into
  // an out-of-bounds write in the occupancy matrix. Fail where it originates.
  if (!Number.isFinite(len)) throw new Error(`grid: non-finite track count (${JSON.stringify(c)})`);
  return len;
};
export const implicitStartLine = (c: TrackCounts): number => 0 - c.negativeImplicit + 0; // +0 avoids -0
export const implicitEndLine = (c: TrackCounts): number => c.explicit + c.positiveImplicit;

/** oz line → the CellOccupancyMatrix track index immediately following it */
export const ozLineToNextTrack = (c: TrackCounts, ozLine: number): number => ozLine + c.negativeImplicit;
/** oz line range → exclusive track index range */
export function ozLineRangeToTrackRange(c: TrackCounts, line: LineOf<number>): { start: number; end: number } {
  return { start: ozLineToNextTrack(c, line.start), end: ozLineToNextTrack(c, line.end) };
}
/** track index → the oz line immediately preceding it */
export const trackToPrevOzLine = (c: TrackCounts, index: number): number => index - c.negativeImplicit;

// --- GridTrack

export type GridTrackKind = 'track' | 'gutter';

export interface GridTrack {
  kind: GridTrackKind;
  isCollapsed: boolean;
  minTrackSizingFunction: MinTrackSizingFunction;
  maxTrackSizingFunction: MaxTrackSizingFunction;
  offset: number;
  baseSize: number;
  growthLimit: number;
  contentAlignmentAdjustment: number;
  itemIncurredIncrease: number;
  baseSizePlannedIncrease: number;
  growthLimitPlannedIncrease: number;
  infinitelyGrowable: boolean;
}

export function newGridTrack(min: MinTrackSizingFunction, max: MaxTrackSizingFunction): GridTrack {
  return {
    kind: 'track',
    isCollapsed: false,
    minTrackSizingFunction: min,
    maxTrackSizingFunction: max,
    offset: 0,
    baseSize: 0,
    growthLimit: 0,
    contentAlignmentAdjustment: 0,
    itemIncurredIncrease: 0,
    baseSizePlannedIncrease: 0,
    growthLimitPlannedIncrease: 0,
    infinitelyGrowable: false,
  };
}

export function gutter(size: LengthPercentage): GridTrack {
  const track = newGridTrack(size, size);
  track.kind = 'gutter';
  return track;
}

export function collapseTrack(track: GridTrack): void {
  track.isCollapsed = true;
  track.minTrackSizingFunction = 0;
  track.maxTrackSizingFunction = 0;
}

export const trackIsFlexible = (track: GridTrack): boolean => maxIsFr(track.maxTrackSizingFunction);

export const trackUsesPercent = (track: GridTrack): boolean =>
  trackUsesPercentage(track.minTrackSizingFunction) || trackUsesPercentage(track.maxTrackSizingFunction);

export const trackHasIntrinsicSizingFunction = (track: GridTrack): boolean =>
  minIsIntrinsic(track.minTrackSizingFunction) || maxIsIntrinsic(track.maxTrackSizingFunction);

export function fitContentLimit(track: GridTrack, axisAvailableGridSpace: Opt): number {
  const max = track.maxTrackSizingFunction;
  if (maxIsFitContent(max)) {
    if (typeof max.fitContent === 'number') return max.fitContent;
    return axisAvailableGridSpace !== null ? axisAvailableGridSpace * max.fitContent.percent : Infinity;
  }
  return Infinity;
}

export function fitContentLimitedGrowthLimit(track: GridTrack, axisAvailableGridSpace: Opt): number {
  return Math.min(track.growthLimit, fitContentLimit(track, axisAvailableGridSpace));
}

export function flexFactor(track: GridTrack): number {
  const max = track.maxTrackSizingFunction;
  return maxIsFr(max) ? max.fr : 0;
}

// --- CellOccupancyMatrix

export type CellOccupancyState = 'unoccupied' | 'definitely-placed' | 'auto-placed';

export class CellOccupancyMatrix {
  private inner: CellOccupancyState[][]; // rows × cols
  private columns: TrackCounts;
  private rows: TrackCounts;

  constructor(columns: TrackCounts, rows: TrackCounts) {
    this.columns = { ...columns };
    this.rows = { ...rows };
    this.inner = Array.from({ length: trackCountsLen(rows) }, () =>
      new Array<CellOccupancyState>(trackCountsLen(columns)).fill('unoccupied'),
    );
  }

  trackCounts(axis: AbsoluteAxis): TrackCounts {
    return axis === 'horizontal' ? this.columns : this.rows;
  }

  private isAreaInRange(
    primaryAxis: AbsoluteAxis,
    primaryRange: { start: number; end: number },
    secondaryRange: { start: number; end: number },
  ): boolean {
    if (primaryRange.start < 0 || primaryRange.end > trackCountsLen(this.trackCounts(primaryAxis))) return false;
    if (secondaryRange.start < 0 || secondaryRange.end > trackCountsLen(this.trackCounts(absOther(primaryAxis)))) {
      return false;
    }
    return true;
  }

  private expandToFitRange(rowRange: { start: number; end: number }, colRange: { start: number; end: number }): void {
    const reqNegativeRows = Math.max(-rowRange.start, 0);
    const reqPositiveRows = Math.max(rowRange.end - trackCountsLen(this.rows), 0);
    const reqNegativeCols = Math.max(-colRange.start, 0);
    const reqPositiveCols = Math.max(colRange.end - trackCountsLen(this.columns), 0);

    const oldRowCount = trackCountsLen(this.rows);
    const oldColCount = trackCountsLen(this.columns);
    const newRowCount = oldRowCount + reqNegativeRows + reqPositiveRows;
    const newColCount = oldColCount + reqNegativeCols + reqPositiveCols;

    const newInner: CellOccupancyState[][] = Array.from({ length: newRowCount }, () =>
      new Array<CellOccupancyState>(newColCount).fill('unoccupied'),
    );
    for (let r = 0; r < oldRowCount; r++) {
      for (let c = 0; c < oldColCount; c++) {
        newInner[r + reqNegativeRows]![c + reqNegativeCols] = this.inner[r]![c]!;
      }
    }

    this.inner = newInner;
    this.rows.negativeImplicit += reqNegativeRows;
    this.rows.positiveImplicit += reqPositiveRows;
    this.columns.negativeImplicit += reqNegativeCols;
    this.columns.positiveImplicit += reqPositiveCols;
  }

  markAreaAs(
    primaryAxis: AbsoluteAxis,
    primarySpan: LineOf<number>,
    secondarySpan: LineOf<number>,
    value: CellOccupancyState,
  ): void {
    const [rowSpan, columnSpan] =
      primaryAxis === 'horizontal' ? [secondarySpan, primarySpan] : [primarySpan, secondarySpan];

    let colRange = ozLineRangeToTrackRange(this.columns, columnSpan);
    let rowRange = ozLineRangeToTrackRange(this.rows, rowSpan);

    if (!this.isAreaInRange('horizontal', colRange, rowRange)) {
      this.expandToFitRange(rowRange, colRange);
      colRange = ozLineRangeToTrackRange(this.columns, columnSpan);
      rowRange = ozLineRangeToTrackRange(this.rows, rowSpan);
    }

    for (let x = rowRange.start; x < rowRange.end; x++) {
      for (let y = colRange.start; y < colRange.end; y++) {
        this.inner[x]![y] = value;
      }
    }
  }

  lineAreaIsUnoccupied(primaryAxis: AbsoluteAxis, primarySpan: LineOf<number>, secondarySpan: LineOf<number>): boolean {
    const primaryRange = ozLineRangeToTrackRange(this.trackCounts(primaryAxis), primarySpan);
    const secondaryRange = ozLineRangeToTrackRange(this.trackCounts(absOther(primaryAxis)), secondarySpan);
    return this.trackAreaIsUnoccupied(primaryAxis, primaryRange, secondaryRange);
  }

  trackAreaIsUnoccupied(
    primaryAxis: AbsoluteAxis,
    primaryRange: { start: number; end: number },
    secondaryRange: { start: number; end: number },
  ): boolean {
    const [rowRange, colRange] =
      primaryAxis === 'horizontal' ? [secondaryRange, primaryRange] : [primaryRange, secondaryRange];

    // Out of bounds cells are considered unoccupied
    for (let x = rowRange.start; x < rowRange.end; x++) {
      for (let y = colRange.start; y < colRange.end; y++) {
        const cell = this.inner[x]?.[y];
        if (cell !== undefined && cell !== 'unoccupied') return false;
      }
    }
    return true;
  }

  rowIsOccupied(rowIndex: number): boolean {
    const row = this.inner[rowIndex];
    if (!row) return false;
    return row.some((cell) => cell !== 'unoccupied');
  }

  columnIsOccupied(columnIndex: number): boolean {
    if (this.inner.length === 0 || columnIndex >= (this.inner[0]?.length ?? 0)) return false;
    return this.inner.some((row) => row[columnIndex] !== 'unoccupied');
  }

  /** Search backwards along a track for the last cell of the given state */
  lastOfType(trackType: AbsoluteAxis, startAt: number, kind: CellOccupancyState): Opt {
    const trackCounts = this.trackCounts(absOther(trackType));
    const trackComputedIndex = ozLineToNextTrack(trackCounts, startAt);

    let maybeIndex: number | undefined;
    if (trackType === 'horizontal') {
      if (trackComputedIndex < 0 || trackComputedIndex >= this.inner.length) return null;
      const row = this.inner[trackComputedIndex]!;
      for (let i = row.length - 1; i >= 0; i--) {
        if (row[i] === kind) {
          maybeIndex = i;
          break;
        }
      }
    } else {
      if (trackComputedIndex < 0 || trackComputedIndex >= (this.inner[0]?.length ?? 0)) return null;
      for (let i = this.inner.length - 1; i >= 0; i--) {
        if (this.inner[i]![trackComputedIndex] === kind) {
          maybeIndex = i;
          break;
        }
      }
    }

    return maybeIndex !== undefined ? trackToPrevOzLine(trackCounts, maybeIndex) : null;
  }

  /** Search forwards along a track for the first cell of the given state */
  firstOfType(trackType: AbsoluteAxis, startAt: number, kind: CellOccupancyState): Opt {
    const trackCounts = this.trackCounts(absOther(trackType));
    const trackComputedIndex = ozLineToNextTrack(trackCounts, startAt);

    let maybeIndex: number | undefined;
    if (trackType === 'horizontal') {
      if (trackComputedIndex < 0 || trackComputedIndex >= this.inner.length) return null;
      maybeIndex = this.inner[trackComputedIndex]!.findIndex((cell) => cell === kind);
      if (maybeIndex === -1) maybeIndex = undefined;
    } else {
      if (trackComputedIndex < 0 || trackComputedIndex >= (this.inner[0]?.length ?? 0)) return null;
      const idx = this.inner.findIndex((row) => row[trackComputedIndex] === kind);
      maybeIndex = idx === -1 ? undefined : idx;
    }

    return maybeIndex !== undefined ? trackToPrevOzLine(trackCounts, maybeIndex) : null;
  }
}

// --- GridItem

export interface GridItem {
  node: Node;
  sourceOrder: number;

  /** Placement in origin-zero coordinates */
  row: LineOf<number>;
  column: LineOf<number>;

  overflow: Point<Overflow>;
  boxSizing: BoxSizing;
  size: Size<Dimension>;
  minSize: Size<Dimension>;
  maxSize: Size<Dimension>;
  aspectRatio: number | null;
  padding: Rect<LengthPercentage>;
  border: Rect<LengthPercentage>;
  margin: Rect<LengthPercentageAuto>;
  alignSelf: AlignItems;
  justifySelf: AlignItems;
  baseline: Opt;
  baselineShim: number;

  /** Placement as GridTrackVec indices */
  rowIndexes: LineOf<number>;
  columnIndexes: LineOf<number>;

  crossesFlexibleRow: boolean;
  crossesFlexibleColumn: boolean;
  crossesIntrinsicRow: boolean;
  crossesIntrinsicColumn: boolean;

  // Caches for intrinsic size computation (valid for a single track-sizing run)
  gridAreaSizeCache: Size<Opt> | null;
  minContentContributionCache: Size<Opt>;
  maxContentContributionCache: Size<Opt>;
  minimumContributionCache: Size<Opt>;

  yPosition: number;
  height: number;
}

export function newGridItem(
  node: Node,
  colSpan: LineOf<number>,
  rowSpan: LineOf<number>,
  style: Style,
  parentAlignItems: AlignItems,
  parentJustifyItems: AlignItems,
  sourceOrder: number,
): GridItem {
  return {
    node,
    sourceOrder,
    row: rowSpan,
    column: colSpan,
    overflow: style.overflow,
    boxSizing: style.boxSizing,
    size: style.size,
    minSize: style.minSize,
    maxSize: style.maxSize,
    aspectRatio: style.aspectRatio,
    padding: style.padding,
    border: style.border,
    margin: style.margin,
    alignSelf: style.alignSelf ?? parentAlignItems,
    justifySelf: style.justifySelf ?? parentJustifyItems,
    baseline: null,
    baselineShim: 0,
    rowIndexes: { start: 0, end: 0 },
    columnIndexes: { start: 0, end: 0 },
    crossesFlexibleRow: false,
    crossesFlexibleColumn: false,
    crossesIntrinsicRow: false,
    crossesIntrinsicColumn: false,
    gridAreaSizeCache: null,
    minContentContributionCache: { width: null, height: null },
    maxContentContributionCache: { width: null, height: null },
    minimumContributionCache: { width: null, height: null },
    yPosition: 0,
    height: 0,
  };
}

export function itemPlacement(item: GridItem, axis: AbsoluteAxis): LineOf<number> {
  return axis === 'vertical' ? item.row : item.column;
}

export function itemPlacementIndexes(item: GridItem, axis: AbsoluteAxis): LineOf<number> {
  return axis === 'vertical' ? item.rowIndexes : item.columnIndexes;
}

/** Range into the track vector covering spanned tracks, excluding bounding lines */
export function itemTrackRangeExcludingLines(item: GridItem, axis: AbsoluteAxis): { start: number; end: number } {
  const indexes = itemPlacementIndexes(item, axis);
  return { start: indexes.start + 1, end: indexes.end };
}

export function itemSpan(item: GridItem, axis: AbsoluteAxis): number {
  return lineSpan(itemPlacement(item, axis));
}

export function itemCrossesFlexibleTrack(item: GridItem, axis: AbsoluteAxis): boolean {
  return axis === 'horizontal' ? item.crossesFlexibleColumn : item.crossesFlexibleRow;
}

export function itemCrossesIntrinsicTrack(item: GridItem, axis: AbsoluteAxis): boolean {
  return axis === 'horizontal' ? item.crossesIntrinsicColumn : item.crossesIntrinsicRow;
}

function spannedTracks(item: GridItem, axis: AbsoluteAxis, axisTracks: GridTrack[]): GridTrack[] {
  const range = itemTrackRangeExcludingLines(item, axis);
  return axisTracks.slice(range.start, range.end);
}

/** Sum of definite max track sizing limits (incl. fit-content limits) if all spanned tracks have one */
export function itemSpannedTrackLimit(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  axisParentSize: Opt,
): Opt {
  const tracks = spannedTracks(item, axis, axisTracks);
  let limit = 0;
  for (const track of tracks) {
    const value = maxDefiniteLimit(track.maxTrackSizingFunction, axisParentSize);
    if (value === null) return null;
    limit += value;
  }
  return limit;
}

/** Like itemSpannedTrackLimit but excluding fit-content arguments */
export function itemSpannedFixedTrackLimit(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  axisParentSize: Opt,
): Opt {
  const tracks = spannedTracks(item, axis, axisTracks);
  let limit = 0;
  for (const track of tracks) {
    const value = trackDefiniteValue(track.maxTrackSizingFunction, axisParentSize);
    if (value === null) return null;
    limit += value;
  }
  return limit;
}

/** Resolved margin axis sums (plus baseline shim). Horizontal percentage margins resolve against zero. */
export function itemMarginsAxisSumsWithBaselineShims(item: GridItem, innerNodeWidth: Opt): Size<number> {
  return sumAxes({
    left: resolveOrZero(item.margin.left, 0),
    right: resolveOrZero(item.margin.right, 0),
    top: resolveOrZero(item.margin.top, innerNodeWidth) + item.baselineShim,
    bottom: resolveOrZero(item.margin.bottom, innerNodeWidth),
  });
}

/** Compute known_dimensions for child sizing (applies stretch alignment) */
function itemKnownDimensions(item: GridItem, gridAreaSize: Size<Opt>): Size<Opt> {
  const margins = itemMarginsAxisSumsWithBaselineShims(item, gridAreaSize.width);

  const aspectRatio = item.aspectRatio;
  const padding = {
    left: resolveOrZero(item.padding.left, gridAreaSize.width),
    right: resolveOrZero(item.padding.right, gridAreaSize.width),
    top: resolveOrZero(item.padding.top, gridAreaSize.width),
    bottom: resolveOrZero(item.padding.bottom, gridAreaSize.width),
  };
  const border = {
    left: resolveOrZero(item.border.left, gridAreaSize.width),
    right: resolveOrZero(item.border.right, gridAreaSize.width),
    top: resolveOrZero(item.border.top, gridAreaSize.width),
    bottom: resolveOrZero(item.border.bottom, gridAreaSize.width),
  };
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = item.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const inherentSize = maybeAddSize(
    maybeApplyAspectRatio(maybeResolveSize(item.size, gridAreaSize), aspectRatio),
    boxSizingAdjustment,
  );
  const minSize = maybeAddSize(
    maybeApplyAspectRatio(maybeResolveSize(item.minSize, gridAreaSize), aspectRatio),
    boxSizingAdjustment,
  );
  const maxSize = maybeAddSize(
    maybeApplyAspectRatio(maybeResolveSize(item.maxSize, gridAreaSize), aspectRatio),
    boxSizingAdjustment,
  );

  const gridAreaMinusItemMarginsSize = {
    width: mSub(gridAreaSize.width, margins.width),
    height: mSub(gridAreaSize.height, margins.height),
  };

  // Apply width based on stretch alignment
  let width = inherentSize.width;
  if (
    width === null &&
    item.margin.left !== 'auto' &&
    item.margin.right !== 'auto' &&
    item.justifySelf.keyword === 'stretch' &&
    !item.justifySelf.safe
  ) {
    width = gridAreaMinusItemMarginsSize.width;
  }
  // Reapply aspect ratio after stretch adjustments
  let size = maybeApplyAspectRatio({ width, height: inherentSize.height }, aspectRatio);

  let height = size.height;
  if (
    height === null &&
    item.margin.top !== 'auto' &&
    item.margin.bottom !== 'auto' &&
    item.alignSelf.keyword === 'stretch' &&
    !item.alignSelf.safe
  ) {
    height = gridAreaMinusItemMarginsSize.height;
  }
  size = maybeApplyAspectRatio({ width: size.width, height }, aspectRatio);

  return {
    width: mClamp(size.width, minSize.width, maxSize.width),
    height: mClamp(size.height, minSize.height, maxSize.height),
  };
}

/** Grid area size estimate for child sizing (see taffy grid_item.rs for the spec refs) */
export function itemGridAreaSize(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  availableSpace: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
): Size<Opt> {
  const size: Size<Opt> = { width: null, height: null };

  let axisSum: Opt = 0;
  for (const track of spannedTracks(item, axis, axisTracks)) {
    const minSize = trackDefiniteValue(track.minTrackSizingFunction, absGet(availableSpace, axis));
    const maxSize = trackDefiniteValue(track.maxTrackSizingFunction, absGet(availableSpace, axis));
    if (minSize === null || maxSize === null || minSize !== maxSize) {
      axisSum = null;
      break;
    }
    axisSum = axisSum! + track.baseSize;
  }
  absSet(size, axis, axisSum);

  let otherSum: Opt = 0;
  for (const track of spannedTracks(item, absOther(axis), otherAxisTracks)) {
    const estimate = getTrackSizeEstimate(track, absGet(availableSpace, absOther(axis)));
    if (estimate === null) {
      otherSum = null;
      break;
    }
    otherSum = otherSum! + estimate + track.contentAlignmentAdjustment;
  }
  absSet(size, absOther(axis), otherSum);

  return size;
}

export function itemGridAreaSizeCached(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  availableSpace: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
): Size<Opt> {
  if (item.gridAreaSizeCache) return item.gridAreaSizeCache;
  const gridAreaSize = itemGridAreaSize(item, axis, axisTracks, otherAxisTracks, availableSpace, getTrackSizeEstimate);
  item.gridAreaSizeCache = gridAreaSize;
  return gridAreaSize;
}

function contributionAvailableSpace(availableSpace: Size<Opt>, fallback: AvailableSpace): Size<AvailableSpace> {
  return {
    width: availableSpace.width ?? fallback,
    height: availableSpace.height ?? fallback,
  };
}

export function itemMinContentContribution(
  item: GridItem,
  axis: AbsoluteAxis,
  gridAreaSize: Size<Opt>,
  availableSpace: Size<Opt>,
): number {
  const knownDimensions = itemKnownDimensions(item, gridAreaSize);
  return measureChildSize(
    item.node,
    knownDimensions,
    gridAreaSize,
    contributionAvailableSpace(availableSpace, 'min-content'),
    'inherent-size',
    axis,
  );
}

export function itemMinContentContributionCached(
  item: GridItem,
  axis: AbsoluteAxis,
  gridAreaSize: Size<Opt>,
  availableSpace: Size<Opt>,
): number {
  const cached = absGet(item.minContentContributionCache, axis);
  if (cached !== null) return cached;
  const size = itemMinContentContribution(item, axis, gridAreaSize, availableSpace);
  absSet(item.minContentContributionCache, axis, size);
  return size;
}

export function itemMaxContentContribution(
  item: GridItem,
  axis: AbsoluteAxis,
  gridAreaSize: Size<Opt>,
  availableSpace: Size<Opt>,
): number {
  const knownDimensions = itemKnownDimensions(item, gridAreaSize);
  return measureChildSize(
    item.node,
    knownDimensions,
    gridAreaSize,
    contributionAvailableSpace(availableSpace, 'max-content'),
    'inherent-size',
    axis,
  );
}

export function itemMaxContentContributionCached(
  item: GridItem,
  axis: AbsoluteAxis,
  gridAreaSize: Size<Opt>,
  availableSpace: Size<Opt>,
): number {
  const cached = absGet(item.maxContentContributionCache, axis);
  if (cached !== null) return cached;
  const size = itemMaxContentContribution(item, axis, gridAreaSize, availableSpace);
  absSet(item.maxContentContributionCache, axis, size);
  return size;
}

/**
 * The minimum contribution of an item — the smallest outer size it can have.
 * See https://www.w3.org/TR/css-grid-1/#min-size-auto
 */
export function itemMinimumContribution(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  gridAreaSize: Size<Opt>,
  innerNodeSize: Size<Opt>,
): number {
  const padding = {
    left: resolveOrZero(item.padding.left, gridAreaSize.width),
    right: resolveOrZero(item.padding.right, gridAreaSize.width),
    top: resolveOrZero(item.padding.top, gridAreaSize.width),
    bottom: resolveOrZero(item.padding.bottom, gridAreaSize.width),
  };
  const border = {
    left: resolveOrZero(item.border.left, gridAreaSize.width),
    right: resolveOrZero(item.border.right, gridAreaSize.width),
    top: resolveOrZero(item.border.top, gridAreaSize.width),
    bottom: resolveOrZero(item.border.bottom, gridAreaSize.width),
  };
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = item.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };

  let size =
    absGet(
      maybeAddSize(maybeApplyAspectRatio(maybeResolveSize(item.size, gridAreaSize), item.aspectRatio), boxSizingAdjustment),
      axis,
    ) ??
    absGet(
      maybeAddSize(
        maybeApplyAspectRatio(maybeResolveSize(item.minSize, gridAreaSize), item.aspectRatio),
        boxSizingAdjustment,
      ),
      axis,
    ) ??
    overflowAutoMinSize(absGet({ width: item.overflow.x, height: item.overflow.y }, axis));

  if (size === null) {
    // Automatic minimum size. See https://www.w3.org/TR/css-grid-1/#min-size-auto
    const itemAxisTrackRange = itemTrackRangeExcludingLines(item, axis);
    const itemAxisTracks = axisTracks.slice(itemAxisTrackRange.start, itemAxisTrackRange.end);

    // it spans at least one track in that axis whose min track sizing function is auto
    const spansAutoMinTrack = axisTracks.some((track) => track.minTrackSizingFunction === 'auto');
    // if it spans more than one track in that axis, none of those tracks are flexible
    const onlySpanOneTrack = itemAxisTracks.length === 1;
    const spansAFlexibleTrack = axisTracks.some((track) => maxIsFr(track.maxTrackSizingFunction));

    const useContentBasedMinimum = spansAutoMinTrack && (onlySpanOneTrack || !spansAFlexibleTrack);

    size = useContentBasedMinimum ? itemMinContentContributionCached(item, axis, gridAreaSize, gridAreaSize) : 0;
  }

  // The size suggestion is additionally clamped by the maximum size in the affected axis.
  const limit = itemSpannedFixedTrackLimit(item, axis, axisTracks, absGet(innerNodeSize, axis));
  return mMin(size, limit) as number;
}

export function itemMinimumContributionCached(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  gridAreaSize: Size<Opt>,
  innerNodeSize: Size<Opt>,
): number {
  const cached = absGet(item.minimumContributionCache, axis);
  if (cached !== null) return cached;
  const size = itemMinimumContribution(item, axis, axisTracks, gridAreaSize, innerNodeSize);
  absSet(item.minimumContributionCache, axis, size);
  return size;
}

// --- shared helper

export function maybeAddSize(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: mAdd(s.width, rhs.width),
    height: mAdd(s.height, rhs.height),
  };
}
