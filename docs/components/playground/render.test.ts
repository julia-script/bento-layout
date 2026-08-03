// What the demo pipeline hands the page: serialize() geometry and the
// styleToCss() translation the browser overlay renders.
//
// styleToCss gets the attention because it is the one translation step in the
// engine-vs-browser comparison — if the two disagree, a bug here would frame
// the engine for it.

import { computeLayout, LayoutNode, type StyleInput } from 'bento-layout';
import { describe, expect, it } from 'vitest';
import { unreachable } from '../../../src/assert.js';
// Not part of the curated public surface; tests reach into src the way the
// engine's own tests do.
import { resolveStyle } from '../../../src/style.js';
import { serialize } from './serialize.js';
import { styleToCss } from './styleToCss.js';

function css(input: StyleInput): Record<string, string> {
  return styleToCss(resolveStyle(input));
}

describe('styleToCss', () => {
  it("always emits the engine defaults that differ from CSS's", () => {
    expect(css({})).toMatchObject({ display: 'flex', boxSizing: 'border-box', position: 'relative' });
  });

  it('skips properties whose value matches the CSS initial value', () => {
    const out = css({});
    for (const key of ['width', 'marginTop', 'paddingLeft', 'flexGrow', 'flexShrink', 'gridRow', 'columnGap']) {
      expect(out, key).not.toHaveProperty(key);
    }
  });

  it('spells lengths, percentages, and auto the CSS way', () => {
    expect(css({ width: 120, height: '50%', minWidth: 10.5 })).toMatchObject({
      width: '120px',
      height: '50%',
      minWidth: '10.5px',
    });
    // 0.1 * 100 must not surface as 10.000000000000002%.
    expect(css({ width: { percent: 0.1 } }).width).toBe('10%');
  });

  it('renders alignment keywords, including the safe flag', () => {
    expect(css({ alignItems: { keyword: 'center', safe: false } }).alignItems).toBe('center');
    expect(css({ justifyContent: { keyword: 'end', safe: true } }).justifyContent).toBe('safe end');
  });

  it('gives border widths a style so they take layout effect', () => {
    expect(css({ border: 2 })).toMatchObject({
      borderTopWidth: '2px',
      borderStyle: 'solid',
      borderColor: 'transparent',
    });
    expect(css({})).not.toHaveProperty('borderStyle');
  });

  it('renders grid templates: single values, fr, minmax, fit-content, repeat', () => {
    expect(
      css({
        gridTemplateColumns: [
          { min: 100, max: 100 },
          { min: 'auto', max: { fr: 1 } },
          { min: 100, max: { fr: 2 } },
          { min: 'auto', max: { fitContent: 200 } },
        ],
      }).gridTemplateColumns,
    ).toBe('100px 1fr minmax(100px, 2fr) fit-content(200px)');

    expect(
      css({ gridTemplateColumns: [{ repeat: 'auto-fill', tracks: [{ min: 150, max: { fr: 1 } }] }] })
        .gridTemplateColumns,
    ).toBe('repeat(auto-fill, minmax(150px, 1fr))');
  });

  it('renders grid placement lines and spans', () => {
    expect(css({ gridColumnStart: { line: 1 }, gridColumnEnd: { line: -1 } }).gridColumn).toBe('1 / -1');
    expect(css({ gridRowEnd: { span: 2 } }).gridRow).toBe('auto / span 2');
  });
});

describe('serialize', () => {
  function tree(): LayoutNode {
    return LayoutNode.make({ width: 200, height: 200, paddingLeft: 20, paddingTop: 10 }, [
      LayoutNode.make({ width: 50, height: 50 }),
      LayoutNode.make({ display: 'none', width: 50, height: 50 }),
    ]);
  }

  it('reports parent-relative geometry with css attached', () => {
    const root = tree();
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    const out = serialize(root) ?? unreachable();
    expect([out.x, out.y, out.width, out.height]).toEqual([0, 0, 200, 200]);
    const child = out.children[0] ?? unreachable();
    // Relative to the parent's border box, not accumulated.
    expect([child.x, child.y]).toEqual([20, 10]);
    expect(child.css.width).toBe('50px');
    expect(out.display).toBe('flex');
  });

  it('drops display:none subtrees so engine boxes and overlay DOM stay aligned', () => {
    const root = tree();
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    const out = serialize(root) ?? unreachable();
    expect(out.children).toHaveLength(1);
    expect(serialize(LayoutNode.make({ display: 'none' }))).toBeNull();
  });
});
