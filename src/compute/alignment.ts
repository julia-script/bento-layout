// Alignment fallbacks and content-size accumulation, shared by all layout modes.

import type { Point, Size } from '../geometry.js';
import type { AlignContent, AlignContentKeyword, AlignItems, AlignItemsKeyword, Overflow } from '../style.js';

/** Resolve the safe/unsafe overflow-position fallback for a self-alignment value. */
export function resolveSelfAlignmentSafety(alignment: AlignItems, overflows: boolean): AlignItemsKeyword {
  return alignment.safe && overflows ? 'start' : alignment.keyword;
}

/** Resolve spec-defined fallbacks for an AlignContent value. */
export function applyAlignmentFallback(
  freeSpace: number,
  numItems: number,
  alignmentMode: AlignContent,
): AlignContentKeyword {
  let keyword = alignmentMode.keyword;

  // Distributed alignment keywords fall back to positional keywords (with
  // implicit `safe`) when there is one item or the items overflow.
  if (numItems <= 1 || freeSpace <= 0) {
    if (keyword === 'stretch' || keyword === 'space-between') {
      keyword = 'flex-start';
    } else if (keyword === 'space-around' || keyword === 'space-evenly') {
      // The distributed-to-center fallback is implicitly safe: it resolves to
      // `start` on overflow even without an explicit `safe` keyword.
      keyword = freeSpace <= 0 ? 'start' : 'center';
    }
  }

  // Safe alignment falls back to start on overflow. `start` is
  // direction-agnostic, so this must not swallow the `flex-start` produced by
  // the *distributed* fallback above: that keyword is flex-relative and keeps
  // the reversal. `column-reverse` + `justify-content: space-between` with an
  // overflowing item sits at y=-200 in Chrome (the flex-start of a reversed
  // column), not y=0 — while an *explicitly* `safe flex-start` on the same
  // container does resolve to y=0, so the distinction is the origin of the
  // safety, not the keyword. The `center` fallback carries no flex-relative
  // meaning and resolves to `start` either way (verified for space-around and
  // space-evenly, both y=0 in that container).
  if (freeSpace <= 0 && alignmentMode.safe) {
    keyword = 'start';
  }

  return keyword;
}

/** Generic alignment function used for both align-content and justify-content. */
export function computeAlignmentOffset(
  freeSpace: number,
  numItems: number,
  gap: number,
  alignmentMode: AlignContentKeyword,
  layoutIsFlexReversed: boolean,
  isFirst: boolean,
): number {
  if (isFirst) {
    switch (alignmentMode) {
      case 'start':
        return 0;
      case 'flex-start':
        return layoutIsFlexReversed ? freeSpace : 0;
      case 'end':
        return freeSpace;
      case 'flex-end':
        return layoutIsFlexReversed ? 0 : freeSpace;
      case 'center':
        return freeSpace / 2;
      case 'stretch':
        return 0;
      case 'space-between':
        return 0;
      case 'space-around':
        return freeSpace >= 0 ? freeSpace / numItems / 2 : freeSpace / 2;
      case 'space-evenly':
        return freeSpace >= 0 ? freeSpace / (numItems + 1) : freeSpace / 2;
    }
  } else {
    const clampedFreeSpace = Math.max(freeSpace, 0);
    switch (alignmentMode) {
      case 'start':
      case 'flex-start':
      case 'end':
      case 'flex-end':
      case 'center':
      case 'stretch':
        return gap;
      case 'space-between':
        return gap + clampedFreeSpace / (numItems - 1);
      case 'space-around':
        return gap + clampedFreeSpace / numItems;
      case 'space-evenly':
        return gap + clampedFreeSpace / (numItems + 1);
    }
  }
}

/** Determine how much width/height a node contributes to its parent's content size. */
export function computeContentSizeContribution(
  location: Point<number>,
  size: Size<number>,
  contentSize: Size<number>,
  overflow: Point<Overflow>,
): Size<number> {
  const sizeContribution = {
    width: overflow.x === 'visible' ? Math.max(size.width, contentSize.width) : size.width,
    height: overflow.y === 'visible' ? Math.max(size.height, contentSize.height) : size.height,
  };
  if (sizeContribution.width > 0 && sizeContribution.height > 0) {
    const maxX = Math.max(location.x + sizeContribution.width, 0);
    const minX = Math.min(location.x, 0);
    const maxY = Math.max(location.y + sizeContribution.height, 0);
    const minY = Math.min(location.y, 0);
    return { width: maxX - minX, height: maxY - minY };
  }
  return { width: 0, height: 0 };
}
