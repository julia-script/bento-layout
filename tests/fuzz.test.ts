// Unit tests for the differential fuzzer's Chrome-free parts: PRNG and
// generator determinism, the serializer round-trip against the harness
// attribute parser, the shrinker, and divergence signatures.

import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../src/style.js';
import type { Style } from '../src/index.js';
import { generateTree, countNodes, STYLE_COVERAGE } from '../scripts/fuzz/generate.js';
import type { FuzzMode, FuzzNode, FuzzTree } from '../scripts/fuzz/generate.js';
import { deriveSeed, mulberry32, Rng } from '../scripts/fuzz/prng.js';
import { styleToCss } from '../scripts/fuzz/serialize.js';
import { shrinkTree } from '../scripts/fuzz/shrink.js';
import { treeSignature } from '../scripts/fuzz/signature.js';
import { buildStyle } from './harness/fixture.js';

const MODES: FuzzMode[] = ['flex', 'grid', 'block', 'mixed'];

describe('fuzz prng', () => {
  it('same seed produces the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('derived seeds differ per index and reproduce', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(deriveSeed(42, i));
    expect(seen.size).toBe(1000);
    expect(deriveSeed(42, 7)).toBe(deriveSeed(42, 7));
  });

  it('weighted picks respect the table deterministically', () => {
    const rng = new Rng(1);
    const picks = Array.from({ length: 50 }, () => rng.weighted([[1, 'a'], [0, 'b']] as const));
    expect(picks.every((p) => p === 'a')).toBe(true);
  });
});

describe('fuzz generator', () => {
  it('same seed and mode generate identical trees (spec: Same seed, same tree)', () => {
    for (const mode of MODES) {
      for (let i = 0; i < 25; i++) {
        const seed = deriveSeed(99, i);
        expect(JSON.stringify(generateTree(seed, mode))).toBe(JSON.stringify(generateTree(seed, mode)));
      }
    }
  });

  it('respects the node budget', () => {
    for (let i = 0; i < 50; i++) {
      expect(countNodes(generateTree(deriveSeed(7, i), 'mixed').root)).toBeLessThanOrEqual(40);
    }
  });

  it('per-mode profiles produce the requested container displays', () => {
    for (const [mode, display] of [
      ['flex', 'flex'],
      ['grid', 'grid'],
      ['block', 'block'],
    ] as const) {
      const tree = generateTree(deriveSeed(3, 0), mode);
      const displays = new Set<string>();
      const walk = (n: FuzzNode): void => {
        if (n.children.length > 0 && n.style.display !== 'none') displays.add(n.style.display ?? 'flex');
        n.children.forEach(walk);
      };
      walk(tree.root);
      for (const d of displays) expect(d).toBe(display);
    }
  });

  it('style coverage table exists for every Style key (compile-time check backing)', () => {
    // The `satisfies` clause in generate.ts is the real check; this guards the
    // excluded list from growing silently.
    const excluded = Object.entries(STYLE_COVERAGE)
      .filter(([, v]) => v === 'excluded')
      .map(([k]) => k);
    expect(excluded).toEqual(['scrollbarWidth']);
  });
});

describe('fuzz serializer round-trip (spec backing for faithful comparison)', () => {
  // The CSS record keys double as fixture-XML attribute names, with one
  // pipeline-mirroring exception: inline CSS needs border-*-width longhands,
  // while the extraction helper reports them as plain border-* attributes.
  function cssToAttrs(css: Record<string, string>): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(css)) {
      attrs[k.replace(/^border-(top|left|bottom|right)-width$/, 'border-$1')] = v;
    }
    return attrs;
  }

  it('styleFromAttrs(styleToCss(s)) resolves to the same style', () => {
    let checked = 0;
    for (const mode of MODES) {
      for (let i = 0; i < 40; i++) {
        const tree = generateTree(deriveSeed(1234, i * 10 + MODES.indexOf(mode)), mode);
        const walk = (node: FuzzNode): void => {
          const roundTripped = resolveStyle(buildStyle(cssToAttrs(styleToCss(node.style))));
          expect(roundTripped).toEqual(resolveStyle(node.style));
          checked++;
          node.children.forEach(walk);
        };
        walk(tree.root);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('fuzz shrinker (spec: Minimal reproduction)', () => {
  const bugNode = (n: FuzzNode): boolean => n.style.aspectRatio === 2 && n.style.margin !== undefined;
  const treeHasBug = (t: FuzzTree): boolean => {
    const walk = (n: FuzzNode): boolean => bugNode(n) || n.children.some(walk);
    return walk(t.root);
  };

  const margin = { left: 1, right: 1, top: 1, bottom: 1 } as const;

  it('shrinks to only the nodes and properties required for the failure', async () => {
    const tree: FuzzTree = {
      root: {
        style: { display: 'flex', flexDirection: 'column', gap: { width: 4, height: 4 } },
        children: [
          { style: { size: { width: 10, height: 10 }, flexGrow: 1 }, children: [] },
          {
            style: { aspectRatio: 2, margin, flexGrow: 2, minSize: { width: 5, height: 5 } },
            children: [{ style: { size: { width: 3, height: 3 } }, children: [], text: 'HH' }],
          },
          { style: { padding: { left: 2, right: 2, top: 2, bottom: 2 } }, children: [] },
        ],
      },
      viewport: { width: 400, height: 300 },
    };

    const result = await shrinkTree(tree, async (t) => treeHasBug(t));

    expect(treeHasBug(result.tree)).toBe(true);
    expect(countNodes(result.tree.root)).toBe(2);
    expect(result.tree.viewport).toBeUndefined();
    expect(Object.keys(result.tree.root.style)).toEqual([]);
    const child = result.tree.root.children[0]!;
    expect(Object.keys(child.style).sort()).toEqual(['aspectRatio', 'margin']);
    expect(child.text).toBeUndefined();
    expect(result.budgetExhausted).toBe(false);
  });

  it('stops at the check budget and keeps a still-failing tree', async () => {
    // 12 removable children guarantee more candidate edits than the budget.
    const tree: FuzzTree = {
      root: {
        style: { display: 'flex' },
        children: Array.from({ length: 12 }, () => ({
          style: { flexGrow: 1, size: { width: 10 as const, height: 10 as const } },
          children: [],
        })),
      },
    };
    // Every candidate "fails": the shrinker would reduce to a single node, but
    // must stop at the budget first.
    const result = await shrinkTree(tree, async () => true, 5);
    expect(result.checks).toBeLessThanOrEqual(5);
    expect(result.budgetExhausted).toBe(true);
    expect(countNodes(result.tree.root)).toBeGreaterThanOrEqual(1);
  });
});

describe('fuzz divergence signatures', () => {
  it('is insensitive to style key insertion order', () => {
    const a: FuzzTree = { root: { style: { flexGrow: 1, aspectRatio: 2 }, children: [] } };
    const styleB: Partial<Style> = {};
    styleB.aspectRatio = 2;
    styleB.flexGrow = 1;
    const b: FuzzTree = { root: { style: styleB, children: [] } };
    expect(treeSignature(a)).toBe(treeSignature(b));
  });

  it('distinguishes different trees', () => {
    const a: FuzzTree = { root: { style: { flexGrow: 1 }, children: [] } };
    const b: FuzzTree = { root: { style: { flexGrow: 2 }, children: [] } };
    expect(treeSignature(a)).not.toBe(treeSignature(b));
  });
});
