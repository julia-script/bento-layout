// Cross-engine benchmark: this engine vs Yoga (WASM) on identical flex trees.
//
// Only the flexbox scenarios from scripts/bench.ts appear here: Yoga implements
// flexbox only, so the grid and block-stack scenarios have no counterpart and
// carry no ratio (same rule BENCHMARKS.md applies to taffy).
//
// Measurement note — this is the whole reason the harness looks like this:
// Yoga caches layout on the node tree, so calling `calculateLayout` twice on
// the same tree measures a no-op the second time (12.6 ms -> 0.03 ms on a
// 10k-node tree, a fictitious ~370x win). `markDirty` cannot clear it: Yoga
// rejects it on any node without a custom measure function. The only way to
// force a from-scratch Yoga layout is to rebuild the tree, so Yoga's timed
// region unavoidably includes construction. We therefore time construction
// separately and subtract it, reporting both numbers rather than just the
// flattering one. Our own `computeLayout` clears its caches internally, so its
// timed region is layout-only on a prebuilt tree.
//
// Usage: pnpm bench:yoga

import Yoga, { Edge, Direction } from 'yoga-layout';
import { computeLayout, LayoutNode } from '../src/index.js';
import type { StyleInput } from '../src/index.js';

const { Node } = Yoga;
type YogaNode = ReturnType<typeof Node.create>;

const WARMUP = 3;
const SAMPLES = 10;
const FIXED_WINDOW_MS = Number(process.env['BENCH_WINDOW_MS'] ?? 3000);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

// --- Tree builders, one pair per scenario ------------------------------------
// Each pair must produce the same tree in both engines; `checkAgreement` below
// verifies that by comparing computed boxes, so a silent shape mismatch fails
// loudly instead of producing a meaningless ratio.

function wideOurs(childCount: number): LayoutNode {
  const children = Array.from({ length: childCount }, (_, i) =>
    LayoutNode.make({
      width: 20 + (i % 5), height: 20 + (i % 7),
      marginLeft: 1, marginRight: 1, marginTop: 1, marginBottom: 1,
    }),
  );
  return LayoutNode.make({ flexWrap: 'wrap', width: 800, height: 'auto', columnGap: 2, rowGap: 2 }, children);
}

function wideYoga(childCount: number): YogaNode {
  const root = Node.create();
  root.setWidth(800);
  // Yoga defaults to column; CSS (and this engine) default to row.
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  root.setFlexWrap(Yoga.WRAP_WRAP);
  root.setGap(Yoga.GUTTER_ALL, 2);
  for (let i = 0; i < childCount; i++) {
    const c = Node.create();
    c.setWidth(20 + (i % 5));
    c.setHeight(20 + (i % 7));
    c.setMargin(Edge.All, 1);
    root.insertChild(c, i);
  }
  return root;
}

/** taffy's `build_deep_hierarchy`, same shape scripts/bench.ts uses. */
function deepOurs(maxNodes: number, branch: number): LayoutNode {
  const itemStyle = (): StyleInput => ({
    flexGrow: 1,
    marginLeft: 10, marginRight: 10, marginTop: 10, marginBottom: 10,
  });
  const buildForest = (budget: number): LayoutNode[] => {
    if (budget <= branch) {
      return Array.from({ length: Math.max(budget, 0) }, () => LayoutNode.make(itemStyle()));
    }
    const childBudget = Math.floor((budget - branch) / branch);
    return Array.from({ length: branch }, () => LayoutNode.make(itemStyle(), buildForest(childBudget)));
  };
  return LayoutNode.make({}, buildForest(maxNodes));
}

function deepYoga(maxNodes: number, branch: number): YogaNode {
  const item = (): YogaNode => {
    const n = Node.create();
    n.setFlexDirection(Yoga.FLEX_DIRECTION_ROW); // Yoga defaults to column
    n.setFlexGrow(1);
    n.setMargin(Edge.All, 10);
    return n;
  };
  const buildForest = (budget: number): YogaNode[] => {
    if (budget <= branch) {
      return Array.from({ length: Math.max(budget, 0) }, item);
    }
    const childBudget = Math.floor((budget - branch) / branch);
    return Array.from({ length: branch }, () => {
      const parent = item();
      buildForest(childBudget).forEach((c, i) => parent.insertChild(c, i));
      return parent;
    });
  };
  const root = Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  buildForest(maxNodes).forEach((c, i) => root.insertChild(c, i));
  return root;
}

// --- Agreement check ---------------------------------------------------------

const countOurs = (n: LayoutNode): number =>
  1 + n.children.reduce((s, c) => s + countOurs(c), 0);
const countYoga = (n: YogaNode): number => {
  let total = 1;
  for (let i = 0; i < n.getChildCount(); i++) total += countYoga(n.getChild(i));
  return total;
};

/**
 * Confirms the two engines were handed the same tree, by node count and by the
 * root's computed box. Divergent *layout results* between engines are expected
 * (they are different implementations); a divergent node count or root size
 * means the builders drifted apart and no ratio should be published.
 */
function checkAgreement(ours: LayoutNode, yoga: YogaNode): string {
  const nOurs = countOurs(ours);
  const nYoga = countYoga(yoga);
  const o = ours.layout;
  const y = yoga.getComputedLayout();
  const sameCount = nOurs === nYoga;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const sameRoot = near(o.size.width, y.width) && near(o.size.height, y.height);
  if (!sameCount) return `MISMATCH nodes ${nOurs} vs ${nYoga}`;
  if (!sameRoot) {
    return `root differs ${o.size.width}x${o.size.height} vs ${y.width}x${y.height}`;
  }
  return 'ok';
}

// --- Runners -----------------------------------------------------------------

const AVAILABLE = { width: 'max-content', height: 'max-content' } as const;

function benchOurs(tree: LayoutNode): { medianMs: number; itersPerSec: number } {
  for (let i = 0; i < WARMUP; i++) computeLayout(tree, AVAILABLE);
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = process.hrtime.bigint();
    computeLayout(tree, AVAILABLE);
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  const start = process.hrtime.bigint();
  let iters = 0;
  while (Number(process.hrtime.bigint() - start) / 1e6 < FIXED_WINDOW_MS) {
    computeLayout(tree, AVAILABLE);
    iters++;
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
  return { medianMs: median(times), itersPerSec: iters / elapsed };
}

/**
 * Times Yoga two ways on freshly built trees: build+layout, and build alone.
 * Layout cost is the difference — see the caching note at the top of this file
 * for why the rebuild is unavoidable.
 */
function benchYoga(build: () => YogaNode): {
  buildPlusLayoutMs: number;
  buildOnlyMs: number;
  layoutMs: number;
  itersPerSec: number;
} {
  for (let i = 0; i < WARMUP; i++) {
    const t = build();
    t.calculateLayout(undefined, undefined, Direction.LTR);
    t.freeRecursive();
  }

  const both: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const tree = build();
    const t = process.hrtime.bigint();
    tree.calculateLayout(undefined, undefined, Direction.LTR);
    both.push(Number(process.hrtime.bigint() - t) / 1e6);
    tree.freeRecursive();
  }

  const buildOnly: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = process.hrtime.bigint();
    const tree = build();
    buildOnly.push(Number(process.hrtime.bigint() - t) / 1e6);
    tree.freeRecursive();
  }

  // Fixed window over the full build+layout cycle, then scaled by the measured
  // layout share, so it stays comparable to our layout-only iteration count.
  const start = process.hrtime.bigint();
  let iters = 0;
  while (Number(process.hrtime.bigint() - start) / 1e6 < FIXED_WINDOW_MS) {
    const tree = build();
    tree.calculateLayout(undefined, undefined, Direction.LTR);
    tree.freeRecursive();
    iters++;
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;

  const layoutOnly = median(both);
  return {
    buildPlusLayoutMs: layoutOnly,
    buildOnlyMs: median(buildOnly),
    layoutMs: layoutOnly,
    itersPerSec: iters / elapsed,
  };
}

// --- Scenarios ---------------------------------------------------------------

const scenarios: [string, () => LayoutNode, () => YogaNode][] = [
  ['flex: wide (10 children)', () => wideOurs(10), () => wideYoga(10)],
  ['flex: wide (100 children)', () => wideOurs(100), () => wideYoga(100)],
  ['flex: wide (1,000 children)', () => wideOurs(1_000), () => wideYoga(1_000)],
  ['flex: wide (10,000 children)', () => wideOurs(10_000), () => wideYoga(10_000)],
  ['flex: deep taffy-shape (~4,000)', () => deepOurs(4_000, 2), () => deepYoga(4_000, 2)],
  ['flex: deep taffy-shape (~10,000)', () => deepOurs(10_000, 2), () => deepYoga(10_000, 2)],
];

console.log(
  `${'Scenario'.padEnd(34)}${'nodes'.padStart(7)}${'ours ms'.padStart(11)}${'yoga ms'.padStart(10)}` +
    `${'ratio'.padStart(8)}${'yoga build'.padStart(12)}  agreement`,
);

for (const [name, buildOurs, buildYoga] of scenarios) {
  const ourTree = buildOurs();
  computeLayout(ourTree, AVAILABLE);
  const yogaTree = buildYoga();
  yogaTree.calculateLayout(undefined, undefined, Direction.LTR);
  const agreement = checkAgreement(ourTree, yogaTree);
  const nodes = countOurs(ourTree);
  yogaTree.freeRecursive();

  const ours = benchOurs(ourTree);
  const yoga = benchYoga(buildYoga);
  const ratio = ours.medianMs / yoga.layoutMs;

  console.log(
    `${name.padEnd(34)}${String(nodes).padStart(7)}` +
      `${ours.medianMs.toFixed(2).padStart(11)}${yoga.layoutMs.toFixed(2).padStart(10)}` +
      `${(`${ratio.toFixed(1)}x`).padStart(8)}${yoga.buildOnlyMs.toFixed(2).padStart(12)}  ${agreement}`,
  );
}
