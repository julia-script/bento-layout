// Port of taffy/src/style/* (flexbox subset).
// Lengths are discriminated unions instead of taffy's bit-packed CompactLength:
//   number            → absolute length (px)
//   { percent: n }    → percentage as a 0..1 fraction
//   'auto'            → keyword auto

import type { FlexDirection, Point, Rect, Size } from './geometry.js';
import type { Opt } from './math.js';

export type LengthPercentage = number | { percent: number };
export type LengthPercentageAuto = LengthPercentage | 'auto';
export type Dimension = LengthPercentageAuto;

export type AvailableSpace = number | 'min-content' | 'max-content';

export type Display = 'flex' | 'none' | 'block' | 'grid';
export type BoxSizing = 'border-box' | 'content-box';
export type Direction = 'ltr' | 'rtl';
export type Position = 'relative' | 'absolute';
export type Overflow = 'visible' | 'clip' | 'hidden' | 'scroll';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type TextAlign = 'auto' | 'legacy-left' | 'legacy-right' | 'legacy-center';

export type AlignItemsKeyword = 'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
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

export interface AlignItems {
  keyword: AlignItemsKeyword;
  safe: boolean;
}
export interface AlignContent {
  keyword: AlignContentKeyword;
  safe: boolean;
}
export type AlignSelf = AlignItems;
export type JustifyContent = AlignContent;

/** Fully-resolved style. Public input is `Partial<Style>` — see resolveStyle. */
export interface Style {
  display: Display;
  boxSizing: BoxSizing;
  direction: Direction;
  overflow: Point<Overflow>;
  scrollbarWidth: number;
  position: Position;
  inset: Rect<LengthPercentageAuto>;
  size: Size<Dimension>;
  minSize: Size<Dimension>;
  maxSize: Size<Dimension>;
  aspectRatio: number | null;
  margin: Rect<LengthPercentageAuto>;
  padding: Rect<LengthPercentage>;
  border: Rect<LengthPercentage>;
  alignItems: AlignItems | null;
  alignSelf: AlignSelf | null;
  alignContent: AlignContent | null;
  justifyContent: JustifyContent | null;
  gap: Size<LengthPercentage>;
  textAlign: TextAlign;
  flexDirection: FlexDirection;
  flexWrap: FlexWrap;
  flexBasis: Dimension;
  flexGrow: number;
  flexShrink: number;
  justifyItems: AlignItems | null;
  justifySelf: AlignSelf | null;
  gridTemplateRows: GridTemplateComponent[];
  gridTemplateColumns: GridTemplateComponent[];
  gridAutoRows: TrackSizingFunction[];
  gridAutoColumns: TrackSizingFunction[];
  gridAutoFlow: GridAutoFlow;
  gridRow: GridPlacementLine;
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

export function resolveStyle(partial: Partial<Style> = {}): Style {
  return { ...defaultStyle(), ...partial };
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

/** left/right resolved against width, top/bottom against height. */
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

export function parseAlignItems(input: string): AlignItems {
  const parts = input.trim().split(/\s+/);
  if (parts[0] === 'safe') return { keyword: parts[1] as AlignItemsKeyword, safe: true };
  if (parts[0] === 'unsafe') return { keyword: parts[1] as AlignItemsKeyword, safe: false };
  return { keyword: parts[0] as AlignItemsKeyword, safe: false };
}

export function parseAlignContent(input: string): AlignContent {
  const parts = input.trim().split(/\s+/);
  if (parts[0] === 'safe') return { keyword: parts[1] as AlignContentKeyword, safe: true };
  if (parts[0] === 'unsafe') return { keyword: parts[1] as AlignContentKeyword, safe: false };
  return { keyword: parts[0] as AlignContentKeyword, safe: false };
}

// --- Grid style types (port of style/grid.rs, unnamed-track subset)

/** Min track sizing function: length/percent, auto, or min/max-content */
export type MinTrackSizingFunction = LengthPercentage | 'auto' | 'min-content' | 'max-content';
/** Max track sizing function: adds fr units and fit-content() */
export type MaxTrackSizingFunction =
  | MinTrackSizingFunction
  | { fr: number }
  | { fitContent: LengthPercentage };

/** A single track's sizing bounds (CSS minmax(); single values set both) */
export interface TrackSizingFunction {
  min: MinTrackSizingFunction;
  max: MaxTrackSizingFunction;
}

export type RepetitionCount = number | 'auto-fill' | 'auto-fit';

/** An entry in grid-template-rows/columns: a single track or a repeat() */
export type GridTemplateComponent =
  | TrackSizingFunction
  | { repeat: RepetitionCount; tracks: TrackSizingFunction[] };

export type GridAutoFlow = 'row' | 'column' | 'row-dense' | 'column-dense';

/** Grid line placement: auto, a 1-based line number (negative counts from end), or a span */
export type GridPlacement = 'auto' | { line: number } | { span: number };

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
