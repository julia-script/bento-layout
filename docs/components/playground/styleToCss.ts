// Resolved engine Style -> inline CSS, for the browser overlay.
//
// Demos are real code now, so there is no CSS-shaped source to put on a real
// element the way the old dialect allowed. Instead the overlay renders the
// *resolved* style of each node — the normalized form `LayoutNode.make`
// produced — translated back to CSS. The translation is a possible source of
// disagreement, which is why it lives in one small file with a test rather
// than being spread through the overlay: if the engines differ, this is the
// first thing to rule out.
//
// Properties whose resolved value equals the CSS initial value are skipped,
// except where the engine's default differs from CSS (`display: flex` vs
// `block`, `box-sizing: border-box` vs `content-box`) — those are always
// emitted so the browser lays out under the engine's defaults.

import type {
  AlignContent,
  AlignItems,
  Dimension,
  GridPlacement,
  GridPlacementLine,
  GridTemplateComponent,
  LengthPercentage,
  LengthPercentageAuto,
  Style,
  TrackSizingFunction,
} from 'bento-layout';

function lp(v: LengthPercentage): string {
  if (typeof v === 'number') return `${v}px`;
  // Trim float noise (0.1 * 100 === 10.000000000000002) without losing
  // deliberate fractional percentages.
  return `${Number((v.percent * 100).toFixed(6))}%`;
}

function lpa(v: LengthPercentageAuto): string {
  return v === 'auto' ? 'auto' : lp(v);
}

function trackBound(v: TrackSizingFunction['min'] | TrackSizingFunction['max']): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'fr' in v) return `${v.fr}fr`;
  if (typeof v === 'object' && 'fitContent' in v) return `fit-content(${lp(v.fitContent)})`;
  return lp(v);
}

function track(t: TrackSizingFunction): string {
  const { min, max } = t;
  // `fit-content()` is not valid inside `minmax()`; its resolved min is always
  // effectively auto, so the function stands alone.
  if (typeof max === 'object' && 'fitContent' in max) return trackBound(max);
  // A bare `<flex>` track means minmax(auto, <flex>) per css-grid-1 §7.2.
  if (typeof max === 'object' && 'fr' in max && min === 'auto') return trackBound(max);
  if (JSON.stringify(min) === JSON.stringify(max)) return trackBound(min);
  return `minmax(${trackBound(min)}, ${trackBound(max)})`;
}

function template(c: GridTemplateComponent): string {
  if ('repeat' in c) {
    return `repeat(${c.repeat}, ${c.tracks.map(track).join(' ')})`;
  }
  return track(c);
}

function placement(p: GridPlacement): string {
  if (p === 'auto') return 'auto';
  if ('line' in p) return String(p.line);
  return `span ${p.span}`;
}

function placementLine(line: GridPlacementLine): string | null {
  if (line.start === 'auto' && line.end === 'auto') return null;
  return `${placement(line.start)} / ${placement(line.end)}`;
}

const TEXT_ALIGN: Record<string, string> = {
  // The engine's legacy-* variants align block children the way `<center>`
  // did; the -webkit- values are the CSS spelling of that behaviour (supported
  // by Firefox and Safari as well).
  'legacy-left': '-webkit-left',
  'legacy-right': '-webkit-right',
  'legacy-center': '-webkit-center',
};

/**
 * Translate a resolved {@link Style} to camelCased inline CSS.
 *
 * `scrollbarWidth` has no CSS equivalent (CSS reserves the *native* scrollbar
 * via `scrollbar-gutter`, not an arbitrary number) and is not emitted; a demo
 * relying on it will genuinely differ from the browser.
 */
export function styleToCss(style: Style): Record<string, string> {
  const css: Record<string, string> = {
    // Always emitted: the engine's defaults differ from CSS's.
    display: style.display,
    boxSizing: style.boxSizing,
  };

  const set = (key: string, value: string | null) => {
    if (value !== null) css[key] = value;
  };
  const dim = (key: string, v: Dimension) => {
    if (v !== 'auto') css[key] = lp(v);
  };

  if (style.direction !== 'ltr') set('direction', style.direction);
  if (style.overflow.x !== 'visible') set('overflowX', style.overflow.x);
  if (style.overflow.y !== 'visible') set('overflowY', style.overflow.y);

  set('position', style.position);
  set('top', style.inset.top === 'auto' ? null : lpa(style.inset.top));
  set('right', style.inset.right === 'auto' ? null : lpa(style.inset.right));
  set('bottom', style.inset.bottom === 'auto' ? null : lpa(style.inset.bottom));
  set('left', style.inset.left === 'auto' ? null : lpa(style.inset.left));

  dim('width', style.size.width);
  dim('height', style.size.height);
  dim('minWidth', style.minSize.width);
  dim('minHeight', style.minSize.height);
  dim('maxWidth', style.maxSize.width);
  dim('maxHeight', style.maxSize.height);
  if (style.aspectRatio !== null) set('aspectRatio', String(style.aspectRatio));

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const cap = side[0]?.toUpperCase() + side.slice(1);
    const m = style.margin[side];
    if (m !== 0) set(`margin${cap}`, lpa(m));
    const p = style.padding[side];
    if (p !== 0) set(`padding${cap}`, lp(p));
    const b = style.border[side];
    if (b !== 0) set(`border${cap}Width`, lp(b));
  }
  // A border width only affects layout when the border has a style; transparent
  // keeps it invisible so the overlay's own outline styling stays legible.
  if (Object.keys(css).some((k) => k.startsWith('border') && k !== 'boxSizing')) {
    css.borderStyle = 'solid';
    css.borderColor = 'transparent';
  }

  const align = (v: AlignItems | AlignContent | null) => (v === null ? null : `${v.safe ? 'safe ' : ''}${v.keyword}`);
  set('alignItems', align(style.alignItems));
  set('alignSelf', align(style.alignSelf));
  set('alignContent', align(style.alignContent));
  set('justifyContent', align(style.justifyContent));
  set('justifyItems', align(style.justifyItems));
  set('justifySelf', align(style.justifySelf));

  if (style.gap.width !== 0) set('columnGap', lp(style.gap.width));
  if (style.gap.height !== 0) set('rowGap', lp(style.gap.height));
  if (style.textAlign !== 'auto') set('textAlign', TEXT_ALIGN[style.textAlign] ?? null);

  if (style.flexDirection !== 'row') set('flexDirection', style.flexDirection);
  if (style.flexWrap !== 'nowrap') set('flexWrap', style.flexWrap);
  if (style.flexBasis !== 'auto') set('flexBasis', lpa(style.flexBasis));
  if (style.flexGrow !== 0) set('flexGrow', String(style.flexGrow));
  if (style.flexShrink !== 1) set('flexShrink', String(style.flexShrink));

  if (style.gridTemplateRows.length > 0) set('gridTemplateRows', style.gridTemplateRows.map(template).join(' '));
  if (style.gridTemplateColumns.length > 0) {
    set('gridTemplateColumns', style.gridTemplateColumns.map(template).join(' '));
  }
  if (style.gridAutoRows.length > 0) set('gridAutoRows', style.gridAutoRows.map(track).join(' '));
  if (style.gridAutoColumns.length > 0) set('gridAutoColumns', style.gridAutoColumns.map(track).join(' '));
  if (style.gridAutoFlow !== 'row') set('gridAutoFlow', style.gridAutoFlow.replace('-', ' '));
  set('gridRow', placementLine(style.gridRow));
  set('gridColumn', placementLine(style.gridColumn));

  return css;
}
