import { describe, expect, it } from 'vitest';
import { assessStopping, computeEnrichment, type JudgedFinding, rankClusters } from '../scripts/fuzz/analysis.js';
import type { BatchFinding } from '../scripts/fuzz-batch.js';

function judged(id: string, properties: string[], path = 'root/0'): JudgedFinding {
  const finding: BatchFinding = {
    id,
    seed: 1,
    index: 1,
    mode: 'mixed',
    nodes: 2,
    tree: { root: { style: Object.fromEntries(properties.map((property) => [property, 1])), children: [] } },
    fixtures: {},
    mismatches: [],
  };
  return {
    finding,
    properties: new Set(properties),
    mismatches: [{ variant: 'border_box_ltr', path, axis: 'width', expected: 10, actual: 20 }],
  };
}

describe('fuzz batch analysis', () => {
  it('ranks properties by open/fixed enrichment', () => {
    const open = [judged('a', ['gap', 'alignItems']), judged('b', ['gap'])];
    const fixed = [judged('c', ['alignItems']), judged('d', ['padding'])];

    const rows = computeEnrichment(open, fixed);
    expect(rows[0]).toMatchObject({ property: 'gap', openCount: 2, fixedCount: 0, enrichment: Infinity });
    expect(rows.find(({ property }) => property === 'alignItems')?.enrichment).toBe(1);
  });

  it('recommends continuing while a coherent, useful cluster remains', () => {
    const open = Array.from({ length: 5 }, (_, index) => judged(`same-${index}`, ['gap', 'size']));
    const clusters = rankClusters(open, computeEnrichment(open, []));

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.coherence).toBe(1);
    expect(assessStopping(open, clusters).recommendation).toBe('continue');
  });

  it('marks a singleton-heavy heterogeneous tail as a stopping candidate', () => {
    const open = Array.from({ length: 8 }, (_, index) =>
      judged(`tail-${index}`, [`property-${index}`], `root/${index}`),
    );
    const clusters = rankClusters(open, computeEnrichment(open, []));

    const assessment = assessStopping(open, clusters);
    expect(assessment.longTailShare).toBe(1);
    expect(assessment.recommendation).toBe('consider-stopping');
  });
});
