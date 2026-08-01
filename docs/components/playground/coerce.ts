// CSS-shaped strings -> engine style values, for demo source only.
//
// The library's `StyleInput` is deliberately structured-only (`10`, not
// `'10px'`; `{ percent: 0.5 }`, not `'50%'`). Written that way a demo stops
// looking like CSS and starts looking like a config file, so demo source gets
// this coercion layer. It lives here rather than in `src/` on purpose: a
// playground can be far less careful than a published API, and the library
// states it ships no CSS parser.
//
// Semantics carry over from tests/harness/fixture.ts, which is the version with
// 4417 browser-generated fixtures behind it: a bare `fr` and `fit-content()`
// take an `auto` minimum, percentages divide by 100, `minmax()` maps to
// `{ min, max }`. The tokenizer differs — that parser's shortcuts are silent on
// input it never sees (`parseGridPlacement('abc')` yields `{ line: NaN }`), and
// a playground gets half-typed input on every keystroke.

import valueParser from 'postcss-value-parser';
import type {
  AlignContent,
  AlignContentKeyword,
  AlignItems,
  AlignItemsKeyword,
  Dimension,
  GridPlacement,
  GridTemplateComponent,
  LengthPercentage,
  MaxTrackSizingFunction,
  MinTrackSizingFunction,
  RepetitionCount,
  StyleInput,
  TrackSizingFunction,
} from 'bento-layout';

/** Thrown for any demo value the engine cannot lay out. Caught by <Demo>. */
export class CoercionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoercionError';
  }
}

const ALIGN_ITEMS_KEYWORDS = new Set<string>([
  'start',
  'end',
  'flex-start',
  'flex-end',
  'center',
  'baseline',
  'stretch',
]);

const ALIGN_CONTENT_KEYWORDS = new Set<string>([
  'start',
  'end',
  'flex-start',
  'flex-end',
  'center',
  'stretch',
  'space-between',
  'space-evenly',
  'space-around',
]);

const INTRINSIC_KEYWORDS = new Set<string>(['auto', 'min-content', 'max-content']);

/**
 * A number that reached the engine as NaN survives every bounds check (all
 * comparisons with NaN are false) and can hang the sizing algorithms outright —
 * the same failure `tests/harness/fixture.ts` records in `parseLength`, where
 * `width: min-content` reached findSizeOfFr with spaceToFill=NaN and spun
 * forever. In a playground that is a locked browser tab rather than a red
 * banner, so every number funnels through here.
 */
function finite(n: number, source: string): number {
  if (!Number.isFinite(n)) {
    throw new CoercionError(`"${source}" is not a finite number`);
  }
  return n;
}

/** Split a value string into its top-level words, dropping whitespace. */
function topLevelNodes(input: string): valueParser.Node[] {
  return valueParser(input.trim()).nodes.filter(
    (n) => n.type !== 'space' && n.type !== 'div',
  );
}

/**
 * `'100px'` -> `100`, `'50%'` -> `{ percent: 0.5 }`.
 *
 * The percentage divides by 100 because the engine models percentages as 0..1
 * fractions — `{ percent: 50 }` would mean 5000%.
 */
export function coerceLengthPercentage(value: unknown, prop: string): LengthPercentage {
  if (typeof value === 'number') return finite(value, `${prop}: ${value}`);
  if (typeof value === 'object' && value !== null) return value as LengthPercentage;
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected a length, got ${typeof value}`);
  }

  const parsed = valueParser.unit(value.trim());
  if (parsed === false) {
    throw new CoercionError(`${prop}: cannot read "${value}" as a length`);
  }
  const n = finite(parseFloat(parsed.number), `${prop}: ${value}`);

  switch (parsed.unit) {
    case 'px':
      return n;
    case '%':
      return { percent: n / 100 };
    case '':
      return n;
    case 'fr':
      throw new CoercionError(
        `${prop}: "fr" is only valid in a grid track, not as a ${prop}`,
      );
    default:
      throw new CoercionError(
        `${prop}: unsupported unit "${parsed.unit}" in "${value}" — use px or %`,
      );
  }
}

/** A {@link coerceLengthPercentage} that also accepts `'auto'`. */
export function coerceDimension(value: unknown, prop: string): Dimension {
  if (typeof value === 'string' && value.trim() === 'auto') return 'auto';
  return coerceLengthPercentage(value, prop);
}

/**
 * A plain pixel number — no percentage form.
 *
 * `scrollbarWidth` is the one style property the engine types as a bare
 * `number` rather than a length, so a percentage has nothing to resolve
 * against. Without this, a demo writing the natural `'12px'` sent the string
 * itself into the engine, where it poisoned the gutter arithmetic into NaN and
 * the whole preview vanished.
 */
export function coerceNumber(value: unknown, prop: string): number {
  if (typeof value === 'number') return finite(value, `${prop}: ${value}`);
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected a number, got ${typeof value}`);
  }
  const parsed = valueParser.unit(value.trim());
  if (parsed === false || (parsed.unit !== 'px' && parsed.unit !== '')) {
    throw new CoercionError(`${prop}: cannot read "${value}" as a number of pixels`);
  }
  return finite(parseFloat(parsed.number), `${prop}: ${value}`);
}

function splitSafe(value: string): { safe: boolean; keyword: string } {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 2 && (parts[0] === 'safe' || parts[0] === 'unsafe')) {
    return { safe: parts[0] === 'safe', keyword: parts[1]! };
  }
  return { safe: false, keyword: parts[0] ?? '' };
}

/** `'center'` -> `{ keyword: 'center', safe: false }`; `'safe center'` sets the flag. */
export function coerceAlignItems(value: unknown, prop: string): AlignItems {
  if (typeof value === 'object' && value !== null) return value as AlignItems;
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected an alignment keyword`);
  }
  const { safe, keyword } = splitSafe(value);
  if (!ALIGN_ITEMS_KEYWORDS.has(keyword)) {
    throw new CoercionError(`${prop}: unknown alignment "${value}"`);
  }
  return { keyword: keyword as AlignItemsKeyword, safe };
}

/** As {@link coerceAlignItems}, over the wider keyword set that adds `space-*`. */
export function coerceAlignContent(value: unknown, prop: string): AlignContent {
  if (typeof value === 'object' && value !== null) return value as AlignContent;
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected an alignment keyword`);
  }
  const { safe, keyword } = splitSafe(value);
  if (!ALIGN_CONTENT_KEYWORDS.has(keyword)) {
    throw new CoercionError(`${prop}: unknown alignment "${value}"`);
  }
  return { keyword: keyword as AlignContentKeyword, safe };
}

function coerceMinTrack(node: valueParser.Node, prop: string): MinTrackSizingFunction {
  if (node.type === 'function') {
    throw new CoercionError(`${prop}: ${node.value}() is not valid as a track minimum`);
  }
  const raw = valueParser.stringify(node);
  if (INTRINSIC_KEYWORDS.has(raw)) return raw as MinTrackSizingFunction;
  const unit = valueParser.unit(raw);
  if (unit !== false && unit.unit === 'fr') {
    throw new CoercionError(`${prop}: "fr" is not valid as a track minimum`);
  }
  return coerceLengthPercentage(raw, prop);
}

function coerceMaxTrack(node: valueParser.Node, prop: string): MaxTrackSizingFunction {
  if (node.type === 'function') {
    if (node.value !== 'fit-content') {
      throw new CoercionError(`${prop}: unexpected ${node.value}() in a track size`);
    }
    const args = node.nodes.filter((n) => n.type !== 'space' && n.type !== 'div');
    if (args.length !== 1) {
      throw new CoercionError(`${prop}: fit-content() takes exactly one length`);
    }
    return { fitContent: coerceLengthPercentage(valueParser.stringify(args[0]!), prop) };
  }

  const raw = valueParser.stringify(node);
  if (INTRINSIC_KEYWORDS.has(raw)) return raw as MaxTrackSizingFunction;
  const unit = valueParser.unit(raw);
  if (unit !== false && unit.unit === 'fr') {
    return { fr: finite(parseFloat(unit.number), `${prop}: ${raw}`) };
  }
  return coerceLengthPercentage(raw, prop);
}

/**
 * One track: `'100px'`, `'1fr'`, `'auto'`, `minmax(a, b)`, `fit-content(n)`.
 *
 * A single value sets both bounds, except that flexible and fit-content tracks
 * take an `auto` minimum — CSS says `1fr` means `minmax(auto, 1fr)`.
 */
function coerceTrack(node: valueParser.Node, prop: string): TrackSizingFunction {
  if (node.type === 'function' && node.value === 'minmax') {
    const args = node.nodes.filter((n) => n.type !== 'space' && n.type !== 'div');
    if (args.length !== 2) {
      throw new CoercionError(`${prop}: minmax() takes exactly two arguments`);
    }
    return {
      min: coerceMinTrack(args[0]!, prop),
      max: coerceMaxTrack(args[1]!, prop),
    };
  }

  const max = coerceMaxTrack(node, prop);
  const min: MinTrackSizingFunction =
    typeof max === 'object' && max !== null && ('fr' in max || 'fitContent' in max)
      ? 'auto'
      : (max as MinTrackSizingFunction);
  return { min, max };
}

function coerceRepetitionCount(node: valueParser.Node, prop: string): RepetitionCount {
  const raw = valueParser.stringify(node);
  if (raw === 'auto-fill' || raw === 'auto-fit') return raw;
  const n = finite(parseFloat(raw), `${prop}: repeat(${raw}, …)`);
  if (!Number.isInteger(n) || n < 1) {
    throw new CoercionError(`${prop}: repeat() count must be a positive integer, got "${raw}"`);
  }
  return n;
}

/**
 * A whole track list: `'100px 1fr auto'`,
 * `'repeat(auto-fill, minmax(100px, 1fr))'`, or a mix.
 */
export function coerceTrackList(value: unknown, prop: string): GridTemplateComponent[] {
  if (Array.isArray(value)) return value as GridTemplateComponent[];
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected a track list string or array`);
  }

  return topLevelNodes(value).map((node): GridTemplateComponent => {
    if (node.type === 'function' && node.value === 'repeat') {
      // postcss-value-parser keeps the comma as a `div` node, so the count is
      // everything before the first one and the tracks are what follows.
      const commaAt = node.nodes.findIndex((n) => n.type === 'div' && n.value === ',');
      if (commaAt === -1) {
        throw new CoercionError(`${prop}: repeat() needs a count and a track list`);
      }
      const countNodes = node.nodes
        .slice(0, commaAt)
        .filter((n) => n.type !== 'space' && n.type !== 'div');
      const trackNodes = node.nodes
        .slice(commaAt + 1)
        .filter((n) => n.type !== 'space' && n.type !== 'div');
      if (countNodes.length !== 1 || trackNodes.length === 0) {
        throw new CoercionError(`${prop}: repeat() needs a count and a track list`);
      }
      return {
        repeat: coerceRepetitionCount(countNodes[0]!, prop),
        tracks: trackNodes.map((t) => coerceTrack(t, prop)),
      };
    }
    return coerceTrack(node, prop);
  });
}

/** `'auto'`, `'span 2'`, `'-1'` -> the engine's placement form. */
export function coerceGridPlacement(value: unknown, prop: string): GridPlacement {
  if (typeof value === 'object' && value !== null) return value as GridPlacement;
  if (typeof value === 'number') return { line: finite(value, `${prop}: ${value}`) };
  if (typeof value !== 'string') {
    throw new CoercionError(`${prop}: expected a grid line, span, or "auto"`);
  }

  const raw = value.trim();
  if (raw === 'auto') return 'auto';

  const span = /^span\s+(-?[\d.]+)$/.exec(raw);
  if (span) {
    const n = finite(parseFloat(span[1]!), `${prop}: ${raw}`);
    if (!Number.isInteger(n) || n < 1) {
      throw new CoercionError(`${prop}: span must be a positive integer, got "${raw}"`);
    }
    return { span: n };
  }

  const n = parseFloat(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CoercionError(`${prop}: cannot read "${value}" as a grid line`);
  }
  return { line: n };
}

// Which coercion each style property takes. Anything absent is passed through
// untouched — enums (`display`, `flexDirection`), plain numbers (`flexGrow`),
// and already-structured values all reach the engine as written.
type Coercer = (value: unknown, prop: string) => unknown;

const DIMENSION_PROPS = [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flexBasis',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'left',
  'right',
  'top',
  'bottom',
] as const;

const LENGTH_PROPS = [
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'borderLeft',
  'borderRight',
  'borderTop',
  'borderBottom',
  'columnGap',
  'rowGap',
] as const;

const COERCERS: Record<string, Coercer> = {
  ...Object.fromEntries(DIMENSION_PROPS.map((p) => [p, coerceDimension])),
  ...Object.fromEntries(LENGTH_PROPS.map((p) => [p, coerceLengthPercentage])),
  alignItems: coerceAlignItems,
  alignSelf: coerceAlignItems,
  justifyItems: coerceAlignItems,
  justifySelf: coerceAlignItems,
  alignContent: coerceAlignContent,
  justifyContent: coerceAlignContent,
  gridTemplateRows: coerceTrackList,
  gridTemplateColumns: coerceTrackList,
  gridAutoRows: coerceTrackList,
  gridAutoColumns: coerceTrackList,
  gridRowStart: coerceGridPlacement,
  gridRowEnd: coerceGridPlacement,
  gridColumnStart: coerceGridPlacement,
  gridColumnEnd: coerceGridPlacement,
  scrollbarWidth: coerceNumber,
  aspectRatio: coerceNumber,
  // Shorthands. The library expands these into longhands; coercion only has to
  // reach the values inside, whether uniform or per-side.
  padding: coerceShorthand(coerceLengthPercentage),
  border: coerceShorthand(coerceLengthPercentage),
  gap: coerceShorthand(coerceLengthPercentage),
  margin: coerceShorthand(coerceDimension),
  inset: coerceShorthand(coerceDimension),
};

/**
 * Coerce a shorthand's value: either one value for every side, or an object
 * naming some of them. The library expands the shorthand itself; this only has
 * to turn the CSS-shaped strings inside it into engine values.
 */
function coerceShorthand(coercer: Coercer): Coercer {
  return (value, prop) => {
    if (typeof value === 'object' && value !== null && !('percent' in value)) {
      return Object.fromEntries(
        Object.entries(value).map(([side, v]) => [side, coercer(v, `${prop}.${side}`)]),
      );
    }
    return coercer(value, prop);
  };
}

/**
 * Run a demo's style object through the coercions above, leaving properties
 * with no coercer untouched.
 *
 * @throws {@link CoercionError} for any value the engine cannot lay out.
 */
export function coerceStyle(raw: Record<string, unknown>): StyleInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const coercer = COERCERS[key];
    out[key] = coercer ? coercer(value, key) : value;
  }
  return out as StyleInput;
}
