// Public API smoke tests + cache perf sanity.

import { describe, expect, it } from 'vitest';
import { computeLayout, createNode } from '../src/index.js';
import type { Node } from '../src/index.js';

describe('public API', () => {
  it('lays out a simple grow row', () => {
    const a = createNode({ style: { flexGrow: 1 } });
    const b = createNode({ style: { flexGrow: 1 } });
    const root = createNode({ style: { size: { width: 400, height: 300 } }, children: [a, b] });

    computeLayout(root, { width: 'max-content', height: 'max-content' });

    expect(root.layout.size).toEqual({ width: 400, height: 300 });
    expect(a.layout.size).toEqual({ width: 200, height: 300 });
    expect(b.layout.location).toEqual({ x: 200, y: 0 });
  });

  it('percent sizes and content-box sizing', () => {
    const child = createNode({
      style: {
        size: { width: { percent: 0.5 }, height: 100 },
        padding: { left: 10, right: 10, top: 0, bottom: 0 },
      },
    });
    const root = createNode({
      style: {
        size: { width: 200, height: 200 },
        boxSizing: 'content-box',
        padding: { left: 10, right: 10, top: 10, bottom: 10 },
      },
      children: [child],
    });

    computeLayout(root, { width: 'max-content', height: 'max-content' });

    // content-box: 200 content + 20 padding
    expect(root.layout.size.width).toBe(220);
    expect(child.layout.size.width).toBe(100);
    expect(child.layout.location).toEqual({ x: 10, y: 10 });
  });

  it('measure functions drive leaf sizing', () => {
    const leaf = createNode({
      measure: (known, available) => ({
        width: known.width ?? (typeof available.width === 'number' ? Math.min(available.width, 100) : 100),
        height: known.height ?? 20,
      }),
    });
    const root = createNode({ style: {}, children: [leaf] });
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(leaf.layout.size).toEqual({ width: 100, height: 20 });
  });

  it('recomputes after style changes', () => {
    const child = createNode({ style: { flexGrow: 1 } });
    const root = createNode({ style: { size: { width: 100, height: 10 } }, children: [child] });
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size.width).toBe(100);

    root.style.size.width = 300;
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size.width).toBe(300);
  });

  it('deeply nested tree completes quickly (layout cache works)', () => {
    // Without the measurement cache this is exponential in depth.
    let node: Node = createNode({ style: {} });
    for (let i = 0; i < 50; i++) {
      node = createNode({ style: { padding: { left: 1, right: 1, top: 1, bottom: 1 } }, children: [node] });
    }
    const start = performance.now();
    computeLayout(node, { width: 800, height: 600 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
