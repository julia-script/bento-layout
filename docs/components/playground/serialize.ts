// Laid-out LayoutNode -> plain RenderNode data.
//
// Lives outside run.worker.ts so tests can import it without a worker global;
// the worker is the only production caller.

import type { LayoutNode } from 'bento-layout';
import type { RenderNode } from './runner.js';
import { styleToCss } from './styleToCss.js';

/**
 * Flatten a laid-out tree into plain data the page can render.
 *
 * `display: none` subtrees are dropped here, in the single place both
 * consumers share, so the engine boxes and the overlay's DOM stay
 * index-aligned in document order — the property the browser comparison
 * depends on.
 */
export function serialize(node: LayoutNode): RenderNode | null {
  if (node.style.display === 'none') return null;
  const { location, size } = node.layout;
  return {
    css: styleToCss(node.style),
    display: node.style.display,
    x: location.x,
    y: location.y,
    width: size.width,
    height: size.height,
    children: node.children.map(serialize).filter((c): c is RenderNode => c !== null),
  };
}
