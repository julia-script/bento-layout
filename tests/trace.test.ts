import { describe, expect, it } from 'vitest';
import { computeLayout, LayoutNode, type LayoutTraceEvent } from '../src/index.js';

describe('layout provenance trace', () => {
  it('reports paths and sizing sources only when requested', () => {
    const child = LayoutNode.make({ aspectRatio: 2, minHeight: 20 });
    const root = LayoutNode.make({ width: 100, height: 40, alignItems: { keyword: 'stretch', safe: false } }, [child]);
    const events: LayoutTraceEvent[] = [];

    computeLayout(root, { width: 'max-content', height: 'max-content' }, { trace: (event) => events.push(event) });

    expect(events.some(({ path, source }) => path === 'root/0' && source === 'stretch')).toBe(true);
    expect(
      events.some(({ path, source, axis }) => path === 'root' && source === 'algorithm-output' && axis === 'width'),
    ).toBe(true);
    expect(() => computeLayout(root, { width: 'max-content', height: 'max-content' })).not.toThrow();
  });
});
