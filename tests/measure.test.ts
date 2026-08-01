// Hand-computed sanity checks for the Ahem text measure function.

import { describe, expect, it } from 'vitest';
import { ahemTextMeasure } from './harness/measure.js';

const ZWS = '​';
// 9 words of 4 glyphs each, ZWS-separated (matches the fixtures' standard text)
const TEXT = Array(9).fill('HHHH').join(ZWS);

describe('ahem text measure', () => {
  it('max-content: all words on one line', () => {
    const measure = ahemTextMeasure(TEXT, 'horizontal');
    const size = measure({ width: null, height: null }, { width: 'max-content', height: 'max-content' });
    expect(size).toEqual({ width: 360, height: 10, baseline: 8 });
  });

  it('min-content: longest word', () => {
    const measure = ahemTextMeasure(TEXT, 'horizontal');
    const size = measure({ width: null, height: null }, { width: 'min-content', height: 'max-content' });
    // width floored at longest word (40), wraps into 9 lines
    expect(size).toEqual({ width: 40, height: 90, baseline: 8 });
  });

  it('definite 50px: wraps at word boundaries', () => {
    const measure = ahemTextMeasure(TEXT, 'horizontal');
    const size = measure({ width: null, height: null }, { width: 50, height: 'max-content' });
    // 5 glyphs fit per line but words are 4 glyphs → one word per line
    expect(size).toEqual({ width: 50, height: 90, baseline: 8 });
  });

  it('known width short-circuits', () => {
    const measure = ahemTextMeasure(TEXT, 'horizontal');
    const size = measure({ width: 100, height: null }, { width: 'max-content', height: 'max-content' });
    // 10 glyphs per line → 2 words per line → ceil(9/2) = 5 lines
    expect(size).toEqual({ width: 100, height: 50, baseline: 8 });
  });

  it('vertical writing mode transposes axes', () => {
    const measure = ahemTextMeasure(TEXT, 'vertical');
    const size = measure({ width: null, height: null }, { width: 'max-content', height: 'max-content' });
    // Vertical writing mode: no horizontal baseline to report.
    expect(size).toEqual({ width: 10, height: 360, baseline: undefined });
  });
});
