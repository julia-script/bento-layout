// Layout engine benchmarks.
//
// Mirrors the tree shapes of taffy's criterion benches (wide flat trees, deep
// nested trees, NxN grids) plus block stacks and a mixed "realistic" tree.
// Each scenario reports the median wall time of `computeLayout` over SAMPLES
// runs after WARMUP runs, on a tree built once (computeLayout clears all
// caches internally, so every run is a full from-scratch layout).
//
// Usage: pnpm bench [--json]

import { computeLayout, LayoutNode } from '../src/index.js';
import type { StyleInput, TrackSizingFunction } from '../src/index.js';

const WARMUP = 3;
const SAMPLES = 10;
/** Per-scenario fixed measurement window for the iteration-count metric. */
const FIXED_WINDOW_MS = Number(process.env['BENCH_WINDOW_MS'] ?? 2000);

function countNodes(node: LayoutNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// --- Tree builders -----------------------------------------------------------

function wideFlex(childCount: number): LayoutNode {
  const children = Array.from({ length: childCount }, (_, i) =>
    LayoutNode.make({
        width: 20 + (i % 5), height: 20 + (i % 7),
        marginLeft: 1, marginRight: 1, marginTop: 1, marginBottom: 1,
      }),
  );
  return LayoutNode.make({ flexWrap: 'wrap', width: 800, height: 'auto', columnGap: 2, rowGap: 2 }, children);
}

/**
 * Port of taffy's `build_deep_hierarchy` (benches/src/lib.rs) as used by its
 * `Deep tree (auto size)` benchmark, so ratios against taffy compare like with
 * like. Every leaf and container gets the same style — `flex_grow: 1` plus a
 * uniform margin — the root is a default style, and layout runs with
 * max-content available space in both axes (taffy passes `(None, None)`).
 *
 * Note the single (default row) flex direction: alternating it per level, as
 * `deepFlexAlternating` does, is a much heavier workload and has no counterpart
 * in taffy's suite.
 */
function taffyDeepFlex(maxNodes: number, branch: number): LayoutNode {
  const itemStyle = (): StyleInput => ({
    flexGrow: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
  });
  // Mirrors taffy's recursion: each level splits `(max_nodes - branch) / branch`
  // among `branch` children, bottoming out in leaves once the budget is small.
  const buildForest = (budget: number): LayoutNode[] => {
    if (budget <= branch) {
      return Array.from({ length: Math.max(budget, 0) }, () => LayoutNode.make(itemStyle()));
    }
    const childBudget = Math.floor((budget - branch) / branch);
    return Array.from({ length: branch }, () =>
      LayoutNode.make(itemStyle(), buildForest(childBudget)),
    );
  };
  return LayoutNode.make({}, buildForest(maxNodes));
}

/**
 * Engine-only stress case: alternates flex direction per level, adds padding on
 * every container and a fixed size on every leaf. The alternation forces
 * repeated cross-axis measurement and costs roughly 3.8x the compute-size calls
 * per node that a uniform-direction tree of the same shape does. Taffy has no
 * equivalent benchmark, so this scenario carries no cross-engine ratio.
 */
function deepFlexAlternating(depth: number, branch: number): LayoutNode {
  const build = (level: number): LayoutNode => {
    if (level === 0) {
      return LayoutNode.make({ width: 10, height: 10, flexGrow: 1 });
    }
    return LayoutNode.make({
        flexDirection: level % 2 === 0 ? 'row' : 'column',
        flexGrow: 1,
        paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1,
      }, Array.from({ length: branch }, () => build(level - 1)));
  };
  const root = build(depth);
  root.setStyle({ width: 1000, height: 1000 });
  return root;
}

function gridNxN(n: number): LayoutNode {
  const track: TrackSizingFunction = { min: 'auto', max: { fr: 1 } };
  const children = Array.from({ length: n * n }, (_, i) =>
    LayoutNode.make({ width: 'auto', height: 10 + (i % 3) }),
  );
  return LayoutNode.make({
      display: 'grid',
      width: 1000, height: 1000,
      gridTemplateColumns: Array.from({ length: n }, () => track),
      gridTemplateRows: Array.from({ length: n }, () => track),
      columnGap: 2, rowGap: 2,
    }, children);
}

function blockStack(count: number): LayoutNode {
  const children = Array.from({ length: count }, (_, i) =>
    LayoutNode.make({
        display: 'block',
        width: 'auto', height: 12,
        marginLeft: 0, marginRight: 0, marginTop: 8, marginBottom: 8 + (i % 3),
      } satisfies StyleInput),
  );
  return LayoutNode.make({ display: 'block', width: 600, height: 'auto' }, children);
}

/** A page-like mixed tree: block root > header/content/footer, flex rows, grid panels */
function mixedPage(sections: number): LayoutNode {
  const gridPanel = (): LayoutNode =>
    LayoutNode.make({
        display: 'grid',
        flexGrow: 1,
        gridTemplateColumns: [
          { min: 'auto', max: { fr: 1 } },
          { min: 'auto', max: { fr: 2 } },
          { min: 'auto', max: 'auto' },
        ],
        columnGap: 4, rowGap: 4,
      }, Array.from({ length: 9 }, () => LayoutNode.make({ width: 'auto', height: 24 })));
  const flexRow = (): LayoutNode =>
    LayoutNode.make({ display: 'flex', columnGap: 8, rowGap: 0, paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8 }, [
        LayoutNode.make({ width: 120, height: 'auto' }),
        gridPanel(),
        LayoutNode.make({ flexGrow: 1, aspectRatio: 1.5 }),
      ]);
  const section = (): LayoutNode =>
    LayoutNode.make({ display: 'block', marginLeft: 0, marginRight: 0, marginTop: 12, marginBottom: 12 }, [flexRow(), flexRow()]);
  return LayoutNode.make({ display: 'block', width: 1024, height: 'auto' }, Array.from({ length: sections }, section));
}

// --- Runner ------------------------------------------------------------------

/**
 * Describes the tree a scenario measures, so a published figure can state its
 * shape (see BENCHMARKS.md - Methodology). `comparable` marks scenarios whose
 * shape matches a taffy benchmark and may therefore carry a cross-engine ratio.
 */
interface Shape {
  depth?: number | 'flat';
  branch?: number;
  flexDirection?: string;
  style: string;
  comparable: boolean;
}

interface Result {
  name: string;
  nodes: number;
  medianMs: number;
  minMs: number;
  nodesPerSec: number;
  /** Iterations completed in a fixed window; stabler than the median on heavy trees. */
  itersPerSec: number;
  shape: Shape;
}

function bench(name: string, tree: LayoutNode, shape: Shape): Result {
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

  // Fixed-time throughput. At SAMPLES=10 the median is noise-dominated on the
  // heavy scenarios, so this is the metric to compare across engine changes.
  const windowStart = process.hrtime.bigint();
  let iters = 0;
  while (Number(process.hrtime.bigint() - windowStart) / 1e6 < FIXED_WINDOW_MS) {
    computeLayout(tree, availableSpace);
    iters++;
  }
  const elapsedSec = Number(process.hrtime.bigint() - windowStart) / 1e9;

  return {
    name,
    nodes,
    medianMs,
    minMs,
    nodesPerSec: Math.round(nodes / (medianMs / 1000)),
    itersPerSec: iters / elapsedSec,
    shape,
  };
}

const FLAT: Shape['depth'] = 'flat';

const scenarios: [string, () => LayoutNode, Shape][] = [
  // Wide/flat trees. Taffy's "Wide tree (2-level hierarchy)" is the comparable case.
  ['flex: wide (10 children)', () => wideFlex(10), { depth: FLAT, flexDirection: 'row (wrap)', style: 'fixed size, margin 1, gap 2', comparable: true }],
  ['flex: wide (100 children)', () => wideFlex(100), { depth: FLAT, flexDirection: 'row (wrap)', style: 'fixed size, margin 1, gap 2', comparable: true }],
  ['flex: wide (1,000 children)', () => wideFlex(1_000), { depth: FLAT, flexDirection: 'row (wrap)', style: 'fixed size, margin 1, gap 2', comparable: true }],
  ['flex: wide (10,000 children)', () => wideFlex(10_000), { depth: FLAT, flexDirection: 'row (wrap)', style: 'fixed size, margin 1, gap 2', comparable: true }],

  // Deep trees matching taffy's `Deep tree (auto size)` shape.
  ['flex: deep taffy-shape (~4,000 nodes)', () => taffyDeepFlex(4_000, 2), { branch: 2, flexDirection: 'row (uniform)', style: 'flexGrow 1, margin 10', comparable: true }],
  ['flex: deep taffy-shape (~10,000 nodes)', () => taffyDeepFlex(10_000, 2), { branch: 2, flexDirection: 'row (uniform)', style: 'flexGrow 1, margin 10', comparable: true }],

  // Engine-only stress cases: no taffy counterpart, so no cross-engine ratio.
  ['flex: deep alternating-axis (stress, depth 10, branch 2)', () => deepFlexAlternating(10, 2), { depth: 10, branch: 2, flexDirection: 'alternating row/column', style: 'flexGrow 1, padding 1, sized leaves', comparable: false }],
  ['flex: deep alternating-axis (stress, depth 7, branch 3)', () => deepFlexAlternating(7, 3), { depth: 7, branch: 3, flexDirection: 'alternating row/column', style: 'flexGrow 1, padding 1, sized leaves', comparable: false }],

  ['grid: 10x10', () => gridNxN(10), { depth: FLAT, style: 'auto/1fr tracks, gap 2', comparable: true }],
  ['grid: 32x32', () => gridNxN(32), { depth: FLAT, style: 'auto/1fr tracks, gap 2', comparable: true }],
  ['grid: 100x100', () => gridNxN(100), { depth: FLAT, style: 'auto/1fr tracks, gap 2', comparable: true }],
  ['block: 1,000 stacked (margin collapsing)', () => blockStack(1_000), { depth: FLAT, style: 'display block, collapsing margins', comparable: false }],
  ['block: 10,000 stacked (margin collapsing)', () => blockStack(10_000), { depth: FLAT, style: 'display block, collapsing margins', comparable: false }],
  ['mixed page: 10 sections', () => mixedPage(10), { style: 'block > flex rows > grid panels', comparable: false }],
  ['mixed page: 100 sections', () => mixedPage(100), { style: 'block > flex rows > grid panels', comparable: false }],
];

const results: Result[] = [];
for (const [name, build, shape] of scenarios) {
  const result = bench(name, build(), shape);
  results.push(result);
  console.log(
    `${result.name.padEnd(56)} ${String(result.nodes).padStart(7)} nodes  ` +
      `${result.medianMs.toFixed(2).padStart(9)} ms median  ` +
      `${result.itersPerSec.toFixed(1).padStart(9)} it/s  ` +
      `${String(result.nodesPerSec.toLocaleString('en-US')).padStart(12)} nodes/s` +
      `${result.shape.comparable ? '' : '  [engine-only]'}`,
  );
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
}
