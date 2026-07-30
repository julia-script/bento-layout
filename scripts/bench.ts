// Layout engine benchmarks.
//
// Mirrors the tree shapes of taffy's criterion benches (wide flat trees, deep
// nested trees, NxN grids) plus block stacks and a mixed "realistic" tree.
// Each scenario reports the median wall time of `computeLayout` over SAMPLES
// runs after WARMUP runs, on a tree built once (computeLayout clears all
// caches internally, so every run is a full from-scratch layout).
//
// Usage: pnpm bench [--json]

import { computeLayout, createNode } from '../src/index.js';
import type { Node, Style, TrackSizingFunction } from '../src/index.js';

const WARMUP = 3;
const SAMPLES = 10;

function countNodes(node: Node): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// --- Tree builders -----------------------------------------------------------

function wideFlex(childCount: number): Node {
  const children = Array.from({ length: childCount }, (_, i) =>
    createNode({
      style: {
        size: { width: 20 + (i % 5), height: 20 + (i % 7) },
        margin: { left: 1, right: 1, top: 1, bottom: 1 },
      },
    }),
  );
  return createNode({
    style: { flexWrap: 'wrap', size: { width: 800, height: 'auto' }, gap: { width: 2, height: 2 } },
    children,
  });
}

function deepFlex(depth: number, branch: number): Node {
  const build = (level: number): Node => {
    if (level === 0) {
      return createNode({ style: { size: { width: 10, height: 10 }, flexGrow: 1 } });
    }
    return createNode({
      style: {
        flexDirection: level % 2 === 0 ? 'row' : 'column',
        flexGrow: 1,
        padding: { left: 1, right: 1, top: 1, bottom: 1 },
      },
      children: Array.from({ length: branch }, () => build(level - 1)),
    });
  };
  const root = build(depth);
  root.style.size = { width: 1000, height: 1000 };
  return root;
}

function gridNxN(n: number): Node {
  const track: TrackSizingFunction = { min: 'auto', max: { fr: 1 } };
  const children = Array.from({ length: n * n }, (_, i) =>
    createNode({ style: { size: { width: 'auto', height: 10 + (i % 3) } } }),
  );
  return createNode({
    style: {
      display: 'grid',
      size: { width: 1000, height: 1000 },
      gridTemplateColumns: Array.from({ length: n }, () => track),
      gridTemplateRows: Array.from({ length: n }, () => track),
      gap: { width: 2, height: 2 },
    },
    children,
  });
}

function blockStack(count: number): Node {
  const children = Array.from({ length: count }, (_, i) =>
    createNode({
      style: {
        display: 'block',
        size: { width: 'auto', height: 12 },
        margin: { left: 0, right: 0, top: 8, bottom: 8 + (i % 3) },
      } satisfies Partial<Style>,
    }),
  );
  return createNode({ style: { display: 'block', size: { width: 600, height: 'auto' } }, children });
}

/** A page-like mixed tree: block root > header/content/footer, flex rows, grid panels */
function mixedPage(sections: number): Node {
  const gridPanel = (): Node =>
    createNode({
      style: {
        display: 'grid',
        flexGrow: 1,
        gridTemplateColumns: [
          { min: 'auto', max: { fr: 1 } },
          { min: 'auto', max: { fr: 2 } },
          { min: 'auto', max: 'auto' },
        ],
        gap: { width: 4, height: 4 },
      },
      children: Array.from({ length: 9 }, () => createNode({ style: { size: { width: 'auto', height: 24 } } })),
    });
  const flexRow = (): Node =>
    createNode({
      style: { display: 'flex', gap: { width: 8, height: 0 }, padding: { left: 8, right: 8, top: 8, bottom: 8 } },
      children: [
        createNode({ style: { size: { width: 120, height: 'auto' } } }),
        gridPanel(),
        createNode({ style: { flexGrow: 1, aspectRatio: 1.5 } }),
      ],
    });
  const section = (): Node =>
    createNode({
      style: { display: 'block', margin: { left: 0, right: 0, top: 12, bottom: 12 } },
      children: [flexRow(), flexRow()],
    });
  return createNode({
    style: { display: 'block', size: { width: 1024, height: 'auto' } },
    children: Array.from({ length: sections }, section),
  });
}

// --- Runner ------------------------------------------------------------------

interface Result {
  name: string;
  nodes: number;
  medianMs: number;
  minMs: number;
  nodesPerSec: number;
}

function bench(name: string, tree: Node): Result {
  const nodes = countNodes(tree);
  const availableSpace = { width: 'max-content', height: 'max-content' } as const;

  for (let i = 0; i < WARMUP; i++) computeLayout(tree, availableSpace);

  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = process.hrtime.bigint();
    computeLayout(tree, availableSpace);
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6);
  }
  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)]!;
  const minMs = times[0]!;
  return { name, nodes, medianMs, minMs, nodesPerSec: Math.round(nodes / (medianMs / 1000)) };
}

const scenarios: [string, () => Node][] = [
  ['flex: wide (10 children)', () => wideFlex(10)],
  ['flex: wide (100 children)', () => wideFlex(100)],
  ['flex: wide (1,000 children)', () => wideFlex(1_000)],
  ['flex: wide (10,000 children)', () => wideFlex(10_000)],
  ['flex: deep (depth 10, branch 2 — 2,047 nodes)', () => deepFlex(10, 2)],
  ['flex: deep (depth 7, branch 3 — 3,280 nodes)', () => deepFlex(7, 3)],
  ['grid: 10x10', () => gridNxN(10)],
  ['grid: 32x32', () => gridNxN(32)],
  ['grid: 100x100', () => gridNxN(100)],
  ['block: 1,000 stacked (margin collapsing)', () => blockStack(1_000)],
  ['block: 10,000 stacked (margin collapsing)', () => blockStack(10_000)],
  ['mixed page: 10 sections', () => mixedPage(10)],
  ['mixed page: 100 sections', () => mixedPage(100)],
];

const results: Result[] = [];
for (const [name, build] of scenarios) {
  const result = bench(name, build());
  results.push(result);
  console.log(
    `${result.name.padEnd(48)} ${String(result.nodes).padStart(7)} nodes  ` +
      `${result.medianMs.toFixed(2).padStart(9)} ms median  ` +
      `${String(result.nodesPerSec.toLocaleString('en-US')).padStart(12)} nodes/s`,
  );
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
}
