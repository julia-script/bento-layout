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
// Entries hold each key field inline as a primitive and compare them with ===,
// so a lookup allocates nothing. Taffy packs the same fields into a u64; we
// compare them separately, which also removes the need for taffy's disambiguation
// between a known-dimension of v and a definite available-space of v — `kw`/`aw`
// are distinct fields and cannot collide.
//
// Note this is deliberately NOT a literal port of taffy's match predicate.
// Taffy matches on known_dimensions + available_space alone and additionally
// accepts an entry whose cached size equals the requested known dimension.
// Both divergences are load-bearing here: dropping `axis` from the key fails 4
// grid baseline fixtures, and adopting taffy's cached-size relaxation fails 12
// more. Only the allocation behaviour is being changed.

const CACHE_SIZE = 9;

interface MeasureEntry {
  kw: Opt;
  kh: Opt;
  aw: AvailableSpace;
  ah: AvailableSpace;
  pw: Opt;
  axis: RequestedAxis;
  /** Prebuilt at store time so a hit returns an existing object. */
  out: LayoutOutput;
}

/** The final-layout entry additionally discriminates on the y-axis parent size. */
interface FinalEntry extends MeasureEntry {
  ph: Opt;
}

export class Cache {
  private finalLayoutEntry: FinalEntry | undefined = undefined;
  /** Allocated lazily: leaf-heavy trees never reach the compute-size path. */
  private measureEntries: (MeasureEntry | undefined)[] | undefined = undefined;

  /**
   * Cache slots (see taffy tree/cache.rs for the full rationale):
   * 0: both known dimensions set; 1-4: one known dimension; 5-8: none.
   */
  private static computeCacheSlot(kw: Opt, kh: Opt, aw: AvailableSpace, ah: AvailableSpace): number {
    const hasKnownWidth = kw !== null;
    const hasKnownHeight = kh !== null;
    if (hasKnownWidth && hasKnownHeight) return 0;
    if (hasKnownWidth) return 1 + (ah === 'min-content' ? 1 : 0);
    if (hasKnownHeight) return 3 + (aw === 'min-content' ? 1 : 0);
    const wMin = aw === 'min-content';
    const hMin = ah === 'min-content';
    return 5 + (wMin ? 2 : 0) + (hMin ? 1 : 0);
  }

  get(input: LayoutInput): LayoutOutput | null {
    const kw = input.knownDimensions.width;
    const kh = input.knownDimensions.height;
    const aw = input.availableSpace.width;
    const ah = input.availableSpace.height;
    const pw = input.parentSize.width;
    const axis = input.axis;

    if (input.runMode === 'perform-layout') {
      const entry = this.finalLayoutEntry;
      if (
        entry !== undefined &&
        entry.kw === kw &&
        entry.kh === kh &&
        entry.aw === aw &&
        entry.ah === ah &&
        entry.pw === pw &&
        entry.ph === input.parentSize.height &&
        entry.axis === axis
      ) {
        return entry.out;
      }
      return null;
    }

    if (input.runMode === 'compute-size') {
      // Measure entries match on knownDimensions/availableSpace and the
      // x-axis parent size only (taffy masks out the y-axis and axis bits).
      const entries = this.measureEntries;
      if (entries === undefined) return null;
      for (let i = 0; i < CACHE_SIZE; i++) {
        const entry = entries[i];
        if (
          entry !== undefined &&
          entry.kw === kw &&
          entry.kh === kh &&
          entry.aw === aw &&
          entry.ah === ah &&
          entry.pw === pw &&
          entry.axis === axis
        ) {
          return entry.out;
        }
      }
      return null;
    }

    return null;
  }

  store(input: LayoutInput, layoutOutput: LayoutOutput): void {
    const kw = input.knownDimensions.width;
    const kh = input.knownDimensions.height;
    const aw = input.availableSpace.width;
    const ah = input.availableSpace.height;
    const pw = input.parentSize.width;
    const axis = input.axis;

    if (input.runMode === 'perform-layout') {
      this.finalLayoutEntry = { kw, kh, aw, ah, pw, ph: input.parentSize.height, axis, out: layoutOutput };
    } else if (input.runMode === 'compute-size') {
      const entries = this.measureEntries ?? (this.measureEntries = new Array(CACHE_SIZE).fill(undefined));
      entries[Cache.computeCacheSlot(kw, kh, aw, ah)] = {
        kw,
        kh,
        aw,
        ah,
        pw,
        axis,
        out: fromOuterSize(layoutOutput.size),
      };
    }
  }

  clear(): void {
    this.finalLayoutEntry = undefined;
    this.measureEntries = undefined;
  }
}
