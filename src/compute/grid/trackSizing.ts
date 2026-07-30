// Port of taffy/src/compute/grid/track_sizing.rs — the CSS Grid track sizing algorithm.
// https://www.w3.org/TR/css-grid-1/#layout-algorithm

import type { AbsoluteAxis, Size } from '../../geometry.js';
import { mMin } from '../../math.js';
import type { Opt } from '../../math.js';
import {
  isScrollContainer,
  maxDefiniteLimit,
  maxHasDefiniteValue,
  maxIsFr,
  maxIsFitContent,
  maxIsMaxContentAlike,
  maxIsMaxOrFitContent,
  resolveOrZero,
  trackDefiniteValue,
  trackUsesPercentage,
} from '../../style.js';
import type { AlignContent, AvailableSpace } from '../../style.js';
import { performChildLayout } from '../dispatch.js';
import {
  absGet,
  absOther,
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
  itemPlacement,
  itemPlacementIndexes,
  itemSpan,
  itemSpannedTrackLimit,
  itemTrackRangeExcludingLines,
  lineSpan,
  ozLineToNextTrack,
  trackHasIntrinsicSizingFunction,
  trackIsFlexible,
} from './types.js';
import type { GridItem, GridTrack, TrackCounts } from './types.js';

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

    const item = items[this.indexOffset]!;
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
  const outerGutterWeight =
    keyword === 'stretch' || keyword === 'space-between' ? 0 : 1;
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

/** Contribution helpers shared by the intrinsic sizing steps (IntrinsicSizeMeasurer in taffy) */
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
      const contribution = itemMaxContentContributionCached(item, axis, areaSize, availableSpace);
      return contribution + absGet(marginAxisSums, axis);
    },
    minimumContribution(item, axisTracks) {
      const areaSize = gridAreaSize(item, axisTracks);
      const availableSpace: Size<Opt> = { ...areaSize };
      absSetLocal(availableSpace, axis, null);
      const marginAxisSums = itemMarginsAxisSumsWithBaselineShims(item, availableSpace.width);
      const contribution = itemMinimumContributionCached(item, axis, axisTracks, areaSize, innerNodeSize);
      return contribution + absGet(marginAxisSums, axis);
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
  innerNodeSize: Size<Opt>,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  items: GridItem[],
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
  hasBaselineAlignedItem: boolean,
): void {
  // 11.4 Initialise Track sizes
  const percentageBasis = absGet(innerNodeSize, axis) ?? axisMinSize;
  initializeTrackSizes(axisTracks, percentageBasis);

  // 11.5.1 Shim item baselines
  if (hasBaselineAlignedItem) {
    resolveItemBaselines(axis, items, innerNodeSize);
  }

  // If all tracks have base_size = growth_limit, skip the rest
  if (axisTracks.every((track) => track.baseSize === track.growthLimit)) {
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
      otherAxisTracks[i]!.contentAlignmentAdjustment = gutterAlignmentAdjustment;
    }
  }

  // 11.5 Resolve Intrinsic Track Sizes
  resolveIntrinsicTrackSizes(
    axis,
    axisTracks,
    otherAxisTracks,
    items,
    absGet(availableGridSpace, axis),
    innerNodeSize,
    getTrackSizeEstimate,
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
  expandFlexibleTracks(axis, axisTracks, items, axisMinSize, axisMaxSize, axisAvailableSpaceForExpansion);

  // 11.8. Stretch auto Tracks
  if (axisAlignment.keyword === 'stretch' && !axisAlignment.safe) {
    stretchAutoTracks(axisTracks, axisMinSize, axisAvailableSpaceForExpansion);
  }
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
    track.baseSize = trackDefiniteValue(track.minTrackSizingFunction, axisInnerNodeSize) ?? 0;
    track.growthLimit = trackDefiniteValue(track.maxTrackSizingFunction, axisInnerNodeSize) ?? Infinity;
    if (track.growthLimit < track.baseSize) {
      track.growthLimit = track.baseSize;
    }
  }
}

/** 11.5.1 Shim baseline-aligned items so their contributions reflect baseline alignment */
function resolveItemBaselines(axis: AbsoluteAxis, items: GridItem[], innerNodeSize: Size<Opt>): void {
  // Sort items by other-axis (row) start position so we can iterate rows
  const otherAxis = absOther(axis);
  items.sort((a, b) => itemPlacement(a, otherAxis).start - itemPlacement(b, otherAxis).start);

  let index = 0;
  while (index < items.length) {
    const currentRow = itemPlacement(items[index]!, otherAxis).start;
    let end = index;
    while (end < items.length && itemPlacement(items[end]!, otherAxis).start === currentRow) end++;
    const rowItems = items.slice(index, end);
    index = end;

    // Baseline alignment is a no-op for rows with <= 1 baseline-aligned item
    const rowBaselineItemCount = rowItems.filter(
      (item) => item.alignSelf.keyword === 'baseline' && !item.alignSelf.safe,
    ).length;
    if (rowBaselineItemCount <= 1) continue;

    // Compute baselines of all items in the row
    for (const item of rowItems) {
      const measuredSizeAndBaselines = performChildLayout(
        item.node,
        { width: null, height: null },
        innerNodeSize,
        { width: 'min-content', height: 'min-content' },
        'inherent-size',
      );

      const baseline = measuredSizeAndBaselines.firstBaselines.y;
      const height = measuredSizeAndBaselines.size.height;
      item.baseline = (baseline ?? height) + resolveOrZero(item.margin.top, innerNodeSize.width);
    }

    // Compute max baseline and shims
    const rowMaxBaseline = rowItems.reduce((acc, item) => Math.max(acc, item.baseline ?? 0), 0);
    for (const item of rowItems) {
      item.baselineShim = rowMaxBaseline - (item.baseline ?? 0);
    }
  }
}

/** 11.5 Resolve Intrinsic Track Sizes */
function resolveIntrinsicTrackSizes(
  axis: AbsoluteAxis,
  axisTracks: GridTrack[],
  otherAxisTracks: GridTrack[],
  items: GridItem[],
  axisAvailableGridSpace: AvailableSpace,
  innerNodeSize: Size<Opt>,
  getTrackSizeEstimate: (track: GridTrack, availableSpace: Opt) => Opt,
): void {
  // Step 1 (baseline shims) is already done — see resolveItemBaselines.

  // Step 2: pre-sort items by whether they cross flex tracks, then span, then start
  items.sort(cmpByCrossFlexThenSpanThenStart(axis));

  const axisInnerNodeSize = absGet(innerNodeSize, axis);
  const flexFactorSum = axisTracks.reduce((sum, track) => sum + flexFactor(track), 0);
  const itemSizer = makeItemSizer(axis, otherAxisTracks, innerNodeSize, getTrackSizeEstimate);

  const itemOverflow = (item: GridItem): boolean =>
    isScrollContainer(axis === 'horizontal' ? item.overflow.x : item.overflow.y);

  const batcher = new ItemBatcher(axis);
  let batchResult: [GridItem[], boolean] | null;
  while ((batchResult = batcher.next(items)) !== null) {
    const [batch, isFlex] = batchResult;

    // 2. Size tracks to fit non-spanning items (optimized single-span case)
    const batchSpan = lineSpan(itemPlacement(batch[0]!, axis));
    if (!isFlex && batchSpan === 1) {
      for (const item of batch) {
        const trackIndex = itemPlacementIndexes(item, axis).start + 1;
        const track = axisTracks[trackIndex]!;
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
          let space: number;
          if (
            (axisAvailableGridSpace === 'min-content' || axisAvailableGridSpace === 'max-content') &&
            !itemOverflow(item)
          ) {
            // QUIRK: browsers only apply the "limited min-content contribution" rule
            // when the item is not a scroll container.
            const axisMinimumSize = itemSizer.minimumContribution(item, axisTracks);
            const axisMinContentSize = itemSizer.minContentContribution(item, axisTracks);
            const limit = maxDefiniteLimit(track.maxTrackSizingFunction, axisInnerNodeSize);
            space = Math.max(mMin(axisMinContentSize, limit) as number, axisMinimumSize);
          } else {
            space = itemSizer.minimumContribution(item, axisTracks);
          }
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

      let space: number;
      if (
        (axisAvailableGridSpace === 'min-content' || axisAvailableGridSpace === 'max-content') &&
        !itemOverflow(item)
      ) {
        const axisMinimumSize = itemSizer.minimumContribution(item, axisTracks);
        const axisMinContentSize = itemSizer.minContentContribution(item, axisTracks);
        const limit = itemSpannedTrackLimit(item, axis, axisTracks, axisInnerNodeSize);
        space = Math.max(mMin(axisMinContentSize, limit) as number, axisMinimumSize);
      } else {
        space = itemSizer.minimumContribution(item, axisTracks);
      }
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
    if (axisAvailableGridSpace === 'max-content') {
      const hasAutoMinTrackSizingFunction = (track: GridTrack): boolean =>
        track.minTrackSizingFunction === 'auto' && track.maxTrackSizingFunction !== 'min-content';
      const hasMaxContentMinTrackSizingFunction = (track: GridTrack): boolean =>
        track.minTrackSizingFunction === 'max-content';

      for (const item of batch) {
        const axisMaxContentSize = itemSizer.maxContentContribution(item, axisTracks);
        const limit = itemSpannedTrackLimit(item, axis, axisTracks, axisInnerNodeSize);
        const space = mMin(axisMaxContentSize, limit) as number;
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        if (space > 0) {
          // Prioritise distributing space to max-content min tracks (matches Chrome/Firefox)
          if (tracks.some(hasMaxContentMinTrackSizingFunction)) {
            distributeItemSpaceToBaseSize(
              isFlex,
              useFlexFactorForDistribution,
              space,
              tracks,
              hasMaxContentMinTrackSizingFunction,
              () => Infinity,
              'maximum',
            );
          } else {
            distributeItemSpaceToBaseSize(
              isFlex,
              useFlexFactorForDistribution,
              space,
              tracks,
              hasAutoMinTrackSizingFunction,
              (track) => fitContentLimitedGrowthLimit(track, axisInnerNodeSize),
              'maximum',
            );
          }
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
      for (const item of batch) {
        const space = itemSizer.minContentContribution(item, axisTracks);
        const range = itemTrackRangeExcludingLines(item, axis);
        const tracks = axisTracks.slice(range.start, range.end);
        if (space > 0) {
          distributeItemSpaceToGrowthLimit(space, tracks, hasIntrinsicMaxTrackSizingFunction, axisInnerNodeSize);
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

  // 1. Find the space to distribute
  const trackSizes = tracks.reduce((sum, track) => sum + track.baseSize, 0);
  let extraSpace = Math.max(0, space - trackSizes);

  // 2. Distribute space up to limits
  const THRESHOLD = 0.000001;
  extraSpace = distributeSpaceUpToLimits(extraSpace, tracks, affected, distributionProportion, getBaseSize, trackLimit);

  // 3. Distribute remaining space beyond limits (if any)
  if (extraSpace > THRESHOLD) {
    let filter: (track: GridTrack) => boolean =
      intrinsicContributionType === 'minimum'
        ? (track) => maxIsIntrinsicLocal(track)
        : (track) =>
            track.minTrackSizingFunction === 'max-content' || maxIsMaxOrFitContent(track.maxTrackSizingFunction);

    const numberOfTracks = tracks.filter(affected).filter(filter).length;
    if (numberOfTracks === 0) {
      filter = () => true;
    }

    distributeSpaceUpToLimits(extraSpace, tracks, filter, distributionProportion, getBaseSize, trackLimit);
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
function maximiseTracks(
  axisTracks: GridTrack[],
  axisInnerNodeSize: Opt,
  axisAvailableGridSpace: AvailableSpace,
): void {
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
        const maxContentContribution = itemMaxContentContributionCached(
          item,
          axis,
          { width: null, height: null },
          { width: null, height: null },
        );
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

/** 11.7.1. Find the Size of an fr */
function findSizeOfFr(tracks: GridTrack[], spaceToFill: number): number {
  // Trivial case — do not remove (the loop below would loop infinitely).
  // The same applies to a non-finite `spaceToFill`: the validity test below is
  // a set of comparisons, and every comparison with NaN is false, so the loop
  // could never terminate. Returning 0 keeps a bad input from becoming a hang.
  if (spaceToFill === 0 || !Number.isFinite(spaceToFill)) return 0;

  let hypotheticalFrSize = Infinity;
  let previousIterHypotheticalFrSize: number;
  for (;;) {
    let usedSpace = 0;
    let naiveFlexFactorSum = 0;
    for (const track of tracks) {
      // Tracks with flex_factor * hypothetical_fr_size < base_size are treated as inflexible
      if (
        maxIsFr(track.maxTrackSizingFunction) &&
        track.maxTrackSizingFunction.fr * hypotheticalFrSize >= track.baseSize
      ) {
        naiveFlexFactorSum += track.maxTrackSizingFunction.fr;
      } else {
        usedSpace += track.baseSize;
      }
    }
    const leftoverSpace = spaceToFill - usedSpace;
    const totalFlexFactor = Math.max(naiveFlexFactorSum, 1);

    previousIterHypotheticalFrSize = hypotheticalFrSize;
    hypotheticalFrSize = leftoverSpace / totalFlexFactor;

    const hypotheticalFrSizeIsValid = tracks.every((track) => {
      if (maxIsFr(track.maxTrackSizingFunction)) {
        const factor = track.maxTrackSizingFunction.fr;
        return (
          factor * hypotheticalFrSize >= track.baseSize || factor * previousIterHypotheticalFrSize < track.baseSize
        );
      }
      return true;
    });
    if (hypotheticalFrSizeIsValid) break;
  }

  return hypotheticalFrSize;
}

/** 11.8. Stretch auto Tracks */
function stretchAutoTracks(
  axisTracks: GridTrack[],
  axisMinSize: Opt,
  axisAvailableSpaceForExpansion: AvailableSpace,
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
    const extraSpacePerAutoTrack = freeSpace / autoTracks.length;
    for (const track of autoTracks) {
      track.baseSize += extraSpacePerAutoTrack;
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
