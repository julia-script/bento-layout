import { describe, expect, it } from 'vitest';
import {
  CoercionError,
  coerceAlignContent,
  coerceAlignItems,
  coerceDimension,
  coerceGridPlacement,
  coerceLengthPercentage,
  coerceStyle,
  coerceTrackList,
} from './coerce.js';

describe('lengths and percentages', () => {
  it('reads px and bare numbers', () => {
    expect(coerceLengthPercentage('100px', 'width')).toBe(100);
    expect(coerceLengthPercentage('0px', 'width')).toBe(0);
    expect(coerceLengthPercentage('12.5px', 'width')).toBe(12.5);
    expect(coerceLengthPercentage(100, 'width')).toBe(100);
    expect(coerceLengthPercentage('-10px', 'marginLeft')).toBe(-10);
  });

  it('divides percentages by 100', () => {
    // The engine models percentages as 0..1 fractions, so '50%' must be half —
    // { percent: 50 } would mean 5000%.
    expect(coerceLengthPercentage('50%', 'width')).toEqual({ percent: 0.5 });
    expect(coerceLengthPercentage('100%', 'width')).toEqual({ percent: 1 });
    expect(coerceLengthPercentage('12.5%', 'width')).toEqual({ percent: 0.125 });
  });

  it('passes structured values through', () => {
    expect(coerceLengthPercentage({ percent: 0.25 }, 'width')).toEqual({ percent: 0.25 });
  });

  it("accepts 'auto' only as a Dimension", () => {
    expect(coerceDimension('auto', 'width')).toBe('auto');
    expect(() => coerceLengthPercentage('auto', 'paddingLeft')).toThrow(CoercionError);
  });
});

describe('rejected values', () => {
  it('rejects unsupported units', () => {
    expect(() => coerceLengthPercentage('2rem', 'width')).toThrow(/unsupported unit "rem"/);
    expect(() => coerceLengthPercentage('50vh', 'height')).toThrow(/unsupported unit "vh"/);
    expect(() => coerceLengthPercentage('1em', 'width')).toThrow(/unsupported unit "em"/);
  });

  it('rejects fr outside a track position', () => {
    expect(() => coerceLengthPercentage('1fr', 'width')).toThrow(/only valid in a grid track/);
  });

  it('rejects unparseable lengths rather than producing NaN', () => {
    // A NaN reaching the engine survives every bounds check and can hang the
    // sizing loop outright, so these must throw, never return.
    for (const bad of ['abc', '1f', '', 'px', '--']) {
      expect(() => coerceLengthPercentage(bad, 'width')).toThrow(CoercionError);
    }
  });

  it('rejects non-finite numbers', () => {
    expect(() => coerceLengthPercentage(NaN, 'width')).toThrow(/not a finite number/);
    expect(() => coerceLengthPercentage(Infinity, 'width')).toThrow(/not a finite number/);
  });
});

describe('plain-number properties', () => {
  // These two are bare `number` in the engine, not lengths. Before they had a
  // coercer, a demo writing the natural '12px' passed the *string* through to
  // the engine, where the gutter arithmetic produced NaN and the preview
  // vanished with no error to explain it.
  it('reads px and bare numbers for scrollbarWidth', () => {
    expect(coerceStyle({ scrollbarWidth: '12px' })).toEqual({ scrollbarWidth: 12 });
    expect(coerceStyle({ scrollbarWidth: '12' })).toEqual({ scrollbarWidth: 12 });
    expect(coerceStyle({ scrollbarWidth: 12 })).toEqual({ scrollbarWidth: 12 });
  });

  it('reads aspectRatio as a unitless number', () => {
    expect(coerceStyle({ aspectRatio: 1.5 })).toEqual({ aspectRatio: 1.5 });
    expect(coerceStyle({ aspectRatio: '1.5' })).toEqual({ aspectRatio: 1.5 });
  });

  it('rejects units and junk rather than leaking a string', () => {
    expect(() => coerceStyle({ scrollbarWidth: '50%' })).toThrow(CoercionError);
    expect(() => coerceStyle({ scrollbarWidth: '2rem' })).toThrow(CoercionError);
    expect(() => coerceStyle({ aspectRatio: 'wide' })).toThrow(CoercionError);
  });
});

describe('alignment keywords', () => {
  it('expands a bare keyword', () => {
    expect(coerceAlignItems('center', 'alignItems')).toEqual({ keyword: 'center', safe: false });
    expect(coerceAlignItems('stretch', 'alignItems')).toEqual({ keyword: 'stretch', safe: false });
  });

  it('reads the safe modifier', () => {
    expect(coerceAlignItems('safe center', 'alignItems')).toEqual({ keyword: 'center', safe: true });
    expect(coerceAlignItems('unsafe center', 'alignItems')).toEqual({
      keyword: 'center',
      safe: false,
    });
  });

  it('accepts space-* only on the content keyword set', () => {
    expect(coerceAlignContent('space-between', 'justifyContent')).toEqual({
      keyword: 'space-between',
      safe: false,
    });
    expect(() => coerceAlignItems('space-between', 'alignItems')).toThrow(/unknown alignment/);
  });

  it('rejects unknown keywords', () => {
    expect(() => coerceAlignItems('middle', 'alignItems')).toThrow(/unknown alignment/);
  });

  it('passes structured values through', () => {
    expect(coerceAlignItems({ keyword: 'center', safe: true }, 'alignItems')).toEqual({
      keyword: 'center',
      safe: true,
    });
  });
});

describe('grid track lists', () => {
  it('fixed and percentage tracks set both bounds', () => {
    expect(coerceTrackList('40px 40px', 'gridTemplateColumns')).toEqual([
      { min: 40, max: 40 },
      { min: 40, max: 40 },
    ]);
    expect(coerceTrackList('10% 20%', 'gridTemplateColumns')).toEqual([
      { min: { percent: 0.1 }, max: { percent: 0.1 } },
      { min: { percent: 0.2 }, max: { percent: 0.2 } },
    ]);
  });

  it('gives a bare fr an auto minimum', () => {
    // CSS says `1fr` means `minmax(auto, 1fr)`.
    expect(coerceTrackList('1fr', 'gridTemplateColumns')).toEqual([{ min: 'auto', max: { fr: 1 } }]);
    expect(coerceTrackList('0.2fr', 'gridTemplateColumns')).toEqual([{ min: 'auto', max: { fr: 0.2 } }]);
  });

  it('reads intrinsic keywords', () => {
    expect(coerceTrackList('auto min-content max-content', 'gridTemplateColumns')).toEqual([
      { min: 'auto', max: 'auto' },
      { min: 'min-content', max: 'min-content' },
      { min: 'max-content', max: 'max-content' },
    ]);
  });

  it('reads minmax and fit-content', () => {
    expect(coerceTrackList('minmax(20px, 40px)', 'gridTemplateColumns')).toEqual([{ min: 20, max: 40 }]);
    expect(coerceTrackList('minmax(0px, max-content)', 'gridTemplateColumns')).toEqual([
      { min: 0, max: 'max-content' },
    ]);
    expect(coerceTrackList('fit-content(50%)', 'gridTemplateColumns')).toEqual([
      { min: 'auto', max: { fitContent: { percent: 0.5 } } },
    ]);
    expect(coerceTrackList('fit-content(30px)', 'gridTemplateColumns')).toEqual([
      { min: 'auto', max: { fitContent: 30 } },
    ]);
  });

  it('reads repeat with a count and with auto-fill/auto-fit', () => {
    expect(coerceTrackList('repeat(3, 1fr)', 'gridTemplateColumns')).toEqual([
      { repeat: 3, tracks: [{ min: 'auto', max: { fr: 1 } }] },
    ]);
    expect(coerceTrackList('repeat(auto-fill, minmax(100px, 1fr))', 'gridTemplateColumns')).toEqual([
      { repeat: 'auto-fill', tracks: [{ min: 100, max: { fr: 1 } }] },
    ]);
    expect(coerceTrackList('repeat(auto-fit, 40px)', 'gridTemplateColumns')).toEqual([
      { repeat: 'auto-fit', tracks: [{ min: 40, max: 40 }] },
    ]);
  });

  it('mixes repeat with plain tracks', () => {
    expect(coerceTrackList('200px repeat(auto-fill, 150px) 1fr', 'gridTemplateColumns')).toEqual([
      { min: 200, max: 200 },
      { repeat: 'auto-fill', tracks: [{ min: 150, max: 150 }] },
      { min: 'auto', max: { fr: 1 } },
    ]);
  });

  it('carries multiple tracks inside one repeat', () => {
    expect(coerceTrackList('repeat(2, 100px 1fr)', 'gridTemplateColumns')).toEqual([
      {
        repeat: 2,
        tracks: [
          { min: 100, max: 100 },
          { min: 'auto', max: { fr: 1 } },
        ],
      },
    ]);
  });

  it('passes an already-structured array through', () => {
    const structured = [{ min: 'auto' as const, max: { fr: 1 } }];
    expect(coerceTrackList(structured, 'gridTemplateColumns')).toBe(structured);
  });

  it('rejects malformed track syntax', () => {
    // `repeat(3)` is the case a naive indexOf(',') split turns into garbage.
    expect(() => coerceTrackList('repeat(3)', 'gridTemplateColumns')).toThrow(/needs a count and a track list/);
    expect(() => coerceTrackList('repeat(0, 1fr)', 'gridTemplateColumns')).toThrow(/positive integer/);
    expect(() => coerceTrackList('minmax(1fr, 2fr)', 'gridTemplateColumns')).toThrow(/not valid as a track minimum/);
    expect(() => coerceTrackList('minmax(10px)', 'gridTemplateColumns')).toThrow(/exactly two arguments/);
    expect(() => coerceTrackList('2rem', 'gridTemplateColumns')).toThrow(/unsupported unit/);
  });
});

describe('grid placement', () => {
  it('reads auto, lines, and spans', () => {
    expect(coerceGridPlacement('auto', 'gridRowStart')).toBe('auto');
    expect(coerceGridPlacement('1', 'gridRowStart')).toEqual({ line: 1 });
    expect(coerceGridPlacement('-1', 'gridColumnEnd')).toEqual({ line: -1 });
    expect(coerceGridPlacement('span 2', 'gridRowEnd')).toEqual({ span: 2 });
    expect(coerceGridPlacement(3, 'gridRowStart')).toEqual({ line: 3 });
  });

  it('rejects garbage rather than producing { line: NaN }', () => {
    expect(() => coerceGridPlacement('abc', 'gridRowStart')).toThrow(CoercionError);
    expect(() => coerceGridPlacement('span 0', 'gridRowEnd')).toThrow(/positive integer/);
    expect(() => coerceGridPlacement('1.5', 'gridRowStart')).toThrow(CoercionError);
  });
});

describe('whole-style coercion', () => {
  it('coerces known properties and leaves others alone', () => {
    expect(
      coerceStyle({
        display: 'grid',
        width: '300px',
        height: '50%',
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gridRowEnd: 'span 2',
        columnGap: '8px',
      }),
    ).toEqual({
      display: 'grid',
      width: 300,
      height: { percent: 0.5 },
      flexGrow: 1,
      alignItems: { keyword: 'center', safe: false },
      justifyContent: { keyword: 'space-between', safe: false },
      gridTemplateColumns: [{ repeat: 2, tracks: [{ min: 'auto', max: { fr: 1 } }] }],
      gridRowEnd: { span: 2 },
      columnGap: 8,
    });
  });

  it('names the offending property when a value is bad', () => {
    expect(() => coerceStyle({ width: '2rem' })).toThrow(/^width:/);
  });

  it('coerces the values inside a uniform shorthand', () => {
    // The library expands `padding` into longhands; coercion only turns the
    // CSS-shaped string into an engine value.
    expect(coerceStyle({ padding: '16px' })).toEqual({ padding: 16 });
    expect(coerceStyle({ gap: '8px' })).toEqual({ gap: 8 });
    expect(coerceStyle({ margin: 'auto' })).toEqual({ margin: 'auto' });
    expect(coerceStyle({ padding: '10%' })).toEqual({ padding: { percent: 0.1 } });
  });

  it('coerces each side of an object shorthand', () => {
    expect(coerceStyle({ padding: { top: '8px', bottom: '10%' } })).toEqual({
      padding: { top: 8, bottom: { percent: 0.1 } },
    });
    expect(coerceStyle({ gap: { column: '8px' } })).toEqual({ gap: { column: 8 } });
  });

  it('names the side when a shorthand value is bad', () => {
    expect(() => coerceStyle({ padding: { top: '2rem' } })).toThrow(/padding\.top:/);
  });
});
