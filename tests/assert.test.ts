import { describe, expect, it } from 'vitest';
import { unreachable } from '../src/assert.js';

describe('unreachable', () => {
  it('throws when a supposedly-impossible branch is taken', () => {
    expect(() => unreachable()).toThrow('unreachable');
  });

  it('carries a custom message', () => {
    expect(() => unreachable('track must exist')).toThrow('track must exist');
  });

  it('is transparent to `??` when the value is present', () => {
    const tracks = [10, 20];
    expect(tracks[0] ?? unreachable()).toBe(10);
  });

  // The point of the helper over `!`: a broken invariant fails here rather than
  // leaking `undefined` into arithmetic and surfacing as NaN somewhere else.
  it('throws instead of yielding undefined on an out-of-range lookup', () => {
    const tracks: number[] = [];
    expect(() => tracks[0] ?? unreachable()).toThrow('unreachable');
  });

  // `0` and `''` are legitimate values; `??` must not treat them as absent.
  it('does not fire on falsy-but-present values', () => {
    const zeros = [0];
    expect(zeros[0] ?? unreachable()).toBe(0);
  });
});
