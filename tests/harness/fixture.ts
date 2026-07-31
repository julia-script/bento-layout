// Fixture XML parser + tree builder — port of taffy/tests/xml.rs (flexbox subset).

import { XMLParser } from 'fast-xml-parser';
import { createNode } from '../../src/index.js';
import type {
  AlignContent,
  AlignContentKeyword,
  AlignItems,
  AlignItemsKeyword,
  AvailableSpace,
  Dimension,
  GridPlacement,
  GridTemplateComponent,
  LengthPercentage,
  LengthPercentageAuto,
  MaxTrackSizingFunction,
  MinTrackSizingFunction,
  Node,
  Size,
  Style,
  TrackSizingFunction,
} from '../../src/index.js';
import { ahemTextMeasure } from './measure.js';
import type { WritingMode } from './measure.js';

export interface ExpectedNode {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ExpectedNode[];
}

export interface FixtureTest {
  name: string;
  useRounding: boolean;
  viewport: Size<AvailableSpace>;
  root: Node;
  expected: ExpectedNode;
  /** display values seen in the input tree (to detect block/grid fixtures) */
  displays: Set<string>;
}

type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseFixture(xml: string): FixtureTest {
  const doc = parser.parse(xml) as XmlNode[];
  const testEl = doc.find((el) => 'test' in el);
  if (!testEl) throw new Error('fixture has no <test> element');
  const testAttrs = testEl[':@'] ?? {};
  const children = testEl['test'] as XmlNode[];

  const viewportEl = children.find((el) => 'viewport' in el);
  const inputEl = children.find((el) => 'input' in el);
  const expectationsEl = children.find((el) => 'expectations' in el);
  if (!inputEl || !expectationsEl) throw new Error('fixture missing <input> or <expectations>');

  const viewportAttrs = viewportEl?.[':@'] ?? {};
  const viewport: Size<AvailableSpace> = {
    width: parseAvailableSpace(viewportAttrs['width']),
    height: parseAvailableSpace(viewportAttrs['height']),
  };

  const inputChildren = (inputEl['input'] as XmlNode[]).filter(isElement);
  const expectationChildren = (expectationsEl['expectations'] as XmlNode[]).filter(isElement);
  if (inputChildren.length !== 1 || expectationChildren.length !== 1) {
    throw new Error('fixture must have exactly one root input/expectation node');
  }

  const displays = new Set<string>();
  const root = buildNode(inputChildren[0]!, displays);
  const expected = buildExpected(expectationChildren[0]!);

  return {
    name: testAttrs['name'] ?? 'unnamed',
    useRounding: (testAttrs['use-rounding'] ?? 'true') !== 'false',
    viewport,
    root,
    expected,
    displays,
  };
}

function isElement(el: XmlNode): boolean {
  return !('#text' in el);
}

function elementTag(el: XmlNode): string {
  const key = Object.keys(el).find((k) => k !== ':@' && k !== '#text');
  if (!key) throw new Error('element has no tag');
  return key;
}

function buildNode(el: XmlNode, displays: Set<string>): Node {
  const tag = elementTag(el);
  const attrs = el[':@'] ?? {};
  const kids = (el[tag] as XmlNode[]) ?? [];
  const elementChildren = kids.filter(isElement);
  const style = buildStyle(attrs);
  if (attrs['display'] !== undefined) displays.add(attrs['display']);

  if (elementChildren.length > 0) {
    return createNode({ style, children: elementChildren.map((child) => buildNode(child, displays)) });
  }

  // Leaf: text content (if any) measured with the Ahem font
  // Trim only collapsible whitespace: U+00A0 (`&nbsp;`) is a rendered glyph
  // with real advance width, and JS `trim()` would strip it — a `&nbsp;`-only
  // node then measures 0 where Chrome measures a full character.
  const textContent = kids
    .filter((k) => '#text' in k)
    .map((k) => String(k['#text']))
    .join('')
    .replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
  if (textContent.length > 0) {
    const writingMode: WritingMode = (attrs['writing-mode'] ?? '').includes('vertical') ? 'vertical' : 'horizontal';
    return createNode({ style, measure: ahemTextMeasure(textContent, writingMode) });
  }
  return createNode({ style });
}

function buildExpected(el: XmlNode): ExpectedNode {
  const tag = elementTag(el);
  const attrs = el[':@'] ?? {};
  const kids = ((el[tag] as XmlNode[]) ?? []).filter(isElement);
  return {
    x: parseFloat(attrs['x'] ?? '0'),
    y: parseFloat(attrs['y'] ?? '0'),
    width: parseFloat(attrs['width'] ?? '0'),
    height: parseFloat(attrs['height'] ?? '0'),
    children: kids.map(buildExpected),
  };
}

/** Exported for the fuzzer's serializer round-trip test (tests/fuzz.test.ts). */
export function buildStyle(attrs: Record<string, string>): Partial<Style> {
  const style: Partial<Style> = {
    display: (attrs['display'] as Style['display']) ?? 'flex',
    direction: (attrs['direction'] as Style['direction']) ?? 'ltr',
    boxSizing: (attrs['box-sizing'] as Style['boxSizing']) ?? 'border-box',
    overflow: {
      x: (attrs['overflow-x'] as Style['overflow']['x']) ?? 'visible',
      y: (attrs['overflow-y'] as Style['overflow']['y']) ?? 'visible',
    },
    scrollbarWidth: attrs['scrollbar-width'] !== undefined ? parseFloat(attrs['scrollbar-width']) : 0,
    position: (attrs['position'] as Style['position']) ?? 'relative',
    size: {
      width: parseDimension(attrs['width'], 'auto'),
      height: parseDimension(attrs['height'], 'auto'),
    },
    minSize: {
      width: parseDimension(attrs['min-width'], 'auto'),
      height: parseDimension(attrs['min-height'], 'auto'),
    },
    maxSize: {
      width: parseDimension(attrs['max-width'], 'auto'),
      height: parseDimension(attrs['max-height'], 'auto'),
    },
    inset: {
      top: parseDimension(attrs['top'], 'auto'),
      left: parseDimension(attrs['left'], 'auto'),
      bottom: parseDimension(attrs['bottom'], 'auto'),
      right: parseDimension(attrs['right'], 'auto'),
    },
    margin: {
      top: parseDimension(attrs['margin-top'], 0),
      left: parseDimension(attrs['margin-left'], 0),
      bottom: parseDimension(attrs['margin-bottom'], 0),
      right: parseDimension(attrs['margin-right'], 0),
    },
    padding: {
      top: parseLengthPercentage(attrs['padding-top']),
      left: parseLengthPercentage(attrs['padding-left']),
      bottom: parseLengthPercentage(attrs['padding-bottom']),
      right: parseLengthPercentage(attrs['padding-right']),
    },
    border: {
      top: parseLengthPercentage(attrs['border-top']),
      left: parseLengthPercentage(attrs['border-left']),
      bottom: parseLengthPercentage(attrs['border-bottom']),
      right: parseLengthPercentage(attrs['border-right']),
    },
    gap: {
      width: parseLengthPercentage(attrs['column-gap']),
      height: parseLengthPercentage(attrs['row-gap']),
    },
    aspectRatio: attrs['aspect-ratio'] !== undefined ? parseFloat(attrs['aspect-ratio']) : null,
    textAlign: parseTextAlign(attrs['text-align']),
    flexDirection: (attrs['flex-direction'] as Style['flexDirection']) ?? 'row',
    flexWrap: (attrs['flex-wrap'] as Style['flexWrap']) ?? 'nowrap',
    flexGrow: attrs['flex-grow'] !== undefined ? parseFloat(attrs['flex-grow']) : 0,
    flexShrink: attrs['flex-shrink'] !== undefined ? parseFloat(attrs['flex-shrink']) : 1,
    flexBasis: parseDimension(attrs['flex-basis'], 'auto'),
  };

  if (attrs['align-items'] !== undefined) style.alignItems = parseAlignItems(attrs['align-items']);
  if (attrs['align-self'] !== undefined) style.alignSelf = parseAlignItems(attrs['align-self']);
  if (attrs['align-content'] !== undefined) style.alignContent = parseAlignContent(attrs['align-content']);
  if (attrs['justify-content'] !== undefined) style.justifyContent = parseAlignContent(attrs['justify-content']);
  if (attrs['justify-items'] !== undefined) style.justifyItems = parseAlignItems(attrs['justify-items']);
  if (attrs['justify-self'] !== undefined) style.justifySelf = parseAlignItems(attrs['justify-self']);

  if (attrs['grid-template-rows'] !== undefined) style.gridTemplateRows = parseTrackList(attrs['grid-template-rows']);
  if (attrs['grid-template-columns'] !== undefined)
    style.gridTemplateColumns = parseTrackList(attrs['grid-template-columns']);
  if (attrs['grid-auto-rows'] !== undefined)
    style.gridAutoRows = parseTrackList(attrs['grid-auto-rows']).filter(isSingleTrack);
  if (attrs['grid-auto-columns'] !== undefined)
    style.gridAutoColumns = parseTrackList(attrs['grid-auto-columns']).filter(isSingleTrack);
  if (attrs['grid-auto-flow'] !== undefined) style.gridAutoFlow = parseGridAutoFlow(attrs['grid-auto-flow']);
  style.gridRow = {
    start: parseGridPlacement(attrs['grid-row-start']),
    end: parseGridPlacement(attrs['grid-row-end']),
  };
  style.gridColumn = {
    start: parseGridPlacement(attrs['grid-column-start']),
    end: parseGridPlacement(attrs['grid-column-end']),
  };

  return style;
}

function isSingleTrack(c: GridTemplateComponent): c is TrackSizingFunction {
  return !('repeat' in c);
}

// --- Grid attribute parsing (mirrors taffy's cssparser-based FromCss impls)

/** Split a track list on top-level whitespace (parens protect their contents) */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current.length > 0) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

export function parseTrackList(input: string): GridTemplateComponent[] {
  return splitTopLevel(input.trim()).map((entry) => {
    const repeatMatch = /^repeat\((.*)\)$/s.exec(entry);
    if (repeatMatch) {
      const inner = repeatMatch[1]!;
      const commaIdx = inner.indexOf(',');
      const countStr = inner.slice(0, commaIdx).trim();
      const tracksStr = inner.slice(commaIdx + 1).trim();
      const count =
        countStr === 'auto-fill' ? ('auto-fill' as const) : countStr === 'auto-fit' ? ('auto-fit' as const) : parseInt(countStr, 10);
      const tracks = splitTopLevel(tracksStr).map(parseTrackSizingFunction);
      return { repeat: count, tracks };
    }
    return parseTrackSizingFunction(entry);
  });
}

export function parseTrackSizingFunction(input: string): TrackSizingFunction {
  const minmaxMatch = /^minmax\((.*)\)$/s.exec(input);
  if (minmaxMatch) {
    const inner = minmaxMatch[1]!;
    const commaIdx = inner.indexOf(',');
    return {
      min: parseMinTrack(inner.slice(0, commaIdx).trim()),
      max: parseMaxTrack(inner.slice(commaIdx + 1).trim()),
    };
  }
  const max = parseMaxTrack(input);
  const min: MinTrackSizingFunction =
    typeof max === 'object' && ('fr' in max || 'fitContent' in max) ? 'auto' : max;
  return { min, max };
}

function parseMinTrack(input: string): MinTrackSizingFunction {
  if (input === 'auto' || input === 'min-content' || input === 'max-content') return input;
  return parseLength(input);
}

function parseMaxTrack(input: string): MaxTrackSizingFunction {
  if (input === 'auto' || input === 'min-content' || input === 'max-content') return input;
  const fitMatch = /^fit-content\((.*)\)$/s.exec(input);
  if (fitMatch) return { fitContent: parseLength(fitMatch[1]!.trim()) };
  const frMatch = /^(-?[\d.]+)fr$/.exec(input);
  if (frMatch) return { fr: parseFloat(frMatch[1]!) };
  return parseLength(input);
}

function parseGridAutoFlow(input: string): Style['gridAutoFlow'] {
  const parts = input.trim().split(/\s+/);
  const dense = parts.includes('dense');
  const column = parts.includes('column');
  if (column) return dense ? 'column-dense' : 'column';
  return dense ? 'row-dense' : 'row';
}

export function parseGridPlacement(input: string | undefined): GridPlacement {
  if (input === undefined || input === 'auto') return 'auto';
  const spanMatch = /^span\s+(\d+)$/.exec(input.trim());
  if (spanMatch) return { span: parseInt(spanMatch[1]!, 10) };
  return { line: parseInt(input.trim(), 10) };
}

function parseDimension(input: string | undefined, fallback: Dimension): Dimension {
  if (input === undefined) return fallback;
  if (input === 'auto') return 'auto';
  return parseLength(input);
}

function parseLengthPercentage(input: string | undefined): LengthPercentage {
  if (input === undefined) return 0;
  return parseLength(input);
}

function parseLength(input: string): LengthPercentage {
  if (input.endsWith('%')) {
    const pct = parseFloat(input);
    if (Number.isNaN(pct)) throw new Error(`fixture: unparseable percentage "${input}"`);
    return { percent: pct / 100 };
  }
  const px = parseFloat(input);
  // A silent NaN here is the worst possible outcome: it survives every bounds
  // check downstream (all comparisons with NaN are false) and can hang the
  // sizing algorithms outright — `width: min-content` on an element reached
  // findSizeOfFr with spaceToFill=NaN and spun forever. The engine's
  // `Dimension` models px/percent/auto only; anything else must be rejected
  // at the boundary, not turned into NaN.
  if (Number.isNaN(px)) throw new Error(`fixture: unsupported length value "${input}"`);
  return px;
}

function parseTextAlign(input: string | undefined): Style['textAlign'] {
  switch (input) {
    case '-webkit-left':
      return 'legacy-left';
    case '-webkit-right':
      return 'legacy-right';
    case '-webkit-center':
      return 'legacy-center';
    default:
      return 'auto';
  }
}

function parseAvailableSpace(input: string | undefined): AvailableSpace {
  if (input === undefined || input === 'max-content') return 'max-content';
  if (input === 'min-content') return 'min-content';
  return parseFloat(input);
}

// Type-only re-export so tsc treats these as used
export type { LengthPercentageAuto };

// --- Alignment keyword parsing (test-harness only) ---------------------------
// Fixture XML carries CSS-ish keyword strings, so the harness maps them to the
// engine's structured AlignItems/AlignContent. This deliberately does NOT live
// in src/: the engine's contract is fully-resolved structured styles, and a
// consumer is expected to have resolved the cascade before calling it. Keeping
// keyword handling here stops a CSS parser from creeping into the public API.

/**
 * `self-start`/`self-end` resolve against the *item's* own axis. With no
 * orthogonal writing modes they coincide with `start`/`end` (css-align-3 §4.1),
 * so they are normalized here rather than threaded through every consumer.
 * An unrecognized keyword must not be cast blindly: it would fall through every
 * alignment branch and yield a NaN offset (found via WPT `self-end` tests).
 */
function toAlignItemsKeyword(input: string | undefined): AlignItemsKeyword {
  switch (input) {
    case 'self-start':
      return 'start';
    case 'self-end':
      return 'end';
    case 'start':
    case 'end':
    case 'flex-start':
    case 'flex-end':
    case 'center':
    case 'baseline':
    case 'stretch':
      return input;
    // `normal` behaves as `stretch` for the layout modes this engine supports.
    case 'normal':
    case undefined:
      return 'stretch';
    default:
      throw new Error(`unsupported align/justify value: "${input}"`);
  }
}

function parseAlignItems(input: string): AlignItems {
  const parts = input.trim().split(/\s+/);
  if (parts[0] === 'safe') return { keyword: toAlignItemsKeyword(parts[1]), safe: true };
  if (parts[0] === 'unsafe') return { keyword: toAlignItemsKeyword(parts[1]), safe: false };
  return { keyword: toAlignItemsKeyword(parts[0]), safe: false };
}

/** Same reasoning as toAlignItemsKeyword: an unrecognized keyword must throw
 *  rather than be cast, or it falls through every alignment branch as a NaN
 *  offset and the fixture fails with an unrelated-looking number. */
function toAlignContentKeyword(input: string | undefined): AlignContentKeyword {
  switch (input) {
    case 'start':
    case 'end':
    case 'flex-start':
    case 'flex-end':
    case 'center':
    case 'stretch':
    case 'space-between':
    case 'space-evenly':
    case 'space-around':
      return input;
    case 'normal':
    case undefined:
      return 'stretch';
    default:
      throw new Error(`unsupported align/justify-content value: "${input}"`);
  }
}

function parseAlignContent(input: string): AlignContent {
  const parts = input.trim().split(/\s+/);
  if (parts[0] === 'safe') return { keyword: toAlignContentKeyword(parts[1]), safe: true };
  if (parts[0] === 'unsafe') return { keyword: toAlignContentKeyword(parts[1]), safe: false };
  return { keyword: toAlignContentKeyword(parts[0]), safe: false };
}
