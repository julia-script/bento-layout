// Unit tests for the harness grid attribute parser, covering the distinct
// value shapes present in the vendored fixtures.

import { describe, expect, it } from 'vitest';
import { parseGridPlacement, parseTrackList, parseTrackSizingFunction } from './harness/fixture.js';

describe('grid track list parsing', () => {
  it('fixed and percent tracks', () => {
    expect(parseTrackList('40px 40px')).toEqual([
      { min: 40, max: 40 },
      { min: 40, max: 40 },
    ]);
    expect(parseTrackList('10% 20%')).toEqual([
      { min: { percent: 0.1 }, max: { percent: 0.1 } },
      { min: { percent: 0.2 }, max: { percent: 0.2 } },
    ]);
  });

  it('fr gets auto min', () => {
    expect(parseTrackSizingFunction('1fr')).toEqual({ min: 'auto', max: { fr: 1 } });
    expect(parseTrackSizingFunction('0.2fr')).toEqual({ min: 'auto', max: { fr: 0.2 } });
  });

  it('intrinsic keywords', () => {
    expect(parseTrackList('auto min-content max-content')).toEqual([
      { min: 'auto', max: 'auto' },
      { min: 'min-content', max: 'min-content' },
      { min: 'max-content', max: 'max-content' },
    ]);
  });

  it('minmax and fit-content', () => {
    expect(parseTrackSizingFunction('minmax(20px,40px)')).toEqual({ min: 20, max: 40 });
    expect(parseTrackSizingFunction('minmax(0px,max-content)')).toEqual({ min: 0, max: 'max-content' });
    expect(parseTrackSizingFunction('fit-content(50%)')).toEqual({
      min: 'auto',
      max: { fitContent: { percent: 0.5 } },
    });
    expect(parseTrackSizingFunction('fit-content(30px)')).toEqual({ min: 'auto', max: { fitContent: 30 } });
  });

  it('repeat with count and auto-fill, mixed with plain tracks', () => {
    expect(parseTrackList('40px repeat(1, 40px) repeat(auto-fill, 40px)')).toEqual([
      { min: 40, max: 40 },
      { repeat: 1, tracks: [{ min: 40, max: 40 }] },
      { repeat: 'auto-fill', tracks: [{ min: 40, max: 40 }] },
    ]);
  });

  it('placements', () => {
    expect(parseGridPlacement(undefined)).toBe('auto');
    expect(parseGridPlacement('auto')).toBe('auto');
    expect(parseGridPlacement('2')).toEqual({ line: 2 });
    expect(parseGridPlacement('-4')).toEqual({ line: -4 });
    expect(parseGridPlacement('span 2')).toEqual({ span: 2 });
  });
});
