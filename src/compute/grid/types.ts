// Grid data structures — GridTrack, TrackCounts, CellOccupancyMatrix, GridItem,
// and origin-zero coordinate helpers.
//
// Coordinate systems:
// - "CSS Grid Line": 1-based, negative counts from the end, 0 invalid
// - "OriginZero" (oz): explicit grid's start line is 0 (plain numbers here)
// - "TrackVec index": even indices are lines/gutters, odd indices are tracks

import { unreachable } from '../../assert.js';
import type { AbsoluteAxis, Point, Rect, Size } from '../../geometry.js';
import { maybeApplyAspectRatio, rectAdd, sumAxes } from '../../geometry.js';
import type { Opt } from '../../math.js';
import { mAdd, mClamp, mMin, mSub, vClamp } from '../../math.js';
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
import {
  InvalidStyleError,
  maxDefiniteLimit,
  maxIsFitContent,
  maxIsFr,
  maxIsIntrinsic,
  maybeResolveSize,
  minIsIntrinsic,
  overflowAutoMinSize,
  resolveOrZero,
  resolveRectOrZero,
  trackDefiniteValue,
  trackUsesPercentage,
} from '../../style.js';
import type { LayoutNode } from '../../tree.js';
import {
  maybeApplyAspectRatioUsed,
  transferMaxSizeThroughAspectRatio,
  transferMinSizeThroughAspectRatio,
} from '../aspectRatio.js';
import { measureChildSize } from '../dispatch.js';

const BLINK_LAYOUT_UNIT_DENOMINATOR = 64;

export function toBlinkLayoutUnit(value: number): number {
  return Math.trunc(value * BLINK_LAYOUT_UNIT_DENOMINATOR) / BLINK_LAYOUT_UNIT_DENOMINATOR;
}

/**
 * Blink stores resolved layout lengths in 1/64px fixed point and truncates
 * float conversions toward zero. Grid intrinsic contributions observe that
 * conversion per edge, before padding/border sums are formed.
 */
function resolveGridInsetOrZero(value: LengthPercentage, context: Opt): number {
  return toBlinkLayoutUnit(resolveOrZero(value, context));
}

export function resolveGridInsets(insets: Rect<LengthPercentage>, context: Opt): Rect<number> {
  return {
    left: resolveGridInsetOrZero(insets.left, context),
    right: resolveGridInsetOrZero(insets.right, context),
    top: resolveGridInsetOrZero(insets.top, context),
    bottom: resolveGridInsetOrZero(insets.bottom, context),
  };
}

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
  throw new InvalidStyleError('grid line 0 is invalid (lines are 1-based; negative indices count from the end)');
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
  if (!Number.isFinite(len)) throw new InvalidStyleError(`grid: non-finite track count (${JSON.stringify(c)})`);
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
  /** Set when every item in the current span batch contributed 0 to this
   *  track, leaving its growth limit infinite for want of anything to raise
   *  it. Such a track is treated as limited while any other track it shares a
   *  later spanning item with can still grow. */
  limitedByZeroContribution: boolean;
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
    limitedByZeroContribution: false,
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

/** Grid §11.7.1: find the size of an fr, optionally from provisional track bases. */
export function findSizeOfFr(
  tracks: GridTrack[],
  spaceToFill: number,
  getBaseSize: (track: GridTrack) => number = (track) => track.baseSize,
): number {
  // Trivial case — the loop below would otherwise fail to converge.
  if (spaceToFill === 0 || !Number.isFinite(spaceToFill)) return 0;

  let hypotheticalFrSize = Infinity;
  let previousIterHypotheticalFrSize: number;
  for (;;) {
    let usedSpace = 0;
    let naiveFlexFactorSum = 0;
    for (const track of tracks) {
      const baseSize = getBaseSize(track);
      if (maxIsFr(track.maxTrackSizingFunction) && track.maxTrackSizingFunction.fr * hypotheticalFrSize >= baseSize) {
        naiveFlexFactorSum += track.maxTrackSizingFunction.fr;
      } else {
        usedSpace += baseSize;
      }
    }
    const leftoverSpace = spaceToFill - usedSpace;
    const totalFlexFactor = Math.max(naiveFlexFactorSum, 1);

    previousIterHypotheticalFrSize = hypotheticalFrSize;
    hypotheticalFrSize = leftoverSpace / totalFlexFactor;

    const hypotheticalFrSizeIsValid = tracks.every((track) => {
      if (!maxIsFr(track.maxTrackSizingFunction)) return true;
      const factor = track.maxTrackSizingFunction.fr;
      const baseSize = getBaseSize(track);
      return factor * hypotheticalFrSize >= baseSize || factor * previousIterHypotheticalFrSize < baseSize;
    });
    if (hypotheticalFrSizeIsValid) return hypotheticalFrSize;
  }
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
        (newInner[r + reqNegativeRows] ?? unreachable())[c + reqNegativeCols] = this.inner[r]?.[c] ?? unreachable();
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
      const row = this.inner[x] ?? unreachable();
      for (let y = colRange.start; y < colRange.end; y++) {
        row[y] = value;
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
    const lookupTrackCounts = this.trackCounts(absOther(trackType));
    const resultTrackCounts = this.trackCounts(trackType);
    const trackComputedIndex = ozLineToNextTrack(lookupTrackCounts, startAt);

    let maybeIndex: number | undefined;
    if (trackType === 'horizontal') {
      if (trackComputedIndex < 0 || trackComputedIndex >= this.inner.length) return null;
      const row = this.inner[trackComputedIndex] ?? unreachable();
      for (let i = row.length - 1; i >= 0; i--) {
        if (row[i] === kind) {
          maybeIndex = i;
          break;
        }
      }
    } else {
      if (trackComputedIndex < 0 || trackComputedIndex >= (this.inner[0]?.length ?? 0)) return null;
      for (let i = this.inner.length - 1; i >= 0; i--) {
        if (this.inner[i]?.[trackComputedIndex] === kind) {
          maybeIndex = i;
          break;
        }
      }
    }

    // `startAt` selects a cell on the opposite axis, but `maybeIndex` is the
    // found position along `trackType`. Convert it with that axis's counts.
    // Using row counts for a found column shifted the sparse auto-placement
    // cursor by the row grid's negative implicit tracks: two overlapping
    // row-locked items then materialized four columns instead of two.
    return maybeIndex !== undefined ? trackToPrevOzLine(resultTrackCounts, maybeIndex) : null;
  }

  /** Search forwards along a track for the first cell of the given state */
  firstOfType(trackType: AbsoluteAxis, startAt: number, kind: CellOccupancyState): Opt {
    const lookupTrackCounts = this.trackCounts(absOther(trackType));
    const resultTrackCounts = this.trackCounts(trackType);
    const trackComputedIndex = ozLineToNextTrack(lookupTrackCounts, startAt);

    let maybeIndex: number | undefined;
    if (trackType === 'horizontal') {
      if (trackComputedIndex < 0 || trackComputedIndex >= this.inner.length) return null;
      maybeIndex = this.inner[trackComputedIndex]?.indexOf(kind);
      if (maybeIndex === -1) maybeIndex = undefined;
    } else {
      if (trackComputedIndex < 0 || trackComputedIndex >= (this.inner[0]?.length ?? 0)) return null;
      const idx = this.inner.findIndex((row) => row[trackComputedIndex] === kind);
      maybeIndex = idx === -1 ? undefined : idx;
    }

    return maybeIndex !== undefined ? trackToPrevOzLine(resultTrackCounts, maybeIndex) : null;
  }
}

// --- GridItem

export interface GridItem {
  node: LayoutNode;
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
  baselineIsSynthesized: boolean;
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
  node: LayoutNode,
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
    baselineIsSynthesized: false,
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

/** Whether an item participates in first-baseline alignment across its row. */
export function itemParticipatesInBlockBaselineAlignment(item: GridItem): boolean {
  return (
    item.alignSelf.keyword === 'baseline' &&
    !item.alignSelf.safe &&
    item.margin.top !== 'auto' &&
    item.margin.bottom !== 'auto'
  );
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

/** Resolved margin axis sums (plus baseline shim). Indefinite percentage margins resolve against zero. */
export function itemMarginsAxisSumsWithBaselineShims(item: GridItem, innerNodeWidth: Opt): Size<number> {
  return sumAxes({
    left: resolveOrZero(item.margin.left, innerNodeWidth),
    right: resolveOrZero(item.margin.right, innerNodeWidth),
    top: resolveOrZero(item.margin.top, innerNodeWidth) + item.baselineShim,
    bottom: resolveOrZero(item.margin.bottom, innerNodeWidth),
  });
}

function itemKnownDimensions(item: GridItem, gridAreaSize: Size<Opt>): Size<Opt> {
  const margins = itemMarginsAxisSumsWithBaselineShims(item, gridAreaSize.width);

  const aspectRatio = item.aspectRatio;
  const padding = resolveGridInsets(item.padding, gridAreaSize.width);
  const border = resolveGridInsets(item.border, gridAreaSize.width);
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = item.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const resolvedStyleSize = maybeResolveSize(item.size, gridAreaSize);
  const inherentSize = maybeAddSize(maybeApplyAspectRatio(resolvedStyleSize, aspectRatio), boxSizingAdjustment);
  const resolvedMinSize = maybeResolveSize(item.minSize, gridAreaSize);
  const resolvedMaxSize = maybeResolveSize(item.maxSize, gridAreaSize);
  const minSizeRaw = maybeAddSize(resolvedMinSize, boxSizingAdjustment);
  const minSize = transferMinSizeThroughAspectRatio(
    {
      width: Math.max(minSizeRaw.width ?? paddingBorderSize.width, paddingBorderSize.width),
      height: Math.max(minSizeRaw.height ?? paddingBorderSize.height, paddingBorderSize.height),
    },
    resolvedMinSize,
    resolvedStyleSize,
    resolvedMaxSize,
    aspectRatio,
    item.boxSizing,
    paddingBorderSize,
  );
  const maxSize = transferMaxSizeThroughAspectRatio(
    resolvedMaxSize,
    resolvedStyleSize,
    minSize,
    aspectRatio,
    item.boxSizing,
    paddingBorderSize,
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
  // Resolve the ratio from the item's used inline size, after its own
  // min/max-width constraints. css-sizing-4 §4.2 makes inline size the
  // ratio-determining input here; Blink's ComputeBlockSizeForFragment receives
  // the already-clamped inline fragment size. Chrome 151, a 3px-wide grid area
  // around `max-width: 1px; aspect-ratio: 1.5`, therefore derives a 2/3px
  // height from 1px, not a 2px height from the pre-clamp 3px stretch fit.
  width = mClamp(width, minSize.width, maxSize.width);
  // Reapply aspect ratio after stretch adjustments (on used border-box values,
  // so the transfer must respect box-sizing)
  let size = maybeApplyAspectRatioUsed(
    { width, height: inherentSize.height },
    aspectRatio,
    item.boxSizing,
    paddingBorderSize,
  );

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
  size = maybeApplyAspectRatioUsed({ width: size.width, height }, aspectRatio, item.boxSizing, paddingBorderSize);

  return {
    width: mClamp(size.width, minSize.width, maxSize.width),
    height: mClamp(size.height, minSize.height, maxSize.height),
  };
}

/**
 * Resolve the inline size used while measuring a grid item's block contribution.
 *
 * Grid §11 sizes rows after columns and requires block-axis contributions to
 * use the resulting inline available space. For every non-stretch self
 * alignment, Grid §6.6 makes an automatic inline size fit-content. Grid §10.2
 * gives auto margins precedence over self-alignment, so an inline auto margin
 * also suppresses implicit stretch. Blink 7922 keeps `kFitContent` when
 * `AxisEdgeFromItemPosition()` sees that margin; its `BlockContributionSize()`
 * gets the used width from the measurement constraint space before reading
 * the fragment's block size.
 */
function itemContributionKnownDimensions(item: GridItem, axis: AbsoluteAxis, gridAreaSize: Size<Opt>): Size<Opt> {
  const knownDimensions = itemKnownDimensions(item, gridAreaSize);
  if (
    axis !== 'vertical' ||
    knownDimensions.width !== null ||
    gridAreaSize.width === null ||
    (item.justifySelf.keyword === 'stretch' && item.margin.left !== 'auto' && item.margin.right !== 'auto')
  ) {
    return knownDimensions;
  }

  const margins = itemMarginsAxisSumsWithBaselineShims(item, gridAreaSize.width);
  const measureKnownDimensions = { ...knownDimensions, width: null };
  const availableHeight: AvailableSpace = gridAreaSize.height ?? 'max-content';
  const measure = (width: AvailableSpace): number =>
    measureChildSize(
      item.node,
      measureKnownDimensions,
      gridAreaSize,
      { width, height: availableHeight },
      'inherent-size',
      'horizontal',
    );
  const minContentWidth = measure('min-content');
  const maxContentWidth = measure('max-content');
  const stretchFitWidth = Math.max(gridAreaSize.width - margins.width, 0);

  knownDimensions.width = Math.min(maxContentWidth, Math.max(minContentWidth, stretchFitWidth));
  return knownDimensions;
}

function autoInsetLayoutUnitDelta(item: GridItem, gridAreaSize: Size<Opt>, axis: AbsoluteAxis): number {
  const exact = sumAxes(
    rectAdd(resolveRectOrZero(item.padding, gridAreaSize.width), resolveRectOrZero(item.border, gridAreaSize.width)),
  );
  const quantized = sumAxes(
    rectAdd(resolveGridInsets(item.padding, gridAreaSize.width), resolveGridInsets(item.border, gridAreaSize.width)),
  );
  return absGet(quantized, axis) - absGet(exact, axis);
}

/** Grid area size estimate for child sizing (css-grid-1 §12) */
export function itemGridAreaSize(
  item: GridItem,
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  availableSpace: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
): Size<Opt> {
  const size: Size<Opt> = { width: null, height: null };

  // Accumulate in a plain `number` and only widen to `Opt` on the way out, so
  // the running total never needs an assertion to stay non-null.
  let axisTotal = 0;
  let axisDefinite = true;
  for (const track of spannedTracks(item, axis, axisTracks)) {
    const minSize = trackDefiniteValue(track.minTrackSizingFunction, absGet(availableSpace, axis));
    const maxSize = trackDefiniteValue(track.maxTrackSizingFunction, absGet(availableSpace, axis));
    if (minSize === null || maxSize === null || minSize !== maxSize) {
      axisDefinite = false;
      break;
    }
    axisTotal += track.baseSize;
  }
  absSet(size, axis, axisDefinite ? axisTotal : null);

  const otherAxis = absOther(axis);
  const otherAxisAvailableSize = absGet(availableSpace, otherAxis);
  const otherSpannedTracks = spannedTracks(item, otherAxis, otherAxisTracks);

  // Grid §11.5 sizes a multi-track item crossing a flexible track as one
  // group: non-flex tracks are held at their current base sizes and space is
  // distributed only to the flexible tracks. Blink exposes that provisional
  // span through GridItemData::CalculateAvailableSize even while the opposite
  // axis is being sized. In a 20px-tall grid, an item spanning `3fr auto auto`
  // therefore has a definite 20px block area during column sizing; treating
  // the auto tracks' indefinite maxima as making the whole span indefinite
  // instead measured breakable text at max-content (50px rather than 40px).
  const useFlexibleSpanEstimate =
    otherAxisAvailableSize !== null &&
    itemSpan(item, otherAxis) > 1 &&
    otherSpannedTracks.some((track) => maxIsFr(track.maxTrackSizingFunction));

  let flexFraction = 0;
  if (useFlexibleSpanEstimate) {
    const provisionalBaseSize = (track: GridTrack): number =>
      trackDefiniteValue(track.minTrackSizingFunction, otherAxisAvailableSize) ??
      getTrackSizeEstimate(track, otherAxisAvailableSize) ??
      track.baseSize;
    flexFraction = findSizeOfFr(otherAxisTracks, otherAxisAvailableSize, provisionalBaseSize);
  }

  let otherTotal = 0;
  let otherDefinite = true;
  for (const track of otherSpannedTracks) {
    let estimate = getTrackSizeEstimate(track, otherAxisAvailableSize);
    if (estimate === null && useFlexibleSpanEstimate) {
      estimate = maxIsFr(track.maxTrackSizingFunction)
        ? Math.max(
            trackDefiniteValue(track.minTrackSizingFunction, otherAxisAvailableSize) ?? track.baseSize,
            track.maxTrackSizingFunction.fr * flexFraction,
          )
        : track.baseSize;
    }
    if (estimate === null) {
      otherDefinite = false;
      break;
    }
    otherTotal += estimate + track.contentAlignmentAdjustment;
  }
  absSet(size, otherAxis, otherDefinite ? otherTotal : null);

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

/** CSS Sizing 4 §4.3 automatic inline minimum after a ratio transfer. */
function itemRatioAutomaticInlineMinimum(item: GridItem, gridAreaSize: Size<Opt>, knownDimensions: Size<Opt>): Opt {
  if (
    item.aspectRatio === null ||
    item.size.width !== 'auto' ||
    item.minSize.width !== 'auto' ||
    overflowAutoMinSize(item.overflow) === 0 ||
    gridAreaSize.width !== null ||
    knownDimensions.width === null
  ) {
    return null;
  }

  const padding = resolveGridInsets(item.padding, gridAreaSize.width);
  const border = resolveGridInsets(item.border, gridAreaSize.width);
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = item.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const maxSize = maybeAddSize(maybeResolveSize(item.maxSize, gridAreaSize), boxSizingAdjustment);
  const minContentWidth = measureChildSize(
    item.node,
    { width: null, height: null },
    gridAreaSize,
    { width: 'min-content', height: 'max-content' },
    'content-size',
    'horizontal',
  );
  return Math.min(minContentWidth, maxSize.width ?? Infinity);
}

export function itemMinContentContribution(
  item: GridItem,
  axis: AbsoluteAxis,
  gridAreaSize: Size<Opt>,
  availableSpace: Size<Opt>,
): number {
  const knownDimensions = itemContributionKnownDimensions(item, axis, gridAreaSize);
  // A grid container's automatic block size is its max-content size
  // (css-grid-1 §5.1). Grid-item contributions therefore use block layout in
  // the row axis, not an inline-style min-content constraint. Blink makes the
  // same split: row contributions call BlockContributionSize(), while column
  // contributions call MinContentSize(). Chrome, an empty nested grid with
  // `grid-template-rows: minmax(auto, 1px)` in a 0px-tall auto-min track,
  // contributes 1px in the block axis but the column-axis counterpart stays 0.
  const intrinsicConstraint = axis === 'vertical' ? 'max-content' : 'min-content';
  const measured = measureChildSize(
    item.node,
    knownDimensions,
    gridAreaSize,
    contributionAvailableSpace(availableSpace, intrinsicConstraint),
    'inherent-size',
    axis,
  );
  const measuredWithInset =
    absGet(knownDimensions, axis) === null ? measured + autoInsetLayoutUnitDelta(item, gridAreaSize, axis) : measured;
  const ratioAutomaticMinimum =
    axis === 'horizontal' ? itemRatioAutomaticInlineMinimum(item, gridAreaSize, knownDimensions) : null;
  return Math.max(measuredWithInset, ratioAutomaticMinimum ?? 0);
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
  const knownDimensions = itemContributionKnownDimensions(item, axis, gridAreaSize);
  const measured = measureChildSize(
    item.node,
    knownDimensions,
    gridAreaSize,
    contributionAvailableSpace(availableSpace, 'max-content'),
    'inherent-size',
    axis,
  );
  const measuredWithInset =
    absGet(knownDimensions, axis) === null ? measured + autoInsetLayoutUnitDelta(item, gridAreaSize, axis) : measured;
  const ratioAutomaticMinimum =
    axis === 'horizontal' ? itemRatioAutomaticInlineMinimum(item, gridAreaSize, knownDimensions) : null;
  return Math.max(measuredWithInset, ratioAutomaticMinimum ?? 0);
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
  const padding = resolveGridInsets(item.padding, gridAreaSize.width);
  const border = resolveGridInsets(item.border, gridAreaSize.width);
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = item.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const resolvedStyleSize = maybeResolveSize(item.size, gridAreaSize);
  const resolvedMinSize = maybeResolveSize(item.minSize, gridAreaSize);
  const resolvedMaxSize = maybeResolveSize(item.maxSize, gridAreaSize);
  const preferredSize = maybeAddSize(maybeApplyAspectRatio(resolvedStyleSize, item.aspectRatio), boxSizingAdjustment);
  const minimumSize = maybeAddSize(resolvedMinSize, boxSizingAdjustment);
  const maximumSize = maybeAddSize(resolvedMaxSize, boxSizingAdjustment);
  const transferredMinimumSize = maybeAddSize(
    maybeApplyAspectRatio(resolvedMinSize, item.aspectRatio),
    boxSizingAdjustment,
  );
  const transferredMaximumSize = maybeAddSize(
    maybeApplyAspectRatio(resolvedMaxSize, item.aspectRatio),
    boxSizingAdjustment,
  );

  // Track sizing deliberately leaves the contribution axis's grid-area size
  // indefinite. A percentage minimum therefore cannot resolve yet, but it is
  // still a specified minimum — not `auto` — so it disables the grid item's
  // content-based automatic minimum (css-grid-1 §6.6). Blink similarly keeps
  // percent min lengths distinct from auto while computing contributions.
  // Contribute zero at this intrinsic stage; item layout later resolves the
  // percentage against the final, definite grid area. Chrome, a 1px-tall grid
  // with `min-height: 50%` around 10px text, stretches the item to 1px rather
  // than letting an accidental automatic minimum hold it at 10px.
  const rawMinimum = absGet(item.minSize, axis);
  const unresolvedPercentageMinimum = typeof rawMinimum === 'object' ? 0 : null;
  let size =
    absGet(preferredSize, axis) ??
    unresolvedPercentageMinimum ??
    absGet(transferredMinimumSize, axis) ??
    overflowAutoMinSize(item.overflow);

  if (size === null) {
    // Automatic minimum size. See https://www.w3.org/TR/css-grid-1/#min-size-auto
    const itemAxisTrackRange = itemTrackRangeExcludingLines(item, axis);
    const itemAxisTracks = axisTracks.slice(itemAxisTrackRange.start, itemAxisTrackRange.end);

    // it spans at least one track in that axis whose min track sizing function is auto
    const spansAutoMinTrack = itemAxisTracks.some((track) => track.minTrackSizingFunction === 'auto');
    // if it spans more than one track in that axis, none of those tracks are flexible
    const onlySpanOneTrack = itemAxisTracks.length === 1;
    const spansAFlexibleTrack = itemAxisTracks.some((track) => maxIsFr(track.maxTrackSizingFunction));

    const useContentBasedMinimum = spansAutoMinTrack && (onlySpanOneTrack || !spansAFlexibleTrack);

    size = useContentBasedMinimum ? itemMinContentContributionCached(item, axis, gridAreaSize, gridAreaSize) : 0;
  }

  // The size suggestions are clamped by the item's own min/max size in the
  // affected axis (css-grid-1 §6.6 / css-sizing-3 §5.2.1), with the usual
  // min-beats-max precedence. Without this clamp, `width: 40px;
  // max-width: 10px` contributes 40 to the track where Chrome contributes 10
  // (and 20 when a `min-width: 20px` overrides the max). The content-based
  // branch above measures with the clamp already applied, so re-clamping it
  // here is a no-op for that path.
  const preferredAxisSize = absGet(preferredSize, axis);
  const minimumAxisSize = absGet(minimumSize, axis);
  const maximumAxisSize = absGet(maximumSize, axis);
  const transferredMinimumAxisSize = absGet(transferredMinimumSize, axis);
  const transferredMaximumAxisSize = absGet(transferredMaximumSize, axis);

  // Transferred constraints apply only to an indefinite destination and are
  // bounded by definite constraints already present in that axis (CSS Sizing 4
  // §4.4). Chrome keeps a grid item's `width: 1px` contribution at 1px when
  // `min-height: 97px; aspect-ratio: .5` would otherwise transfer 48.5px; with
  // `width: auto; max-width: 20px`, the same transfer is capped at 20px.
  const transferredMinConstraint =
    minimumAxisSize === null &&
    unresolvedPercentageMinimum === null &&
    preferredAxisSize === null &&
    transferredMinimumAxisSize !== null
      ? Math.min(transferredMinimumAxisSize, maximumAxisSize ?? Infinity)
      : null;
  const minSize = minimumAxisSize ?? transferredMinConstraint;
  const transferredMaxConstraint =
    maximumAxisSize === null && preferredAxisSize === null && transferredMaximumAxisSize !== null
      ? Math.max(transferredMaximumAxisSize, minimumAxisSize ?? 0, minSize ?? 0)
      : null;
  const maxSize = maximumAxisSize ?? transferredMaxConstraint;
  size = vClamp(size, minSize, maxSize);

  // The size suggestion is additionally clamped by the maximum size in the affected axis.
  const limit = itemSpannedFixedTrackLimit(item, axis, axisTracks, absGet(innerNodeSize, axis));

  // The minimum contribution is an *outer* size, and a border box is never
  // smaller than its own padding+border — so the contribution floors at the pb
  // sum even when `overflow: scroll` makes the automatic minimum size 0.
  // Without the floor an auto track based on such an item collapses to the
  // container's free space instead of the pb sum: Chrome sizes the track to 20
  // for a `padding: 10% 20px` scroll item in a 7px grid (percentages drop to 0
  // at this stage and re-resolve against the final area later), the engine
  // sized it to 7. The flexbox §4.5 equivalent floors by padding+border in the
  // same way.
  return Math.max(mMin(size, limit) as number, absGet(paddingBorderSize, axis));
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
