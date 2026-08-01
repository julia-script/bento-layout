// Style data model: the resolved properties layout reads.
// Lengths are discriminated unions rather than a packed numeric encoding:
//   number            → absolute length (px)
//   { percent: n }    → percentage as a 0..1 fraction
//   'auto'            → keyword auto

import type { FlexDirection, Point, Rect, Size } from './geometry.js';
import type { Opt } from './math.js';

/**
 * A CSS length: either absolute pixels or a percentage of the containing block.
 *
 * @remarks
 * This is the base of the length vocabulary the rest of the style types build
 * on ({@link LengthPercentageAuto} adds `'auto'`, {@link Dimension} is an alias
 * of that). Lengths are plain data rather than parsed strings: there is no CSS
 * parser here, so you write `10`, not `'10px'`.
 *
 * Write a percentage as `'50%'`. The object form `{ percent: 0.5 }` is how the
 * engine stores one — a 0–1 fraction, which is what the resolution arithmetic
 * multiplies by — and it is what {@link LayoutNode.style} reads back. It is
 * legal input too, so a resolved style round-trips, but there is no reason to
 * write it by hand.
 *
 * Percentages resolve against the containing block, and against its *inline*
 * size (width) on all four sides for `padding`, `margin`, and `border` — so a
 * percentage top padding is a fraction of the parent's width, per css-box-3.
 *
 * @example
 * ```typescript
 * const node = LayoutNode.make({
 *   width: '50%', // half the parent; reads back as { percent: 0.5 }
 *   height: 100,
 *   paddingLeft: 8,
 *   paddingRight: 8,
 * });
 * ```
 */
export type LengthPercentage = number | { percent: number };

/**
 * A percentage written the CSS way, accepted anywhere {@link StyleInput} takes
 * a length.
 *
 * @remarks
 * Percentages are the one place the engine's data form and the CSS spelling
 * disagree by a factor of 100, so input accepts both and normalizes: `'50%'`
 * becomes `{ percent: 0.5 }` on the way in, which is what
 * {@link LayoutNode.style} reads back. The engine itself never sees the string.
 *
 * This is a spelling, not a parser: only a single number followed by `%`. There
 * is still no `'10px'`, no `'0 auto'`, no `calc()`.
 */
export type PercentString = `${number}%`;

/** {@link LengthPercentage} as written in input, where `'50%'` is also legal. */
export type LengthPercentageInput = LengthPercentage | PercentString;

/** {@link LengthPercentageAuto} as written in input, where `'50%'` is also legal. */
export type LengthPercentageAutoInput = LengthPercentageAuto | PercentString;

/** {@link Dimension} as written in input, where `'50%'` is also legal. */
export type DimensionInput = LengthPercentageAutoInput;

/**
 * A {@link LengthPercentage} that may also be `'auto'`.
 *
 * @remarks
 * Used where CSS lets a value be computed rather than stated — `margin`, and
 * `inset` (`left`/`right`/`top`/`bottom`). What `'auto'` means depends on the
 * property: an `'auto'` margin absorbs free space (the centering trick), while
 * an `'auto'` inset leaves the box at its normal-flow position.
 */
export type LengthPercentageAuto = LengthPercentage | 'auto';

/**
 * A sizing value for `size`, `minSize`, `maxSize`, and `flexBasis`.
 *
 * @remarks
 * Identical to {@link LengthPercentageAuto}; the separate name marks the CSS
 * role. `'auto'` means "size from content or the layout algorithm" rather than
 * a fixed value, and is the default on every axis.
 */
export type Dimension = LengthPercentageAuto;

/**
 * How much room a node has to lay out in, per axis.
 *
 * @remarks
 * You pass this to {@link computeLayout} for the root; internally it is also
 * what drives intrinsic sizing, and what a {@link MeasureFunction} receives.
 *
 * A number is a definite constraint in pixels. The two keywords ask intrinsic
 * questions instead: `'max-content'` means "unconstrained — size to content",
 * and `'min-content'` means "as narrow as the content permits". For a root you
 * are fitting to a viewport, pass numbers; to shrink-wrap a tree, pass
 * `'max-content'`.
 *
 * @example
 * ```typescript
 * const root = LayoutNode.make({}, [LayoutNode.make({ width: 50, height: 50 })]);
 *
 * computeLayout(root, { width: 800, height: 600 }); // fit a viewport
 * computeLayout(root, { width: 'max-content', height: 'max-content' }); // shrink-wrap
 * ```
 */
export type AvailableSpace = number | 'min-content' | 'max-content';

/**
 * Which layout algorithm a node runs for its children.
 *
 * @remarks
 * `'none'` removes the node and its whole subtree from layout, sizing it to
 * zero. Note the default is `'flex'`, not CSS's `'block'`.
 */
export type Display = 'flex' | 'none' | 'block' | 'grid';

/**
 * Whether `size` measures the border box or the content box.
 *
 * @remarks
 * Under the default `'border-box'`, a width of 100 includes padding and border.
 * Under `'content-box'` (CSS's own default) the padding and border are added on
 * top, so the painted box comes out larger than the number you wrote.
 */
export type BoxSizing = 'border-box' | 'content-box';

/** Inline direction: `'rtl'` mirrors the main axis and flips start/end edges. */
export type Direction = 'ltr' | 'rtl';

/**
 * Whether a node participates in normal flow.
 *
 * @remarks
 * `'absolute'` takes the node out of flow and positions it against its
 * containing block using `inset`, so it no longer affects its siblings.
 */
export type Position = 'relative' | 'absolute';

/**
 * What happens to content that overflows a node's box.
 *
 * @remarks
 * Layout-relevant beyond clipping: `'hidden'` and `'scroll'` make the node a
 * scroll container, which gives it an automatic minimum size of zero — the
 * reason an overflowing flex item shrinks with `overflow: 'hidden'` but not
 * with `'visible'`. `'scroll'` additionally reserves `scrollbarWidth` as a
 * gutter.
 */
export type Overflow = 'visible' | 'clip' | 'hidden' | 'scroll';

/** Whether flex items wrap onto multiple lines, and in which order. */
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';

/**
 * Legacy `text-align` inherited into block containers.
 *
 * @remarks
 * Only the `legacy-*` values matter here: they reproduce the pre-CSS2.1
 * behaviour where alignment on a block also aligns its block-level children.
 * `'auto'` (the default) leaves that alone. This engine lays out boxes, not
 * glyphs, so it has no effect on text inside a {@link MeasureFunction}.
 */
export type TextAlign = 'auto' | 'legacy-left' | 'legacy-right' | 'legacy-center';

/**
 * How an individual item sits within its line, on the cross axis.
 *
 * @remarks
 * `'start'`/`'end'` are absolute (physical) edges, while `'flex-start'` and
 * `'flex-end'` follow the flex direction and so swap under `row-reverse` or
 * `rtl`. `'stretch'` fills the line — the default for flex items with an
 * `'auto'` cross size. `'baseline'` aligns items by their first text baseline.
 */
export type AlignItemsKeyword = 'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';

/**
 * How the whole set of lines or tracks is distributed along an axis.
 *
 * @remarks
 * Shares the edge keywords of {@link AlignItemsKeyword} and adds the
 * space-distribution ones. `'space-between'` puts all spare room *between*
 * items, `'space-around'` gives each item a half-size gutter on both sides, and
 * `'space-evenly'` makes every gap — including the outer two — equal.
 */
export type AlignContentKeyword =
  | 'start'
  | 'end'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-evenly'
  | 'space-around';

/**
 * Cross-axis alignment for a container's items, as a keyword plus the CSS
 * `safe` modifier.
 *
 * @remarks
 * CSS writes this as one token (`align-items: safe center`); here it is
 * structured data, so `'center'` becomes `{ keyword: 'center', safe: false }`.
 *
 * `safe: true` is the overflow escape hatch: when the item is bigger than its
 * container, alignment falls back to `'start'` so the overflow spills off the
 * end rather than off the start edge, where it would be unreachable. With
 * `safe: false` (the default, matching CSS's `unsafe`) the requested alignment
 * is honoured even when it overflows both ways.
 *
 * @example
 * ```typescript
 * const row = LayoutNode.make({
 *   alignItems: { keyword: 'center', safe: false },
 *   justifyContent: { keyword: 'space-between', safe: false },
 * });
 * ```
 */
export interface AlignItems {
  keyword: AlignItemsKeyword;
  safe: boolean;
}

/**
 * Distribution of lines or tracks along an axis. Same `{ keyword, safe }` shape
 * as {@link AlignItems} — see there for what `safe` does.
 */
export interface AlignContent {
  keyword: AlignContentKeyword;
  safe: boolean;
}

/**
 * Per-item override of the parent's `alignItems`, set on the child. Same shape
 * as {@link AlignItems}.
 */
export type AlignSelf = AlignItems;

/**
 * Main-axis distribution of items within a container. Same shape as
 * {@link AlignContent}.
 */
export type JustifyContent = AlignContent;

/**
 * Everything that describes how one box should be laid out — the CSS box model
 * and the flex, grid, and block properties, as plain data.
 *
 * @remarks
 * You almost never build a whole `Style`. Nodes take `Partial<Style>` and fill
 * the rest from defaults, so pass only what differs:
 * `LayoutNode.make({ flexGrow: 1 })`. The complete resolved object is what
 * {@link LayoutNode.style} hands back.
 *
 * Properties mirror CSS names and meanings, with two systematic differences:
 * values are structured data rather than strings (`10`, not `'10px'`), and this
 * resolved form holds only longhands, grouped into `Rect`/`Size`/`Point`
 * objects. {@link StyleInput} additionally accepts uniform shorthands such as
 * `padding: 16`, which expand into these fields on the way in.
 *
 * Percentages are the one value that differs between the two forms: input takes
 * `'50%'`, and this resolved form stores the fraction `{ percent: 0.5 }` the
 * layout arithmetic works in. Both are legal input, so a resolved style can be
 * passed straight back to {@link LayoutNode.setStyle}.
 *
 * Which properties apply depends on `display` and on whether a node is a
 * container or an item. `flexGrow` on a grid item, or `gridRow` on a flex item,
 * is simply ignored rather than an error.
 *
 * The defaults are the engine's own, not CSS's. The three that surprise people:
 * `display` is `'flex'` (CSS: `block`), `boxSizing` is `'border-box'` (CSS:
 * `content-box`), and `flexShrink` is `1`, so items shrink below their basis
 * unless told otherwise.
 *
 * @example
 * A centered card with a fixed size.
 * ```typescript
 * const card = LayoutNode.make({
 *   width: 300,
 *   height: 200,
 *   paddingLeft: 16,
 *   paddingRight: 16,
 *   alignItems: { keyword: 'center', safe: false },
 *   justifyContent: { keyword: 'center', safe: false },
 * });
 * ```
 *
 * @see {@link LayoutNode.setStyle} to change styles after construction.
 */
export interface Style {
  /** Layout algorithm for this node's children. @defaultValue `'flex'` */
  display: Display;
  /** Whether {@link Style.size} means the border box or content box. @defaultValue `'border-box'` */
  boxSizing: BoxSizing;
  /** Inline direction; `'rtl'` mirrors the main axis. @defaultValue `'ltr'` */
  direction: Direction;
  /**
   * Overflow handling per physical axis (`x` horizontal, `y` vertical).
   * @defaultValue `{ x: 'visible', y: 'visible' }`
   */
  overflow: Point<Overflow>;
  /**
   * Gutter reserved on an axis whose {@link Style.overflow} is `'scroll'`.
   *
   * @remarks
   * Taken out of the content box, so it shrinks the room children get. Ignored
   * unless that axis actually scrolls.
   *
   * @defaultValue `0`
   */
  scrollbarWidth: number;
  /** Whether the node stays in normal flow. @defaultValue `'relative'` */
  position: Position;
  /**
   * Offsets from the containing block's edges, used when
   * {@link Style.position} is `'absolute'`.
   *
   * @remarks
   * `'auto'` on a side means "no constraint from this edge". Giving both
   * opposite sides definite values stretches the box between them, which is how
   * you fill a container without stating a size.
   *
   * @defaultValue all sides `'auto'`
   */
  inset: Rect<LengthPercentageAuto>;
  /**
   * Preferred size on each axis.
   *
   * @remarks
   * `'auto'` defers to content and to the layout algorithm. Clamped by
   * {@link Style.minSize} and {@link Style.maxSize}, and interpreted per
   * {@link Style.boxSizing}.
   *
   * @defaultValue both axes `'auto'`
   */
  size: Size<Dimension>;
  /**
   * Lower size bound, clamping {@link Style.size}.
   *
   * @remarks
   * `'auto'` is not zero: for a flex or grid item it means the *automatic
   * minimum size*, which floors the item at its content's minimum so text does
   * not shrink to nothing. Set `0` explicitly to allow full shrinkage — or make
   * the node a scroll container, which has the same effect.
   *
   * @defaultValue both axes `'auto'`
   */
  minSize: Size<Dimension>;
  /** Upper size bound, clamping {@link Style.size}. @defaultValue both axes `'auto'` */
  maxSize: Size<Dimension>;
  /**
   * Width-to-height ratio; `2` is twice as wide as tall.
   *
   * @remarks
   * Derives the size of an axis left `'auto'` from the other axis, after
   * min/max clamping on each axis independently. `null` disables it.
   *
   * @defaultValue `null`
   */
  aspectRatio: number | null;
  /**
   * Space outside the border box.
   *
   * @remarks
   * `'auto'` absorbs free space, which is how a box centers itself
   * (`left: 'auto', right: 'auto'`). In block layout, adjacent vertical margins
   * collapse per CSS 2.2, so the rendered gap can be smaller than the sum.
   * Percentages resolve against the containing block's **width** on all four
   * sides.
   *
   * @defaultValue all sides `0`
   */
  margin: Rect<LengthPercentageAuto>;
  /**
   * Space between the border and the content, inside the box. Percentages
   * resolve against the containing block's width on all four sides.
   *
   * @defaultValue all sides `0`
   */
  padding: Rect<LengthPercentage>;
  /**
   * Border thickness, between padding and margin.
   *
   * @remarks
   * Thickness only — this engine computes geometry, not paint, so there is no
   * border style or color.
   *
   * @defaultValue all sides `0`
   */
  border: Rect<LengthPercentage>;
  /**
   * Cross-axis alignment applied to all children. `null` means the algorithm's
   * default (stretch for flex).
   *
   * @defaultValue `null`
   */
  alignItems: AlignItems | null;
  /**
   * This node's own cross-axis alignment, overriding its parent's
   * {@link Style.alignItems}. Set on the child, not the container.
   *
   * @defaultValue `null`
   */
  alignSelf: AlignSelf | null;
  /**
   * Distribution of flex lines or grid tracks along the cross axis. Only has an
   * effect with multiple lines or tracks.
   *
   * @defaultValue `null`
   */
  alignContent: AlignContent | null;
  /** Distribution of items along the main axis. @defaultValue `null` */
  justifyContent: JustifyContent | null;
  /**
   * Gutters between items: `width` between columns, `height` between rows.
   *
   * @remarks
   * Named by axis rather than CSS's row/column gap. Applies to flex and grid;
   * gaps are not added outside the first or last item.
   *
   * @defaultValue `{ width: 0, height: 0 }`
   */
  gap: Size<LengthPercentage>;
  /** Legacy block text alignment. @defaultValue `'auto'` */
  textAlign: TextAlign;
  /** Main-axis direction for flex containers. @defaultValue `'row'` */
  flexDirection: FlexDirection;
  /** Whether items wrap onto multiple lines. @defaultValue `'nowrap'` */
  flexWrap: FlexWrap;
  /**
   * Starting main-axis size of a flex item, before growing or shrinking.
   *
   * @remarks
   * Takes priority over {@link Style.size} on the main axis. `'auto'` falls
   * back to that size, and then to content.
   *
   * @defaultValue `'auto'`
   */
  flexBasis: Dimension;
  /**
   * Share of leftover main-axis space this item claims, relative to its
   * siblings' grow factors. `0` means it never grows.
   *
   * @defaultValue `0`
   */
  flexGrow: number;
  /**
   * Share of overflow this item absorbs when items do not fit, weighted by its
   * basis. `0` keeps it at its basis.
   *
   * @remarks
   * Defaults to `1`, matching CSS: items shrink below their basis by default,
   * which is the usual explanation for an item coming out narrower than
   * requested. It cannot shrink past {@link Style.minSize}.
   *
   * @defaultValue `1`
   */
  flexShrink: number;
  /** Inline-axis alignment of grid items within their areas. @defaultValue `null` */
  justifyItems: AlignItems | null;
  /**
   * This grid item's own inline-axis alignment, overriding the container's
   * {@link Style.justifyItems}.
   *
   * @defaultValue `null`
   */
  justifySelf: AlignSelf | null;
  /**
   * Explicit row tracks. @defaultValue `[]` (no explicit rows)
   * @see {@link GridTemplateComponent} for the track vocabulary.
   */
  gridTemplateRows: GridTemplateComponent[];
  /** Explicit column tracks. @defaultValue `[]` */
  gridTemplateColumns: GridTemplateComponent[];
  /**
   * Sizes for rows created implicitly beyond the explicit grid, cycled in
   * order.
   *
   * @defaultValue `[]` (implicit rows are `auto`)
   */
  gridAutoRows: TrackSizingFunction[];
  /** Sizes for implicitly-created columns, cycled in order. @defaultValue `[]` */
  gridAutoColumns: TrackSizingFunction[];
  /** Direction and packing of automatic grid placement. @defaultValue `'row'` */
  gridAutoFlow: GridAutoFlow;
  /**
   * This item's row placement. @defaultValue `{ start: 'auto', end: 'auto' }`
   * @see {@link GridPlacement}
   */
  gridRow: GridPlacementLine;
  /** This item's column placement. @defaultValue `{ start: 'auto', end: 'auto' }` */
  gridColumn: GridPlacementLine;
}

export const defaultStyle = (): Style => ({
  display: 'flex',
  boxSizing: 'border-box',
  direction: 'ltr',
  overflow: { x: 'visible', y: 'visible' },
  scrollbarWidth: 0,
  position: 'relative',
  inset: { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' },
  size: { width: 'auto', height: 'auto' },
  minSize: { width: 'auto', height: 'auto' },
  maxSize: { width: 'auto', height: 'auto' },
  aspectRatio: null,
  margin: { left: 0, right: 0, top: 0, bottom: 0 },
  padding: { left: 0, right: 0, top: 0, bottom: 0 },
  border: { left: 0, right: 0, top: 0, bottom: 0 },
  alignItems: null,
  alignSelf: null,
  alignContent: null,
  justifyContent: null,
  gap: { width: 0, height: 0 },
  textAlign: 'auto',
  flexDirection: 'row',
  flexWrap: 'nowrap',
  flexBasis: 'auto',
  flexGrow: 0,
  flexShrink: 1,
  justifyItems: null,
  justifySelf: null,
  gridTemplateRows: [],
  gridTemplateColumns: [],
  gridAutoRows: [],
  gridAutoColumns: [],
  gridAutoFlow: 'row',
  gridRow: { start: 'auto', end: 'auto' },
  gridColumn: { start: 'auto', end: 'auto' },
});

/** Scalar {@link Style} properties, which {@link StyleInput} takes unchanged. */
type ScalarStyleKey =
  | 'display'
  | 'boxSizing'
  | 'direction'
  | 'scrollbarWidth'
  | 'position'
  | 'aspectRatio'
  | 'textAlign'
  | 'flexDirection'
  | 'flexWrap'
  | 'flexGrow'
  | 'flexShrink'
  | 'gridAutoFlow'
  | 'alignItems'
  | 'alignSelf'
  | 'alignContent'
  | 'justifyContent'
  | 'justifyItems'
  | 'justifySelf';

/**
 * A style written as flat CSS properties — the form you pass to
 * {@link LayoutNode}.
 *
 * @remarks
 * Keys are CSS longhand names in camelCase, the same spelling the DOM's
 * `element.style` and React inline styles use: `paddingLeft`, `minWidth`,
 * `columnGap`. Every property is optional, and anything omitted keeps its
 * default.
 *
 * Values stay structured data rather than CSS strings: `10` for pixels, `'50%'`
 * for a percentage, `'auto'` for the keyword. There is no CSS parser here, so
 * the multi-value shorthand strings do not exist — no `margin: '0 auto'`, no
 * `padding: '10px 20px'`.
 *
 * The uniform shorthands do: `padding`, `margin`, `border`, `inset`, `gap`, and
 * `overflow` each set their longhands from one value, or from an object naming
 * the sides or axes you want. Input is read in order, so a longhand after a
 * shorthand overrides it — `{ padding: 16, paddingTop: 0 }` is 16 on three
 * sides and 0 on top.
 *
 * A few names differ from the CSS property they correspond to, following CSS
 * itself rather than the engine's internals: box offsets are `top`/`left`/
 * `bottom`/`right` (CSS `inset`), and gaps are `columnGap`/`rowGap`.
 *
 * @example
 * ```typescript
 * const card = LayoutNode.make({
 *   width: 300,
 *   height: 200,
 *   paddingLeft: 16,
 *   paddingRight: 16,
 *   columnGap: 8,
 *   alignItems: { keyword: 'center', safe: false },
 * });
 * ```
 *
 * @see {@link Style} for the resolved form read back from
 *   {@link LayoutNode.style}.
 */
export interface StyleInput extends Partial<Pick<Style, ScalarStyleKey>> {
  /** CSS `flex-basis`. @defaultValue `'auto'` */
  flexBasis?: DimensionInput;

  /** CSS `width`. @defaultValue `'auto'` */
  width?: DimensionInput;
  /** CSS `height`. @defaultValue `'auto'` */
  height?: DimensionInput;
  /** CSS `min-width`. @defaultValue `'auto'` */
  minWidth?: DimensionInput;
  /** CSS `min-height`. @defaultValue `'auto'` */
  minHeight?: DimensionInput;
  /** CSS `max-width`. @defaultValue `'auto'` */
  maxWidth?: DimensionInput;
  /** CSS `max-height`. @defaultValue `'auto'` */
  maxHeight?: DimensionInput;

  /** CSS `margin-left`. @defaultValue `0` */
  marginLeft?: LengthPercentageAutoInput;
  /** CSS `margin-right`. @defaultValue `0` */
  marginRight?: LengthPercentageAutoInput;
  /** CSS `margin-top`. @defaultValue `0` */
  marginTop?: LengthPercentageAutoInput;
  /** CSS `margin-bottom`. @defaultValue `0` */
  marginBottom?: LengthPercentageAutoInput;

  /** CSS `padding-left`. @defaultValue `0` */
  paddingLeft?: LengthPercentageInput;
  /** CSS `padding-right`. @defaultValue `0` */
  paddingRight?: LengthPercentageInput;
  /** CSS `padding-top`. @defaultValue `0` */
  paddingTop?: LengthPercentageInput;
  /** CSS `padding-bottom`. @defaultValue `0` */
  paddingBottom?: LengthPercentageInput;

  /** CSS `border-left-width`. @defaultValue `0` */
  borderLeft?: LengthPercentageInput;
  /** CSS `border-right-width`. @defaultValue `0` */
  borderRight?: LengthPercentageInput;
  /** CSS `border-top-width`. @defaultValue `0` */
  borderTop?: LengthPercentageInput;
  /** CSS `border-bottom-width`. @defaultValue `0` */
  borderBottom?: LengthPercentageInput;

  /** CSS `left`, used when `position` is `'absolute'`. @defaultValue `'auto'` */
  left?: LengthPercentageAutoInput;
  /** CSS `right`. @defaultValue `'auto'` */
  right?: LengthPercentageAutoInput;
  /** CSS `top`. @defaultValue `'auto'` */
  top?: LengthPercentageAutoInput;
  /** CSS `bottom`. @defaultValue `'auto'` */
  bottom?: LengthPercentageAutoInput;

  /** CSS `column-gap` — the gutter between columns. @defaultValue `0` */
  columnGap?: LengthPercentageInput;
  /** CSS `row-gap` — the gutter between rows. @defaultValue `0` */
  rowGap?: LengthPercentageInput;

  /** CSS `overflow-x`. @defaultValue `'visible'` */
  overflowX?: Overflow;
  /** CSS `overflow-y`. @defaultValue `'visible'` */
  overflowY?: Overflow;

  /** CSS `grid-template-rows`. @defaultValue `[]` */
  gridTemplateRows?: GridTemplateComponentInput[];
  /** CSS `grid-template-columns`. @defaultValue `[]` */
  gridTemplateColumns?: GridTemplateComponentInput[];
  /** CSS `grid-auto-rows` — sizing for implicit rows. @defaultValue `[]` */
  gridAutoRows?: TrackSizingFunctionInput[];
  /** CSS `grid-auto-columns` — sizing for implicit columns. @defaultValue `[]` */
  gridAutoColumns?: TrackSizingFunctionInput[];

  /** CSS `grid-row-start`. @defaultValue `'auto'` */
  gridRowStart?: GridPlacement;
  /** CSS `grid-row-end`. @defaultValue `'auto'` */
  gridRowEnd?: GridPlacement;
  /** CSS `grid-column-start`. @defaultValue `'auto'` */
  gridColumnStart?: GridPlacement;
  /** CSS `grid-column-end`. @defaultValue `'auto'` */
  gridColumnEnd?: GridPlacement;

  // --- Shorthands ---------------------------------------------------------
  // Each sets its longhands and nothing else, so a longhand written after one
  // overrides it. Values are data, not CSS strings: there is no `'10px 20px'`
  // two-value form — use the object to vary a side, as in
  // `{ top: 10, bottom: 10 }`.

  /**
   * All four paddings at once, or the named sides.
   *
   * @remarks
   * A single value applies to every side. An object sets only the sides it
   * names, leaving the rest untouched.
   *
   * @example
   * ```typescript
   * LayoutNode.make({ padding: 16 });                  // all four
   * LayoutNode.make({ padding: { top: 8, bottom: 8 } }); // top and bottom only
   * LayoutNode.make({ padding: 16, paddingTop: 0 });   // 16, except the top
   * ```
   */
  padding?: LengthPercentageInput | EdgesInput<LengthPercentageInput>;

  /**
   * All four margins at once, or the named sides. `'auto'` is a legal value and
   * absorbs free space, so `{ margin: 'auto' }` centres a box on both axes.
   */
  margin?: LengthPercentageAutoInput | EdgesInput<LengthPercentageAutoInput>;

  /** All four border widths at once, or the named sides. */
  border?: LengthPercentageInput | EdgesInput<LengthPercentageInput>;

  /**
   * All four box offsets at once, or the named sides — CSS `inset`. Applies
   * when `position` is `'absolute'`.
   */
  inset?: LengthPercentageAutoInput | EdgesInput<LengthPercentageAutoInput>;

  /**
   * Both gutters at once, or one axis.
   *
   * @example
   * ```typescript
   * LayoutNode.make({ gap: 8 });                  // rows and columns
   * LayoutNode.make({ gap: { column: 8 } });      // columns only
   * ```
   */
  gap?: LengthPercentageInput | GapInput;

  /** Both overflow axes at once, or one of them. */
  overflow?: Overflow | OverflowInput;
}

/**
 * Flat input key → the nested {@link Style} field it writes, as
 * `[nested key, sub-key]`. This table is the whole flat-to-nested mapping;
 * {@link resolveStyle} does nothing else.
 */
const FLAT_TO_NESTED = {
  width: ['size', 'width'],
  height: ['size', 'height'],
  minWidth: ['minSize', 'width'],
  minHeight: ['minSize', 'height'],
  maxWidth: ['maxSize', 'width'],
  maxHeight: ['maxSize', 'height'],
  marginLeft: ['margin', 'left'],
  marginRight: ['margin', 'right'],
  marginTop: ['margin', 'top'],
  marginBottom: ['margin', 'bottom'],
  paddingLeft: ['padding', 'left'],
  paddingRight: ['padding', 'right'],
  paddingTop: ['padding', 'top'],
  paddingBottom: ['padding', 'bottom'],
  borderLeft: ['border', 'left'],
  borderRight: ['border', 'right'],
  borderTop: ['border', 'top'],
  borderBottom: ['border', 'bottom'],
  left: ['inset', 'left'],
  right: ['inset', 'right'],
  top: ['inset', 'top'],
  bottom: ['inset', 'bottom'],
  columnGap: ['gap', 'width'],
  rowGap: ['gap', 'height'],
  overflowX: ['overflow', 'x'],
  overflowY: ['overflow', 'y'],
  gridRowStart: ['gridRow', 'start'],
  gridRowEnd: ['gridRow', 'end'],
  gridColumnStart: ['gridColumn', 'start'],
  gridColumnEnd: ['gridColumn', 'end'],
} as const satisfies Record<string, readonly [keyof Style, string]>;

/**
 * Shorthand key → the longhand keys it sets, in the order CSS writes them.
 *
 * @remarks
 * Every shorthand here is *uniform*: it applies one value to each longhand it
 * names. The multi-value CSS forms (`padding: '10px 20px'`, `flex: '1 1 auto'`)
 * are string syntax, which this library does not parse — pass the longhands, or
 * a per-edge object.
 *
 * Expansion happens in {@link mergeStyle}, which walks input in insertion
 * order, so a longhand written after a shorthand overrides it exactly as the
 * cascade does.
 */
const SHORTHAND_TO_LONGHANDS = {
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  border: ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['rowGap', 'columnGap'],
  overflow: ['overflowX', 'overflowY'],
} as const satisfies Record<string, readonly (keyof StyleInput)[]>;

/**
 * Per-edge object form of a box shorthand, as an alternative to four longhands.
 *
 * @remarks
 * Every side is optional and anything omitted is left as it was, so this sets
 * only the edges it names — `{ top: 8 }` does not zero the other three.
 */
export interface EdgesInput<T> {
  top?: T;
  right?: T;
  bottom?: T;
  left?: T;
}

/**
 * Axis object form of `gap`.
 *
 * @remarks
 * Accepts either CSS's naming (`row`/`column`) or the resolved {@link Style}
 * shape (`width`/`height`, where `width` is the column gutter). The second form
 * exists so a resolved style can be passed straight back in as input.
 */
export interface GapInput {
  row?: LengthPercentageInput;
  column?: LengthPercentageInput;
  /** Column gutter, matching {@link Style.gap}. */
  width?: LengthPercentageInput;
  /** Row gutter, matching {@link Style.gap}. */
  height?: LengthPercentageInput;
}

/** Per-axis object form of `overflow`, matching {@link Style.overflow}. */
export interface OverflowInput {
  x?: Overflow;
  y?: Overflow;
}

/** Maps an edges/axis object onto the longhand keys of its shorthand. */
const OBJECT_FORM_KEYS: Record<string, Record<string, keyof StyleInput>> = {
  padding: { top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft' },
  margin: { top: 'marginTop', right: 'marginRight', bottom: 'marginBottom', left: 'marginLeft' },
  border: { top: 'borderTop', right: 'borderRight', bottom: 'borderBottom', left: 'borderLeft' },
  inset: { top: 'top', right: 'right', bottom: 'bottom', left: 'left' },
  // `width`/`height` are Style's own spelling of the gap axes, accepted so a
  // resolved style round-trips as input.
  gap: { row: 'rowGap', column: 'columnGap', width: 'columnGap', height: 'rowGap' },
  overflow: { x: 'overflowX', y: 'overflowY' },
};

/**
 * Expand one shorthand into `[longhandKey, value]` pairs.
 *
 * A plain value applies to every longhand; an object sets only the sides or
 * axes it names.
 */
function expandShorthand(key: string, value: unknown): Array<[string, unknown]> {
  const objectKeys = OBJECT_FORM_KEYS[key];
  // `'auto'` is a legal uniform margin/inset value and is not an edges object,
  // so only a non-null plain object takes the per-edge path.
  if (objectKeys !== undefined && typeof value === 'object' && value !== null && !('percent' in value)) {
    return Object.entries(value)
      .filter(([side]) => objectKeys[side] !== undefined)
      .map(([side, v]) => [objectKeys[side] as string, v]);
  }
  const longhands = SHORTHAND_TO_LONGHANDS[key as keyof typeof SHORTHAND_TO_LONGHANDS];
  return longhands.map((longhand) => [longhand as string, value]);
}

/**
 * `'50%'` → `{ percent: 0.5 }`. Any other value passes through untouched.
 *
 * @remarks
 * The engine stores percentages as 0..1 fractions because that is the form the
 * resolution arithmetic wants (`context * percent`), but nobody writing a style
 * thinks in `{ percent: 0.5 }`. Divide by 100 once, here, and the factor-of-100
 * trap stops existing for callers — `'50%'` in, `{ percent: 0.5 }` back out.
 *
 * Only a trailing `%` triggers this, so every keyword string (`'auto'`,
 * `'center'`, `'max-content'`) is left alone and no CSS parsing is implied.
 *
 * A malformed percentage throws rather than resolving to `NaN`: a `NaN` length
 * poisons every sum it touches and surfaces as a silently empty layout far from
 * the style that caused it.
 */
function coercePercent(value: unknown): unknown {
  if (typeof value !== 'string' || !value.endsWith('%')) return value;
  const body = value.slice(0, -1).trim();
  const n = body === '' ? Number.NaN : Number(body);
  if (!Number.isFinite(n)) {
    throw new InvalidStyleError(`"${value}" is not a percentage — expected a number followed by "%", as in "50%"`);
  }
  return { percent: n / 100 };
}

/** The four style keys holding grid tracks, where a percentage sits nested. */
const TRACK_LIST_KEYS = new Set(['gridTemplateRows', 'gridTemplateColumns', 'gridAutoRows', 'gridAutoColumns']);

/**
 * {@link coercePercent} applied at every depth a length can appear inside a
 * grid track: the track's own `min`/`max`, a `fitContent()` limit, and the
 * tracks nested in a `repeat()`.
 *
 * @remarks
 * Recursion is what keeps this honest — the three shapes are distinguished by
 * their keys, not their nesting depth, so one function handles the whole tree
 * and `'50%'` means the same thing wherever a track can hold a length. Values
 * with nothing to convert (`{ fr: 1 }`, `'min-content'`) fall through.
 *
 * Objects are rebuilt rather than mutated: input a caller still holds a
 * reference to must not change under them, and the style they get back must
 * not be reachable from what they passed in.
 */
function coerceTrack(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return coercePercent(value);
  if ('repeat' in value) {
    const tracks = (value as Record<string, unknown>).tracks;
    return { ...value, tracks: Array.isArray(tracks) ? tracks.map(coerceTrack) : tracks };
  }
  if ('fitContent' in value) return { fitContent: coercePercent((value as { fitContent: unknown }).fitContent) };
  if ('min' in value || 'max' in value) {
    const { min, max } = value as { min: unknown; max: unknown };
    return { min: coerceTrack(min), max: coerceTrack(max) };
  }
  return value; // `{ percent: n }` or `{ fr: n }` — already in engine form.
}

/**
 * Expand a flat {@link StyleInput} into the engine's resolved {@link Style},
 * filling in defaults for everything omitted.
 *
 * @remarks
 * The engine works in normalized {@link Size} / {@link Rect} / {@link Point}
 * shapes because they make the axis-generic math tractable — `main(size, dir)`
 * and `cross(size, dir)` need a pair, not four loose properties. Flat CSS names
 * are the input dialect only; this is the single point where the two meet.
 */
export function resolveStyle(input: StyleInput = {}): Style {
  return mergeStyle(defaultStyle(), input);
}

/**
 * Merge flat `input` over the resolved `base`, writing each flat key into the
 * nested field it maps to.
 *
 * @remarks
 * Shared by {@link resolveStyle} and `LayoutNode.setStyle`, so construction and
 * mutation expand flat input identically.
 *
 * Nested objects touched by `input` are rebuilt rather than mutated in place,
 * which keeps two guarantees at once: `base` is never written through (a node's
 * existing style object is not modified underneath it), and the caller retains
 * no live handle on the result. That second point is what makes mutation
 * tracking possible — a style reachable from outside could go stale with no
 * setter called, and no dirty flag could be trusted.
 *
 * Unlike the old nested input, a flat key sets exactly one field: passing
 * `width` leaves `height` alone instead of replacing the whole `size` object.
 *
 * @internal
 */
export function mergeStyle(base: Style, input: StyleInput): Style {
  const style: Style = { ...base };
  const rebuilt = new Set<string>();

  // A shorthand stands in for its longhands, so expand it in place: later keys
  // still overwrite earlier ones, which is what makes `{ padding: 8,
  // paddingTop: 0 }` behave the way the cascade would.
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (key in SHORTHAND_TO_LONGHANDS) {
      entries.push(...expandShorthand(key, value));
    } else {
      entries.push([key, value]);
    }
  }

  for (const [flatKey, raw] of entries) {
    // `'50%'` is input spelling only; normalize before anything stores it, so
    // the engine and `node.style` only ever see the 0..1 fraction.
    const value = coercePercent(raw);
    const mapping = (FLAT_TO_NESTED as Record<string, readonly [keyof Style, string] | undefined>)[flatKey];
    if (mapping === undefined) {
      // Scalar (or already-structured) property: copy arrays/objects so the
      // caller keeps no handle on what the node now owns. A track list is
      // copied by the same walk that converts the percentages inside it.
      (style as unknown as Record<string, unknown>)[flatKey] = Array.isArray(value)
        ? TRACK_LIST_KEYS.has(flatKey)
          ? value.map(coerceTrack)
          : [...value]
        : value;
      continue;
    }
    const [nestedKey, subKey] = mapping;
    // Rebuild the nested object once, then write each flat key into the copy.
    if (!rebuilt.has(nestedKey)) {
      (style as unknown as Record<string, unknown>)[nestedKey] = { ...(base[nestedKey] as object) };
      rebuilt.add(nestedKey);
    }
    (style[nestedKey] as Record<string, unknown>)[subKey] = value;
  }

  return style;
}

// --- Resolution (port of util/resolve.rs)

/** LengthPercentage[Auto]/Dimension → Option<f32> against an optional basis. */
export function maybeResolve(value: LengthPercentageAuto, context: Opt): Opt {
  if (value === 'auto') return null;
  if (typeof value === 'number') return value;
  return context !== null ? context * value.percent : null;
}

export function resolveOrZero(value: LengthPercentageAuto, context: Opt): number {
  return maybeResolve(value, context) ?? 0;
}

export function maybeResolveSize(s: Size<Dimension>, context: Size<Opt>): Size<Opt> {
  return { width: maybeResolve(s.width, context.width), height: maybeResolve(s.height, context.height) };
}

export function resolveSizeOrZero(s: Size<LengthPercentage>, context: Size<Opt>): Size<number> {
  return { width: resolveOrZero(s.width, context.width), height: resolveOrZero(s.height, context.height) };
}

/** All four sides resolved against a single (inline-size) basis. */
export function resolveRectOrZero(r: Rect<LengthPercentageAuto>, context: Opt): Rect<number> {
  return {
    left: resolveOrZero(r.left, context),
    right: resolveOrZero(r.right, context),
    top: resolveOrZero(r.top, context),
    bottom: resolveOrZero(r.bottom, context),
  };
}

/**
 * left/right resolved against width, top/bottom against height.
 *
 * NOTE: correct for `inset`, wrong for padding/margin/border — those resolve
 * against the inline size on all four sides (css-box-3 §4). Using it for
 * padding was a real bug. Currently unused; a candidate for removal in the
 * pre-publish API review.
 */
export function resolveRectOrZeroPerAxis(r: Rect<LengthPercentageAuto>, context: Size<Opt>): Rect<number> {
  return {
    left: resolveOrZero(r.left, context.width),
    right: resolveOrZero(r.right, context.width),
    top: resolveOrZero(r.top, context.height),
    bottom: resolveOrZero(r.bottom, context.height),
  };
}

/** left/right resolved against width, top/bottom against height, auto → null. */
export function maybeResolveRectPerAxis(r: Rect<LengthPercentageAuto>, context: Size<Opt>): Rect<Opt> {
  return {
    left: maybeResolve(r.left, context.width),
    right: maybeResolve(r.right, context.width),
    top: maybeResolve(r.top, context.height),
    bottom: maybeResolve(r.bottom, context.height),
  };
}

// --- Style predicates

export const isScrollContainer = (o: Overflow): boolean => o === 'hidden' || o === 'scroll';

/** Overflow::maybe_into_automatic_min_size */
export const overflowAutoMinSize = (o: Overflow): Opt => (isScrollContainer(o) ? 0 : null);

// --- AvailableSpace helpers (port of style/available_space.rs + math impls)

export const asIntoOption = (avs: AvailableSpace): Opt => (typeof avs === 'number' ? avs : null);

export function asMaybeSet(avs: AvailableSpace, value: Opt): AvailableSpace {
  return value !== null ? value : avs;
}

export function asMapDefinite(avs: AvailableSpace, f: (v: number) => number): AvailableSpace {
  return typeof avs === 'number' ? f(avs) : avs;
}

export function asMaybeSub(avs: AvailableSpace, rhs: Opt): AvailableSpace {
  return typeof avs === 'number' && rhs !== null ? avs - rhs : avs;
}

export function asMaybeClamp(avs: AvailableSpace, min: Opt, max: Opt): AvailableSpace {
  if (typeof avs !== 'number') return avs;
  let v = avs;
  if (max !== null) v = Math.min(v, max);
  if (min !== null) v = Math.max(v, min);
  return v;
}

// --- Alignment constants

export const ALIGN_STRETCH: AlignItems = { keyword: 'stretch', safe: false };
export const ALIGN_CONTENT_STRETCH: AlignContent = { keyword: 'stretch', safe: false };

/**
 * Thrown when a style value cannot be laid out.
 *
 * @remarks
 * Usually raised from {@link computeLayout} rather than from the constructor or
 * {@link LayoutNode.setStyle} — styles are stored as given and only validated
 * when layout actually reaches them, so the stack points at the layout call
 * rather than at the node that carries the bad value. The message names the
 * offending value.
 *
 * The one exception is a malformed percentage string (`'fifty%'`), which throws
 * where the style is set. That value has to be converted on the way in, so
 * there is nothing to store and defer, and failing at the offending
 * `LayoutNode.make` beats a `NaN` that surfaces as an empty layout later.
 *
 * This is deliberately narrow. Only values that make layout impossible throw; a
 * merely nonsensical one does not. Grid line `0` is the instructive case — CSS
 * says an invalid placement falls back to `auto`, so it lays out rather than
 * throwing. Today the reachable causes are a `repeat()` whose track count is
 * not finite (`NaN` or `Infinity`), and an internal grid line of `0` reached
 * after that fallback.
 *
 * @example
 * ```typescript
 * import { InvalidStyleError, LayoutNode, computeLayout } from 'bento-layout';
 *
 * const root = LayoutNode.make({
 *   display: 'grid',
 *   gridTemplateColumns: [{ repeat: Number.NaN, tracks: [{ min: 10, max: 10 }] }],
 * }, [LayoutNode.make()]);
 *
 * try {
 *   computeLayout(root, { width: 'max-content', height: 'max-content' });
 * } catch (err) {
 *   if (err instanceof InvalidStyleError) {
 *     console.error('bad style:', err.message);
 *   }
 * }
 * ```
 */
export class InvalidStyleError extends Error {
  override readonly name = 'InvalidStyleError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

// --- Grid style types (port of style/grid.rs, unnamed-track subset)

/**
 * Lower bound of a grid track's size — the `min` half of CSS `minmax()`.
 *
 * @remarks
 * A length or percentage is a fixed floor. `'min-content'` and `'max-content'`
 * floor the track at its items' intrinsic sizes, and `'auto'` behaves as
 * `'min-content'` here but additionally lets the track stretch under
 * `alignContent`/`justifyContent: 'stretch'`. Flexible (`fr`) values are not
 * valid as a minimum — see {@link MaxTrackSizingFunction}.
 */
export type MinTrackSizingFunction = LengthPercentage | 'auto' | 'min-content' | 'max-content';

/**
 * Upper bound of a grid track's size — the `max` half of CSS `minmax()`.
 *
 * @remarks
 * Everything {@link MinTrackSizingFunction} allows, plus the two things only a
 * maximum can express: `{ fr: n }` for a flexible track that divides leftover
 * space in proportion to `n` (CSS `1fr`), and `{ fitContent: limit }` for a
 * track that sizes to its content but stops at `limit` (CSS `fit-content()`).
 */
export type MaxTrackSizingFunction =
  | MinTrackSizingFunction
  | { fr: number }
  | { fitContent: LengthPercentage };

/** {@link MinTrackSizingFunction} as written in input, where `'50%'` is also legal. */
export type MinTrackSizingFunctionInput = LengthPercentageInput | 'auto' | 'min-content' | 'max-content';

/** {@link MaxTrackSizingFunction} as written in input, where `'50%'` is also legal. */
export type MaxTrackSizingFunctionInput =
  | MinTrackSizingFunctionInput
  | { fr: number }
  | { fitContent: LengthPercentageInput };

/**
 * A single grid track's sizing bounds — CSS `minmax(min, max)`.
 *
 * @remarks
 * A CSS track written as one value sets both bounds: `100px` is
 * `{ min: 100, max: 100 }`, and `1fr` is `{ min: 'auto', max: { fr: 1 } }`.
 * There is no single-value shorthand here, so state both.
 *
 * @example
 * ```typescript
 * const fixed = { min: 100, max: 100 };                      // 100px
 * const flexible = { min: 'auto', max: { fr: 1 } } as const; // 1fr
 * const bounded = { min: 100, max: { fr: 1 } } as const;     // minmax(100px, 1fr)
 * ```
 */
export interface TrackSizingFunction {
  min: MinTrackSizingFunction;
  max: MaxTrackSizingFunction;
}

/** {@link TrackSizingFunction} as written in input, where `'50%'` is also legal. */
export interface TrackSizingFunctionInput {
  min: MinTrackSizingFunctionInput;
  max: MaxTrackSizingFunctionInput;
}

/**
 * How many times a `repeat()` repeats.
 *
 * @remarks
 * A number repeats exactly that many times. `'auto-fill'` fits as many
 * repetitions as the container allows; `'auto-fit'` does the same but then
 * collapses repetitions that ended up empty, letting the remaining tracks take
 * that space. They differ only when there are fewer items than tracks.
 */
export type RepetitionCount = number | 'auto-fill' | 'auto-fit';

/**
 * One entry in {@link Style.gridTemplateRows} or
 * {@link Style.gridTemplateColumns}: either a single track or a `repeat()`.
 *
 * @remarks
 * A template is an array of these, and a `repeat()` expands in place to the
 * tracks it names.
 *
 * @example
 * A 200px sidebar and as many 150px-minimum columns as fit beside it.
 *
 * The container needs a definite width for `auto-fill` to have anything to fill
 * — an auto-sized grid shrink-wraps its content and produces a single
 * repetition.
 * ```typescript
 * const grid = LayoutNode.make({
 *   display: 'grid',
 *   width: 800,
 *   height: 200,
 *   gridTemplateColumns: [
 *     { min: 200, max: 200 },
 *     { repeat: 'auto-fill', tracks: [{ min: 150, max: { fr: 1 } }] },
 *   ],
 * }, [LayoutNode.make(), LayoutNode.make(), LayoutNode.make()]);
 *
 * // tracks: 200px sidebar, then 150px-minimum columns filling the remaining 600px
 * ```
 */
export type GridTemplateComponent =
  | TrackSizingFunction
  | { repeat: RepetitionCount; tracks: TrackSizingFunction[] };

/** {@link GridTemplateComponent} as written in input, where `'50%'` is also legal. */
export type GridTemplateComponentInput =
  | TrackSizingFunctionInput
  | { repeat: RepetitionCount; tracks: TrackSizingFunctionInput[] };

/**
 * Direction and packing used to place items that have no explicit position.
 *
 * @remarks
 * `'row'` fills each row before moving down; `'column'` fills each column
 * first. The `-dense` variants backtrack to fill holes left by explicitly
 * placed items, at the cost of items appearing out of source order.
 */
export type GridAutoFlow = 'row' | 'column' | 'row-dense' | 'column-dense';

/**
 * Where a grid item starts or ends on one axis.
 *
 * @remarks
 * `'auto'` leaves it to automatic placement. `{ line: n }` names a grid line:
 * lines are **1-based**, and negative numbers count back from the end, so
 * `{ line: -1 }` is the last line — the idiom for "stretch to the end".
 * `{ span: n }` sizes the item in tracks instead of pinning it to a line.
 *
 * Line `0` does not exist in CSS. It is treated as `'auto'` rather than
 * throwing, matching how browsers recover from an invalid placement.
 *
 * @example
 * ```typescript
 * const banner = LayoutNode.make({
 *   gridColumnStart: { line: 1 }, // full width…
 *   gridColumnEnd: { line: -1 }, // …to the last line
 *   gridRowEnd: { span: 2 },     // two rows tall
 * });
 * ```
 */
export type GridPlacement = 'auto' | { line: number } | { span: number };

/**
 * An item's placement on one axis, as a start/end pair — CSS `grid-row` /
 * `grid-column`.
 *
 * @see {@link GridPlacement} for what each end accepts.
 */
export interface GridPlacementLine {
  start: GridPlacement;
  end: GridPlacement;
}

export const AUTO_TRACK: TrackSizingFunction = { min: 'auto', max: 'auto' };

export const isRepeat = (c: GridTemplateComponent): c is { repeat: RepetitionCount; tracks: TrackSizingFunction[] } =>
  typeof c === 'object' && 'repeat' in c;

export const gridAutoFlowIsDense = (f: GridAutoFlow): boolean => f === 'row-dense' || f === 'column-dense';
/** Whether auto placement fills row-wise (horizontal primary axis) or column-wise */
export const gridAutoFlowPrimaryAxis = (f: GridAutoFlow): 'horizontal' | 'vertical' =>
  f === 'row' || f === 'row-dense' ? 'horizontal' : 'vertical';

// --- Track sizing function helpers (port of Min/MaxTrackSizingFunction impls)

const isLp = (v: MaxTrackSizingFunction): v is LengthPercentage =>
  typeof v === 'number' || (typeof v === 'object' && 'percent' in v);

export function minIsIntrinsic(min: MinTrackSizingFunction): boolean {
  return min === 'auto' || min === 'min-content' || min === 'max-content';
}

export function maxIsIntrinsic(max: MaxTrackSizingFunction): boolean {
  return (
    max === 'auto' ||
    max === 'min-content' ||
    max === 'max-content' ||
    (typeof max === 'object' && 'fitContent' in max)
  );
}

/** "Treat auto and fit-content() as max-content" — css-grid-1 §11.1 */
export function maxIsMaxContentAlike(max: MaxTrackSizingFunction): boolean {
  return max === 'auto' || max === 'max-content' || (typeof max === 'object' && 'fitContent' in max);
}

export function maxIsMaxOrFitContent(max: MaxTrackSizingFunction): boolean {
  return max === 'max-content' || (typeof max === 'object' && 'fitContent' in max);
}

export const maxIsFr = (max: MaxTrackSizingFunction): max is { fr: number } =>
  typeof max === 'object' && 'fr' in max;

export const maxIsFitContent = (max: MaxTrackSizingFunction): max is { fitContent: LengthPercentage } =>
  typeof max === 'object' && 'fitContent' in max;

/** Definite value of a min/max sizing function (length always; percent against parent) */
export function trackDefiniteValue(v: MinTrackSizingFunction | MaxTrackSizingFunction, parentSize: Opt): Opt {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'percent' in v) return parentSize !== null ? v.percent * parentSize : null;
  return null;
}

/** Like trackDefiniteValue but fit-content() limits also resolve */
export function maxDefiniteLimit(max: MaxTrackSizingFunction, parentSize: Opt): Opt {
  if (maxIsFitContent(max)) {
    const limit = max.fitContent;
    if (typeof limit === 'number') return limit;
    return parentSize !== null ? limit.percent * parentSize : null;
  }
  return trackDefiniteValue(max, parentSize);
}

/** Resolved size of a percentage sizing function (null for everything else) */
export function trackResolvedPercentageSize(
  v: MinTrackSizingFunction | MaxTrackSizingFunction,
  parentSize: number,
): Opt {
  return typeof v === 'object' && 'percent' in v ? v.percent * parentSize : null;
}

export function trackUsesPercentage(v: MinTrackSizingFunction | MaxTrackSizingFunction): boolean {
  if (typeof v !== 'object') return false;
  if ('percent' in v) return true;
  // fit-content(<percent>) also counts as using a percentage
  return 'fitContent' in v && typeof v.fitContent === 'object';
}

export function maxHasDefiniteValue(max: MaxTrackSizingFunction, parentSize: Opt): boolean {
  if (typeof max === 'number') return true;
  if (typeof max === 'object' && 'percent' in max) return parentSize !== null;
  return false;
}

export function trackHasFixedComponent(track: TrackSizingFunction): boolean {
  return isLp(track.min as MaxTrackSizingFunction) || isLp(track.max);
}
