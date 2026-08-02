// The CSS Grid track sizing algorithm.
// https://www.w3.org/TR/css-grid-1/#layout-algorithm

import { unreachable } from '../../assert.js';
import type { AbsoluteAxis, Size } from '../../geometry.js';
import type { Opt } from '../../math.js';
import { mMin } from '../../math.js';
import type { AlignContent, AvailableSpace, Direction } from '../../style.js';
import {
  isScrollContainer,
  maxHasDefiniteValue,
  maxIsFitContent,
  maxIsFr,
  maxIsMaxContentAlike,
  maxIsMaxOrFitContent,
  resolveOrZero,
  trackDefiniteValue,
  trackUsesPercentage,
} from '../../style.js';
import { performChildLayout } from '../dispatch.js';
import type { GridItem, GridTrack, TrackCounts } from './types.js';
import {
  absGet,
  absOther,
  findSizeOfFr,
  fitContentLimit,
  fitContentLimitedGrowthLimit,
  flexFactor,
  itemCrossesFlexibleTrack,
  itemCrossesIntrinsicTrack,
  itemGridAreaSizeCached,
  itemMarginsAxisSumsWithBaselineShims,
  itemMaxContentContributionCached,
  itemMinContentContributionCached,
  itemMinimumContributionCached,
  itemParticipatesInBlockBaselineAlignment,
  itemPlacement,
  itemPlacementIndexes,
  itemSpan,
  itemSpannedTrackLimit,
  itemTrackRangeExcludingLines,
  lineSpan,
  ozLineToNextTrack,
  toBlinkLayoutUnit,
  trackHasIntrinsicSizingFunction,
  trackIsFlexible,
} from './types.js';

/** Whether a minimum or maximum size's space is being distributed */
type IntrinsicContributionType = 'minimum' | 'maximum';

/**
 * Iterates grid items in batches: first non-flex-crossing items grouped by span
 * (ascending), then all flex-crossing items as one final batch.
 */
class ItemBatcher {
  private axis: AbsoluteAxis;
  private indexOffset = 0;
  private currentIsFlex = false;

  constructor(axis: AbsoluteAxis) {
    this.axis = axis;
  }

  next(items: GridItem[]): [GridItem[], boolean] | null {
    if (this.currentIsFlex || this.indexOffset >= items.length) return null;

    const item = items[this.indexOffset] ?? unreachable();
    const currentSpan = itemSpan(item, this.axis);
    this.currentIsFlex = itemCrossesFlexibleTrack(item, this.axis);

    let nextIndexOffset: number;
    if (this.currentIsFlex) {
      nextIndexOffset = items.length;
    } else {
      const idx = items.findIndex(
        (it) => itemCrossesFlexibleTrack(it, this.axis) || itemSpan(it, this.axis) > currentSpan,
      );
      nextIndexOffset = idx === -1 ? items.length : idx;
    }

    const batch = items.slice(this.indexOffset, nextIndexOffset);
    this.indexOffset = nextIndexOffset;
    return [batch, this.currentIsFlex];
  }
}

/** Sort comparator: items not crossing flex tracks first, then by span, then by start line. */
export function cmpByCrossFlexThenSpanThenStart(axis: AbsoluteAxis): (a: GridItem, b: GridItem) => number {
  return (itemA, itemB) => {
    const aFlex = itemCrossesFlexibleTrack(itemA, axis);
    const bFlex = itemCrossesFlexibleTrack(itemB, axis);
    if (!aFlex && bFlex) return -1;
    if (aFlex && !bFlex) return 1;
    const placementA = itemPlacement(itemA, axis);
    const placementB = itemPlacement(itemB, axis);
    const spanDiff = lineSpan(placementA) - lineSpan(placementB);
    if (spanDiff !== 0) return spanDiff;
    return placementA.start - placementB.start;
  };
}

/**
 * Per-gutter additional size adjustment used when estimating other-axis sizes,
 * accounting for align-content/justify-content distribution.
 */
export function computeAlignmentGutterAdjustment(
  alignment: AlignContent,
  axisInnerNodeSize: Opt,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
  tracks: GridTrack[],
): number {
  if (tracks.length <= 1) return 0;

  const keyword = alignment.keyword;
  const outerGutterWeight = keyword === 'stretch' || keyword === 'space-between' ? 0 : 1;
  const innerGutterWeight =
    keyword === 'space-between' ? 1 : keyword === 'space-around' ? 2 : keyword === 'space-evenly' ? 1 : 0;

  if (innerGutterWeight === 0) return 0;

  if (axisInnerNodeSize !== null) {
    let trackSizeSum: Opt = 0;
    for (const track of tracks) {
      const estimate = getTrackSizeEstimate(track, axisInnerNodeSize);
      if (estimate === null) {
        trackSizeSum = null;
        break;
      }
      trackSizeSum += estimate;
    }
    const freeSpace = trackSizeSum !== null ? Math.max(0, axisInnerNodeSize - trackSizeSum) : 0;

    const weightedTrackCount = Math.floor((tracks.length - 3) / 2) * innerGutterWeight + 2 * outerGutterWeight;

    return (freeSpace / weightedTrackCount) * innerGutterWeight;
  }

  return 0;
}

/** Convert origin-zero placements into grid track vector indexes */
export function resolveItemTrackIndexes(items: GridItem[], columnCounts: TrackCounts, rowCounts: TrackCounts): void {
  for (const item of items) {
    item.columnIndexes = {
      start: 2 * ozLineToNextTrack(columnCounts, item.column.start),
      end: 2 * ozLineToNextTrack(columnCounts, item.column.end),
    };
    item.rowIndexes = {
      start: 2 * ozLineToNextTrack(rowCounts, item.row.start),
      end: 2 * ozLineToNextTrack(rowCounts, item.row.end),
    };
  }
}

/** Determine (per axis) whether each item crosses any flexible or intrinsic tracks */
export function determineIfItemCrossesFlexibleOrIntrinsicTracks(
  items: GridItem[],
  columns: GridTrack[],
  rows: GridTrack[],
): void {
  for (const item of items) {
    const colRange = itemTrackRangeExcludingLines(item, 'horizontal');
    const rowRange = itemTrackRangeExcludingLines(item, 'vertical');
    item.crossesFlexibleColumn = columns.slice(colRange.start, colRange.end).some(trackIsFlexible);
    item.crossesIntrinsicColumn = columns.slice(colRange.start, colRange.end).some(trackHasIntrinsicSizingFunction);
    item.crossesFlexibleRow = rows.slice(rowRange.start, rowRange.end).some(trackIsFlexible);
    item.crossesIntrinsicRow = rows.slice(rowRange.start, rowRange.end).some(trackHasIntrinsicSizingFunction);
  }
}

/** Contribution helpers shared by the intrinsic sizing steps */
interface ItemSizer {
  minContentContribution(item: GridItem, axisTracks: GridTrack[]): number;
  maxContentContribution(item: GridItem, axisTracks: GridTrack[]): number;
  minimumContribution(item: GridItem, axisTracks: GridTrack[]): number;
}

function makeItemSizer(
  axis: AbsoluteAxis,
  otherAxisTracks: GridTrack[],
  innerNodeSize: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
  direction: Direction,
): ItemSizer {
  const gridAreaSize = (item: GridItem, axisTracks: GridTrack[]): Size<Opt> =>
    itemGridAreaSizeCached(item, axis, axisTracks, otherAxisTracks, innerNodeSize, getTrackSizeEstimate);

  return {
    minContentContribution(item, axisTracks) {
      const areaSize = gridAreaSize(item, axisTracks);
      const availableSpace: Size<Opt> = { ...areaSize };
      absSetLocal(availableSpace, axis, null);
      const marginAxisSums = itemMarginsAxisSumsWithBaselineShims(item, availableSpace.width);
      const contribution = itemMinContentContributionCached(item, axis, areaSize, availableSpace);
      return contribution + absGet(marginAxisSums, axis);
    },
    maxContentContribution(item, axisTracks) {
      const areaSize = gridAreaSize(item, axisTracks);
      const availableSpace: Size<Opt> = { ...areaSize };
      absSetLocal(availableSpace, axis, null);
      const marginAxisSums = itemMarginsAxisSumsWithBaselineShims(item, availableSpace.width);
      let contribution = itemMaxContentContributionCached(item, axis, areaSize, availableSpace);
      if (
        axis === 'horizontal' &&
        direction === 'rtl' &&
        item.justifySelf.keyword === 'baseline' &&
        !item.justifySelf.safe
      ) {
        // css-align-3 baseline-export makes a horizontal box use vertical-rl
        // for inline-axis baseline synthesis under RTL, so its line-under
        // baseline moves with its width. Blink 151 measures the track baseline
        // at min-content, then adds that contribution-specific delta as the
        // css-grid-1 §11.5.1 baseline shim: 140px max-content text with a 50px
        // min-content width gets a 50 - 140 = -90px shim and contributes 50px.
        contribution = itemMinContentContributionCached(item, axis, areaSize, availableSpace);
      }
      return contribution + absGet(marginAxisSums, axis);
    },
    minimumContribution(item, axisTracks) {
      const areaSize = gridAreaSize(item, axisTracks);
      const availableSpace: Size<Opt> = { ...areaSize };
      absSetLocal(availableSpace, axis, null);
      const marginAxisSums = itemMarginsAxisSumsWithBaselineShims(item, availableSpace.width);
      const contribution = itemMinimumContributionCached(item, axis, axisTracks, areaSize, innerNodeSize);

      // css-grid-1 §11.5.1 allows a different baseline shim for each
      // intrinsic contribution. Blink computes the shim lazily inside the
      // content-size callback. When an automatic minimum resolves directly to
      // zero (notably for a multi-track item crossing a flexible track), that
      // callback is never invoked and the minimum contribution has no shim.
      const preferredAxis = absGet(item.size, axis);
      const preferredOtherAxis = absGet(item.size, absOther(axis));
      const minimumAxis = absGet(item.minSize, axis);
      const minimumOtherAxis = absGet(item.minSize, absOther(axis));
      const hasPreferredSize = preferredAxis !== 'auto' || (item.aspectRatio !== null && preferredOtherAxis !== 'auto');
      const hasTransferredMinimum = item.aspectRatio !== null && minimumAxis === 'auto' && minimumOtherAxis !== 'auto';
      const range = itemTrackRangeExcludingLines(item, axis);
      const tracks = axisTracks.slice(range.start, range.end);
      const usesContentBasedAutomaticMinimum =
        minimumAxis === 'auto' &&
        !hasTransferredMinimum &&
        !isScrollContainer(item.overflow.x) &&
        !isScrollContainer(item.overflow.y) &&
        tracks.some((track) => track.minTrackSizingFunction === 'auto') &&
        (itemSpan(item, axis) === 1 || !itemCrossesFlexibleTrack(item, axis));
      const usesBaselineShim = hasPreferredSize || usesContentBasedAutomaticMinimum;
      const contributionBaselineShim = axis === 'vertical' && !usesBaselineShim ? item.baselineShim : 0;
      return contribution + absGet(marginAxisSums, axis) - contributionBaselineShim;
    },
  };
}

function absSetLocal(size: Size<Opt>, axis: AbsoluteAxis, value: Opt): void {
  if (axis === 'horizontal') size.width = value;
  else size.height = value;
}

/**
 * Track sizing algorithm.
 * Note: gutters are treated as empty fixed-size tracks for the purposes of this algorithm.
 */
export function trackSizingAlgorithm(
  axis: AbsoluteAxis,
  axisMinSize: Opt,
  axisMaxSize: Opt,
  axisAlignment: AlignContent,
  otherAxisAlignment: AlignContent,
  availableGridSpace: Size<AvailableSpace>,
  sizingConstraint: 'min-content' | 'max-content' | null,
  innerNodeSize: Size<Opt>,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  items: GridItem[],
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
  hasBaselineAlignedItem: boolean,
  direction: Direction,
): void {
  // 11.4 Initialise Track sizes
  const percentageBasis = absGet(innerNodeSize, axis) ?? axisMinSize;
  initializeTrackSizes(axisTracks, percentageBasis);

  // Baseline shims depend on the grid item's containing-block width, so they
  // are resolved after this axis's tracks have their used sizes below.
  const resolveBaselines = (): void => {
    if (hasBaselineAlignedItem) resolveItemBaselines(axis, axisTracks, items, innerNodeSize);
  };

  // If all tracks have base_size = growth_limit, skip the rest
  if (axisTracks.every((track) => track.baseSize === track.growthLimit)) {
    resolveBaselines();
    return;
  }

  // Pre-computations for 11.5 Resolve Intrinsic Track Sizes
  const gutterAlignmentAdjustment = computeAlignmentGutterAdjustment(
    otherAxisAlignment,
    absGet(innerNodeSize, absOther(axis)),
    getTrackSizeEstimate,
    otherAxisTracks,
  );
  if (otherAxisTracks.length > 3) {
    for (let i = 2; i < otherAxisTracks.length; i += 2) {
      (otherAxisTracks[i] ?? unreachable()).contentAlignmentAdjustment = gutterAlignmentAdjustment;
    }
  }

  // 11.5 Resolve Intrinsic Track Sizes
  resolveIntrinsicTrackSizes(
    axis,
    axisTracks,
    otherAxisTracks,
    items,
    absGet(availableGridSpace, axis),
    sizingConstraint,
    innerNodeSize,
    getTrackSizeEstimate,
    direction,
  );

  // 11.6. Maximise Tracks
  maximiseTracks(axisTracks, absGet(innerNodeSize, axis), absGet(availableGridSpace, axis));

  // For the final two expansion steps, only expand into space generated by the
  // grid container's size — map definite available space to MaxContent when
  // inner_node_size is None.
  const innerSize = absGet(innerNodeSize, axis);
  const axisAvailableSpaceForExpansion: AvailableSpace =
    innerSize !== null ? innerSize : absGet(availableGridSpace, axis) === 'min-content' ? 'min-content' : 'max-content';

  // 11.7. Expand Flexible Tracks
  const itemSizer = makeItemSizer(axis, otherAxisTracks, innerNodeSize, getTrackSizeEstimate, direction);
  expandFlexibleTracks(axis, axisTracks, itemSizer, items, axisMinSize, axisMaxSize, axisAvailableSpaceForExpansion);

  // 11.8. Stretch auto Tracks
  if (axisAlignment.keyword === 'stretch' && !axisAlignment.safe) {
    // Column tracks are stored in physical order after RTL initialization, so
    // walk them backwards to keep Blink's remainder at logical end.
    stretchAutoTracks(
      axisTracks,
      axisMinSize,
      axisAvailableSpaceForExpansion,
      axis === 'horizontal' && direction === 'rtl',
    );
  }

  resolveBaselines();
}

/** Flush planned base size increases after a round of space distribution */
function flushPlannedBaseSizeIncreases(tracks: GridTrack[]): void {
  for (const track of tracks) {
    track.baseSize += track.baseSizePlannedIncrease;
    track.baseSizePlannedIncrease = 0;
  }
}

/** Flush planned growth limit increases after a round of space distribution */
function flushPlannedGrowthLimitIncreases(tracks: GridTrack[], setInfinitelyGrowable: boolean): void {
  for (const track of tracks) {
    if (track.growthLimitPlannedIncrease > 0) {
      track.growthLimit =
        track.growthLimit === Infinity
          ? track.baseSize + track.growthLimitPlannedIncrease
          : track.growthLimit + track.growthLimitPlannedIncrease;
      track.infinitelyGrowable = setInfinitelyGrowable;
    } else {
      track.infinitelyGrowable = false;
    }
    track.growthLimitPlannedIncrease = 0;
  }
}

/** 11.4 Initialise Track sizes */
function initializeTrackSizes(axisTracks: GridTrack[], axisInnerNodeSize: Opt): void {
  for (const track of axisTracks) {
    if (track.kind === 'gutter') {
      // Grid §11 treats gutters as fixed tracks. Blink 7922 resolves the gap
      // once through MinimumValueForLength into a 1/64px LayoutUnit, then adds
      // that same quantized value between every track. Five 10%-of-1px gutters
      // therefore total 30/64px, not the exact 0.5px.
      const gutterSize = toBlinkLayoutUnit(trackDefiniteValue(track.minTrackSizingFunction, axisInnerNodeSize) ?? 0);
      track.baseSize = gutterSize;
      track.growthLimit = gutterSize;
      continue;
    }
    // Blink stores every resolved fixed track breadth as a 1/64px LayoutUnit
    // before grid areas sum their spanned tracks. This is observable when that
    // area becomes a percentage basis: twelve 5%-of-96px tracks are twelve
    // 4.796875px tracks, so a 20% margin resolves to 11.5px; summing the ideal
    // 4.8px values first resolves the margin to 11.515625px instead.
    const baseSize = trackDefiniteValue(track.minTrackSizingFunction, axisInnerNodeSize) ?? 0;
    const growthLimit = trackDefiniteValue(track.maxTrackSizingFunction, axisInnerNodeSize);
    track.baseSize = toBlinkLayoutUnit(baseSize);
    track.growthLimit = growthLimit === null ? Infinity : toBlinkLayoutUnit(growthLimit);
    if (track.growthLimit < track.baseSize) {
      track.growthLimit = track.baseSize;
    }
  }
}

/** 11.5.1 Shim baseline-aligned items so their contributions reflect baseline alignment */
function resolveItemBaselines(
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  items: GridItem[],
  innerNodeSize: Size<Opt>,
): void {
  for (const item of items) {
    item.baseline = null;
    item.baselineIsSynthesized = false;
    item.baselineShim = 0;
  }

  // Sort items by other-axis (row) start position so we can iterate rows
  const otherAxis = absOther(axis);
  items.sort((a, b) => itemPlacement(a, otherAxis).start - itemPlacement(b, otherAxis).start);

  let index = 0;
  while (index < items.length) {
    const currentRow = itemPlacement(items[index] ?? unreachable(), otherAxis).start;
    let end = index;
    while (end < items.length && itemPlacement(items[end] ?? unreachable(), otherAxis).start === currentRow) end++;
    const rowItems = items.slice(index, end);
    index = end;

    // Grid §10.2 gives block-axis auto margins precedence over align-self, so
    // those items do not enter the baseline-sharing group. Chrome 151 leaves
    // an empty `margin-bottom:auto` item at y=0 beside a 10px baseline item;
    // including it here synthesized a zero baseline and added a 10px shim.
    const baselineCandidates = rowItems.filter(itemParticipatesInBlockBaselineAlignment);
    if (baselineCandidates.length <= 1) continue;

    // Compute baselines only for members of the baseline-sharing group.
    const baselineItems: GridItem[] = [];
    for (const item of baselineCandidates) {
      // css-align-3 baseline-export synthesizes a grid item's baseline from
      // its border edge, so first lay it out against its actual containing
      // block. Chrome 151: 20px + 30% block padding in an 80px grid area gives
      // a 44px baseline, even when the grid container itself is 200px wide.
      const range = itemTrackRangeExcludingLines(item, axis);
      const gridAreaAxisSize = axisTracks
        .slice(range.start, range.end)
        .reduce((sum, track) => sum + track.baseSize + track.contentAlignmentAdjustment, 0);
      const gridAreaSize = { ...innerNodeSize };
      absSetLocal(gridAreaSize, axis, gridAreaAxisSize);

      const measuredSizeAndBaselines = performChildLayout(
        item.node,
        { width: null, height: null },
        gridAreaSize,
        { width: 'min-content', height: 'min-content' },
        'inherent-size',
      );

      const baseline = measuredSizeAndBaselines.firstBaselines.y;
      const height = measuredSizeAndBaselines.size.height;
      if (itemFallsBackFromBlockBaselineAlignment(item, baseline === null)) continue;
      item.baselineIsSynthesized = baseline === null;
      item.baseline = (baseline ?? height) + resolveOrZero(item.margin.top, gridAreaSize.width);
      baselineItems.push(item);
    }

    if (baselineItems.length <= 1) continue;

    // Compute max baseline and shims
    const rowMaxBaseline = baselineItems.reduce((acc, item) => Math.max(acc, item.baseline ?? 0), 0);
    for (const item of baselineItems) {
      item.baselineShim = rowMaxBaseline - (item.baseline ?? 0);
    }
  }
}

/** Recompute shims from baselines measured against final two-axis grid areas. */
export function resolveFinalItemBaselineShims(items: GridItem[]): void {
  items.sort((a, b) => a.row.start - b.row.start);
  let index = 0;
  while (index < items.length) {
    const currentRow = (items[index] ?? unreachable()).row.start;
    let end = index;
    while (end < items.length && (items[end] ?? unreachable()).row.start === currentRow) end++;

    const baselineCandidates = items.slice(index, end).filter(itemParticipatesInBlockBaselineAlignment);
    index = end;
    if (baselineCandidates.length <= 1) continue;

    const baselineItems: GridItem[] = [];
    for (const item of baselineCandidates) {
      item.baselineShim = 0;
      if (itemFallsBackFromBlockBaselineAlignment(item, item.baselineIsSynthesized)) {
        item.baseline = null;
        continue;
      }
      baselineItems.push(item);
    }

    if (baselineItems.length <= 1) continue;
    const rowMaxBaseline = baselineItems.reduce((acc, item) => Math.max(acc, item.baseline ?? 0), 0);
    for (const item of baselineItems) item.baselineShim = rowMaxBaseline - (item.baseline ?? 0);
  }
}

/** CSS Grid §10.3: synthesized percentage-dependent items cannot baseline-align in intrinsic rows. */
function itemFallsBackFromBlockBaselineAlignment(item: GridItem, hasSynthesizedBaseline: boolean): boolean {
  if (!hasSynthesizedBaseline || (!item.crossesIntrinsicRow && !item.crossesFlexibleRow)) return false;
  const blockSizes = [item.size.height, item.minSize.height, item.maxSize.height];
  return blockSizes.some((size) => typeof size === 'object');
}

/** 11.5 Resolve Intrinsic Track Sizes */
function resolveIntrinsicTrackSizes(
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  items: GridItem[],
  _axisAvailableGridSpace: AvailableSpace,
  sizingConstraint: 'min-content' | 'max-content' | null,
  innerNodeSize: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
  direction: Direction,
): void {
  // Step 1 (baseline shims) is already done — see resolveItemBaselines.

  // Step 2: pre-sort items by whether they cross flex tracks, then span, then start
  items.sort(cmpByCrossFlexThenSpanThenStart(axis));

  const axisInnerNodeSize = absGet(innerNodeSize, axis);
  const flexFactorSum = axisTracks.reduce((sum, track) => sum + flexFactor(track), 0);
  const itemSizer = makeItemSizer(axis, otherAxisTracks, innerNodeSize, getTrackSizeEstimate, direction);

  const itemOverflow = (item: GridItem): boolean =>
    isScrollContainer(axis === 'horizontal' ? item.overflow.x : item.overflow.y);

  const batcher = new ItemBatcher(axis);
  let batchResult: [GridItem[], boolean] | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: drain-the-batcher loop; the assignment is the condition.
  while ((batchResult = batcher.next(items)) !== null) {
    const [batch, isFlex] = batchResult;

    // 2. Size tracks to fit non-spanning items (optimized single-span case)
    const batchSpan = lineSpan(itemPlacement(batch[0] ?? unreachable(), axis));
    if (!isFlex && batchSpan === 1) {
      // Tracks this batch sized. A track is sized by its own single-span items,
      // so once they have been considered its growth limit is settled — even if
      // they all contributed 0. Telling that apart from "no items at all", where
      // the limit stays genuinely infinite, is what the flush below needs.
      const sizedByThisBatch = new Set<GridTrack>();
      for (const item of batch) {
        const trackIndex = itemPlacementIndexes(item, axis).start + 1;
        const track = axisTracks[trackIndex] ?? unreachable();
        sizedByThisBatch.add(track);
        const min = track.minTrackSizingFunction;

        // Handle base sizes
        let newBaseSize: number;
        if (min === 'min-content') {
          newBaseSize = Math.max(track.baseSize, itemSizer.minContentContribution(item, axisTracks));
        } else if (typeof min === 'object' && 'percent' in min) {
          // If the container size is indefinite then percentage sized tracks are
          // treated as min-content (matches Chrome)
          newBaseSize =
            axisInnerNodeSize === null
              ? Math.max(track.baseSize, itemSizer.minContentContribution(item, axisTracks))
              : track.baseSize;
        } else if (min === 'max-content') {
          newBaseSize = Math.max(track.baseSize, itemSizer.maxContentContribution(item, axisTracks));
        } else if (min === 'auto') {
          // The vendored Grid §11.5 text asks for a limited min-content
          // contribution under an intrinsic sizing constraint. Blink 7922's
          // track sizer instead applies kForIntrinsicMinimums to auto tracks;
          // CalculateIntrinsicMinimumContribution returns a non-auto authored
          // minimum directly (and has a TODO about ratio transfers). Thus
          // min-width:0 with min-height:1 and aspect-ratio:1 contributes 0 to
          // this track, while the item itself still lays out at 1px and
          // overflows it. An automatic min-width still takes the content-based
          // branch inside minimumContribution, preserving its intrinsic floor.
          const space = itemSizer.minimumContribution(item, axisTracks);
          newBaseSize = Math.max(track.baseSize, space);
        } else {
          // Fixed length — not an intrinsic track sizing function
          newBaseSize = track.baseSize;
        }

        const growthLimitMinContentContribution = !itemOverflow(item)
          ? itemSizer.minContentContribution(item, axisTracks)
          : null;
        const growthLimitMaxContentContribution = itemSizer.maxContentContribution(item, axisTracks);
        const growthLimitIntrinsicMinContentContribution = itemSizer.minContentContribution(item, axisTracks);
        track.baseSize = newBaseSize;

        // Handle growth limits
        if (maxIsFitContent(track.maxTrackSizingFunction)) {
          // For non-scroll-containers, grow to at least the min-content contribution
          if (growthLimitMinContentContribution !== null) {
            track.growthLimitPlannedIncrease = Math.max(
              track.growthLimitPlannedIncrease,
              growthLimitMinContentContribution,
            );
          }
          // Always grow to at least the fit-content-limited max-content contribution
          const fcLimit = fitContentLimit(track, axisInnerNodeSize);
          const maxContentContribution = Math.min(growthLimitMaxContentContribution, fcLimit);
          track.growthLimitPlannedIncrease = Math.max(track.growthLimitPlannedIncrease, maxContentContribution);
        } else if (
          maxIsMaxContentAlike(track.maxTrackSizingFunction) ||
          (trackUsesPercentage(track.maxTrackSizingFunction) && axisInnerNodeSize === null)
        ) {
          // Indefinite container: percentage tracks treated as auto (matches Chrome)
          track.growthLimitPlannedIncrease = Math.max(
            track.growthLimitPlannedIncrease,
            growthLimitMaxContentContribution,
          );
        } else if (
          track.maxTrackSizingFunction === 'min-content' ||
          track.maxTrackSizingFunction === 'max-content' ||
          track.maxTrackSizingFunction === 'auto'
        ) {
          track.growthLimitPlannedIncrease = Math.max(
            track.growthLimitPlannedIncrease,
            growthLimitIntrinsicMinContentContribution,
          );
        }
      }

      for (const track of axisTracks) {
        if (track.growthLimitPlannedIncrease > 0) {
          track.growthLimit =
            track.growthLimit === Infinity
              ? track.growthLimitPlannedIncrease
              : Math.max(track.growthLimit, track.growthLimitPlannedIncrease);
        } else if (track.growthLimit === Infinity && sizedByThisBatch.has(track)) {
          // Every single-span item in this track contributed 0. Its growth
          // limit resolves to that contribution rather than staying infinite:
          // a track whose own items are all zero-sized has nothing left to
          // grow it, so a later spanning item must not treat it as unlimited
          // and take an equal share of the distributed space.
          //
          // Recorded separately from `growthLimit` because "limited at 0" and
          // "no items at all" have to stay distinguishable — see the guard in
          // distributeSpaceUpToLimits, which only honours this when some other
          // spanned track is still growable. When every spanned track is
          // limited, the spec's "distribute space beyond limits" step applies
          // and they all grow equally again.
          track.limitedByZeroContribution = true;
        }
        track.infinitelyGrowable = false;
        track.growthLimitPlannedIncrease = 0;
        if (track.growthLimit < track.baseSize) {
          track.growthLimit = track.baseSize;
        }
      }

      continue;
    }

    const useFlexFactorForDistribution = isFlex && flexFactorSum !== 0;

    // 1. For intrinsic minimums: increase base sizes to accommodate minimum contributions
    for (const item of batch) {
      if (!itemCrossesIntrinsicTrack(item, axis)) continue;

      // Blink 7922 always asks for kForIntrinsicMinimums here, including when
      // the grid itself is under an intrinsic sizing constraint. In
      // particular, a span crossing a flexible track has an automatic minimum
      // of zero (Grid §6.6), so only its outer padding/border floor contributes;
      // substituting its min-content contribution transferred a definite block
      // size through aspect-ratio and inflated a 56px grid to 609px.
      const space = itemSizer.minimumContribution(item, axisTracks);
      const range = itemTrackRangeExcludingLines(item, axis);
      const tracks = axisTracks.slice(range.start, range.end);
      if (space > 0) {
        const hasIntrinsicMinTrackSizingFunction = (track: GridTrack): boolean =>
          trackDefiniteValue(track.minTrackSizingFunction, axisInnerNodeSize) === null;
        if (itemOverflow(item)) {
          distributeItemSpaceToBaseSize(
            isFlex,
            useFlexFactorForDistribution,
            space,
            tracks,
            hasIntrinsicMinTrackSizingFunction,
            (track) => fitContentLimitedGrowthLimit(track, axisInnerNodeSize),
            'minimum',
          );
        } else {
          distributeItemSpaceToBaseSize(
            isFlex,
            useFlexFactorForDistribution,
            space,
            tracks,
            hasIntrinsicMinTrackSizingFunction,
            (track) => track.growthLimit,
            'minimum',
          );
        }
      }
    }
    flushPlannedBaseSizeIncreases(axisTracks);

    // 2. For content-based minimums: min-content contributions to min/max-content min tracks
    const hasMinOrMaxContentMinTrackSizingFunction = (track: GridTrack): boolean =>
      track.minTrackSizingFunction === 'min-content' || track.minTrackSizingFunction === 'max-content';
    for (const item of batch) {
      const space = itemSizer.minContentContribution(item, axisTracks);
      const range = itemTrackRangeExcludingLines(item, axis);
      const tracks = axisTracks.slice(range.start, range.end);
      if (space > 0) {
        if (itemOverflow(item)) {
          distributeItemSpaceToBaseSize(
            isFlex,
            useFlexFactorForDistribution,
            space,
            tracks,
            hasMinOrMaxContentMinTrackSizingFunction,
            (track) => fitContentLimitedGrowthLimit(track, axisInnerNodeSize),
            'minimum',
          );
        } else {
          distributeItemSpaceToBaseSize(
            isFlex,
            useFlexFactorForDistribution,
            space,
            tracks,
            hasMinOrMaxContentMinTrackSizingFunction,
            (track) => track.growthLimit,
            'minimum',
          );
        }
      }
    }
    flushPlannedBaseSizeIncreases(axisTracks);

    // 3. For max-content minimums (only under a max-content constraint)
    if (sizingConstraint === 'max-content') {
      const hasMaxContentMinTrackSizingFunction = (track: GridTrack): boolean =>
        track.minTrackSizingFunction === 'max-content';

      for (const item of batch) {
        const axisMaxContentSize = itemSizer.maxContentContribution(item, axisTracks);
        const limit = itemSpannedTrackLimit(item, axis, axisTracks, axisInnerNodeSize);
        const space = mMin(axisMaxContentSize, limit) as number;
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        if (space > 0 && tracks.some(hasMaxContentMinTrackSizingFunction)) {
          // The vendored Grid §11.5 text includes `auto` minima under a
          // max-content constraint, but pinned Blink 7922 explicitly does not:
          // IsContributionAppliedToSet(kForMaxContentMinimums) has a TODO for
          // that rule and selects only HasMaxContentMinTrackBreadth. Match the
          // oracle. Promoting `minmax(auto, .5fr)` from a 10px min-content base
          // to its 20px max-content contribution prevents §11.7's partial fill
          // from ever producing Chrome's final 10px track.
          distributeItemSpaceToBaseSize(
            isFlex,
            useFlexFactorForDistribution,
            space,
            tracks,
            hasMaxContentMinTrackSizingFunction,
            () => Infinity,
            'maximum',
          );
        }
      }
      flushPlannedBaseSizeIncreases(axisTracks);
    }

    // In all cases, increase max-content-min tracks by max-content contributions
    const hasMaxContentMinTrackSizingFunction = (track: GridTrack): boolean =>
      track.minTrackSizingFunction === 'max-content';
    for (const item of batch) {
      const space = itemSizer.maxContentContribution(item, axisTracks);
      const range = itemTrackRangeExcludingLines(item, axis);
      const tracks = axisTracks.slice(range.start, range.end);
      if (space > 0) {
        distributeItemSpaceToBaseSize(
          isFlex,
          useFlexFactorForDistribution,
          space,
          tracks,
          hasMaxContentMinTrackSizingFunction,
          (track) => track.growthLimit,
          'maximum',
        );
      }
    }
    flushPlannedBaseSizeIncreases(axisTracks);

    // 4. Growth limits floored by base sizes
    for (const track of axisTracks) {
      if (track.growthLimit < track.baseSize) {
        track.growthLimit = track.baseSize;
      }
    }

    if (!isFlex) {
      // 5. For intrinsic maximums: grow growth limits by min-content contributions
      const hasIntrinsicMaxTrackSizingFunction = (track: GridTrack): boolean =>
        !maxHasDefiniteValue(track.maxTrackSizingFunction, axisInnerNodeSize);
      const intrinsicMaxTracksAccommodatingThisBatch = new Set<GridTrack>();
      for (const item of batch) {
        const space = itemSizer.minContentContribution(item, axisTracks);
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        for (const track of tracks) {
          if (hasIntrinsicMaxTrackSizingFunction(track)) intrinsicMaxTracksAccommodatingThisBatch.add(track);
        }
        if (space > 0) {
          distributeItemSpaceToGrowthLimit(space, tracks, hasIntrinsicMaxTrackSizingFunction, axisInnerNodeSize);
        }
      }
      // Blink initializes the planned increase of every intrinsic-max track
      // crossed by an item in this span batch, even when that item's
      // contribution is zero. This makes the track's infinite growth limit
      // definite before a later, wider-span batch is processed. Chrome 151:
      // a zero-height span-2 item followed by a 130px span-3 item keeps its
      // two rows at 0; only the third row receives the 130px contribution.
      for (const track of intrinsicMaxTracksAccommodatingThisBatch) {
        if (track.growthLimit === Infinity && track.growthLimitPlannedIncrease === 0) {
          track.limitedByZeroContribution = true;
        }
      }
      // Mark tracks whose growth limit changed from infinite to finite as infinitely growable
      flushPlannedGrowthLimitIncreases(axisTracks, true);

      // 6. For max-content maximums: grow growth limits by max-content contributions
      const hasMaxContentMaxTrackSizingFunction = (track: GridTrack): boolean =>
        maxIsMaxContentAlike(track.maxTrackSizingFunction) ||
        (trackUsesPercentage(track.maxTrackSizingFunction) && axisInnerNodeSize === null);
      for (const item of batch) {
        const space = itemSizer.maxContentContribution(item, axisTracks);
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        if (space > 0) {
          distributeItemSpaceToGrowthLimit(space, tracks, hasMaxContentMaxTrackSizingFunction, axisInnerNodeSize);
        }
      }
      flushPlannedGrowthLimitIncreases(axisTracks, false);
    }
  }

  // Step 5. Any track that still has an infinite growth limit: set it to its base size.
  for (const track of axisTracks) {
    if (track.growthLimit === Infinity) {
      track.growthLimit = track.baseSize;
    }
  }
}

/** 11.5.1. Distributing Extra Space Across Spanned Tracks (base sizes) */
function distributeItemSpaceToBaseSize(
  isFlex: boolean,
  useFlexFactorForDistribution: boolean,
  space: number,
  tracks: GridTrack[],
  trackIsAffected: (track: GridTrack) => boolean,
  trackLimit: (track: GridTrack) => number,
  intrinsicContributionType: IntrinsicContributionType,
): void {
  let affected: (track: GridTrack) => boolean;
  let distributionProportion: (track: GridTrack) => number;
  if (isFlex) {
    affected = (track) => trackIsFlexible(track) && trackIsAffected(track);
    distributionProportion = useFlexFactorForDistribution ? (track) => flexFactor(track) : () => 1;
  } else {
    affected = trackIsAffected;
    distributionProportion = () => 1;
  }

  // Skip if there is no space or no affected tracks
  if (space === 0 || !tracks.some(affected)) return;

  const getBaseSize = (track: GridTrack): number => track.baseSize;
  // A zero-contribution track has no up-to-limits growth potential, but it
  // remains affected. Grid §11.5.1 unfreezes every affected intrinsic-max
  // track when distributing beyond limits; Blink's BeyondLimitsGrowthPotential
  // likewise returns infinity for every base-size contribution. Filtering the
  // track out here incorrectly excludes it from that second phase: Chrome 151
  // splits the remaining 103px of a 175px span equally over base sizes [0, 72],
  // producing [51.5, 123.5], rather than assigning all 103px to the second track.
  const effectiveTrackLimit = (track: GridTrack): number =>
    track.limitedByZeroContribution ? track.baseSize : trackLimit(track);

  // 1. Find the space to distribute
  const trackSizes = tracks.reduce((sum, track) => sum + track.baseSize, 0);
  let extraSpace = Math.max(0, space - trackSizes);

  // 2. Distribute space up to limits
  const THRESHOLD = 0.000001;
  extraSpace = distributeSpaceUpToLimits(
    extraSpace,
    tracks,
    affected,
    distributionProportion,
    getBaseSize,
    effectiveTrackLimit,
  );

  // 3. Distribute remaining space beyond limits (if any)
  if (extraSpace > THRESHOLD) {
    const preferredBeyondLimitTrack: (track: GridTrack) => boolean =
      intrinsicContributionType === 'minimum'
        ? (track) => maxIsIntrinsicLocal(track)
        : (track) =>
            track.minTrackSizingFunction === 'max-content' || maxIsMaxOrFitContent(track.maxTrackSizingFunction);
    const preferredAffectedTrack = (track: GridTrack): boolean => affected(track) && preferredBeyondLimitTrack(track);
    const beyondLimitTrack = tracks.some(preferredAffectedTrack) ? preferredAffectedTrack : affected;

    // css-grid-1 §11.5.1 explicitly unfreezes base sizes here. Their growth
    // limits constrained the first distribution, but no longer cap this one;
    // Blink's BeyondLimitsGrowthPotential likewise returns infinity for every
    // base-size contribution. Keep the selection within the affected tracks:
    // a fixed sibling row is never eligible merely because no preferred
    // intrinsic-max track exists.
    distributeSpaceUpToLimits(
      extraSpace,
      tracks,
      beyondLimitTrack,
      distributionProportion,
      getBaseSize,
      () => Infinity,
    );
  }

  // 4. Promote item-incurred increases to planned increases
  for (const track of tracks) {
    if (track.itemIncurredIncrease > track.baseSizePlannedIncrease) {
      track.baseSizePlannedIncrease = track.itemIncurredIncrease;
    }
    track.itemIncurredIncrease = 0;
  }
}

function maxIsIntrinsicLocal(track: GridTrack): boolean {
  const max = track.maxTrackSizingFunction;
  return (
    max === 'auto' || max === 'min-content' || max === 'max-content' || (typeof max === 'object' && 'fitContent' in max)
  );
}

/** 11.5.1. Distributing Extra Space Across Spanned Tracks (growth limits, simplified) */
function distributeItemSpaceToGrowthLimit(
  space: number,
  tracks: GridTrack[],
  trackIsAffected: (track: GridTrack) => boolean,
  axisInnerNodeSize: Opt,
): void {
  // Skip if no space or no affected tracks
  if (space === 0 || tracks.filter(trackIsAffected).length === 0) return;

  // 1. Find the space to distribute
  const trackSizes = tracks.reduce(
    (sum, track) => sum + (track.growthLimit === Infinity ? track.baseSize : track.growthLimit),
    0,
  );
  const extraSpace = Math.max(0, space - trackSizes);

  // 2. Distribute space up to limits
  const isGrowable = (track: GridTrack): boolean =>
    track.infinitelyGrowable || fitContentLimitedGrowthLimit(track, axisInnerNodeSize) === Infinity;
  const growableTracks = tracks.filter(trackIsAffected).filter(isGrowable);
  if (growableTracks.length > 0) {
    const itemIncurredIncrease = extraSpace / growableTracks.length;
    for (const track of growableTracks) {
      track.itemIncurredIncrease = itemIncurredIncrease;
    }
  } else {
    // 3. Distribute space beyond limits
    distributeSpaceUpToLimits(
      extraSpace,
      tracks,
      trackIsAffected,
      () => 1,
      (track) => (track.growthLimit === Infinity ? track.baseSize : track.growthLimit),
      (track) => fitContentLimit(track, axisInnerNodeSize),
    );
  }

  // 4. Promote item-incurred increases to planned increases
  for (const track of tracks) {
    if (track.itemIncurredIncrease > track.growthLimitPlannedIncrease) {
      track.growthLimitPlannedIncrease = track.itemIncurredIncrease;
    }
    track.itemIncurredIncrease = 0;
  }
}

/** 11.6 Maximise Tracks */
function maximiseTracks(axisTracks: GridTrack[], axisInnerNodeSize: Opt, axisAvailableGridSpace: AvailableSpace): void {
  const usedSpace = axisTracks.reduce((sum, track) => sum + track.baseSize, 0);
  const freeSpace =
    axisAvailableGridSpace === 'max-content'
      ? Infinity
      : axisAvailableGridSpace === 'min-content'
        ? 0
        : axisAvailableGridSpace - usedSpace;

  if (freeSpace === Infinity) {
    for (const track of axisTracks) track.baseSize = track.growthLimit;
  } else if (freeSpace > 0) {
    distributeSpaceUpToLimits(
      freeSpace,
      axisTracks,
      () => true,
      () => 1,
      (track) => track.baseSize,
      (track) => fitContentLimitedGrowthLimit(track, axisInnerNodeSize),
    );
    for (const track of axisTracks) {
      track.baseSize += track.itemIncurredIncrease;
      track.itemIncurredIncrease = 0;
    }
  }
}

/** 11.7. Expand Flexible Tracks */
function expandFlexibleTracks(
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  itemSizer: ItemSizer,
  items: GridItem[],
  axisMinSize: Opt,
  axisMaxSize: Opt,
  axisAvailableSpaceForExpansion: AvailableSpace,
): void {
  // First, find the grid's used flex fraction
  let flexFraction: number;
  if (typeof axisAvailableSpaceForExpansion === 'number') {
    const availableSpace = axisAvailableSpaceForExpansion;
    const usedSpace = axisTracks.reduce((sum, track) => sum + track.baseSize, 0);
    const freeSpace = availableSpace - usedSpace;
    flexFraction = freeSpace <= 0 ? 0 : findSizeOfFr(axisTracks, availableSpace);
  } else if (axisAvailableSpaceForExpansion === 'min-content') {
    flexFraction = 0;
  } else {
    // Indefinite free space
    const trackBasedFraction = axisTracks
      .filter((track) => maxIsFr(track.maxTrackSizingFunction))
      .reduce((acc, track) => {
        const factor = flexFactor(track);
        const value = factor > 1 ? track.baseSize / factor : track.baseSize;
        return Math.max(acc, value);
      }, 0);
    const itemBasedFraction = items
      .filter((item) => itemCrossesFlexibleTrack(item, axis))
      .reduce((acc, item) => {
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        const maxContentContribution = itemSizer.maxContentContribution(item, axisTracks);
        return Math.max(acc, findSizeOfFr(tracks, maxContentContribution));
      }, 0);
    let fraction = Math.max(trackBasedFraction, itemBasedFraction);

    // Redo treating free space as definite if the result violates the container's min/max size
    const hypotheticalGridSize = axisTracks.reduce((sum, track) => {
      if (maxIsFr(track.maxTrackSizingFunction)) {
        return sum + Math.max(track.baseSize, track.maxTrackSizingFunction.fr * fraction);
      }
      return sum + track.baseSize;
    }, 0);
    const minSize = axisMinSize ?? 0;
    const maxSize = axisMaxSize ?? Infinity;
    if (hypotheticalGridSize < minSize) {
      fraction = findSizeOfFr(axisTracks, minSize);
    } else if (hypotheticalGridSize > maxSize) {
      fraction = findSizeOfFr(axisTracks, maxSize);
    }
    flexFraction = fraction;
  }

  // For each flexible track, apply the used flex fraction
  for (const track of axisTracks) {
    if (maxIsFr(track.maxTrackSizingFunction)) {
      track.baseSize = Math.max(track.baseSize, track.maxTrackSizingFunction.fr * flexFraction);
    }
  }
}

/** 11.8. Stretch auto Tracks */
function stretchAutoTracks(
  axisTracks: GridTrack[],
  axisMinSize: Opt,
  axisAvailableSpaceForExpansion: AvailableSpace,
  remainderTowardPhysicalStart: boolean,
): void {
  const autoTracks = axisTracks.filter((track) => track.maxTrackSizingFunction === 'auto');
  if (autoTracks.length === 0) return;

  const usedSpace = axisTracks.reduce((sum, track) => sum + track.baseSize, 0);

  // With indefinite free space, use the definite min-width/height instead (if any)
  const freeSpace =
    typeof axisAvailableSpaceForExpansion === 'number'
      ? axisAvailableSpaceForExpansion - usedSpace
      : axisMinSize !== null
        ? axisMinSize - usedSpace
        : 0;
  if (freeSpace > 0) {
    // Grid §11.8 divides free space equally, but Blink 7922 performs each
    // share in integer 1/64px LayoutUnits and gives the discarded remainder
    // to later tracks. With six auto tracks in 1px, the first three receive
    // 31/64px and the last three 33/64px; exact floating halves put the middle
    // line at .5px and paint a `grid-column: 4 / span 3` item one pixel late.
    const scaledFreeSpace = freeSpace * 64;
    const nearestLayoutUnit = Math.round(scaledFreeSpace);
    const stableScaledFreeSpace =
      Math.abs(scaledFreeSpace - nearestLayoutUnit) <= Number.EPSILON * Math.max(1, Math.abs(scaledFreeSpace)) * 4
        ? nearestLayoutUnit
        : scaledFreeSpace;
    let remainingFreeSpace = Math.trunc(stableScaledFreeSpace);
    let remainingFreeSpaceValue = freeSpace;
    let remainingTrackCount = autoTracks.length;
    const tracksInDistributionOrder = remainderTowardPhysicalStart ? autoTracks.reverse() : autoTracks;
    for (const track of tracksInDistributionOrder) {
      const extraSpace = Math.trunc(remainingFreeSpace / remainingTrackCount);
      const extraSpaceValue = remainingTrackCount === 1 ? remainingFreeSpaceValue : extraSpace / 64;
      track.baseSize += extraSpaceValue;
      remainingFreeSpace -= extraSpace;
      remainingFreeSpaceValue -= extraSpaceValue;
      remainingTrackCount--;
    }
  }
}

/** Helper for distributing space to tracks evenly (up to per-track limits) */
function distributeSpaceUpToLimits(
  spaceToDistribute: number,
  tracks: GridTrack[],
  trackIsAffected: (track: GridTrack) => boolean,
  trackDistributionProportion: (track: GridTrack) => number,
  trackAffectedProperty: (track: GridTrack) => number,
  trackLimit: (track: GridTrack) => number,
): number {
  const THRESHOLD = 0.01;

  let remaining = spaceToDistribute;
  while (remaining > THRESHOLD) {
    const growable = tracks.filter(
      (track) =>
        trackAffectedProperty(track) + track.itemIncurredIncrease < trackLimit(track) && trackIsAffected(track),
    );

    const proportionSum = growable.reduce((sum, track) => sum + trackDistributionProportion(track), 0);
    if (proportionSum === 0) break;

    // Compute item-incurred increase for this iteration
    const minIncreaseLimit = growable.reduce(
      (acc, track) =>
        Math.min(
          acc,
          (trackLimit(track) - trackAffectedProperty(track) - track.itemIncurredIncrease) /
            trackDistributionProportion(track),
        ),
      Infinity,
    );
    const iterationItemIncurredIncrease = Math.min(minIncreaseLimit, remaining / proportionSum);

    for (const track of tracks) {
      if (!trackIsAffected(track)) continue;
      const increase = iterationItemIncurredIncrease * trackDistributionProportion(track);
      if (
        increase > 0 &&
        trackAffectedProperty(track) + track.itemIncurredIncrease + increase <= trackLimit(track) + THRESHOLD
      ) {
        track.itemIncurredIncrease += increase;
        remaining -= increase;
      }
    }
  }

  return remaining;
}
