// Unit tests for the differential fuzzer's Chrome-free parts: PRNG and
// generator determinism, the serializer round-trip against the harness
// attribute parser, the shrinker, and divergence signatures.

import { describe, expect, it } from 'vitest';
import type { FuzzMode, FuzzNode, FuzzTree } from '../scripts/fuzz/generate.js';
import { countNodes, generateTree, STYLE_COVERAGE } from '../scripts/fuzz/generate.js';
import { deriveSeed, mulberry32, Rng } from '../scripts/fuzz/prng.js';
import { styleToCss } from '../scripts/fuzz/serialize.js';
import { shrinkTree } from '../scripts/fuzz/shrink.js';
import { treeSignature } from '../scripts/fuzz/signature.js';
import type { Style } from '../src/index.js';
import { resolveStyle } from '../src/style.js';
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
    const picks = Array.from({ length: 50 }, () =>
      rng.weighted([
        [1, 'a'],
        [0, 'b'],
      ] as const),
    );
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
    expect(countNodes(result.tree.root)).toBe(1);
    expect(result.tree.viewport).toBeUndefined();
    expect(Object.keys(result.tree.root.style).sort()).toEqual(['aspectRatio', 'margin']);
    expect(result.tree.root.text).toBeUndefined();
    expect(result.budgetExhausted).toBe(false);
  });

  it('stops at the check budget and keeps a still-failing tree', async () => {
    const tree: FuzzTree = {
      root: {
        style: {},
        children: [],
        text: 'HH',
      },
    };
    const result = await shrinkTree(tree, async () => true, 1);
    expect(result.checks).toBe(1);
    expect(result.budgetExhausted).toBe(true);
  });

  it('resets unnecessary longhands inside structured style properties', async () => {
    const tree: FuzzTree = {
      root: {
        style: {
          aspectRatio: 2,
          padding: { left: 40, right: 97, top: 20, bottom: 1 },
          border: { left: 120, right: 200, top: 1, bottom: 20 },
        },
        children: [],
      },
    };
    const stillFails = (candidate: FuzzTree): boolean =>
      candidate.root.style.aspectRatio === 2 && candidate.root.style.padding?.right === 97;

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(stillFails(result.tree)).toBe(true);
    expect(result.tree.root.style).toEqual({
      aspectRatio: 2,
      padding: { left: 0, right: 97, top: 0, bottom: 0 },
    });
    expect(result.budgetExhausted).toBe(false);
  });

  it('shrinks text and numeric values instead of keeping the original magnitudes', async () => {
    const tree: FuzzTree = {
      root: {
        style: { padding: { left: 40, right: 320, top: 20, bottom: 97 } },
        children: [],
        text: 'HHH​HHH​HHHHH',
      },
    };
    const stillFails = (candidate: FuzzTree): boolean =>
      (candidate.root.style.padding?.right as number) > 0 && (candidate.root.text?.includes('H') ?? false);

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.root.text).toBe('H');
    expect(result.tree.root.style.padding).toEqual({ left: 0, right: 1, top: 0, bottom: 0 });
  });

  it('removes mutually dependent properties as a group', async () => {
    const tree: FuzzTree = {
      root: { style: { flexGrow: 2, flexShrink: 2 }, children: [] },
    };
    const stillFails = (candidate: FuzzTree): boolean => {
      const hasGrow = candidate.root.style.flexGrow !== undefined;
      const hasShrink = candidate.root.style.flexShrink !== undefined;
      return hasGrow === hasShrink;
    };

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.root.style).toEqual({});
  });

  it('unwraps wrappers and replaces a subtree with its relevant child', async () => {
    const tree: FuzzTree = {
      root: {
        style: { display: 'block' },
        children: [
          {
            style: { padding: { left: 20, right: 20, top: 20, bottom: 20 } },
            children: [{ style: { aspectRatio: 2 }, children: [] }],
          },
        ],
      },
    };
    const stillFails = (candidate: FuzzTree): boolean => {
      const walk = (node: FuzzNode): boolean => node.style.aspectRatio !== undefined || node.children.some(walk);
      return walk(candidate.root);
    };

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(countNodes(result.tree.root)).toBe(1);
    expect(result.tree.root.style).toEqual({ aspectRatio: 1 });
  });

  it('shortens grid track lists and simplifies their values', async () => {
    const tree: FuzzTree = {
      root: {
        style: {
          gridTemplateColumns: [
            { min: 40, max: 40 },
            { min: 97, max: 97 },
            { min: 320, max: 320 },
          ],
        },
        children: [],
      },
    };
    const stillFails = (candidate: FuzzTree): boolean => (candidate.root.style.gridTemplateColumns?.length ?? 0) > 0;

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.root.style.gridTemplateColumns).toHaveLength(1);
    expect(result.tree.root.style.gridTemplateColumns).toEqual([{ min: 'auto', max: 'auto' }]);
  });

  it('simplifies non-default keywords when deleting the property heals the failure', async () => {
    const tree: FuzzTree = {
      root: { style: { flexDirection: 'column-reverse' }, children: [] },
    };
    const stillFails = (candidate: FuzzTree): boolean =>
      candidate.root.style.flexDirection === 'column' || candidate.root.style.flexDirection === 'column-reverse';

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.root.style.flexDirection).toBe('column');
  });

  it('only tries keywords valid for content-distribution properties', async () => {
    const tree: FuzzTree = {
      root: { style: { alignContent: { keyword: 'space-evenly', safe: false } }, children: [] },
    };
    const stillFails = (candidate: FuzzTree): boolean => {
      const keyword = candidate.root.style.alignContent?.keyword as string | undefined;
      if (keyword === 'baseline') throw new Error('align-content does not accept baseline');
      return keyword === 'space-between' || keyword === 'space-around' || keyword === 'space-evenly';
    };

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.root.style.alignContent).toEqual({ keyword: 'space-between', safe: false });
  });

  it('shrinks viewport dimensions when removing the viewport heals the failure', async () => {
    const tree: FuzzTree = {
      root: { style: {}, children: [] },
      viewport: { width: 400, height: 300 },
    };
    const stillFails = (candidate: FuzzTree): boolean => (candidate.viewport?.width ?? 0) > 0;

    const result = await shrinkTree(tree, async (candidate) => stillFails(candidate));

    expect(result.tree.viewport).toEqual({ width: 1, height: 0 });
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
