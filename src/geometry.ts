// Port of taffy/src/geometry.rs (subset needed for flexbox).
// Size/Rect/Point are plain objects; axis helpers take the flex-direction.

export interface Size<T> {
  width: T;
  height: T;
}

export interface Rect<T> {
  left: T;
  right: T;
  top: T;
  bottom: T;
}

export interface Point<T> {
  x: T;
  y: T;
}

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
