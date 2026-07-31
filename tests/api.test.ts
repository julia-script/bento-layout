// Public API smoke tests + cache perf sanity.

import { describe, expect, it } from 'vitest';
import { computeLayout, LayoutNode } from '../src/index.js';

describe('public API', () => {
  it('lays out a simple grow row', () => {
    const a = new LayoutNode({ flexGrow: 1 });
    const b = new LayoutNode({ flexGrow: 1 });
    const root = new LayoutNode({ size: { width: 400, height: 300 } }, [a, b]);

    computeLayout(root, { width: 'max-content', height: 'max-content' });

    expect(root.layout.size).toEqual({ width: 400, height: 300 });
    expect(a.layout.size).toEqual({ width: 200, height: 300 });
    expect(b.layout.location).toEqual({ x: 200, y: 0 });
  });

  it('percent sizes and content-box sizing', () => {
    const child = new LayoutNode({
        size: { width: { percent: 0.5 }, height: 100 },
        padding: { left: 10, right: 10, top: 0, bottom: 0 },
      });
    const root = new LayoutNode({
        size: { width: 200, height: 200 },
        boxSizing: 'content-box',
        padding: { left: 10, right: 10, top: 10, bottom: 10 },
      }, [child]);

    computeLayout(root, { width: 'max-content', height: 'max-content' });

    // content-box: 200 content + 20 padding
    expect(root.layout.size.width).toBe(220);
    expect(child.layout.size.width).toBe(100);
    expect(child.layout.location).toEqual({ x: 10, y: 10 });
  });

  it('measure functions drive leaf sizing', () => {
    const leaf = new LayoutNode().setMeasure((known, available) => ({
        width: known.width ?? (typeof available.width === 'number' ? Math.min(available.width, 100) : 100),
        height: known.height ?? 20,
      }));
    const root = new LayoutNode({}, [leaf]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(leaf.layout.size).toEqual({ width: 100, height: 20 });
  });

  it('recomputes after style changes', () => {
    const child = new LayoutNode({ flexGrow: 1 });
    const root = new LayoutNode({ size: { width: 100, height: 10 } }, [child]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size.width).toBe(100);

    root.style.size.width = 300;
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size.width).toBe(300);
  });

  it('deeply nested tree completes quickly (layout cache works)', () => {
    // Without the measurement cache this is exponential in depth.
    let node: LayoutNode = new LayoutNode();
    for (let i = 0; i < 50; i++) {
      node = new LayoutNode({ padding: { left: 1, right: 1, top: 1, bottom: 1 } }, [node]);
    }
    const start = performance.now();
    computeLayout(node, { width: 800, height: 600 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('public surface', () => {
  it('root exports exactly the curated value surface', async () => {
    const mod = await import('../src/index.js');
    // Types are erased; this snapshots the runtime surface. Growing it is a
    // deliberate, reviewed decision — update this list in the same commit.
    expect(Object.keys(mod).sort()).toEqual(['InvalidStyleError', 'LayoutNode', 'computeLayout']);
  });
});
