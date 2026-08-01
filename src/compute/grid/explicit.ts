// The explicit grid: track counts and sizes from grid-template-* (named lines
// not implemented).

import type { AbsoluteAxis } from '../../geometry.js';
import { vMax } from '../../math.js';
import type { Opt } from '../../math.js';
import { isRepeat, resolveOrZero, trackDefiniteValue, trackHasFixedComponent, AUTO_TRACK } from '../../style.js';
import type { GridTemplateComponent, LengthPercentage, Style, TrackSizingFunction } from '../../style.js';
import { collapseTrack, gutter, newGridTrack } from './types.js';
import type { GridTrack, TrackCounts } from './types.js';

/** The auto-repeat fit strategy to use */
export type AutoRepeatStrategy = 'max-repetitions-that-do-not-overflow' | 'min-repetitions-that-do-overflow';

/**
 * Compute the number of rows and columns in the explicit grid.
 * Returns [numAutoRepetitions, explicitTrackCount].
 */
export function computeExplicitGridSizeInAxis(
  style: Style,
  autoFitContainerSize: Opt,
  autoFitStrategy: AutoRepeatStrategy,
  axis: AbsoluteAxis,
): [number, number] {
  const template = axis === 'horizontal' ? style.gridTemplateColumns : style.gridTemplateRows;

  if (template.length === 0) return [0, 0];

  // If there are any repetitions that contain no tracks, the whole definition is invalid
  if (template.some((def) => isRepeat(def) && def.tracks.length === 0)) return [0, 0];

  const nonAutoRepeatingTrackCount = template.reduce((sum, def) => {
    if (!isRepeat(def)) return sum + 1;
    return typeof def.repeat === 'number' ? sum + def.repeat * def.tracks.length : sum;
  }, 0);

  const autoRepetitionCount = template.filter((def) => isRepeat(def) && typeof def.repeat !== 'number').length;
  const allTrackDefsHaveFixedComponent = template.every((def) =>
    isRepeat(def) ? def.tracks.every(trackHasFixedComponent) : trackHasFixedComponent(def),
  );

  const templateIsValid = autoRepetitionCount === 0 || (autoRepetitionCount === 1 && allTrackDefsHaveFixedComponent);
  if (!templateIsValid) return [0, 0];

  if (autoRepetitionCount === 0) return [0, nonAutoRepeatingTrackCount];

  const repetitionDefinition = template.find(
    (def): def is { repeat: 'auto-fill' | 'auto-fit'; tracks: TrackSizingFunction[] } =>
      isRepeat(def) && typeof def.repeat !== 'number',
  )!;
  const repetitionTrackCount = repetitionDefinition.tracks.length;

  // "treating each track as its max track sizing function if that is definite or as its
  // minimum track sizing function otherwise, flooring the max by the min if both definite"
  const trackDefiniteValueFn = (sizingFunction: TrackSizingFunction, parentSize: Opt): number => {
    const maxSize = trackDefiniteValue(sizingFunction.max, parentSize);
    const minSize = trackDefiniteValue(sizingFunction.min, parentSize);
    return maxSize !== null ? vMax(maxSize, minSize) : minSize!;
  };

  let numRepetitions: number;
  if (autoFitContainerSize === null) {
    numRepetitions = 1;
  } else {
    const innerContainerSize = autoFitContainerSize;
    const parentSize = innerContainerSize;

    const nonRepeatingTrackUsedSpace = template.reduce((sum, def) => {
      if (!isRepeat(def)) return sum + trackDefiniteValueFn(def, parentSize);
      if (typeof def.repeat === 'number') {
        return sum + def.repeat * def.tracks.reduce((s, t) => s + trackDefiniteValueFn(t, parentSize), 0);
      }
      return sum;
    }, 0);
    const gapStyle: LengthPercentage = axis === 'horizontal' ? style.gap.width : style.gap.height;
    const gapSize = resolveOrZero(gapStyle, innerContainerSize);

    const perRepetitionTrackUsedSpace = repetitionDefinition.tracks.reduce(
      (sum, t) => sum + trackDefiniteValueFn(t, parentSize),
      0,
    );

    // The first repetition is special-cased: gap count depends on non-repeating tracks too
    const firstRepetitionAndNonRepeatingTracksUsedSpace =
      nonRepeatingTrackUsedSpace +
      perRepetitionTrackUsedSpace +
      Math.max(nonAutoRepeatingTrackCount + repetitionTrackCount - 1, 0) * gapSize;

    const perRepetitionGapUsedSpace = repetitionTrackCount * gapSize;
    const perRepetitionUsedSpace = perRepetitionTrackUsedSpace + perRepetitionGapUsedSpace;

    if (firstRepetitionAndNonRepeatingTracksUsedSpace > innerContainerSize || perRepetitionUsedSpace <= 0) {
      // A repetition that consumes no space would repeat infinitely; css-grid-1
      // §7.2.3.1 caps the count at 1. Guarding here also keeps the division
      // below from producing NaN (0/0), which used to flow all the way into the
      // explicit track count — and since `x + NaN + y` is NaN, not a number
      // greater than any index, the occupancy matrix's bounds check passed
      // vacuously and placement wrote out of bounds (TypeError).
      numRepetitions = 1;
    } else {
      const numRepetitionThatFit =
        (innerContainerSize - firstRepetitionAndNonRepeatingTracksUsedSpace) / perRepetitionUsedSpace;

      numRepetitions =
        autoFitStrategy === 'max-repetitions-that-do-not-overflow'
          ? Math.floor(numRepetitionThatFit) + 1
          : Math.ceil(numRepetitionThatFit) + 1;
    }
  }

  const gridTemplateTrackCount = nonAutoRepeatingTrackCount + repetitionTrackCount * numRepetitions;
  return [numRepetitions, gridTemplateTrackCount];
}

/**
 * Resolve the track sizing functions of explicit tracks, automatically created
 * tracks, and gutters, given track counts and the relevant styles.
 */
export function initializeGridTracks(
  tracks: GridTrack[],
  counts: TrackCounts,
  style: Style,
  axis: AbsoluteAxis,
  trackHasItems: (index: number) => boolean,
): void {
  const trackTemplate: GridTemplateComponent[] =
    axis === 'horizontal' ? style.gridTemplateColumns : style.gridTemplateRows;
  const autoTracks: TrackSizingFunction[] = axis === 'horizontal' ? style.gridAutoColumns : style.gridAutoRows;
  const gap: LengthPercentage = axis === 'horizontal' ? style.gap.width : style.gap.height;

  tracks.length = 0;
  tracks.push(gutter(gap));

  const autoTrackCount = autoTracks.length;
  const nonAutoRepeatingTrackCount = trackTemplate.reduce((sum, def) => {
    if (!isRepeat(def)) return sum + 1;
    return typeof def.repeat === 'number' ? sum + def.repeat * def.tracks.length : sum;
  }, 0);

  // Cycle helper for auto-track lists
  const autoTrackAt = (index: number): TrackSizingFunction =>
    autoTrackCount === 0 ? AUTO_TRACK : autoTracks[((index % autoTrackCount) + autoTrackCount) % autoTrackCount]!;

  // Create negative implicit tracks. When auto-tracks exist, offset the cycle so the
  // track immediately before the explicit grid gets the *last* auto track, etc.
  const negOffset = autoTrackCount === 0 ? 0 : autoTrackCount - (counts.negativeImplicit % autoTrackCount);
  for (let i = 0; i < counts.negativeImplicit; i++) {
    const def = autoTrackAt(negOffset + i);
    tracks.push(newGridTrack(def.min, def.max));
    tracks.push(gutter(gap));
  }

  let currentTrackIndex = counts.negativeImplicit;

  // Create explicit tracks
  if (counts.explicit > 0) {
    for (const def of trackTemplate) {
      if (!isRepeat(def)) {
        tracks.push(newGridTrack(def.min, def.max));
        tracks.push(gutter(gap));
        currentTrackIndex++;
      } else if (typeof def.repeat === 'number') {
        const total = def.repeat * def.tracks.length;
        for (let i = 0; i < total; i++) {
          const sf = def.tracks[i % def.tracks.length]!;
          tracks.push(newGridTrack(sf.min, sf.max));
          tracks.push(gutter(gap));
          currentTrackIndex++;
        }
      } else {
        // auto-fill / auto-fit
        const autoRepeatedTrackCount = counts.explicit - nonAutoRepeatingTrackCount;
        for (let i = 0; i < autoRepeatedTrackCount; i++) {
          const sf = def.tracks[i % def.tracks.length]!;
          const track = newGridTrack(sf.min, sf.max);
          const gutterTrack = gutter(gap);

          // Auto-fit tracks that don't contain items should be collapsed
          if (def.repeat === 'auto-fit' && !trackHasItems(currentTrackIndex)) {
            collapseTrack(track);
            collapseTrack(gutterTrack);
          }

          tracks.push(track);
          tracks.push(gutterTrack);
          currentTrackIndex++;
        }

        // If the auto-fit repeat is at the very end of the track list, collapse backwards
        // until the first non-collapsed track (fixes the gutter before trailing collapsed tracks).
        const isLast = currentTrackIndex === trackCountsTotal(counts);
        if (def.repeat === 'auto-fit' && isLast) {
          for (let i = tracks.length - 1; i >= 0; i--) {
            const prev = tracks[i]!;
            if (prev.kind === 'track' && !prev.isCollapsed) break;
            collapseTrack(prev);
          }
        }
      }
    }
  }

  const gridAreaTracks = counts.negativeImplicit + counts.explicit - currentTrackIndex;

  // Create positive implicit tracks
  for (let i = 0; i < counts.positiveImplicit + gridAreaTracks; i++) {
    const def = autoTrackAt(i);
    tracks.push(newGridTrack(def.min, def.max));
    tracks.push(gutter(gap));
  }

  // Mark first and last grid lines as collapsed
  collapseTrack(tracks[0]!);
  collapseTrack(tracks[tracks.length - 1]!);
}

function trackCountsTotal(c: TrackCounts): number {
  return c.negativeImplicit + c.explicit + c.positiveImplicit;
}
