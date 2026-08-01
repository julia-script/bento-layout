// Renders a laid-out tree as nested SVG rects.
//
// This is the only part of the playground that reads engine output. Everything
// is positioned from `node.layout`, never by CSS layout, so what you see is the
// engine's result rather than the browser's opinion of the same styles.
//
// SVG rather than divs because the coordinate system is the engine's own: a
// rect's x/y/width/height are exact user-space numbers with no box model in
// between, so subpixel geometry survives and there is no border-box arithmetic
// to get wrong. `unroundedLayout` therefore renders faithfully.

import type { LayoutNode } from 'bento-layout';

/** How many depth colours before the palette repeats. */
const DEPTH_STEPS = 5;

/**
 * SVG strokes straddle the path, so half of a 1px stroke falls outside the
 * rect's geometry. Insetting by half keeps the drawn edge entirely within the
 * computed box, which is what makes adjacent boxes read as flush rather than
 * overlapping by a pixel.
 */
const STROKE = 1;
const INSET = STROKE / 2;

/** Room around the tree so the root's own stroke is not clipped by the viewBox. */
const PADDING = 1;

export interface LayoutBoxProps {
  node: LayoutNode;
  depth?: number;
}

/**
 * One node as a `<g>` holding its rect and its children.
 *
 * Children are translated by the node's origin rather than given absolute
 * coordinates, which mirrors how the engine reports layout: `location` is
 * relative to the parent's border box, so the transform *is* that relationship.
 */
export function LayoutBox({ node, depth = 0 }: LayoutBoxProps) {
  // `display: none` nodes lay out as zero-sized; drawing them would leave a
  // stroke artifact where there is no box.
  if (node.style.display === 'none') return null;

  const { location, size } = node.layout;
  const collapsed = size.width === 0 || size.height === 0;

  const children = node.children.map((child, i) => <LayoutBox key={i} node={child} depth={depth + 1} />);

  return (
    <g transform={`translate(${location.x} ${location.y})`}>
      {collapsed ? (
        // SVG renders no rect at zero width or height, so a box collapsed on
        // one axis would vanish even though it still has extent on the other.
        // A line keeps that visible. A node collapsed on *both* axes draws
        // nothing, which is fine — it occupies no space, and the source that
        // produced it is on screen next to the preview.
        <line className="fd-layout-collapsed" x1={0} y1={0} x2={size.width} y2={size.height} />
      ) : (
        <rect
          className="fd-layout-rect"
          data-depth={depth % DEPTH_STEPS}
          x={INSET}
          y={INSET}
          width={size.width - INSET * 2}
          height={size.height - INSET * 2}
          rx={2}
        />
      )}
      {children}
    </g>
  );
}

export interface LayoutCanvasProps {
  root: LayoutNode;
}

/**
 * The `<svg>` wrapper: sizes its viewBox to the laid-out root.
 *
 * The canvas is sized in CSS pixels equal to the layout's own units, so the
 * preview is 1:1 rather than scaled — a demo that says 480px measures 480px on
 * screen. `overflow: visible` on the SVG lets content that spills its parent
 * stay visible, matching what the engine reports in `contentSize`.
 */
export function LayoutCanvas({ root }: LayoutCanvasProps) {
  const { width, height } = root.layout.size;
  const w = width + PADDING * 2;
  const h = height + PADDING * 2;

  return (
    <svg
      className="fd-layout-canvas"
      width={w}
      height={h}
      viewBox={`${-PADDING} ${-PADDING} ${w} ${h}`}
      role="img"
      aria-label="Computed layout preview"
    >
      <LayoutBox node={root} />
    </svg>
  );
}
