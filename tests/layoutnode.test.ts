// LayoutNode tree-manipulation semantics (spec: layout-tree-api /
// "Opaque node trees" + "Tree manipulation with GC-native lifetime").

import { describe, expect, it } from 'vitest';
import { computeLayout, LayoutNode } from '../src/index.js';

const SPACE = { width: 'max-content', height: 'max-content' } as const;

describe('LayoutNode', () => {
  it('lays out a tree built from constructors', () => {
    const a = LayoutNode.make({ flexGrow: 1 });
    const b = LayoutNode.make({ flexGrow: 1 });
    const root = LayoutNode.make({ width: 400, height: 300 }, [a, b]);

    computeLayout(root, SPACE);

    expect(root.layout.size).toEqual({ width: 400, height: 300 });
    expect(a.layout.size).toEqual({ width: 200, height: 300 });
    expect(b.layout.location).toEqual({ x: 200, y: 0 });
  });

  it('setStyle changes are reflected on recompute', () => {
    const a = LayoutNode.make({ flexGrow: 1 });
    const b = LayoutNode.make({ flexGrow: 1 });
    const root = LayoutNode.make({ width: 400, height: 100 }, [a, b]);

    computeLayout(root, SPACE);
    expect(a.layout.size.width).toBe(200);

    a.setStyle({ flexGrow: 3 });
    computeLayout(root, SPACE);
    expect(a.layout.size.width).toBe(300);
    expect(b.layout.size.width).toBe(100);
  });

  it('exposes no assignable path to internals', () => {
    const node = LayoutNode.make();
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
    const leaf = LayoutNode.make().setMeasure(() => ({ width: 70, height: 30 }));
    const root = LayoutNode.make({}, [leaf]);

    computeLayout(root, SPACE);
    expect(leaf.layout.size).toEqual({ width: 70, height: 30 });

    leaf.setMeasure(null);
    computeLayout(root, SPACE);
    expect(leaf.layout.size).toEqual({ width: 0, height: 0 });
  });

  it('detach and reattach positions the subtree under its new parent', () => {
    const moved = LayoutNode.make({ width: 50, height: 50 });
    const left = LayoutNode.make({ width: 100, height: 100 }, [moved]);
    const right = LayoutNode.make({ width: 100, height: 100 });
    const root = LayoutNode.make({}, [left, right]);

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
    const child = LayoutNode.make({ width: 10, height: 10 });
    const sub = LayoutNode.make({ width: 30, height: 30 }, [child]);
    const root = LayoutNode.make({}, [sub]);

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
    const child = LayoutNode.make();
    const p1 = LayoutNode.make({}, [child]);
    const p2 = LayoutNode.make();

    p2.appendChild(child);
    expect(p1.children).toEqual([]);
    expect(p2.children).toEqual([child]);
    expect(child.parentNode).toBe(p2);
  });

  it('insertChild places at index and handles same-parent moves', () => {
    const a = LayoutNode.make();
    const b = LayoutNode.make();
    const c = LayoutNode.make();
    const root = LayoutNode.make({}, [a, b, c]);

    root.insertChild(0, c); // move last -> first
    expect(root.children).toEqual([c, a, b]);

    root.insertChild(3, c); // move first -> last (index adjusted for removal)
    expect(root.children).toEqual([a, b, c]);

    expect(() => root.insertChild(4, LayoutNode.make())).toThrow(RangeError);
    expect(() => root.insertChild(-1, LayoutNode.make())).toThrow(RangeError);
  });

  it('rejects cycles', () => {
    const inner = LayoutNode.make();
    const mid = LayoutNode.make({}, [inner]);
    const root = LayoutNode.make({}, [mid]);

    expect(() => inner.appendChild(root)).toThrow(/cycle/);
    expect(() => inner.appendChild(inner)).toThrow(/cycle/);
    expect(() => root.removeChild(inner)).toThrow(/not a child/);
  });

  // Flat input merges per property, so touching one axis leaves its partner
  // alone — the nested form used to replace the whole `size` object.
  it('setStyle merges per property, not per nested object', () => {
    const node = LayoutNode.make({ width: 100, height: 200 });
    node.setStyle({ width: 50 });
    expect(node.style.size).toEqual({ width: 50, height: 200 });
    // untouched properties keep their resolved values
    expect(node.style.display).toBe('flex');
  });

  it('flat keys expand into the engine-side nested shapes', () => {
    const node = LayoutNode.make({
      paddingLeft: 1,
      paddingTop: 2,
      marginBottom: 3,
      columnGap: 4,
      rowGap: 5,
      overflowY: 'scroll',
      minWidth: 6,
      left: 7,
      gridRowStart: { line: 2 },
    });
    expect(node.style.padding).toEqual({ left: 1, right: 0, top: 2, bottom: 0 });
    expect(node.style.margin).toEqual({ left: 0, right: 0, top: 0, bottom: 3 });
    expect(node.style.gap).toEqual({ width: 4, height: 5 });
    expect(node.style.overflow).toEqual({ x: 'visible', y: 'scroll' });
    expect(node.style.minSize).toEqual({ width: 6, height: 'auto' });
    expect(node.style.inset.left).toBe(7);
    expect(node.style.gridRow).toEqual({ start: { line: 2 }, end: 'auto' });
  });

  // A node must own its style outright: nothing the caller still holds may
  // reach into it. Aliasing would also defeat mutation tracking, since a node
  // could then go stale without any setter being called.
  it('does not alias caller-supplied style values', () => {
    const tracks = [{ min: 10, max: 10 } as const];
    const align = { keyword: 'center', safe: false } as const;
    const node = LayoutNode.make({ gridTemplateColumns: tracks, alignItems: align });
    expect(node.style.gridTemplateColumns).not.toBe(tracks);
    expect(node.style.gridTemplateColumns).toEqual(tracks);
    expect(node.style.alignItems).toEqual(align);
  });

  it('setStyle does not write through to the previous style object', () => {
    const node = LayoutNode.make({ width: 100, height: 200 });
    const before = node.style.size;
    node.setStyle({ width: 50 });
    // the old nested object is left untouched; a new one is built
    expect(before).toEqual({ width: 100, height: 200 });
    expect(node.style.size).toEqual({ width: 50, height: 200 });
  });
});

describe('InvalidStyleError', () => {
  it('grid line 0 is treated as auto, like CSS invalid-placement fallback', () => {
    const item = LayoutNode.make({ gridColumnStart: { line: 0 }, gridColumnEnd: 'auto' });
    const root = LayoutNode.make({ display: 'grid', gridTemplateColumns: [{ min: 100, max: 100 }] }, [item]);
    expect(() => computeLayout(root, SPACE)).not.toThrow();
    expect(item.layout.size.width).toBe(100); // placed in the single auto slot
  });

  it('non-finite repeat count throws a typed error', async () => {
    const { InvalidStyleError } = await import('../src/index.js');
    const root = LayoutNode.make(
      { display: 'grid', gridTemplateColumns: [{ repeat: Number.NaN, tracks: [{ min: 10, max: 10 }] }] },
      [LayoutNode.make()],
    );
    expect(() => computeLayout(root, SPACE)).toThrow(InvalidStyleError);
    const err = (() => {
      try {
        computeLayout(root, SPACE);
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err?.name).toBe('InvalidStyleError');
  });
});
