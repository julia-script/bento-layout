// Scrollbar gutter reservation (the `scrollbarWidth` style knob).
//
// Browser fixtures are generated in headless Chrome, which has 0-width overlay
// scrollbars, so gutter reservation is covered here instead: these mirror the
// pre-regeneration Taffy fixtures that were generated with 15px scrollbars.

import { describe, expect, it } from 'vitest';
import { computeLayout, LayoutNode } from '../src/index.js';

const SCROLL = { overflowX: 'scroll', overflowY: 'scroll' } as const;

describe('scrollbar gutter reservation', () => {
  it('flex: scroll container reserves gutters for its content', () => {
    // Mirrors flex/overflow_scrollbars_take_up_space_both_axis (scrollbar-width 15)
    const child = LayoutNode.make({ width: { percent: 1 }, height: { percent: 1 } });
    const root = LayoutNode.make({ width: 100, height: 100, ...SCROLL, scrollbarWidth: 15 }, [child]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    // Percentage sizes resolve against the content box, which excludes the 15px gutters
    expect(child.layout.size).toEqual({ width: 85, height: 85 });
  });

  it('flex: vertical scrollbar consumes inline space in a row', () => {
    const a = LayoutNode.make({ flexGrow: 1 });
    const root = LayoutNode.make({ width: 100, height: 50, overflowX: 'visible', overflowY: 'scroll', scrollbarWidth: 15 }, [a]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(a.layout.size.width).toBe(85);
    expect(a.layout.size.height).toBe(50);
  });

  it('flex rtl: vertical scrollbar gutter is reserved on the left', () => {
    const a = LayoutNode.make({ flexGrow: 1 });
    const root = LayoutNode.make({
        direction: 'rtl',
        width: 100, height: 50,
        overflowX: 'visible', overflowY: 'scroll',
        scrollbarWidth: 15,
      }, [a]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(a.layout.size.width).toBe(85);
    expect(a.layout.location.x).toBe(15);
  });

  it('block: scroll container reserves gutters', () => {
    const child = LayoutNode.make({ display: 'block', width: 'auto', height: 20 });
    const root = LayoutNode.make({ display: 'block', width: 100, height: 100, ...SCROLL, scrollbarWidth: 15 }, [child]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size.width).toBe(85);
  });

  it('grid: scroll container reserves gutters for track sizing', () => {
    const child = LayoutNode.make();
    const root = LayoutNode.make({
        display: 'grid',
        width: 100, height: 100,
        gridTemplateColumns: [{ min: 'auto', max: { fr: 1 } }],
        gridTemplateRows: [{ min: 'auto', max: { fr: 1 } }],
        ...SCROLL,
        scrollbarWidth: 15,
      }, [child]);
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    expect(child.layout.size).toEqual({ width: 85, height: 85 });
  });
});
