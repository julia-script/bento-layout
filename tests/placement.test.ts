// Direct unit tests for grid placement coordinates (mirrors taffy's placement tests).

import { describe, expect, it } from 'vitest';
import { LayoutNode } from '../src/index.js';
import type { GridPlacement, Style } from '../src/index.js';
import { computeGridSizeEstimate } from '../src/compute/grid/implicit.js';
import { placeGridItems } from '../src/compute/grid/placement.js';
import { CellOccupancyMatrix } from '../src/compute/grid/types.js';
import type { GridItem } from '../src/compute/grid/types.js';

const START = { keyword: 'start', safe: false } as const;

function runPlacement(
  explicitColCount: number,
  explicitRowCount: number,
  childPlacements: { col: [GridPlacement, GridPlacement]; row: [GridPlacement, GridPlacement] }[],
  flow: Style['gridAutoFlow'] = 'row',
): GridItem[] {
  const children = childPlacements.map((p, index) => ({
    index,
    node: LayoutNode.make({
        gridColumnStart: p.col[0], gridColumnEnd: p.col[1],
        gridRowStart: p.row[0], gridRowEnd: p.row[1],
      }),
  }));
  const [colCounts, rowCounts] = computeGridSizeEstimate(
    explicitColCount,
    explicitRowCount,
    'ltr',
    children.map((c) => c.node.style),
  );
  const matrix = new CellOccupancyMatrix(colCounts, rowCounts);
  const items: GridItem[] = [];
  placeGridItems(matrix, items, children, 'ltr', flow, START, START);
  items.sort((a, b) => a.sourceOrder - b.sourceOrder);
  return items;
}

describe('grid placement', () => {
  it('definite line placements', () => {
    const items = runPlacement(4, 4, [{ col: [{ line: 1 }, { line: 3 }], row: [{ line: 1 }, { line: 2 }] }]);
    expect(items[0]!.column).toEqual({ start: 0, end: 2 });
    expect(items[0]!.row).toEqual({ start: 0, end: 1 });
  });

  it('negative line placement counts from end', () => {
    // -1 is the end line of a 4-track explicit grid → oz line 4
    const items = runPlacement(4, 4, [{ col: [{ line: 1 }, { line: -1 }], row: [{ line: 1 }, 'auto'] }]);
    expect(items[0]!.column).toEqual({ start: 0, end: 4 });
  });

  it('span placements', () => {
    const items = runPlacement(4, 4, [{ col: [{ line: 2 }, { span: 2 }], row: ['auto', 'auto'] }]);
    expect(items[0]!.column).toEqual({ start: 1, end: 3 });
  });

  it('auto placement flows row-wise', () => {
    const auto: [GridPlacement, GridPlacement] = ['auto', 'auto'];
    const items = runPlacement(2, 2, [
      { col: auto, row: auto },
      { col: auto, row: auto },
      { col: auto, row: auto },
    ]);
    expect(items[0]!.column).toEqual({ start: 0, end: 1 });
    expect(items[0]!.row).toEqual({ start: 0, end: 1 });
    expect(items[1]!.column).toEqual({ start: 1, end: 2 });
    expect(items[1]!.row).toEqual({ start: 0, end: 1 });
    expect(items[2]!.column).toEqual({ start: 0, end: 1 });
    expect(items[2]!.row).toEqual({ start: 1, end: 2 });
  });

  it('dense packing backfills gaps', () => {
    const auto: [GridPlacement, GridPlacement] = ['auto', 'auto'];
    // First item spans 2 columns starting at col 2 (leaving col 1 of row 1 free)
    const items = runPlacement(
      3,
      3,
      [
        { col: [{ line: 2 }, { span: 2 }], row: auto },
        { col: [{ span: 2 }, 'auto'], row: auto },
        { col: auto, row: auto },
      ],
      'row-dense',
    );
    // Second item (span 2) doesn't fit in the single free cell of row 1 → row 2
    expect(items[1]!.row).toEqual({ start: 1, end: 2 });
    // Third item (span 1) backfills the free cell at col 1, row 1
    expect(items[2]!.column).toEqual({ start: 0, end: 1 });
    expect(items[2]!.row).toEqual({ start: 0, end: 1 });
  });
});
