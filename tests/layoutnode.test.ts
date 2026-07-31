// LayoutNode tree-manipulation semantics (spec: layout-tree-api /
// "Opaque node trees" + "Tree manipulation with GC-native lifetime").

import { describe, expect, it } from 'vitest';
import { LayoutNode, computeLayout } from '../src/index.js';

const SPACE = { width: 'max-content', height: 'max-content' } as const;

describe('LayoutNode', () => {
  it('lays out a tree built from constructors', () => {
    const a = new LayoutNode({ flexGrow: 1 });
    const b = new LayoutNode({ flexGrow: 1 });
    const root = new LayoutNode({ size: { width: 400, height: 300 } }, [a, b]);

    computeLayout(root, SPACE);

    expect(root.layout.size).toEqual({ width: 400, height: 300 });
    expect(a.layout.size).toEqual({ width: 200, height: 300 });
    expect(b.layout.location).toEqual({ x: 200, y: 0 });
  });

  it('setStyle changes are reflected on recompute', () => {
    const a = new LayoutNode({ flexGrow: 1 });
    const b = new LayoutNode({ flexGrow: 1 });
    const root = new LayoutNode({ size: { width: 400, height: 100 } }, [a, b]);

    computeLayout(root, SPACE);
    expect(a.layout.size.width).toBe(200);

    a.setStyle({ flexGrow: 3 });
    computeLayout(root, SPACE);
    expect(a.layout.size.width).toBe(300);
    expect(b.layout.size.width).toBe(100);
  });

  it('exposes no assignable path to internals', () => {
    const node = new LayoutNode();
    // Getters only: assignment throws in strict mode (no setter defined).
    expect(() => {
      (node as { style: unknown }).style = {};
    }).toThrow(TypeError);
    expect(() => {
      (node as { layout: unknown }).layout = {};
    }).toThrow(TypeError);
    expect(Object.keys(node)).toEqual([]); // no enumerable own data properties
  });

  it('setMeasure drives leaf sizing and can be cleared', () => {
    const leaf = new LayoutNode().setMeasure(() => ({ width: 70, height: 30 }));
    const root = new LayoutNode({}, [leaf]);

    computeLayout(root, SPACE);
    expect(leaf.layout.size).toEqual({ width: 70, height: 30 });

    leaf.setMeasure(null);
    computeLayout(root, SPACE);
    expect(leaf.layout.size).toEqual({ width: 0, height: 0 });
  });

  it('detach and reattach positions the subtree under its new parent', () => {
    const moved = new LayoutNode({ size: { width: 50, height: 50 } });
    const left = new LayoutNode({ size: { width: 100, height: 100 } }, [moved]);
    const right = new LayoutNode({ size: { width: 100, height: 100 } });
    const root = new LayoutNode({}, [left, right]);

    computeLayout(root, SPACE);
    expect(moved.parentNode).toBe(left);

    left.removeChild(moved);
    expect(moved.parentNode).toBeNull();
    right.appendChild(moved);

    computeLayout(root, SPACE);
    expect(moved.parentNode).toBe(right);
    expect(right.children).toEqual([moved]);
    expect(left.children).toEqual([]);
    // right starts at x=100, so moved's absolute slot follows its new parent
    expect(right.layout.location.x).toBe(100);
    expect(moved.layout.location).toEqual({ x: 0, y: 0 });
  });

  it('a detached subtree is a live tree needing no cleanup call', () => {
    const child = new LayoutNode({ size: { width: 10, height: 10 } });
    const sub = new LayoutNode({ size: { width: 30, height: 30 } }, [child]);
    const root = new LayoutNode({}, [sub]);

    root.removeChild(sub);
    // detached subtree can be laid out standalone
    computeLayout(sub, SPACE);
    expect(sub.layout.size).toEqual({ width: 30, height: 30 });

    // original tree is unaffected; no destroy/free API exists
    computeLayout(root, SPACE);
    expect(root.children).toEqual([]);
    expect('free' in root || 'destroy' in root || 'remove' in root).toBe(false);
  });

  it('appendChild reparents: a node has at most one parent', () => {
    const child = new LayoutNode();
    const p1 = new LayoutNode({}, [child]);
    const p2 = new LayoutNode();

    p2.appendChild(child);
    expect(p1.children).toEqual([]);
    expect(p2.children).toEqual([child]);
    expect(child.parentNode).toBe(p2);
  });

  it('insertChild places at index and handles same-parent moves', () => {
    const a = new LayoutNode();
    const b = new LayoutNode();
    const c = new LayoutNode();
    const root = new LayoutNode({}, [a, b, c]);

    root.insertChild(0, c); // move last -> first
    expect(root.children).toEqual([c, a, b]);

    root.insertChild(3, c); // move first -> last (index adjusted for removal)
    expect(root.children).toEqual([a, b, c]);

    expect(() => root.insertChild(4, new LayoutNode())).toThrow(RangeError);
    expect(() => root.insertChild(-1, new LayoutNode())).toThrow(RangeError);
  });

  it('rejects cycles', () => {
    const inner = new LayoutNode();
    const mid = new LayoutNode({}, [inner]);
    const root = new LayoutNode({}, [mid]);

    expect(() => inner.appendChild(root)).toThrow(/cycle/);
    expect(() => inner.appendChild(inner)).toThrow(/cycle/);
    expect(() => root.removeChild(inner)).toThrow(/not a child/);
  });

  it('setStyle shallow-merges: nested objects are replaced whole', () => {
    const node = new LayoutNode({ size: { width: 100, height: 200 } });
    node.setStyle({ size: { width: 50, height: 'auto' } });
    expect(node.style.size).toEqual({ width: 50, height: 'auto' });
    // untouched properties keep their resolved values
    expect(node.style.display).toBe('flex');
  });
});

describe('InvalidStyleError', () => {
  it('grid line 0 is treated as auto, like CSS invalid-placement fallback', () => {
    const item = new LayoutNode({ gridColumn: { start: { line: 0 }, end: 'auto' } });
    const root = new LayoutNode({ display: 'grid', gridTemplateColumns: [{ min: 100, max: 100 }] }, [item]);
    expect(() => computeLayout(root, SPACE)).not.toThrow();
    expect(item.layout.size.width).toBe(100); // placed in the single auto slot
  });

  it('non-finite repeat count throws a typed error', async () => {
    const { InvalidStyleError } = await import('../src/index.js');
    const root = new LayoutNode(
      { display: 'grid', gridTemplateColumns: [{ repeat: Number.NaN, tracks: [{ min: 10, max: 10 }] }] },
      [new LayoutNode()],
    );
    expect(() => computeLayout(root, SPACE)).toThrow(InvalidStyleError);
    const err = (() => { try { computeLayout(root, SPACE); } catch (e) { return e as Error; } return null; })();
    expect(err?.name).toBe('InvalidStyleError');
  });
});
