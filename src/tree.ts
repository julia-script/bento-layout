// The node tree, its layout cache, and layout in/out types — a single concrete
// GC-managed tree: nodes are plain objects holding style, children, and outputs.

import type { Point, Rect, Size } from './geometry.js';
import { pointNone, pointZero, rectZero, sizeZero } from './geometry.js';
import type { Opt } from './math.js';
import type { AvailableSpace, Style, StyleInput } from './style.js';
import { mergeStyle, resolveStyle } from './style.js';

export type RunMode = 'perform-layout' | 'compute-size' | 'perform-hidden-layout';
export type SizingMode = 'content-size' | 'inherent-size';
export type RequestedAxis = 'horizontal' | 'vertical' | 'both';

/** A start/end pair. */
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
  /** Axes whose known value was resolved definitively by the parent (for
   * example, an aspect-ratio constraint transfer or flex stretch), not an
   * automatic ratio-derived preferred size that content may enlarge. */
  knownDimensionsAreHard?: Size<boolean>;
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

/**
 * Where a node ended up and how big it is — the result of laying one node out.
 *
 * @remarks
 * Read it from {@link LayoutNode.layout} (pixel-rounded) or
 * {@link LayoutNode.unroundedLayout} (exact). Every measurement is in pixels.
 *
 * The box model here is the CSS one: `size` is the **border box**, whatever the
 * node's `boxSizing` was. Subtract `border` and `padding` to get the content
 * box, and `scrollbarSize` too if the node reserves a scrollbar gutter.
 */
export interface Layout {
  /**
   * Paint order among siblings, matching the node's index in its parent.
   *
   * @remarks
   * Useful when layout order and paint order diverge — `flexDirection:
   * 'row-reverse'` positions children right-to-left but leaves this in document
   * order.
   */
  order: number;
  /**
   * Top-left corner, relative to the **parent's** border box — not the
   * viewport. Accumulate down the tree for absolute coordinates.
   */
  location: Point<number>;
  /** Border-box size, including padding and border regardless of `boxSizing`. */
  size: Size<number>;
  /**
   * Extent of the node's content.
   *
   * @remarks
   * Larger than {@link Layout.size} when content overflows, which is what to
   * compare against to decide whether a scroll container actually scrolls.
   */
  contentSize: Size<number>;
  /**
   * Space reserved for scrollbar gutters, from `scrollbarWidth` on an axis with
   * `overflow: 'scroll'`. Zero on both axes otherwise.
   */
  scrollbarSize: Size<number>;
  /** Resolved border widths per side, inside {@link Layout.size}. */
  border: Rect<number>;
  /** Resolved padding per side, inside the border. */
  padding: Rect<number>;
  /**
   * Resolved margins per side, outside {@link Layout.size}.
   *
   * @remarks
   * Already reflected in the node's `location`. For vertical margins in block
   * layout these are the values after CSS margin collapsing, so they can differ
   * from what the style asked for.
   */
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

/**
 * Callback that reports a leaf node's content size, given the constraints the
 * engine has resolved so far.
 *
 * @remarks
 * Attach one with {@link LayoutNode.setMeasure}. It is the bridge between the
 * layout engine and content it cannot inspect — a run of text, an image, an
 * embedded canvas.
 *
 * Read the two arguments in order. `knownDimensions` is authoritative: a
 * non-`null` axis has already been decided, and returning anything else for it
 * is ignored, so the useful move is to honour it — text given a definite width
 * should wrap to it and report the resulting height. `availableSpace` only
 * matters for axes that are still `null`; it is either a number (space
 * remaining) or an intrinsic keyword, where `'max-content'` asks how large the
 * content would be with unlimited room and `'min-content'` asks for the
 * smallest size that still works — the longest unbreakable word, for text.
 *
 * Return the **content-box** size in pixels; the engine adds the node's own
 * padding and border. Expect several calls per layout with different
 * constraints, so keep the function pure and inexpensive.
 *
 * For text, also return a `baseline` — the distance from the top of the
 * content box down to the first line's alphabetic baseline. Without it the
 * engine has to synthesize one from the box's bottom edge, and
 * `align-items: baseline` lines boxes up by their bottoms instead of by their
 * text. Content with no text (an image, an icon) should omit it.
 *
 * @param knownDimensions - Axes already resolved, `null` where still open.
 * @param availableSpace - Room available on each unresolved axis, as a number
 *   or an intrinsic-sizing keyword.
 * @returns The content size in pixels, optionally with a `baseline`.
 *
 * @example
 * A fixed-size leaf, the simplest useful case.
 * ```typescript
 * const icon = LayoutNode.make().setMeasure(() => ({ width: 24, height: 24 }));
 * ```
 *
 * @example
 * Text that wraps: honour a known width, otherwise answer the intrinsic
 * question being asked.
 * ```typescript
 * import type { MeasureFunction } from 'bento-layout';
 *
 * const measureText = (text: string, charWidth = 10, lineHeight = 20): MeasureFunction =>
 *   (known, available) => {
 *     const maxWidth = text.length * charWidth;
 *     const longestWord = Math.max(
 *       ...text.split(' ').map((w) => w.length * charWidth),
 *     );
 *
 *     let width: number;
 *     if (known.width !== null) width = known.width;
 *     else if (available.width === 'min-content') width = longestWord;
 *     else if (available.width === 'max-content') width = maxWidth;
 *     else width = Math.min(available.width, maxWidth);
 *
 *     const lines = Math.max(1, Math.ceil(maxWidth / Math.max(width, longestWord)));
 *     const height = known.height ?? lines * lineHeight;
 *     // First line's baseline, so `align-items: baseline` can align the text.
 *     return { width, height, baseline: lineHeight * 0.8 };
 *   };
 *
 * const paragraph = LayoutNode.make().setMeasure(measureText('hello wrapping world'));
 * ```
 */
export type MeasureFunction = (knownDimensions: Size<Opt>, availableSpace: Size<AvailableSpace>) => MeasuredContent;

/**
 * What a {@link MeasureFunction} reports back: the content size, plus an
 * optional first baseline for text.
 *
 * `baseline` is the distance in pixels from the **top of the returned content
 * box** down to the first line's alphabetic baseline. Return it whenever the
 * content has real text, so `align-items: baseline` can line that text up with
 * text in sibling boxes.
 *
 * Omit it (or return a bare `Size`) for content with no text — an image, an
 * icon, a canvas. Layout then synthesizes a baseline from the box's bottom
 * border edge, which is what CSS requires for a box with no baseline of its own
 * (css-flexbox-1 §8.3).
 */
export interface MeasuredContent extends Size<number> {
  /** Distance from the top of the content box to the first text baseline. */
  baseline?: number | undefined;
}

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
 * A box in a layout tree: a style, a list of children, and — once
 * {@link computeLayout} has run — a computed position and size.
 *
 * @remarks
 * Build a tree by nesting nodes, hand the root to {@link computeLayout}, then
 * read each node's {@link LayoutNode.layout}. A node is an ordinary JS object
 * with an ordinary lifetime: there are no numeric handles, no arena to register
 * with, and no `free()` or `destroy()` to remember. Drop a subtree and the
 * garbage collector takes it; a subtree detached from its parent stays fully
 * usable as a standalone tree, so you can lay it out on its own or re-attach it
 * somewhere else. This is deliberately unlike the native engines, which make
 * you manage node lifetime by hand.
 *
 * Nodes are opaque. Style changes go through {@link LayoutNode.setStyle},
 * structure through {@link LayoutNode.appendChild} /
 * {@link LayoutNode.insertChild} / {@link LayoutNode.removeChild}, and results
 * come back out through the getters. Routing every mutation through a method is
 * what lets the engine see changes; assigning to a getter throws.
 *
 * Only leaf nodes measure their own content, via
 * {@link LayoutNode.setMeasure} — that is how text and images get sizes. A node
 * with children ignores any measure function and sizes from its children.
 *
 * @example
 * A column with a fixed header and a body that fills the rest.
 * ```typescript
 * import { LayoutNode, computeLayout } from 'bento-layout';
 *
 * const header = LayoutNode.make({ width: 'auto', height: 60 });
 * const body = LayoutNode.make({ flexGrow: 1 });
 * const root = LayoutNode.make(
 *   { flexDirection: 'column', width: 320, height: 480 },
 *   [header, body],
 * );
 *
 * computeLayout(root, { width: 'max-content', height: 'max-content' });
 *
 * header.layout.size; // { width: 320, height: 60 }
 * body.layout.location; // { x: 0, y: 60 }
 * body.layout.size.height; // 420 — the remaining space
 * ```
 *
 * @see {@link computeLayout} to lay a tree out.
 * @see {@link Style} for the full style vocabulary.
 */
export class LayoutNode {
  #internal: NodeInternal;

  /**
   * Create a node from plain style data, optionally with children.
   *
   * @remarks
   * `style` is merged over the defaults, so you pass only what differs. The
   * defaults are the engine's own rather than CSS's — most visibly `display: 'flex'`
   * (CSS would say `block`) and `flexShrink: 1` — so a bare `LayoutNode.make()`
   * is an empty flex container, not a block box.
   *
   * Passing `children` is equivalent to calling
   * {@link LayoutNode.appendChild} for each in order, and carries the same
   * rules: a child is detached from any previous parent, and a cycle throws.
   *
   * @param style - Style properties to override; anything omitted keeps its
   *   default. Nested objects such as `size` are taken whole.
   * @param children - Children to append, in order. Each is reparented.
   *
   * @throws {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error | Error}
   *   if a node in `children` is this node or one of its ancestors.
   *
   * @example
   * ```typescript
   * const root = LayoutNode.make(
   *   {
   *     display: 'grid',
   *     gridTemplateColumns: [
   *       { min: 'auto', max: { fr: 1 } },
   *       { min: 'auto', max: { fr: 2 } },
   *     ],
   *   },
   *   [LayoutNode.make(), LayoutNode.make()],
   * );
   * ```
   */
  constructor(style: StyleInput = {}, children: readonly LayoutNode[] = []) {
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
  static make(style: StyleInput = {}, children: readonly LayoutNode[] = []): LayoutNode {
    return new LayoutNode(style, children);
  }

  static {
    internalOf = (node) => node.#internal;
  }

  /**
   * This node's fully-resolved style, with defaults filled in for everything
   * the constructor and {@link LayoutNode.setStyle} did not specify.
   *
   * @remarks
   * The style is the node's own: values you pass to the constructor or to
   * {@link LayoutNode.setStyle} are copied, so keeping a reference to a style
   * object — or reusing one template across several nodes — never lets you
   * reach back in. Reading from this getter is always safe.
   *
   * Change styles through {@link LayoutNode.setStyle}, never through this
   * getter. `Readonly<Style>` is a compile-time guard and it is shallow: the
   * type stops `node.style = {...}` and `node.style.display = 'grid'`, but
   * nested objects are not frozen, so `node.style.size.width = 300` type-errors
   * yet still mutates the node at runtime. Reaching in that way is unsupported
   * and will break once mutation tracking lands.
   *
   * @example
   * ```typescript
   * const node = LayoutNode.make({ width: 100, height: 200 });
   * node.style.size.height; // 200 — as given
   * node.style.display; // 'flex' — the default, filled in
   * ```
   */
  get style(): Readonly<Style> {
    return this.#internal.style;
  }

  /**
   * This node's children, in layout order.
   *
   * @remarks
   * The array is the node's own, not a copy: it is `readonly` to the type
   * system but reflects later structural changes, so snapshot it with
   * `[...node.children]` before iterating while you mutate.
   */
  get children(): readonly LayoutNode[] {
    return this.#internal.children;
  }

  /**
   * The node this one is attached to, or `null` if it is a root or detached.
   *
   * @remarks
   * Named `parentNode` rather than `parent` to match the DOM, since the tree
   * shape is otherwise DOM-like.
   */
  get parentNode(): LayoutNode | null {
    return this.#internal.parent ?? null;
  }

  /**
   * The computed layout: where this node ended up and how big it is.
   *
   * @remarks
   * Meaningless until {@link computeLayout} has run over a tree containing this
   * node — before that it reads as an all-zero box. Values are pixel-rounded
   * unless rounding was disabled.
   *
   * `location` is relative to the **parent's** border box, not the viewport, so
   * painting in absolute coordinates means accumulating positions down the
   * tree. `size` is the border-box size regardless of the node's `boxSizing`;
   * `padding`, `border`, and `scrollbarSize` give the insets needed to derive
   * the content box, and `contentSize` is the extent of the content itself,
   * which may exceed `size` when content overflows.
   *
   * Each {@link computeLayout} call replaces this object rather than updating
   * it in place, so a reference held across calls goes stale — read the getter
   * again instead of caching it.
   *
   * @example
   * ```typescript
   * const child = LayoutNode.make({ width: 50, height: 50 });
   * const root = LayoutNode.make(
   *   { paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10 },
   *   [child],
   * );
   * computeLayout(root, { width: 'max-content', height: 'max-content' });
   *
   * child.layout.location; // { x: 10, y: 10 } — inside the parent's padding
   * root.layout.size; // { width: 70, height: 70 } — child plus padding
   * ```
   */
  get layout(): Readonly<Layout> {
    return this.#internal.layout;
  }

  /**
   * The layout before pixel rounding — exact fractional values.
   *
   * @remarks
   * Populated on every {@link computeLayout} call, whether or not rounding is
   * enabled, so you can read exact geometry without giving up the rounded
   * values. Use it when you do your own subpixel positioning (canvas, SVG, a
   * scaled layer) or when rounding twice would compound error. For painting to
   * a pixel grid, prefer {@link LayoutNode.layout}, whose rounding keeps
   * adjacent boxes flush.
   */
  get unroundedLayout(): Readonly<Layout> {
    return this.#internal.unroundedLayout;
  }

  /**
   * Merge style properties into this node, overwriting the ones named and
   * leaving the rest as they were.
   *
   * @remarks
   * The merge is per property: setting `width` leaves `height` alone, and
   * setting `paddingLeft` leaves the other three sides alone. Only the keys you
   * name change, so there is no need to restate a whole edge or axis to adjust
   * one value.
   *
   * Changes apply on the next {@link computeLayout}; this does not lay anything
   * out on its own. Returns the node, so calls chain.
   *
   * @param style - Properties to overwrite. Anything omitted is untouched.
   * @returns This node.
   *
   * @example
   * ```typescript
   * const node = LayoutNode.make({ width: 100, height: 200 });
   *
   * node.setStyle({ width: 50 });
   * node.style.size; // { width: 50, height: 200 } — height untouched
   * node.style.display; // 'flex' — everything else survives the merge
   * ```
   *
   * @example
   * Re-laying out after a change.
   * ```typescript
   * const a = LayoutNode.make({ flexGrow: 1 });
   * const b = LayoutNode.make({ flexGrow: 1 });
   * const root = LayoutNode.make({ width: 400, height: 100 }, [a, b]);
   * const space = { width: 'max-content', height: 'max-content' } as const;
   *
   * computeLayout(root, space);
   * a.layout.size.width; // 200 — split evenly
   *
   * a.setStyle({ flexGrow: 3 });
   * computeLayout(root, space);
   * a.layout.size.width; // 300 — three parts to b's one
   * ```
   */
  setStyle(style: StyleInput): this {
    this.#internal.style = mergeStyle(this.#internal.style, style);
    this.#markDirty();
    return this;
  }

  /**
   * Attach a callback that reports this node's intrinsic content size, or pass
   * `null` to remove it.
   *
   * @remarks
   * This is how content the engine cannot see — text, an image, a canvas —
   * gets a size. The engine has no notion of glyphs or intrinsic image
   * dimensions; a leaf without a measure function is zero-sized unless its
   * style gives it one.
   *
   * **Only leaves are measured.** A node with children sizes from those
   * children and never calls its measure function, so attaching one to a
   * container has no effect.
   *
   * The callback may be invoked several times per layout with different
   * constraints — typically once to probe `'min-content'`, once for
   * `'max-content'`, and again with a definite width once one is chosen. Keep
   * it pure and cheap; it sits in the hot path.
   *
   * @param measure - Callback returning the content size, or `null` to clear
   *   it. See {@link MeasureFunction} for how to read its arguments.
   * @returns This node.
   *
   * @example
   * A leaf whose text wraps at the width it is offered.
   * ```typescript
   * const label = LayoutNode.make().setMeasure((known, available) => ({
   *   width: known.width ?? (typeof available.width === 'number'
   *     ? Math.min(available.width, 100)
   *     : 100),
   *   height: known.height ?? 20,
   * }));
   *
   * const root = LayoutNode.make({}, [label]);
   * computeLayout(root, { width: 'max-content', height: 'max-content' });
   * label.layout.size; // { width: 100, height: 20 }
   *
   * label.setMeasure(null);
   * computeLayout(root, { width: 'max-content', height: 'max-content' });
   * label.layout.size; // { width: 0, height: 0 } — nothing left to size it
   * ```
   */
  setMeasure(measure: MeasureFunction | null): this {
    this.#internal.measure = measure ?? undefined;
    this.#markDirty();
    return this;
  }

  /**
   * Add `child` as this node's last child.
   *
   * @remarks
   * A node has at most one parent, so this *moves* rather than shares: if
   * `child` already has a parent it is removed from it first, including when
   * that parent is this node — appending an existing child moves it to the end.
   *
   * @param child - Node to append. Reparented if it is already attached.
   * @returns This node, so calls chain.
   *
   * @throws {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error | Error}
   *   if `child` is this node or one of its ancestors, which would make the
   *   tree cyclic.
   *
   * @example
   * ```typescript
   * const child = LayoutNode.make();
   * const first = LayoutNode.make({}, [child]);
   * const second = LayoutNode.make();
   *
   * second.appendChild(child);
   * first.children; // [] — moved, not shared
   * child.parentNode; // second
   * ```
   *
   * @see {@link LayoutNode.insertChild} to place a child at a specific index.
   */
  appendChild(child: LayoutNode): this {
    return this.insertChild(this.#internal.children.length, child);
  }

  /**
   * Add `child` at position `index`, shifting later siblings back.
   *
   * @remarks
   * Like {@link LayoutNode.appendChild} in every other respect: the child is
   * detached from any current parent, and cycles throw.
   *
   * When you reorder a child *within the same parent*, `index` is interpreted
   * against the list as it stands **before** the move. The child is removed
   * first and the target index compensated, so passing `children.length` moves
   * a node to the end rather than landing out of bounds.
   *
   * @param index - Where to insert, from `0` to `children.length` inclusive.
   *   Must be an integer.
   * @param child - Node to insert. Reparented if it is already attached.
   * @returns This node, so calls chain.
   *
   * @throws {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RangeError | RangeError}
   *   if `index` is negative, greater than `children.length`, or not an
   *   integer.
   * @throws {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error | Error}
   *   if `child` is this node or one of its ancestors.
   *
   * @example
   * Reordering within one parent.
   * ```typescript
   * const a = LayoutNode.make();
   * const b = LayoutNode.make();
   * const c = LayoutNode.make();
   * const root = LayoutNode.make({}, [a, b, c]);
   *
   * root.insertChild(0, c);
   * root.children; // [c, a, b] — last moved to first
   *
   * root.insertChild(3, c);
   * root.children; // [a, b, c] — and back to last
   * ```
   */
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
   * Detach `child` from this node and return it.
   *
   * @remarks
   * The removed subtree stays fully alive — it keeps its own children and
   * styles, and becomes a root in its own right. Lay it out standalone with
   * {@link computeLayout}, attach it elsewhere, or simply drop the reference
   * and let the garbage collector reclaim it. There is no `free()` or
   * `destroy()` to call afterwards, and no way to leak by forgetting one.
   *
   * @param child - A direct child of this node.
   * @returns The detached `child`, for convenient chaining.
   *
   * @throws {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error | Error}
   *   if `child` is not a direct child of this node. Removing a grandchild
   *   means calling this on its actual parent.
   *
   * @example
   * A detached subtree is an ordinary tree.
   * ```typescript
   * const inner = LayoutNode.make({ width: 10, height: 10 });
   * const sub = LayoutNode.make({ width: 30, height: 30 }, [inner]);
   * const root = LayoutNode.make({}, [sub]);
   *
   * root.removeChild(sub);
   * sub.parentNode; // null
   *
   * computeLayout(sub, { width: 'max-content', height: 'max-content' });
   * sub.layout.size; // { width: 30, height: 30 } — lays out on its own
   * ```
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

// --- Cache
//
// Entries hold each key field inline as a primitive and compare them with ===,
// so a lookup allocates nothing. Keeping the fields separate rather than packing
// them into one number also removes any need to disambiguate a known-dimension
// of v from a definite available-space of v — `kw`/`aw` are distinct fields and
// cannot collide.
//
// Two properties of the match predicate are load-bearing and easy to break:
// `axis` must stay in the key (dropping it fails 4 grid baseline fixtures), and
// an entry whose cached size merely equals the requested known dimension must
// NOT be accepted as a hit (that relaxation fails 12 more).

const CACHE_SIZE = 9;

interface MeasureEntry {
  kw: Opt;
  kh: Opt;
  hw: boolean;
  hh: boolean;
  aw: AvailableSpace;
  ah: AvailableSpace;
  pw: Opt;
  axis: RequestedAxis;
  marginStartCollapsible: boolean;
  marginEndCollapsible: boolean;
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
   * Cache slots, bucketed by which dimensions are known:
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
    const marginStartCollapsible = input.verticalMarginsAreCollapsible.start;
    const marginEndCollapsible = input.verticalMarginsAreCollapsible.end;
    const hw = input.knownDimensionsAreHard?.width ?? false;
    const hh = input.knownDimensionsAreHard?.height ?? false;

    if (input.runMode === 'perform-layout') {
      const entry = this.finalLayoutEntry;
      if (
        entry !== undefined &&
        entry.kw === kw &&
        entry.kh === kh &&
        entry.hw === hw &&
        entry.hh === hh &&
        entry.aw === aw &&
        entry.ah === ah &&
        entry.pw === pw &&
        entry.ph === input.parentSize.height &&
        entry.axis === axis &&
        entry.marginStartCollapsible === marginStartCollapsible &&
        entry.marginEndCollapsible === marginEndCollapsible
      ) {
        return entry.out;
      }
      return null;
    }

    if (input.runMode === 'compute-size') {
      // Measure entries match on knownDimensions/availableSpace and the
      // x-axis parent size only; the y-axis and axis fields are ignored here.
      const entries = this.measureEntries;
      if (entries === undefined) return null;
      for (let i = 0; i < CACHE_SIZE; i++) {
        const entry = entries[i];
        if (
          entry !== undefined &&
          entry.kw === kw &&
          entry.kh === kh &&
          entry.hw === hw &&
          entry.hh === hh &&
          entry.aw === aw &&
          entry.ah === ah &&
          entry.pw === pw &&
          entry.axis === axis &&
          entry.marginStartCollapsible === marginStartCollapsible &&
          entry.marginEndCollapsible === marginEndCollapsible
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
    const marginStartCollapsible = input.verticalMarginsAreCollapsible.start;
    const marginEndCollapsible = input.verticalMarginsAreCollapsible.end;
    const hw = input.knownDimensionsAreHard?.width ?? false;
    const hh = input.knownDimensionsAreHard?.height ?? false;

    if (input.runMode === 'perform-layout') {
      this.finalLayoutEntry = {
        kw,
        kh,
        hw,
        hh,
        aw,
        ah,
        pw,
        ph: input.parentSize.height,
        axis,
        marginStartCollapsible,
        marginEndCollapsible,
        out: layoutOutput,
      };
    } else if (input.runMode === 'compute-size') {
      // biome-ignore lint/suspicious/noAssignInExpressions: lazy-allocate the cache row on first measure.
      const entries = this.measureEntries ?? (this.measureEntries = new Array(CACHE_SIZE).fill(undefined));
      entries[Cache.computeCacheSlot(kw, kh, aw, ah)] = {
        kw,
        kh,
        hw,
        hh,
        aw,
        ah,
        pw,
        axis,
        marginStartCollapsible,
        marginEndCollapsible,
        // Compute-size callers normally read only `.size`, but block layout
        // also consumes the collapsed-margin outputs to size an ancestor BFC.
        // Keep the complete immutable result: CSS2 §8.3.1 collapses an empty
        // block's adjoining top/end margins before Blink encapsulates that
        // margin strut in a flex item's independent formatting context.
        // Replacing this with `fromOuterSize()` turned a cached self-collapsing
        // leaf into a non-collapsing one (Chrome 151: 1px + 1px => 1px, not 2).
        out: layoutOutput,
      };
    }
  }

  clear(): void {
    this.finalLayoutEntry = undefined;
    this.measureEntries = undefined;
  }
}
