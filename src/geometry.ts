// Geometry primitives. Size/Rect/Point are plain objects; axis helpers take
// the flex-direction.

/**
 * A width/height pair.
 *
 * @remarks
 * The container for anything two-dimensional: `size`, `minSize`, `maxSize`, and
 * `gap` in a {@link Style}, sizes in a {@link Layout}, and the arguments to a
 * {@link MeasureFunction}. `T` varies by use — `Size<number>` for computed
 * pixels, `Size<Dimension>` for styles that accept `'auto'` and percentages.
 *
 * Note that `gap` uses this axis-wise: `width` is the gap *between columns*,
 * `height` the gap between rows.
 *
 * @typeParam T - Type of each axis value.
 */
export interface Size<T> {
  width: T;
  height: T;
}

/**
 * A value for each of the four physical sides.
 *
 * @remarks
 * Used for `margin`, `padding`, `border`, and `inset`. Sides are physical and
 * never flip: `left` stays left under `direction: 'rtl'`, so the *start* edge
 * is `right` in that case.
 *
 * There is no shorthand — always give all four sides.
 *
 * @typeParam T - Type of each side's value.
 *
 * @example
 * ```typescript
 * const padding = { left: 10, right: 10, top: 5, bottom: 5 };
 * ```
 */
export interface Rect<T> {
  left: T;
  right: T;
  top: T;
  bottom: T;
}

/**
 * An x/y pair.
 *
 * @remarks
 * Used for positions — `Layout.location` — and for per-axis settings such as
 * `Style.overflow`, where `x` is the horizontal axis and `y` the vertical.
 *
 * @typeParam T - Type of each coordinate.
 */
export interface Point<T> {
  x: T;
  y: T;
}

/**
 * Main-axis direction of a flex container, and whether it runs in reverse.
 *
 * @remarks
 * `'row'` lays items out along the inline axis (horizontally in `ltr`) and
 * `'column'` down the block axis. The `-reverse` variants swap the start and
 * end edges, so items stack from the opposite side; they change layout order
 * only, not `Layout.order`.
 *
 * This also decides which axis alignment properties act on: `justifyContent`
 * always works along the main axis and `alignItems` across it, so both swap
 * meaning between `'row'` and `'column'`.
 */
export type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';
export type AbsoluteAxis = 'horizontal' | 'vertical';

export const isRow = (dir: FlexDirection): boolean => dir === 'row' || dir === 'row-reverse';
export const isColumn = (dir: FlexDirection): boolean => dir === 'column' || dir === 'column-reverse';
export const isReverse = (dir: FlexDirection): boolean => dir === 'row-reverse' || dir === 'column-reverse';
export const mainAxis = (dir: FlexDirection): AbsoluteAxis => (isRow(dir) ? 'horizontal' : 'vertical');
export const crossAxis = (dir: FlexDirection): AbsoluteAxis => (isRow(dir) ? 'vertical' : 'horizontal');
export const otherAxis = (axis: AbsoluteAxis): AbsoluteAxis => (axis === 'horizontal' ? 'vertical' : 'horizontal');

// --- Size helpers

export const size = <T>(width: T, height: T): Size<T> => ({ width, height });
export const sizeZero = (): Size<number> => ({ width: 0, height: 0 });
export const sizeNone = (): Size<number | null> => ({ width: null, height: null });

export function sizeMap<T, U>(s: Size<T>, f: (v: T) => U): Size<U> {
  return { width: f(s.width), height: f(s.height) };
}

export function sizeGetAbs<T>(s: Size<T>, axis: AbsoluteAxis): T {
  return axis === 'horizontal' ? s.width : s.height;
}

export function main<T>(s: Size<T>, dir: FlexDirection): T {
  return isRow(dir) ? s.width : s.height;
}

export function cross<T>(s: Size<T>, dir: FlexDirection): T {
  return isRow(dir) ? s.height : s.width;
}

export function setMain<T>(s: Size<T>, dir: FlexDirection, value: T): void {
  if (isRow(dir)) s.width = value;
  else s.height = value;
}

export function setCross<T>(s: Size<T>, dir: FlexDirection, value: T): void {
  if (isRow(dir)) s.height = value;
  else s.width = value;
}

export function withMain<T>(s: Size<T>, dir: FlexDirection, value: T): Size<T> {
  return isRow(dir) ? { width: value, height: s.height } : { width: s.width, height: value };
}

export function withCross<T>(s: Size<T>, dir: FlexDirection, value: T): Size<T> {
  return isRow(dir) ? { width: s.width, height: value } : { width: value, height: s.height };
}

export function sizeFromCross<T>(dir: FlexDirection, value: T): Size<T | null> {
  return isRow(dir) ? { width: null, height: value } : { width: value, height: null };
}

export function sizeAdd(a: Size<number>, b: Size<number>): Size<number> {
  return { width: a.width + b.width, height: a.height + b.height };
}

export function sizeSub(a: Size<number>, b: Size<number>): Size<number> {
  return { width: a.width - b.width, height: a.height - b.height };
}

export function sizeMax(a: Size<number>, b: Size<number>): Size<number> {
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
}

export function sizeOr<T>(a: Size<T | null>, b: Size<T | null>): Size<T | null> {
  return { width: a.width ?? b.width, height: a.height ?? b.height };
}

export function sizeUnwrapOr(a: Size<number | null>, b: Size<number>): Size<number> {
  return { width: a.width ?? b.width, height: a.height ?? b.height };
}

/** Port of Size<Option<f32>>::maybe_apply_aspect_ratio */
export function maybeApplyAspectRatio(s: Size<number | null>, aspectRatio: number | null): Size<number | null> {
  if (aspectRatio !== null) {
    if (s.width !== null && s.height === null) return { width: s.width, height: s.width / aspectRatio };
    if (s.width === null && s.height !== null) return { width: s.height * aspectRatio, height: s.height };
  }
  return { ...s };
}

/**
 * Transfer a min/max constraint through `aspect-ratio` onto the *stretched*
 * axis only (css-sizing-4 §5.2.2 constrains the ratio-determined size).
 *
 * A block child's inline axis is stretched by its parent, so `max-height: 20;
 * aspect-ratio: 2` caps that width at 40 — the constraint reaches the width
 * only because the width has no size of its own to hold it. Where the axis
 * instead takes its size from content or from a specified value, the transfer
 * must not apply: `max-width: 40; aspect-ratio: 2` around 60px of text is
 * 40x60, not 40x20, and `width: 80` with `max-height: 20` stays 80 wide.
 * Transferring unconditionally would cap overflowing content too.
 */
export function transferConstraintToStretchedAxis(
  constraint: Size<number | null>,
  styleSize: Size<number | null>,
  aspectRatio: number | null,
  stretched: Size<boolean>,
  /** How to reconcile a transferred constraint with one the axis already has.
   *  Minimums take the larger, maximums the smaller. Omit to keep the axis's
   *  own value and discard the transfer. */
  combine?: (own: number, transferred: number) => number,
): Size<number | null> {
  if (aspectRatio === null) return { ...constraint };
  // `maybeApplyAspectRatio` only fills an axis that is null, so an axis with a
  // constraint of its own never sees the transferred one. Both are constraints
  // of the same kind, so the used value is `combine` of the two rather than
  // whichever happened to be written down. Chrome, a block child with
  // `min-width: 20%; min-height: 120; aspect-ratio: 1.5` in a 17-wide parent:
  // 180x120 — the transferred 180 (=120x1.5) beats the 3.4 the percentage
  // resolves to — where keeping only the percentage left it at the stretch
  // width of 17.
  const transferred = maybeApplyAspectRatio(constraint, aspectRatio);
  const resolve = (axis: 'width' | 'height'): number | null => {
    if (!stretched[axis] || styleSize[axis] !== null) return constraint[axis];
    const own = constraint[axis];
    if (own === null) return transferred[axis];
    // The transfer needs the *other* axis to have supplied it; when this axis
    // filled its own value, `transferred` just echoes `own`.
    const other = axis === 'width' ? constraint.height : constraint.width;
    if (other === null || combine === undefined) return own;
    const fromOther = axis === 'width' ? other * aspectRatio : other / aspectRatio;
    return combine(own, fromOther);
  };
  return { width: resolve('width'), height: resolve('height') };
}

/**
 * The ratio-derived axis follows the *used* value of the specified one, so each
 * specified axis is clamped by its own min/max before the ratio fills in the
 * other (css-sizing-4 §5.2.2). Sizes here are border-box, matching min/max.
 *
 * `ratioBox` is the padding+border sum to strip before applying the ratio and
 * add back after — non-zero only under `box-sizing: content-box`, where the
 * ratio relates the *content* boxes (css-sizing-4 §4.1). Applying it to
 * border-box values there uses the wrong axis's inset on the derived axis:
 * `content-box; width: 120; aspect-ratio: 1` with 60px of horizontal border and
 * 55px of vertical border is 180x175 in Chrome (content 120x120), not 180x180.
 * Omit for border-box, where the ratio already relates the border boxes.
 *
 * The parameter exists because of the step order here: clamping before
 * deriving (min/max must stay on their own axis) moves the ratio onto
 * border-box values, where applying it directly would be wrong. Keep both
 * properties: clamp first, but relate the content boxes.
 */
export function applyAspectRatioClamped(
  size: Size<number | null>,
  minSize: Size<number | null>,
  maxSize: Size<number | null>,
  aspectRatio: number | null,
  ratioBox: Size<number> = { width: 0, height: 0 },
): Size<number | null> {
  const clamp = (v: number | null, min: number | null, max: number | null): number | null => {
    if (v === null) return null;
    let out = v;
    if (max !== null) out = Math.min(out, max);
    if (min !== null) out = Math.max(out, min);
    return out;
  };
  const clamped = {
    width: clamp(size.width, minSize.width, maxSize.width),
    height: clamp(size.height, minSize.height, maxSize.height),
  };
  if (aspectRatio === null || (ratioBox.width === 0 && ratioBox.height === 0)) {
    return maybeApplyAspectRatio(clamped, aspectRatio);
  }
  const inner = maybeApplyAspectRatio(
    {
      width: clamped.width !== null ? clamped.width - ratioBox.width : null,
      height: clamped.height !== null ? clamped.height - ratioBox.height : null,
    },
    aspectRatio,
  );
  return {
    width: inner.width !== null ? inner.width + ratioBox.width : null,
    height: inner.height !== null ? inner.height + ratioBox.height : null,
  };
}

// --- Rect helpers

export const rect = <T>(left: T, right: T, top: T, bottom: T): Rect<T> => ({ left, right, top, bottom });
export const rectZero = (): Rect<number> => ({ left: 0, right: 0, top: 0, bottom: 0 });

export function rectAdd(a: Rect<number>, b: Rect<number>): Rect<number> {
  return { left: a.left + b.left, right: a.right + b.right, top: a.top + b.top, bottom: a.bottom + b.bottom };
}

export const horizontalAxisSum = (r: Rect<number>): number => r.left + r.right;
export const verticalAxisSum = (r: Rect<number>): number => r.top + r.bottom;

export function sumAxes(r: Rect<number>): Size<number> {
  return { width: horizontalAxisSum(r), height: verticalAxisSum(r) };
}

export function rectMainAxisSum(r: Rect<number>, dir: FlexDirection): number {
  return isRow(dir) ? horizontalAxisSum(r) : verticalAxisSum(r);
}

export function rectCrossAxisSum(r: Rect<number>, dir: FlexDirection): number {
  return isRow(dir) ? verticalAxisSum(r) : horizontalAxisSum(r);
}

export function rectMainStart<T>(r: Rect<T>, dir: FlexDirection): T {
  return isRow(dir) ? r.left : r.top;
}

export function rectMainEnd<T>(r: Rect<T>, dir: FlexDirection): T {
  return isRow(dir) ? r.right : r.bottom;
}

export function rectCrossStart<T>(r: Rect<T>, dir: FlexDirection): T {
  return isRow(dir) ? r.top : r.left;
}

export function rectCrossEnd<T>(r: Rect<T>, dir: FlexDirection): T {
  return isRow(dir) ? r.bottom : r.right;
}

// --- Point helpers

export const pointZero = (): Point<number> => ({ x: 0, y: 0 });
export const pointNone = (): Point<number | null> => ({ x: null, y: null });

export function pointTranspose<T>(p: Point<T>): Point<T> {
  return { x: p.y, y: p.x };
}

export function pointMain<T>(p: Point<T>, dir: FlexDirection): T {
  return isRow(dir) ? p.x : p.y;
}

export function pointCross<T>(p: Point<T>, dir: FlexDirection): T {
  return isRow(dir) ? p.y : p.x;
}
