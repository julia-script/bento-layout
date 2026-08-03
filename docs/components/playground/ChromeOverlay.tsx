// The same demo, laid out by the browser instead of by the engine.
//
// This is the comparison the project is built on, made visible: correctness is
// defined as agreement with Chrome, so the playground can show both results in
// the same coordinate space and let the reader look for daylight between them.
//
// Each node carries its resolved engine style translated to CSS (styleToCss,
// applied in the worker), so the browser lays out the same normalized tree the
// engine did. The translation is deliberately one small audited step — if the
// engines disagree, styleToCss is the first suspect to rule out.
//
// Rendered as bordered divs rather than SVG because these boxes must be laid
// out BY the browser — their geometry is the browser's answer, which is exactly
// what an SVG rect (positioned by us) could not produce.

import { useEffect, useRef } from 'react';
import type { Rect } from './browser.js';
import { CANVAS_ORIGIN } from './LayoutBox.js';
import type { RenderNode } from './runner.js';

function OverlayNode({ node }: { node: RenderNode }) {
  return (
    <div className="fd-chrome-box" style={node.css}>
      {node.children.map((child, i) => (
        <OverlayNode key={i} node={child} />
      ))}
    </div>
  );
}

export interface ChromeOverlayProps {
  /** The laid-out demo tree; only each node's `css` is used here. */
  root: RenderNode;
  /** Viewport width, so the browser lays out against the same available space. */
  width: number;
  /**
   * The zoom this overlay is drawn at.
   *
   * Passed in rather than recovered from `measuredWidth / width`: that ratio is
   * only correct once the browser has settled at the new scale, and a
   * measurement taken before then divides every box by a wrong number — which
   * reported a several-hundred-pixel disagreement on a demo that matches.
   */
  zoom: number;
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
 * of the comparison, which runs on the engine's boxes against these measured
 * boxes and never reads the SVG. Without it the overlay would simply look a
 * pixel off; with it, visible daylight means the engines actually disagree.
 */
export function ChromeOverlay({ root, width, zoom, onMeasure }: ChromeOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Read the browser's answer back after it has laid the boxes out. Measured
  // relative to the overlay's own origin and divided by the ancestor zoom, so
  // the numbers are in engine units and directly comparable with the engine's.
  // biome-ignore lint/correctness/useExhaustiveDependencies(root): the effect reads the rendered DOM, which `root` produces — it must re-measure when the tree changes even though it never reads the value.
  useEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    let frame = 0;
    // Two frames, not one. A single rAF after a React commit can still run
    // before the browser has laid this subtree out at its new scale, and the
    // measurement then describes the previous state; the second frame is
    // guaranteed to be post-layout.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const bounds = el.getBoundingClientRect();
        const scale = zoom || 1;

        // Self-check before trusting anything: the overlay is `width` engine px
        // drawn at `zoom`, so its screen width must be width*zoom. When it is
        // not, this subtree has not been laid out at the current scale yet and
        // every box below would be divided by a scale it was not drawn at —
        // which is what reported "differs by 367px" on a demo that matches.
        // Skipping leaves the previous measurement in place, and Demo's stamp
        // makes that one unusable, so the verdict simply waits.
        if (Math.abs(bounds.width - width * scale) > 1) return;

        const boxes = [...el.querySelectorAll<HTMLElement>('.fd-chrome-box')].map((node) => {
          const b = node.getBoundingClientRect();
          return {
            x: (b.x - bounds.x) / scale,
            y: (b.y - bounds.y) / scale,
            width: b.width / scale,
            height: b.height / scale,
          };
        });
        onMeasure(boxes);
      });
    });
    return () => cancelAnimationFrame(frame);
    // `root` is what the rendered DOM is derived from, so re-measuring when
    // it changes covers every edit; `width` covers a viewport resize, and
    // `zoom` a scale change.
  }, [onMeasure, root, width, zoom]);

  return (
    <div
      ref={ref}
      className="fd-chrome-overlay"
      style={{ width, transform: `translate(${CANVAS_ORIGIN}px, ${CANVAS_ORIGIN}px)` }}
      aria-hidden="true"
    >
      <OverlayNode node={root} />
    </div>
  );
}

export default ChromeOverlay;
