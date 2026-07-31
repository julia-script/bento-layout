// Port of taffy/src/tree/{layout,cache,node}.rs — collapsed for a single concrete
// GC-managed tree: nodes are plain objects holding style, children, and outputs.

import type { Point, Rect, Size } from './geometry.js';
import { pointNone, pointZero, rectZero, sizeZero } from './geometry.js';
import type { AvailableSpace, Style } from './style.js';
import { resolveStyle } from './style.js';
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

/**
 * Engine-side view of a node's state; `LayoutNode` holds one as its private
 * record.
 * @internal
 */
export interface NodeInternal {
  style: Style;
  children: LayoutNode[];
  measure?: MeasureFunction | undefined;
  parent: LayoutNode | null;
  unroundedLayout: Layout;
  layout: Layout;
  cache: Cache;
}

// Friend accessor: assigned inside LayoutNode's static block so it can reach
// the #internal field; exported via internals() below, which the compute
// engine uses and the package root never re-exports.
let internalOf!: (node: LayoutNode) => NodeInternal;

/**
 * A node in a layout tree. Internals are runtime-private: styles change only
 * through {@link setStyle}, structure only through the child methods, so the
 * engine observes every mutation. Computed results are read through the
 * {@link layout} / {@link unroundedLayout} getters.
 *
 * A node detached from its parent is a live standalone tree — lay it out,
 * re-attach it, or drop it; there is nothing to free.
 */
export class LayoutNode {
  #internal: NodeInternal;

  constructor(style: Partial<Style> = {}, children: readonly LayoutNode[] = []) {
    this.#internal = {
      style: resolveStyle(style),
      children: [],
      measure: undefined,
      parent: null,
      unroundedLayout: layoutWithOrder(0),
      layout: layoutWithOrder(0),
      cache: new Cache(),
    };
    for (const child of children) this.appendChild(child);
  }

  static {
    internalOf = (node) => node.#internal;
  }

  /** The resolved style. Read-only by type; mutate via {@link setStyle}. */
  get style(): Readonly<Style> {
    return this.#internal.style;
  }

  get children(): readonly LayoutNode[] {
    return this.#internal.children;
  }

  get parentNode(): LayoutNode | null {
    return this.#internal.parent ?? null;
  }

  /** Final layout (rounded unless rounding was disabled). Filled in by computeLayout. */
  get layout(): Readonly<Layout> {
    return this.#internal.layout;
  }

  /** Pre-rounding layout, for embedders that do their own rounding. */
  get unroundedLayout(): Readonly<Layout> {
    return this.#internal.unroundedLayout;
  }

  /**
   * Shallow-merge `style` into the node's resolved style. Nested objects
   * (`size`, `margin`, `padding`, …) are replaced whole, not deep-merged:
   * `setStyle({ size: { width: 10, height: 'auto' } })` — always supply the
   * full object.
   */
  setStyle(style: Partial<Style>): this {
    this.#internal.style = { ...this.#internal.style, ...style };
    this.#markDirty();
    return this;
  }

  /** Set or clear the measure callback used to size this node's content. */
  setMeasure(measure: MeasureFunction | null): this {
    this.#internal.measure = measure ?? undefined;
    this.#markDirty();
    return this;
  }

  /**
   * Append `child`, detaching it from its current parent first (a node has at
   * most one parent). Throws if `child` is this node or one of its ancestors.
   */
  appendChild(child: LayoutNode): this {
    return this.insertChild(this.#internal.children.length, child);
  }

  /** Insert `child` at `index` (0 ≤ index ≤ children.length); otherwise like appendChild. */
  insertChild(index: number, child: LayoutNode): this {
    const internal = this.#internal;
    if (index < 0 || index > internal.children.length || !Number.isInteger(index)) {
      throw new RangeError(`insertChild: index ${index} out of bounds (0..${internal.children.length})`);
    }
    for (let p: LayoutNode | null = this; p !== null; p = p.parentNode) {
      if (p === child) throw new Error('appendChild/insertChild would create a cycle');
    }
    const childInternal = internalOf(child);
    const oldParent = childInternal.parent;
    if (oldParent) {
      const siblings = internalOf(oldParent).children;
      const i = siblings.indexOf(child);
      // Removing an earlier sibling shifts the target index within the same parent.
      if (oldParent === this && i < index) index--;
      siblings.splice(i, 1);
      oldParent.#markDirty();
    }
    internal.children.splice(index, 0, child);
    childInternal.parent = this;
    this.#markDirty();
    return this;
  }

  /**
   * Detach `child`. The removed subtree stays alive and reusable — re-attach
   * it anywhere or drop it and let it be garbage collected.
   */
  removeChild(child: LayoutNode): LayoutNode {
    const children = this.#internal.children;
    const i = children.indexOf(child);
    if (i === -1) throw new Error('removeChild: node is not a child of this node');
    children.splice(i, 1);
    internalOf(child).parent = null;
    this.#markDirty();
    return child;
  }

  // Every mutation funnels through here. Currently a no-op — computeLayout
  // still clears all caches per run — but this is the contract incremental
  // relayout builds on later (mark this node + ancestor chain dirty) without
  // any public API change.
  #markDirty(): void {}
}

/**
 * Engine access to a node's mutable internals.
 * @internal — exported for src/compute/*, never from the package root.
 */
export function internals(node: LayoutNode): NodeInternal {
  return internalOf(node);
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
