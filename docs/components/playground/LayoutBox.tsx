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

import type { RenderNode } from './runner.js';

/** How many depth colours before the palette repeats. */
const DEPTH_STEPS = 5;

/**
 * A hovered node, in the canvas' own coordinate space.
 *
 * Coordinates are absolute (accumulated down the tree) rather than relative to
 * the parent, because the highlight and tooltip are drawn by the canvas, not
 * inside the node's own translated `<g>`.
 */
export interface HoveredNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  display: string;
}

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

/**
 * Where the root box's drawn edge lands, in the canvas' own coordinates.
 *
 * Purely a drawing offset: the two constants above shift the ink, never the
 * geometry the engine computed. Exported so the Chrome overlay can line itself
 * up with the same origin rather than hardcoding the sum — if either constant
 * changes, the overlay follows instead of silently drifting a pixel.
 */
export const CANVAS_ORIGIN = PADDING + INSET;

export interface LayoutBoxProps {
  node: RenderNode;
  depth?: number;
  /** Absolute origin of this node's parent, for reporting hovers. */
  originX?: number;
  originY?: number;
  onHover?: (node: HoveredNode | null) => void;
  onSelect?: (node: HoveredNode) => void;
}

/**
 * One node as a `<g>` holding its rect and its children.
 *
 * Children are translated by the node's origin rather than given absolute
 * coordinates, which mirrors how the engine reports layout: `location` is
 * relative to the parent's border box, so the transform *is* that relationship.
 */
export function LayoutBox({ node, depth = 0, originX = 0, originY = 0, onHover, onSelect }: LayoutBoxProps) {
  // (`display: none` subtrees never reach here — the worker drops them when
  // serializing, keeping this walk aligned with the browser overlay's.)
  const size = { width: node.width, height: node.height };
  const collapsed = size.width === 0 || size.height === 0;

  // Absolute position of this node, for the hover readout.
  const x = originX + node.x;
  const y = originY + node.y;

  const children = node.children.map((child, i) => (
    <LayoutBox key={i} node={child} depth={depth + 1} originX={x} originY={y} onHover={onHover} onSelect={onSelect} />
  ));

  const info: HoveredNode = {
    x,
    y,
    width: size.width,
    height: size.height,
    depth,
    display: node.display,
  };

  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      {collapsed ? (
        // SVG renders no rect at zero width or height, so a box collapsed on
        // one axis would vanish even though it still has extent on the other.
        // A line keeps that visible. A node collapsed on *both* axes draws
        // nothing, which is fine — it occupies no space, and the source that
        // produced it is on screen next to the preview.
        <line className="fd-layout-collapsed" x1={0} y1={0} x2={size.width} y2={size.height} />
      ) : (
        // Inspectable: given a button role, so it is reachable and activatable
        // by keyboard as well as by pointer and touch.
        // biome-ignore lint/a11y/noStaticElementInteractions: SVG has no interactive element to swap in; role + tabIndex + Enter/Space handling below are the accessible equivalent.
        <rect
          className="fd-layout-rect"
          data-depth={depth % DEPTH_STEPS}
          x={INSET}
          y={INSET}
          width={size.width - INSET * 2}
          height={size.height - INSET * 2}
          rx={2}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={
            onSelect
              ? `${info.display} node, ${Math.round(size.width)} by ${Math.round(size.height)} pixels`
              : undefined
          }
          // Children paint after their parent, so the deepest rect under the
          // pointer wins — the same "innermost element" rule devtools uses.
          onPointerEnter={onHover && (() => onHover(info))}
          onPointerLeave={onHover && (() => onHover(null))}
          onFocus={onHover && (() => onHover(info))}
          onBlur={onHover && (() => onHover(null))}
          // Selection is what makes this usable without a pointer: on touch
          // there is no hover, so a tap is the only way to inspect a node.
          // stopPropagation keeps the document-level clear handler from
          // immediately undoing this.
          onClick={
            onSelect &&
            ((e) => {
              e.stopPropagation();
              onSelect(info);
            })
          }
          onKeyDown={
            onSelect &&
            ((e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onSelect(info);
            })
          }
        />
      )}
      {children}
    </g>
  );
}

export interface LayoutCanvasProps {
  root: RenderNode;
  /** Reports the innermost node under the pointer, or null on leave. */
  onHover?: (node: HoveredNode | null) => void;
  /** Reports a clicked/tapped node, which stays inspected after the pointer leaves. */
  onSelect?: (node: HoveredNode) => void;
  /** The node to outline — whatever is currently hovered or selected. */
  hovered?: HoveredNode | null;
}

/**
 * The `<svg>` wrapper: sizes its viewBox to the laid-out root.
 *
 * The canvas is sized in CSS pixels equal to the layout's own units, so the
 * preview is 1:1 rather than scaled — a demo that says 480px measures 480px on
 * screen. `overflow: visible` on the SVG lets content that spills its parent
 * stay visible, matching what the engine reports in `contentSize`.
 */
export function LayoutCanvas({ root, onHover, onSelect, hovered }: LayoutCanvasProps) {
  const { width, height } = root;
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
      <LayoutBox node={root} onHover={onHover} onSelect={onSelect} />
      {hovered && (
        // Drawn last so it sits above every rect, and non-interactive so it
        // cannot steal the pointer from the node underneath it.
        <rect
          className="fd-layout-highlight"
          x={hovered.x}
          y={hovered.y}
          width={hovered.width}
          height={hovered.height}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
