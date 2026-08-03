// Server component: runs the engine at render time and draws the result as a
// small SVG. The three "modes" cards each show a real computed layout, not an
// illustration of one — the engine runs fine in Node, so the server can just
// call it.

import type { StyleInput } from 'bento-layout';
import { computeLayout, LayoutNode } from 'bento-layout';

export interface MiniSpec {
  style: StyleInput;
  children?: MiniSpec[];
}

function build(spec: MiniSpec): LayoutNode {
  return LayoutNode.make(spec.style, (spec.children ?? []).map(build));
}

const FILLS = [
  'color-mix(in srgb, var(--organic-accent) 14%, transparent)',
  'color-mix(in srgb, var(--organic-accent) 38%, transparent)',
  'color-mix(in srgb, var(--organic-accent) 62%, transparent)',
];

function Rects({ node, depth }: { node: LayoutNode; depth: number }) {
  const { location, size } = node.layout;
  return (
    <g transform={`translate(${location.x} ${location.y})`}>
      <rect
        x={0.5}
        y={0.5}
        width={Math.max(0, size.width - 1)}
        height={Math.max(0, size.height - 1)}
        rx={6}
        fill={FILLS[Math.min(depth, FILLS.length - 1)]}
        stroke="color-mix(in srgb, var(--organic-text) 30%, transparent)"
        strokeWidth={1}
      />
      {node.children.map((child, i) => (
        <Rects key={i} node={child} depth={depth + 1} />
      ))}
    </g>
  );
}

export function MiniLayout({ spec }: { spec: MiniSpec }) {
  const root = build(spec);
  computeLayout(root, { width: 'max-content', height: 'max-content' });
  const { width, height } = root.layout.size;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="Layout computed by bento-layout"
      style={{ display: 'block' }}
    >
      <Rects node={root} depth={0} />
    </svg>
  );
}
