// Port of taffy/src/tree/{layout,cache,node}.rs — collapsed for a single concrete
// GC-managed tree: nodes are plain objects holding style, children, and outputs.

import type { Point, Rect, Size } from './geometry.js';
import { pointNone, pointZero, rectZero, sizeZero } from './geometry.js';
import type { AvailableSpace, Style } from './style.js';
import type { Opt } from './math.js';

export type RunMode = 'perform-layout' | 'compute-size' | 'perform-hidden-layout';
export type SizingMode = 'content-size' | 'inherent-size';
export type RequestedAxis = 'horizontal' | 'vertical' | 'both';

/** A start/end pair (port of taffy's Line<T>). */
export interface Line<T> {
  start: T;
  end: T;
}

export const LINE_FALSE: Line<boolean> = { start: false, end: false };

/** A set of margins available for collapsing (CSS block margin collapsing). */
export interface CollapsibleMarginSet {
  /** The largest positive margin */
  positive: number;
  /** The smallest negative margin (with largest absolute value) */
  negative: number;
}

export const collapsibleMarginZero = (): CollapsibleMarginSet => ({ positive: 0, negative: 0 });

export function marginSetFromMargin(margin: number): CollapsibleMarginSet {
  return margin >= 0 ? { positive: margin, negative: 0 } : { positive: 0, negative: margin };
}

export function collapseWithMargin(set: CollapsibleMarginSet, margin: number): CollapsibleMarginSet {
  return margin >= 0
    ? { positive: Math.max(set.positive, margin), negative: set.negative }
    : { positive: set.positive, negative: Math.min(set.negative, margin) };
}

export function collapseWithSet(a: CollapsibleMarginSet, b: CollapsibleMarginSet): CollapsibleMarginSet {
  return { positive: Math.max(a.positive, b.positive), negative: Math.min(a.negative, b.negative) };
}

export function resolveMarginSet(set: CollapsibleMarginSet): number {
  return set.positive + set.negative;
}

export interface LayoutInput {
  runMode: RunMode;
  sizingMode: SizingMode;
  axis: RequestedAxis;
  knownDimensions: Size<Opt>;
  parentSize: Size<Opt>;
  availableSpace: Size<AvailableSpace>;
  /** CSS Block margin collapsing: whether this node's start/end vertical margins
   * may collapse with its parent's. Always LINE_FALSE outside block layout. */
  verticalMarginsAreCollapsible: Line<boolean>;
}

export interface LayoutOutput {
  size: Size<number>;
  contentSize: Size<number>;
  firstBaselines: Point<Opt>;
  /** Top margin that can be collapsed with (CSS block layout only) */
  topMargin: CollapsibleMarginSet;
  /** Bottom margin that can be collapsed with (CSS block layout only) */
  bottomMargin: CollapsibleMarginSet;
  /** Whether margins can collapse through this node (CSS block layout only) */
  marginsCanCollapseThrough: boolean;
}

export const layoutOutputHidden = (): LayoutOutput => ({
  size: sizeZero(),
  contentSize: sizeZero(),
  firstBaselines: pointNone(),
  topMargin: collapsibleMarginZero(),
  bottomMargin: collapsibleMarginZero(),
  marginsCanCollapseThrough: false,
});

export function fromOuterSize(size: Size<number>): LayoutOutput {
  return {
    size: { ...size },
    contentSize: sizeZero(),
    firstBaselines: pointNone(),
    topMargin: collapsibleMarginZero(),
    bottomMargin: collapsibleMarginZero(),
    marginsCanCollapseThrough: false,
  };
}

export function fromSizesAndBaselines(
  size: Size<number>,
  contentSize: Size<number>,
  firstBaselines: Point<Opt>,
): LayoutOutput {
  return {
    size,
    contentSize,
    firstBaselines,
    topMargin: collapsibleMarginZero(),
    bottomMargin: collapsibleMarginZero(),
    marginsCanCollapseThrough: false,
  };
}

/** The final result of layout for a single node. */
export interface Layout {
  order: number;
  location: Point<number>;
  size: Size<number>;
  contentSize: Size<number>;
  scrollbarSize: Size<number>;
  border: Rect<number>;
  padding: Rect<number>;
  margin: Rect<number>;
}

export const layoutWithOrder = (order: number): Layout => ({
  order,
  location: pointZero(),
  size: sizeZero(),
  contentSize: sizeZero(),
  scrollbarSize: sizeZero(),
  border: rectZero(),
  padding: rectZero(),
  margin: rectZero(),
});

export type MeasureFunction = (knownDimensions: Size<Opt>, availableSpace: Size<AvailableSpace>) => Size<number>;

export interface Node {
  style: Style;
  children: Node[];
  measure?: MeasureFunction | undefined;
  /** Filled in by computeLayout */
  unroundedLayout: Layout;
  /** Final layout (rounded when rounding is enabled, else a copy of unrounded) */
  layout: Layout;
  /** @internal per-layout-run measurement cache */
  cache: Cache;
}

// --- Cache (port of tree/cache.rs)
//
// Keys are strings rather than bit-packed u64s. A known-dimension of v and a
// definite available-space of v must produce different keys (taffy negates the
// definite value); the `k`/`a` prefixes handle that.

const CACHE_SIZE = 9;

function mixedKey(kd: Opt, avs: AvailableSpace): string {
  if (kd !== null) return `k${kd}`;
  return typeof avs === 'number' ? `a${avs}` : avs;
}

interface CacheKey {
  kdAvailableSpace: string;
  parentSizeW: string;
  parentSizeH: string;
  axis: RequestedAxis;
}

function cacheKey(input: LayoutInput): CacheKey {
  return {
    kdAvailableSpace:
      mixedKey(input.knownDimensions.width, input.availableSpace.width) +
      '|' +
      mixedKey(input.knownDimensions.height, input.availableSpace.height),
    parentSizeW: `${input.parentSize.width}`,
    parentSizeH: `${input.parentSize.height}`,
    axis: input.axis,
  };
}

interface CacheEntry<T> {
  key: CacheKey;
  content: T;
}

export class Cache {
  private finalLayoutEntry: CacheEntry<LayoutOutput> | null = null;
  private measureEntries: (CacheEntry<Size<number>> | null)[] = new Array(CACHE_SIZE).fill(null);

  /**
   * Cache slots (see taffy tree/cache.rs for the full rationale):
   * 0: both known dimensions set; 1-4: one known dimension; 5-8: none.
   */
  private static computeCacheSlot(kd: Size<Opt>, avs: Size<AvailableSpace>): number {
    const hasKnownWidth = kd.width !== null;
    const hasKnownHeight = kd.height !== null;
    if (hasKnownWidth && hasKnownHeight) return 0;
    if (hasKnownWidth) return 1 + (avs.height === 'min-content' ? 1 : 0);
    if (hasKnownHeight) return 3 + (avs.width === 'min-content' ? 1 : 0);
    const wMin = avs.width === 'min-content';
    const hMin = avs.height === 'min-content';
    return 5 + (wMin ? 2 : 0) + (hMin ? 1 : 0);
  }

  get(input: LayoutInput): LayoutOutput | null {
    const key = cacheKey(input);
    if (input.runMode === 'perform-layout') {
      const entry = this.finalLayoutEntry;
      if (
        entry &&
        entry.key.kdAvailableSpace === key.kdAvailableSpace &&
        entry.key.parentSizeW === key.parentSizeW &&
        entry.key.parentSizeH === key.parentSizeH &&
        entry.key.axis === key.axis
      ) {
        return entry.content;
      }
      return null;
    }
    if (input.runMode === 'compute-size') {
      // Measure entries match on knownDimensions/availableSpace and the
      // x-axis parent size only (taffy masks out the y-axis and axis bits).
      for (const entry of this.measureEntries) {
        if (entry && entry.key.kdAvailableSpace === key.kdAvailableSpace && entry.key.parentSizeW === key.parentSizeW) {
          return fromOuterSize(entry.content);
        }
      }
      return null;
    }
    return null;
  }

  store(input: LayoutInput, layoutOutput: LayoutOutput): void {
    const key = cacheKey(input);
    if (input.runMode === 'perform-layout') {
      this.finalLayoutEntry = { key, content: layoutOutput };
    } else if (input.runMode === 'compute-size') {
      const slot = Cache.computeCacheSlot(input.knownDimensions, input.availableSpace);
      this.measureEntries[slot] = { key, content: layoutOutput.size };
    }
  }

  clear(): void {
    this.finalLayoutEntry = null;
    this.measureEntries.fill(null);
  }
}
