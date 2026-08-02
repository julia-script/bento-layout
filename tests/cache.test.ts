// Cache key semantics and the no-allocation-on-hit guarantee.
//
// The fixture suite would catch a cache that returns wrong results, but not one
// that quietly stops sharing entries (a pure perf regression) or that starts
// allocating per hit. These pin both.

import { describe, expect, it } from 'vitest';
import type { LayoutInput, LayoutOutput } from '../src/tree.js';
import { Cache } from '../src/tree.js';

const baseInput = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  runMode: 'compute-size',
  sizingMode: 'content-size',
  axis: 'both',
  knownDimensions: { width: null, height: 20 },
  parentSize: { width: 100, height: 200 },
  availableSpace: { width: 'max-content', height: 'min-content' },
  verticalMarginsAreCollapsible: { start: false, end: false },
  ...over,
});

const output = (width: number, height: number): LayoutOutput => ({
  size: { width, height },
  contentSize: { width: 0, height: 0 },
  firstBaselines: { x: null, y: null },
  topMargin: { positive: 0, negative: 0 },
  bottomMargin: { positive: 0, negative: 0 },
  marginsCanCollapseThrough: false,
});

describe('Cache', () => {
  it('returns the same object on repeated hits (no allocation per hit)', () => {
    const cache = new Cache();
    const input = baseInput();
    cache.store(input, output(7, 20));

    const first = cache.get(input);
    const second = cache.get(input);

    expect(first).not.toBeNull();
    expect(first?.size).toEqual({ width: 7, height: 20 });
    // Identity, not equality: a fresh object per hit would fail here.
    expect(first).toBe(second);
  });

  it('preserves collapsed-margin metadata in compute-size entries', () => {
    const cache = new Cache();
    const input = baseInput();
    const collapsed = {
      ...output(0, 0),
      topMargin: { positive: 2, negative: 0 },
      bottomMargin: { positive: 1, negative: 0 },
      marginsCanCollapseThrough: true,
    };

    cache.store(input, collapsed);

    expect(cache.get(input)).toBe(collapsed);
  });

  it('discriminates on every key field', () => {
    const cache = new Cache();
    const input = baseInput();
    cache.store(input, output(7, 20));

    expect(cache.get(baseInput({ knownDimensions: { width: 5, height: 20 } }))).toBeNull();
    expect(cache.get(baseInput({ knownDimensions: { width: null, height: 21 } }))).toBeNull();
    expect(cache.get(baseInput({ availableSpace: { width: 'min-content', height: 'min-content' } }))).toBeNull();
    expect(cache.get(baseInput({ availableSpace: { width: 'max-content', height: 'max-content' } }))).toBeNull();
    expect(cache.get(baseInput({ parentSize: { width: 999, height: 200 } }))).toBeNull();
    // `axis` is part of the key: dropping it regresses grid baseline fixtures,
    // so it is pinned here.
    expect(cache.get(baseInput({ axis: 'horizontal' }))).toBeNull();
  });

  it('ignores parentSize.height for compute-size but not for perform-layout', () => {
    const cache = new Cache();

    // compute-size masks the y-axis parent size.
    const measure = baseInput();
    cache.store(measure, output(7, 20));
    expect(cache.get(baseInput({ parentSize: { width: 100, height: 999 } }))).not.toBeNull();

    // perform-layout discriminates on it.
    const layout = baseInput({ runMode: 'perform-layout' });
    cache.store(layout, output(7, 20));
    expect(cache.get(layout)).not.toBeNull();
    expect(cache.get(baseInput({ runMode: 'perform-layout', parentSize: { width: 100, height: 999 } }))).toBeNull();
  });

  it('does not serve a known-dimension from a matching cached size', () => {
    // Also accepting an entry whose cached size merely equals the requested
    // known dimension regresses 12 fixtures, so the stricter predicate is
    // deliberate.
    const cache = new Cache();
    cache.store(baseInput(), output(7, 20));
    expect(cache.get(baseInput({ knownDimensions: { width: 7, height: 20 } }))).toBeNull();
  });

  it('never serves compute-size entries to perform-hidden-layout', () => {
    const cache = new Cache();
    cache.store(baseInput(), output(7, 20));
    expect(cache.get(baseInput({ runMode: 'perform-hidden-layout' }))).toBeNull();
  });

  it('clear() drops every entry', () => {
    const cache = new Cache();
    const measure = baseInput();
    const layout = baseInput({ runMode: 'perform-layout' });
    cache.store(measure, output(7, 20));
    cache.store(layout, output(7, 20));

    cache.clear();

    expect(cache.get(measure)).toBeNull();
    expect(cache.get(layout)).toBeNull();
  });

  it('keeps entries in distinct slots from clobbering each other', () => {
    // Slot assignment exists so a node measured under several constraints in one
    // pass does not lose earlier results. Both must survive.
    const cache = new Cache();
    const bothKnown = baseInput({ knownDimensions: { width: 5, height: 20 } }); // slot 0
    const neitherKnown = baseInput({
      knownDimensions: { width: null, height: null },
      availableSpace: { width: 'max-content', height: 'max-content' },
    }); // slot 5

    cache.store(bothKnown, output(5, 20));
    cache.store(neitherKnown, output(30, 40));

    expect(cache.get(bothKnown)?.size).toEqual({ width: 5, height: 20 });
    expect(cache.get(neitherKnown)?.size).toEqual({ width: 30, height: 40 });
  });
});
