// Style → inline-CSS serializer (design decision 6) and HTML document builder.
//
// The CSS property names emitted here are exactly the attribute names the
// fixture harness parses (tests/harness/fixture.ts buildStyle), so
// `styleFromAttrs(styleToCss(s))` must round-trip — tests/fuzz.test.ts holds
// that property over generated style space. Chrome's extraction helper echoes
// inline styles back, so the engine tree in a comparison is always built from
// what Chrome actually parsed; a declaration Chrome rejects degrades to lost
// coverage, never to a false mismatch.

import type {
  AlignContent,
  AlignItems,
  Dimension,
  GridPlacement,
  GridTemplateComponent,
  LengthPercentage,
  LengthPercentageAuto,
  Style,
  TrackSizingFunction,
} from '../../src/index.js';
import type { FuzzNode, FuzzTree } from './generate.js';

// --- Value serializers -------------------------------------------------------

/** Percent fraction → CSS percentage, trimming FP noise (0.3*100 === 30.000000000000004). */
function pct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(6))}%`;
}

function lp(v: LengthPercentage): string {
  return typeof v === 'number' ? `${v}px` : pct(v.percent);
}

function lpa(v: LengthPercentageAuto): string {
  return v === 'auto' ? 'auto' : lp(v);
}

function dim(v: Dimension): string {
  return lpa(v);
}

function align(v: AlignItems | AlignContent): string {
  return v.safe ? `safe ${v.keyword}` : v.keyword;
}

function trackBound(v: TrackSizingFunction['min'] | TrackSizingFunction['max']): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return `${v}px`;
  if ('percent' in v) return pct(v.percent);
  if ('fr' in v) return `${v.fr}fr`;
  return `fit-content(${lp(v.fitContent)})`;
}

/**
 * Single track: shortest form that parses back to the same object. The harness
 * parser expands a lone token T to {min: T, max: T}, except fr/fit-content
 * which expand to {min: 'auto', max: T}.
 */
export function serializeTrack(track: TrackSizingFunction): string {
  const { min, max } = track;
  const maxIsFrOrFit = typeof max === 'object' && ('fr' in max || 'fitContent' in max);
  if (maxIsFrOrFit && min === 'auto') return trackBound(max);
  if (!maxIsFrOrFit && JSON.stringify(min) === JSON.stringify(max)) return trackBound(max);
  return `minmax(${trackBound(min)},${trackBound(max)})`;
}

export function serializeTrackList(components: GridTemplateComponent[]): string {
  return components
    .map((c) => {
      if ('repeat' in c) {
        const count = typeof c.repeat === 'number' ? String(c.repeat) : c.repeat;
        return `repeat(${count}, ${c.tracks.map(serializeTrack).join(' ')})`;
      }
      return serializeTrack(c);
    })
    .join(' ');
}

function placement(v: GridPlacement): string {
  if (v === 'auto') return 'auto';
  if ('line' in v) return String(v.line);
  return `span ${v.span}`;
}

const TEXT_ALIGN_CSS: Record<Exclude<Style['textAlign'], 'auto'>, string> = {
  'legacy-left': '-webkit-left',
  'legacy-right': '-webkit-right',
  'legacy-center': '-webkit-center',
};

// --- Property table ----------------------------------------------------------

type Emitter = (style: Partial<Style>, out: Record<string, string>) => void;

function rectEmitter(
  key: 'inset' | 'margin' | 'padding' | 'border',
  props: [string, string, string, string],
  serialize: (v: LengthPercentageAuto) => string,
): Emitter {
  return (style, out) => {
    const rect = style[key];
    if (rect === undefined) return;
    out[props[0]] = serialize(rect.top);
    out[props[1]] = serialize(rect.left);
    out[props[2]] = serialize(rect.bottom);
    out[props[3]] = serialize(rect.right);
  };
}

const EMITTERS: Emitter[] = [
  (s, o) => s.display !== undefined && void (o['display'] = s.display),
  (s, o) => s.boxSizing !== undefined && void (o['box-sizing'] = s.boxSizing),
  (s, o) => s.direction !== undefined && void (o['direction'] = s.direction),
  (s, o) => {
    if (s.overflow === undefined) return;
    o['overflow-x'] = s.overflow.x;
    o['overflow-y'] = s.overflow.y;
  },
  (s, o) => s.position !== undefined && void (o['position'] = s.position),
  rectEmitter('inset', ['top', 'left', 'bottom', 'right'], lpa),
  (s, o) => {
    if (s.size === undefined) return;
    o['width'] = dim(s.size.width);
    o['height'] = dim(s.size.height);
  },
  (s, o) => {
    if (s.minSize === undefined) return;
    o['min-width'] = dim(s.minSize.width);
    o['min-height'] = dim(s.minSize.height);
  },
  (s, o) => {
    if (s.maxSize === undefined) return;
    o['max-width'] = dim(s.maxSize.width);
    o['max-height'] = dim(s.maxSize.height);
  },
  (s, o) => s.aspectRatio != null && void (o['aspect-ratio'] = String(s.aspectRatio)),
  rectEmitter('margin', ['margin-top', 'margin-left', 'margin-bottom', 'margin-right'], lpa),
  rectEmitter('padding', ['padding-top', 'padding-left', 'padding-bottom', 'padding-right'], lpa),
  // Width longhands only: `border-top: 40px` would reset border-style to none
  // (zeroing the border in layout); the base stylesheet supplies `solid`.
  rectEmitter('border', ['border-top-width', 'border-left-width', 'border-bottom-width', 'border-right-width'], lpa),
  (s, o) => s.alignItems != null && void (o['align-items'] = align(s.alignItems)),
  (s, o) => s.alignSelf != null && void (o['align-self'] = align(s.alignSelf)),
  (s, o) => s.alignContent != null && void (o['align-content'] = align(s.alignContent)),
  (s, o) => s.justifyContent != null && void (o['justify-content'] = align(s.justifyContent)),
  (s, o) => {
    if (s.gap === undefined) return;
    // Engine gap: width = column-gap, height = row-gap.
    o['column-gap'] = lp(s.gap.width);
    o['row-gap'] = lp(s.gap.height);
  },
  (s, o) => s.textAlign !== undefined && s.textAlign !== 'auto' && void (o['text-align'] = TEXT_ALIGN_CSS[s.textAlign]),
  (s, o) => s.flexDirection !== undefined && void (o['flex-direction'] = s.flexDirection),
  (s, o) => s.flexWrap !== undefined && void (o['flex-wrap'] = s.flexWrap),
  (s, o) => s.flexBasis !== undefined && void (o['flex-basis'] = dim(s.flexBasis)),
  (s, o) => s.flexGrow !== undefined && void (o['flex-grow'] = String(s.flexGrow)),
  (s, o) => s.flexShrink !== undefined && void (o['flex-shrink'] = String(s.flexShrink)),
  (s, o) => s.justifyItems != null && void (o['justify-items'] = align(s.justifyItems)),
  (s, o) => s.justifySelf != null && void (o['justify-self'] = align(s.justifySelf)),
  (s, o) => s.gridTemplateRows !== undefined && s.gridTemplateRows.length > 0 && void (o['grid-template-rows'] = serializeTrackList(s.gridTemplateRows)),
  (s, o) => s.gridTemplateColumns !== undefined && s.gridTemplateColumns.length > 0 && void (o['grid-template-columns'] = serializeTrackList(s.gridTemplateColumns)),
  (s, o) => s.gridAutoRows !== undefined && s.gridAutoRows.length > 0 && void (o['grid-auto-rows'] = serializeTrackList(s.gridAutoRows)),
  (s, o) => s.gridAutoColumns !== undefined && s.gridAutoColumns.length > 0 && void (o['grid-auto-columns'] = serializeTrackList(s.gridAutoColumns)),
  (s, o) => s.gridAutoFlow !== undefined && void (o['grid-auto-flow'] = s.gridAutoFlow.replace('-', ' ')),
  (s, o) => {
    if (s.gridRow === undefined) return;
    o['grid-row-start'] = placement(s.gridRow.start);
    o['grid-row-end'] = placement(s.gridRow.end);
  },
  (s, o) => {
    if (s.gridColumn === undefined) return;
    o['grid-column-start'] = placement(s.gridColumn.start);
    o['grid-column-end'] = placement(s.gridColumn.end);
  },
];

/** Partial engine style → CSS property record (keys = harness attribute names). */
export function styleToCss(style: Partial<Style>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const emit of EMITTERS) emit(style, out);
  return out;
}

// --- HTML document builder ---------------------------------------------------

const ZWS = '​';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function cssInline(style: Partial<Style>): string {
  return Object.entries(styleToCss(style))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

function nodeToHtml(node: FuzzNode, indent: string, isRoot: boolean): string {
  const id = isRoot ? ' id="test-root"' : '';
  const css = cssInline(node.style);
  const styleAttr = css.length > 0 ? ` style="${escapeAttr(css)}"` : '';
  if (node.children.length === 0) {
    const text = node.text !== undefined ? node.text.replaceAll(ZWS, '&#8203;') : '';
    return `${indent}<div${id}${styleAttr}>${text}</div>`;
  }
  const children = node.children.map((c) => nodeToHtml(c, indent + '  ', false)).join('\n');
  return `${indent}<div${id}${styleAttr}>\n${children}\n${indent}</div>`;
}

export interface HtmlOptions {
  /** 'relative': fixture-style <script src>/<link href> (for persisted files).
   *  'inline': embed the given support sources (for setContent rendering). */
  support: 'relative' | 'inline';
  supportJs?: string;
  supportCss?: string;
  /** Extra comment lines placed at the top of the document (provenance). */
  headerComment?: string[];
  title?: string;
}

export function fuzzTreeToHtml(tree: FuzzTree, opts: HtmlOptions): string {
  const head =
    opts.support === 'inline'
      ? `  <script>${opts.supportJs ?? ''}</script>\n  <style>${opts.supportCss ?? ''}</style>`
      : `  <script src="../support/test_helper.js"></script>\n  <link rel="stylesheet" type="text/css" href="../support/test_base_style.css">`;

  const rootHtml = nodeToHtml(tree.root, '', true);
  const body =
    tree.viewport !== undefined
      ? `<div class="viewport" style="width: ${tree.viewport.width}px; height: ${tree.viewport.height}px;">\n${rootHtml}\n</div>`
      : rootHtml;

  const comment =
    opts.headerComment !== undefined && opts.headerComment.length > 0
      ? `<!--\n${opts.headerComment.map((l) => `  ${l}`).join('\n')}\n-->\n`
      : '';

  return `<!DOCTYPE html>
${comment}<html lang="en">
<head>
${head}
  <title>
    ${opts.title ?? 'Fuzz-generated layout test'}
  </title>
</head>
<body>

${body}

</body>
</html>
`;
}
