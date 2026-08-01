import { describe, expect, it } from 'vitest';
import type { FuzzTree } from '../scripts/fuzz/generate.js';
import { generateMatrixProbes } from '../scripts/fuzz/matrix.js';

const tree: FuzzTree = {
  root: {
    style: { aspectRatio: 2, alignItems: { keyword: 'stretch', safe: false } },
    children: [{ style: { flexGrow: 1 }, children: [] }],
  },
};

describe('fuzz probe matrix', () => {
  it('keeps the input immutable and changes one property occurrence per probe', () => {
    const before = structuredClone(tree);
    const probes = generateMatrixProbes(tree, { properties: new Set(['aspectRatio']), maxProbes: 6 });

    expect(tree).toEqual(before);
    expect(probes[0]).toMatchObject({ name: '00-baseline', changedProperty: null, tree: before });
    expect(probes.slice(1).every(({ changedProperty }) => changedProperty === 'aspectRatio')).toBe(true);
    expect(probes.some(({ name }) => name.endsWith('-unset'))).toBe(true);
    expect(probes.every(({ tree: probeTree }) => probeTree.root.style.alignItems?.keyword === 'stretch')).toBe(true);
  });

  it('respects the probe cap', () => {
    expect(generateMatrixProbes(tree, { maxProbes: 3 })).toHaveLength(3);
  });
});
