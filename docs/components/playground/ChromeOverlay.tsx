// The same demo, laid out by the browser instead of by the engine.
//
// This is the comparison the project is built on, made visible: correctness is
// defined as agreement with Chrome, so the playground can show both results in
// the same coordinate space and let the reader look for daylight between them.
//
// The demo dialect is CSS-shaped on purpose ('480px', '1fr', 'repeat(3, 1fr)'),
// so a StyleNode's properties go directly onto a real element's inline style
// with no translation step. That matters for honesty: if this had to convert
// values first, a disagreement might be the converter's fault rather than a
// real difference between the two engines.
//
// Rendered as bordered divs rather than SVG because these boxes must be laid
// out BY the browser — their geometry is the browser's answer, which is exactly
// what an SVG rect (positioned by us) could not produce.

import { useEffect, useRef } from 'react';
import type { Rect } from './browser.js';
import { CANVAS_ORIGIN } from './LayoutBox.js';
import type { StyleNode } from './parse.js';

/**
 * Style properties that describe layout, and so should reach the browser.
 *
 * A whitelist rather than a pass-through: the demo dialect and CSS overlap but
 * are not identical, and anything outside this list either has no layout effect
 * or does not mean the same thing to both engines. Unknown properties are
 * dropped instead of guessed at.
 */
const LAYOUT_PROPS = new Set([
  'display',
  'position',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'border',
  'borderWidth',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'flexDirection',
  'flexWrap',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignItems',
  'alignSelf',
  'alignContent',
  'justifyContent',
  'justifySelf',
  'justifyItems',
  'gap',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridAutoColumns',
  'gridAutoRows',
  'gridAutoFlow',
  'gridColumn',
  'gridRow',
  'gridColumnStart',
  'gridColumnEnd',
  'gridRowStart',
  'gridRowEnd',
  'aspectRatio',
  'boxSizing',
  'direction',
  'overflow',
]);

function cssStyle(style: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    if (!LAYOUT_PROPS.has(key)) continue;
    if (value == null) continue;
    out[key] = String(value);
  }
  // The engine's default is `display: flex` (Taffy's, and the demo dialect's);
  // CSS defaults to `block`, so an unstyled node would otherwise be compared
  // against a different formatting context than the one it was laid out in.
  out.display ??= 'flex';
  // Engine flex items default to not shrinking below their basis the way CSS
  // items do; matching CSS's own default here keeps the comparison about
  // layout rather than about this one initial value.
  out.boxSizing ??= 'border-box';
  return out;
}

function OverlayNode({ node }: { node: StyleNode }) {
  return (
    <div className="fd-chrome-box" style={cssStyle(node.style)}>
      {node.children.map((child, i) => (
        <OverlayNode key={i} node={child} />
      ))}
    </div>
  );
}

export interface ChromeOverlayProps {
  /** The parsed demo, before engine coercion. */
  styles: StyleNode;
  /** Viewport width, so the browser lays out against the same available space. */
  width: number;
  /**
   * Reports the browser's computed boxes, in the overlay's own coordinate
   * space and in the same document order the engine walks its tree.
   */
  onMeasure?: (boxes: Rect[]) => void;
}

/**
 * The browser's answer, drawn over the engine's.
 *
 * Offset by CANVAS_ORIGIN so the two are drawn from the same origin. That is a
 * VISUAL alignment only — it shifts both engines' ink equally and cancels out
 * of the comparison, which runs on `node.layout` against these measured boxes
 * and never reads the SVG. Without it the overlay would simply look a pixel
 * off; with it, visible daylight means the engines actually disagree.
 */
export function ChromeOverlay({ styles, width, onMeasure }: ChromeOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Read the browser's answer back after it has laid the boxes out. Measured
  // relative to the overlay's own origin and divided by the ancestor zoom, so
  // the numbers are in engine units and directly comparable with node.layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies(styles): the effect reads the rendered DOM, which `styles` produces — it must re-measure when the tree changes even though it never reads the value.
  useEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    const frame = requestAnimationFrame(() => {
      const root = el.getBoundingClientRect();
      // The overlay is inside the zoomed viewport; recover the scale from the
      // element's own measured vs. declared width rather than threading zoom in.
      const scale = root.width / width || 1;
      const boxes = [...el.querySelectorAll<HTMLElement>('.fd-chrome-box')].map((node) => {
        const b = node.getBoundingClientRect();
        return {
          x: (b.x - root.x) / scale,
          y: (b.y - root.y) / scale,
          width: b.width / scale,
          height: b.height / scale,
        };
      });
      onMeasure(boxes);
    });
    return () => cancelAnimationFrame(frame);
    // `styles` is what the rendered DOM is derived from, so re-measuring when
    // it changes covers every edit; `width` covers a viewport resize.
  }, [onMeasure, styles, width]);

  return (
    <div
      ref={ref}
      className="fd-chrome-overlay"
      style={{ width, transform: `translate(${CANVAS_ORIGIN}px, ${CANVAS_ORIGIN}px)` }}
      aria-hidden="true"
    >
      <OverlayNode node={styles} />
    </div>
  );
}

export default ChromeOverlay;
