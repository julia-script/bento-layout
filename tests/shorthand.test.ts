// StyleInput shorthand expansion (spec: style-shorthands).
//
// Shorthands are an input convenience only: they expand into the same longhand
// fields the resolved Style has always had, so `node.style` is unchanged in
// shape and nothing downstream of resolveStyle knows they exist.

import { describe, expect, it } from 'vitest';
import { computeLayout, InvalidStyleError, LayoutNode } from '../src/index.js';
import { resolveStyle } from '../src/style.js';

const SPACE = { width: 'max-content', height: 'max-content' } as const;

describe('uniform value expansion', () => {
  it('padding sets all four sides', () => {
    expect(resolveStyle({ padding: 16 }).padding).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
  });

  it('margin, border, and inset expand the same way', () => {
    expect(resolveStyle({ margin: 4 }).margin).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(resolveStyle({ border: 2 }).border).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(resolveStyle({ inset: 0 }).inset).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('gap sets both axes', () => {
    // Style.gap is a Size: width is the column gutter, height the row gutter.
    expect(resolveStyle({ gap: 8 }).gap).toEqual({ width: 8, height: 8 });
  });

  it('overflow sets both axes', () => {
    expect(resolveStyle({ overflow: 'hidden' }).overflow).toEqual({ x: 'hidden', y: 'hidden' });
  });

  it('keeps percentages and auto as values, not objects', () => {
    expect(resolveStyle({ padding: { percent: 0.1 } }).padding).toEqual({
      top: { percent: 0.1 },
      right: { percent: 0.1 },
      bottom: { percent: 0.1 },
      left: { percent: 0.1 },
    });
    // 'auto' is a legal uniform margin and must not be mistaken for an object.
    expect(resolveStyle({ margin: 'auto' }).margin).toEqual({
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
    });
  });
});

describe('object form', () => {
  it('sets only the sides it names', () => {
    const style = resolveStyle({ paddingLeft: 99, padding: { top: 8, bottom: 8 } });
    // left was set before the shorthand and the shorthand does not name it,
    // so it survives.
    expect(style.padding).toEqual({ top: 8, right: 0, bottom: 8, left: 99 });
  });

  it('accepts the CSS axis names for gap', () => {
    expect(resolveStyle({ gap: { column: 8 } }).gap).toEqual({ width: 8, height: 0 });
    expect(resolveStyle({ gap: { row: 4, column: 8 } }).gap).toEqual({ width: 8, height: 4 });
  });

  it('accepts a resolved Style shape so styles round-trip as input', () => {
    const resolved = resolveStyle({ rowGap: 4, columnGap: 8, overflowX: 'scroll' });
    const again = resolveStyle(resolved);
    expect(again.gap).toEqual({ width: 8, height: 4 });
    expect(again.overflow).toEqual({ x: 'scroll', y: 'visible' });
  });

  it('sets one overflow axis', () => {
    expect(resolveStyle({ overflow: { y: 'scroll' } }).overflow).toEqual({
      x: 'visible',
      y: 'scroll',
    });
  });
});

describe('ordering', () => {
  it('a longhand after a shorthand wins', () => {
    expect(resolveStyle({ padding: 16, paddingTop: 0 }).padding).toEqual({
      top: 0,
      right: 16,
      bottom: 16,
      left: 16,
    });
  });

  it('a shorthand after a longhand wins', () => {
    expect(resolveStyle({ paddingTop: 0, padding: 16 }).padding).toEqual({
      top: 16,
      right: 16,
      bottom: 16,
      left: 16,
    });
  });

  it('expands shorthands independently of each other', () => {
    const style = resolveStyle({ padding: 4, margin: 1, gap: 2 });
    expect(style.padding).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(style.margin).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    expect(style.gap).toEqual({ width: 2, height: 2 });
  });
});

describe('through the public API', () => {
  it('lays out the same as the longhands it expands to', () => {
    const shorthand = LayoutNode.make({ width: 200, height: 200, padding: 20 }, [LayoutNode.make({ flexGrow: 1 })]);
    const longhand = LayoutNode.make(
      {
        width: 200,
        height: 200,
        paddingTop: 20,
        paddingRight: 20,
        paddingBottom: 20,
        paddingLeft: 20,
      },
      [LayoutNode.make({ flexGrow: 1 })],
    );

    computeLayout(shorthand, SPACE);
    computeLayout(longhand, SPACE);

    expect(shorthand.children[0]?.layout.size).toEqual(longhand.children[0]?.layout.size);
    expect(shorthand.children[0]?.layout.location).toEqual({ x: 20, y: 20 });
  });

  it('setStyle merges a shorthand per side, leaving the rest', () => {
    const node = LayoutNode.make({ padding: 10 });
    node.setStyle({ padding: { left: 30 } });
    expect(node.style.padding).toEqual({ top: 10, right: 10, bottom: 10, left: 30 });
  });

  it('auto margins centre a box', () => {
    const child = LayoutNode.make({ width: 50, height: 50, margin: 'auto' });
    const root = LayoutNode.make({ width: 200, height: 200 }, [child]);
    computeLayout(root, SPACE);
    expect(child.layout.location).toEqual({ x: 75, y: 75 });
  });

  it('maps percentage strings to the engine 0..1 fraction', () => {
    // Input takes the CSS spelling; the engine and node.style only ever hold
    // the fraction, so '50%' and { percent: 0.5 } are the same style.
    expect(resolveStyle({ width: '50%' }).size.width).toEqual({ percent: 0.5 });
    expect(resolveStyle({ width: '12.5%' }).size.width).toEqual({ percent: 0.125 });
    expect(resolveStyle({ flexBasis: '100%' }).flexBasis).toEqual({ percent: 1 });
    // Through a shorthand, uniform and per-side alike.
    expect(resolveStyle({ padding: '10%' }).padding).toEqual({
      top: { percent: 0.1 },
      right: { percent: 0.1 },
      bottom: { percent: 0.1 },
      left: { percent: 0.1 },
    });
    expect(resolveStyle({ margin: { top: '25%' } }).margin.top).toEqual({ percent: 0.25 });
    // Keyword strings end in no '%', so they are untouched.
    expect(resolveStyle({ width: 'auto', margin: 'auto' }).size.width).toBe('auto');
  });

  it('lays out a percentage string as the fraction it names', () => {
    const child = LayoutNode.make({ width: '50%', height: 100 });
    const root = LayoutNode.make({ width: 200, height: 200 }, [child]);
    computeLayout(root, SPACE);
    expect(child.layout.size.width).toBe(100);
  });

  it('maps percentage strings at every depth of a grid track', () => {
    expect(resolveStyle({ gridTemplateColumns: [{ min: '25%', max: '25%' }] }).gridTemplateColumns).toEqual([
      { min: { percent: 0.25 }, max: { percent: 0.25 } },
    ]);
    // Inside fit-content(), and inside repeat()'s nested tracks.
    expect(
      resolveStyle({
        gridTemplateRows: [
          { min: 'auto', max: { fitContent: '50%' } },
          { repeat: 3, tracks: [{ min: '10%', max: { fr: 1 } }] },
        ],
        gridAutoColumns: [{ min: 'min-content', max: '75%' }],
      }),
    ).toMatchObject({
      gridTemplateRows: [
        { min: 'auto', max: { fitContent: { percent: 0.5 } } },
        { repeat: 3, tracks: [{ min: { percent: 0.1 }, max: { fr: 1 } }] },
      ],
      gridAutoColumns: [{ min: 'min-content', max: { percent: 0.75 } }],
    });
  });

  it("copies grid tracks so the caller's input is left alone", () => {
    const track = { min: '50%', max: { fr: 1 } } as const;
    const input = { gridTemplateColumns: [track] };
    const style = resolveStyle(input);
    // Converting must not write through to what the caller still holds, and
    // the node must not be reachable from it either.
    expect(track.min).toBe('50%');
    expect(style.gridTemplateColumns[0]).not.toBe(track);
  });

  it('lays out a percentage-string grid track as the fraction it names', () => {
    const child = LayoutNode.make({});
    const grid = LayoutNode.make(
      { display: 'grid', width: 400, height: 100, gridTemplateColumns: [{ min: '25%', max: '25%' }] },
      [child],
    );
    computeLayout(grid, SPACE);
    expect(child.layout.size.width).toBe(100);
  });

  it('rejects a malformed percentage instead of resolving it to NaN', () => {
    expect(() => LayoutNode.make({ width: 'fifty%' as never })).toThrow(InvalidStyleError);
    expect(() => resolveStyle({ width: '%' as never })).toThrow(InvalidStyleError);
  });

  it('leaves node.style in the resolved longhand shape', () => {
    const node = LayoutNode.make({ padding: 5, gap: 3 });
    // Shorthands are an input dialect; the resolved style never gains a
    // `padding: 5` scalar alongside the Rect.
    expect(node.style.padding).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
    expect(node.style.gap).toEqual({ width: 3, height: 3 });
  });
});
