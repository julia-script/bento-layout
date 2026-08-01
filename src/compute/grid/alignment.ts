// Track alignment and final item positioning.

import { unreachable } from '../../assert.js';
import type { Rect, Size } from '../../geometry.js';
import { maybeApplyAspectRatio, rectAdd, sumAxes } from '../../geometry.js';
import type { Opt } from '../../math.js';
import { mClamp, vMax } from '../../math.js';
import type { AlignContent, AlignContentKeyword, AlignItems, Direction, Position } from '../../style.js';
import { maybeResolve, maybeResolveSize, resolveOrZero } from '../../style.js';
import type { Layout, LayoutNode } from '../../tree.js';
import { internals } from '../../tree.js';
import {
  applyAlignmentFallback,
  computeAlignmentOffset,
  computeContentSizeContribution,
  resolveSelfAlignmentSafety,
} from '../alignment.js';
import { measureChildSizeBoth, performChildLayout } from '../dispatch.js';
import type { GridItem, GridTrack } from './types.js';
import { maybeApplyAspectRatioUsed } from './types.js';

const ALIGN_START: AlignItems = { keyword: 'start', safe: false };
const ALIGN_STRETCH_LOCAL: AlignItems = { keyword: 'stretch', safe: false };

/** The align-content keyword that means the same thing in a reversed axis. */
function reversedKeyword(keyword: AlignContentKeyword): AlignContentKeyword {
  switch (keyword) {
    case 'start':
      return 'end';
    case 'end':
      return 'start';
    case 'flex-start':
      return 'flex-end';
    case 'flex-end':
      return 'flex-start';
    case 'stretch':
      return 'end';
    default:
      return keyword;
  }
}

/**
 * Align the grid tracks within the grid per align-content (rows) or
 * justify-content (columns), writing each track's `offset`.
 */
export function alignTracks(
  gridContainerContentBoxSize: number,
  padding: { start: number; end: number },
  border: { start: number; end: number },
  tracks: GridTrack[],
  trackAlignmentStyle: AlignContent,
  axisIsReversed: boolean,
): void {
  const usedSize = tracks.reduce((sum, track) => sum + track.baseSize, 0);
  const freeSpace = gridContainerContentBoxSize - usedSize;
  const origin = padding.start + border.start;

  // Count non-collapsed tracks (not counting gutters)
  let numTracks = 0;
  for (let i = 1; i < tracks.length; i += 2) {
    if (!tracks[i]?.isCollapsed) numTracks++;
  }

  // Grid layout treats gaps as full tracks; gap = 0 here. Grid layout is never flex-reversed.
  const gap = 0;
  const layoutIsReversed = false;
  let trackAlignment = applyAlignmentFallback(freeSpace, numTracks, trackAlignmentStyle);
  if (axisIsReversed) trackAlignment = reversedKeyword(trackAlignment);

  // Compute offsets
  let totalOffset = origin;
  let seenNonCollapsedTrack = false;
  tracks.forEach((track, i) => {
    // Even indices are gutters/lines
    const isGutter = i % 2 === 0;
    const isNonCollapsedTrack = !isGutter && !track.isCollapsed;
    const isFirst = isNonCollapsedTrack && !seenNonCollapsedTrack;

    const offset = isNonCollapsedTrack
      ? computeAlignmentOffset(freeSpace, numTracks, gap, trackAlignment, layoutIsReversed, isFirst)
      : 0;

    track.offset = totalOffset + offset;
    totalOffset = totalOffset + offset + track.baseSize;
    if (isNonCollapsedTrack) seenNonCollapsedTrack = true;
  });
}

/**
 * Align and size a grid item into its final position.
 * Returns [contentSizeContribution, yPosition, height].
 *
 * `justifyBaselineOffset` is the Major-group logical inline offset for
 * `justify-self: baseline` (`trackBaseline - synthesizedBaseline`), or `null`
 * to fall back to start (css-align-3 §6.1 / Blink when the item is alone in
 * its column baseline-sharing group).
 */
export function alignAndPositionItem(
  node: LayoutNode,
  order: number,
  gridArea: Rect<number>,
  containerAlignmentStyles: { horizontal: AlignItems | null; vertical: AlignItems | null },
  baselineShim: number,
  direction: Direction,
  justifyBaselineOffset: number | null = null,
): [Size<number>, number, number] {
  const gridAreaSize = { width: gridArea.right - gridArea.left, height: gridArea.bottom - gridArea.top };

  const nd = internals(node);
  const style = nd.style;
  const overflow = style.overflow;
  const scrollbarWidth = style.scrollbarWidth;
  const aspectRatio = style.aspectRatio;
  const justifySelf = style.justifySelf;
  const alignSelf = style.alignSelf;

  const position = style.position;
  const insetHorizontal = {
    start: maybeResolve(style.inset.left, gridAreaSize.width),
    end: maybeResolve(style.inset.right, gridAreaSize.width),
  };
  const insetVertical = {
    start: maybeResolve(style.inset.top, gridAreaSize.height),
    end: maybeResolve(style.inset.bottom, gridAreaSize.height),
  };
  const padding = {
    left: resolveOrZero(style.padding.left, gridAreaSize.width),
    right: resolveOrZero(style.padding.right, gridAreaSize.width),
    top: resolveOrZero(style.padding.top, gridAreaSize.width),
    bottom: resolveOrZero(style.padding.bottom, gridAreaSize.width),
  };
  const border = {
    left: resolveOrZero(style.border.left, gridAreaSize.width),
    right: resolveOrZero(style.border.right, gridAreaSize.width),
    top: resolveOrZero(style.border.top, gridAreaSize.width),
    bottom: resolveOrZero(style.border.bottom, gridAreaSize.width),
  };
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };

  const inherentSize = maybeAddSize(
    maybeApplyAspectRatio(maybeResolveSize(style.size, gridAreaSize), aspectRatio),
    boxSizingAdjustment,
  );
  const minSizeRaw = maybeAddSize(maybeResolveSize(style.minSize, gridAreaSize), boxSizingAdjustment);
  const minSize = maybeApplyAspectRatio(
    {
      width: vMax(minSizeRaw.width ?? paddingBorderSize.width, paddingBorderSize.width),
      height: vMax(minSizeRaw.height ?? paddingBorderSize.height, paddingBorderSize.height),
    },
    aspectRatio,
  );
  const maxSize = maybeAddSize(
    maybeApplyAspectRatio(maybeResolveSize(style.maxSize, gridAreaSize), aspectRatio),
    boxSizingAdjustment,
  );

  // Resolve default alignment styles if set on neither the parent nor the node itself
  const alignmentStyles = {
    horizontal:
      justifySelf ??
      containerAlignmentStyles.horizontal ??
      (inherentSize.width !== null ? ALIGN_START : ALIGN_STRETCH_LOCAL),
    vertical:
      alignSelf ??
      containerAlignmentStyles.vertical ??
      (inherentSize.height !== null || aspectRatio !== null ? ALIGN_START : ALIGN_STRETCH_LOCAL),
  };

  // Note: both horizontal and vertical margins resolve against the WIDTH of the grid area.
  const margin: Rect<Opt> = {
    left: maybeResolve(style.margin.left, gridAreaSize.width),
    right: maybeResolve(style.margin.right, gridAreaSize.width),
    top: maybeResolve(style.margin.top, gridAreaSize.width),
    bottom: maybeResolve(style.margin.bottom, gridAreaSize.width),
  };

  const gridAreaMinusItemMarginsSize = {
    width: vMaybeSub(vMaybeSub(gridAreaSize.width, margin.left), margin.right),
    height: vMaybeSub(vMaybeSub(gridAreaSize.height, margin.top), margin.bottom) - baselineShim,
  };

  // Absolute positioning: derive width from left+right insets; stretch alignment otherwise
  let width = inherentSize.width;
  if (width === null) {
    if (position === 'absolute' && insetHorizontal.start !== null && insetHorizontal.end !== null) {
      width = Math.max(gridAreaMinusItemMarginsSize.width - insetHorizontal.start - insetHorizontal.end, 0);
    } else if (
      margin.left !== null &&
      margin.right !== null &&
      alignmentStyles.horizontal.keyword === 'stretch' &&
      !alignmentStyles.horizontal.safe &&
      position !== 'absolute'
    ) {
      width = gridAreaMinusItemMarginsSize.width;
    }
  }
  // Reapply aspect ratio after stretch/absolute width adjustments (used
  // border-box values, so the transfer must respect box-sizing)
  let size = maybeApplyAspectRatioUsed(
    { width, height: inherentSize.height },
    aspectRatio,
    style.boxSizing,
    paddingBorderSize,
  );

  let height = size.height;
  if (height === null) {
    if (position === 'absolute' && insetVertical.start !== null && insetVertical.end !== null) {
      height = Math.max(gridAreaMinusItemMarginsSize.height - insetVertical.start - insetVertical.end, 0);
    } else if (
      margin.top !== null &&
      margin.bottom !== null &&
      alignmentStyles.vertical.keyword === 'stretch' &&
      !alignmentStyles.vertical.safe &&
      position !== 'absolute'
    ) {
      height = gridAreaMinusItemMarginsSize.height;
    }
  }
  // Reapply aspect ratio after stretch/absolute height adjustments
  size = maybeApplyAspectRatioUsed({ width: size.width, height }, aspectRatio, style.boxSizing, paddingBorderSize);

  // Clamp by min/max
  size = {
    width: mClamp(size.width, minSize.width, maxSize.width),
    height: mClamp(size.height, minSize.height, maxSize.height),
  };

  const availableSpace = {
    width: gridAreaMinusItemMarginsSize.width,
    height: gridAreaMinusItemMarginsSize.height,
  };

  let knownSize: Size<Opt> = size;
  if (position === 'absolute' && (size.width === null || size.height === null)) {
    const measured = measureChildSizeBoth(
      node,
      size,
      { width: gridAreaSize.width, height: gridAreaSize.height },
      availableSpace,
      'inherent-size',
    );
    knownSize = { width: measured.width, height: measured.height };
  }

  const layoutOutput = performChildLayout(
    node,
    knownSize,
    { width: gridAreaSize.width, height: gridAreaSize.height },
    availableSpace,
    'inherent-size',
  );

  // Resolve final size
  const finalSize = {
    width: mClamp(knownSize.width ?? layoutOutput.size.width, minSize.width, maxSize.width) as number,
    height: mClamp(knownSize.height ?? layoutOutput.size.height, minSize.height, maxSize.height) as number,
  };

  const [x, xMargin] = alignItemWithinArea(
    { start: gridArea.left, end: gridArea.right },
    justifySelf ?? alignmentStyles.horizontal,
    finalSize.width,
    position,
    insetHorizontal,
    { start: margin.left, end: margin.right },
    0,
    direction,
    justifyBaselineOffset,
  );
  const [y, yMargin] = alignItemWithinArea(
    { start: gridArea.top, end: gridArea.bottom },
    alignSelf ?? alignmentStyles.vertical,
    finalSize.height,
    position,
    insetVertical,
    { start: margin.top, end: margin.bottom },
    baselineShim,
    'ltr',
    null,
  );

  const scrollbarSize = {
    width: overflow.y === 'scroll' ? scrollbarWidth : 0,
    height: overflow.x === 'scroll' ? scrollbarWidth : 0,
  };

  const resolvedMargin = { left: xMargin.start, right: xMargin.end, top: yMargin.start, bottom: yMargin.end };

  const layout: Layout = {
    order,
    location: { x, y },
    size: finalSize,
    contentSize: layoutOutput.contentSize,
    scrollbarSize,
    padding,
    border,
    margin: resolvedMargin,
  };
  nd.unroundedLayout = layout;

  const contribution = computeContentSizeContribution(
    { x: x - gridArea.left, y: y - gridArea.top },
    finalSize,
    layoutOutput.contentSize,
    overflow,
  );

  return [contribution, y, finalSize.height];
}

/** Align and size a grid item along a single axis. Returns [start, resolvedMargin]. */
export function alignItemWithinArea(
  gridArea: { start: number; end: number },
  alignmentStyle: AlignItems,
  resolvedSize: number,
  position: Position,
  inset: { start: Opt; end: Opt },
  margin: { start: Opt; end: Opt },
  baselineShim: number,
  direction: Direction,
  /** When non-null, `baseline` uses this logical offset instead of falling back to start. */
  baselineAlignOffset: number | null = null,
): [number, { start: number; end: number }] {
  // Calculate grid area dimension in the axis
  const nonAutoMargin = { start: (margin.start ?? 0) + baselineShim, end: margin.end ?? 0 };
  const gridAreaSize = Math.max(gridArea.end - gridArea.start, 0);
  const freeSpace = Math.max(gridAreaSize - resolvedSize - nonAutoMargin.start - nonAutoMargin.end, 0);

  // Expand auto margins to fill available space
  const autoMarginCount = (margin.start === null ? 1 : 0) + (margin.end === null ? 1 : 0);
  const autoMarginSize = autoMarginCount > 0 ? freeSpace / autoMarginCount : 0;
  const resolvedMargin = {
    start: (margin.start ?? autoMarginSize) + baselineShim,
    end: margin.end ?? autoMarginSize,
  };

  const overflows = resolvedSize + nonAutoMargin.start + nonAutoMargin.end > gridAreaSize;
  // css-grid-1 §10.2: an auto margin absorbs positive free space "prior to
  // alignment ... thereby disabling the effects of any self-alignment
  // properties in that axis". The resolved auto margin already positions the
  // item, so running alignment on top of it would displace it a second time.
  //
  // This holds even when the item overflows, where the auto margin resolves to
  // zero: Chrome pins such an item to the start edge whatever its justify-self
  // says. Only the *absence* of an auto margin lets alignment fold the margins
  // into its offset — with `margin-left: 10px; margin-right: 120px` in a 3px
  // track, `center` does put the item at -53.5, so the margins are not simply
  // ignored under overflow.
  const alignmentKeyword = autoMarginCount > 0 ? 'start' : resolveSelfAlignmentSafety(alignmentStyle, overflows);

  // Compute offset in the axis
  let alignmentBasedOffset: number;
  // css-align-3 §6.1: first-baseline self-alignment. In a multi-item column
  // sharing group, `baselineAlignOffset` is Blink's Major-group delta
  // (`trackBaseline - synthesizedBaseline`) — the border-box offset from the
  // area's inline-start. Margins that participate (block-start in the
  // orthogonal baseline writing mode) are already folded into that delta, so
  // we must not also add resolvedMargin.start. Alone in the group, the offset
  // is null and we fall back to safe start (same §).
  //
  // Chrome, two items in one column with `justify-items: baseline`, widths 30
  // and 20, RTL: both land at x=70 (the wider item's start edge), not at
  // start-per-item (70 and 80). LTR synthesizes every baseline to 0
  // (vertical-lr is flipped-lines), so the delta collapses to the max
  // margin-left and both items share that x.
  const baselineOffset = alignmentKeyword === 'baseline' ? baselineAlignOffset : null;
  const effectiveKeyword =
    baselineOffset !== null ? 'baseline' : alignmentKeyword === 'baseline' ? 'start' : alignmentKeyword;
  switch (effectiveKeyword) {
    case 'baseline': {
      // `baselineOffset` is narrowed non-null by effectiveKeyword === 'baseline'.
      const logicalOffset = baselineOffset ?? 0;
      alignmentBasedOffset = direction === 'rtl' ? gridAreaSize - resolvedSize - logicalOffset : logicalOffset;
      break;
    }
    case 'start':
    case 'flex-start':
    case 'stretch':
      alignmentBasedOffset =
        direction === 'rtl' ? gridAreaSize - resolvedSize - resolvedMargin.end : resolvedMargin.start;
      break;
    case 'end':
    case 'flex-end':
      alignmentBasedOffset =
        direction === 'rtl' ? resolvedMargin.start : gridAreaSize - resolvedSize - resolvedMargin.end;
      break;
    case 'center':
      alignmentBasedOffset = (gridAreaSize - resolvedSize + resolvedMargin.start - resolvedMargin.end) / 2;
      break;
  }

  let offsetWithinArea: number;
  if (position === 'absolute') {
    if (inset.start !== null && inset.end !== null) {
      offsetWithinArea =
        direction === 'rtl'
          ? gridAreaSize - inset.end - resolvedSize - nonAutoMargin.end
          : inset.start + nonAutoMargin.start;
    } else if (inset.start !== null) {
      offsetWithinArea = inset.start + nonAutoMargin.start;
    } else if (inset.end !== null) {
      offsetWithinArea = gridAreaSize - inset.end - resolvedSize - nonAutoMargin.end;
    } else {
      offsetWithinArea = alignmentBasedOffset;
    }
  } else {
    offsetWithinArea = alignmentBasedOffset;
  }

  let start = gridArea.start + offsetWithinArea;
  if (position === 'relative') {
    const relativeInset = direction === 'rtl' ? (negate(inset.end) ?? inset.start) : (inset.start ?? negate(inset.end));
    start += relativeInset ?? 0;
  }

  return [start, resolvedMargin];
}

/**
 * Resolve `justify-self: baseline` offsets for items that share a column.
 *
 * css-align-3 §6.1 / css-grid-1 §11: a grid item with `justify-self: baseline`
 * participates in baseline self-alignment in its startmost column. Blink reads
 * that baseline in an orthogonal writing mode (vertical-lr in LTR, vertical-rl
 * in RTL — `DetermineBaselineWritingMode` with `is_parallel_context=false`).
 * Horizontal-tb items never expose a real first baseline in that mode
 * (`LogicalBoxFragment::FirstBaseline` returns null when writing modes differ),
 * so every baseline is synthesized:
 *   - vertical-lr is flipped-lines → alphabetic synth = 0
 *   - vertical-rl → alphabetic synth = block-size = the item's physical width
 * The Major-group alignment offset is `trackBaseline - synthesizedBaseline`,
 * where `trackBaseline` is the max of `(synth + margin.block-start)` and
 * block-start in the baseline WM is margin-left (LTR) / margin-right (RTL).
 *
 * Must run after items have a final border-box width (a prior layout pass).
 * Single-item groups leave `justifyBaselineOffset` null so positioning falls
 * back to start.
 */
export function resolveJustifyBaselineOffsetsFromLaidOut(
  items: GridItem[],
  direction: Direction,
  columns: GridTrack[],
): void {
  const groups = new Map<number, GridItem[]>();
  for (const item of items) {
    if (item.justifySelf.keyword !== 'baseline' || item.justifySelf.safe) continue;
    const key = item.columnIndexes.start;
    const list = groups.get(key);
    if (list !== undefined) list.push(item);
    else groups.set(key, [item]);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const synths: number[] = [];
    const stored: number[] = [];
    for (const item of group) {
      const width = internals(item.node).unroundedLayout.size.width;
      // Orthogonal synth: LTR→vertical-lr (flipped-lines)→0; RTL→vertical-rl→width.
      // Confirmed against Chrome 151: widths 30+20 in RTL share x=70; in LTR both
      // sit at x=0 (synth collapses, only margin-left differentiates).
      const synth = direction === 'ltr' ? 0 : width;
      const areaWidth = Math.max(
        (columns[item.columnIndexes.end] ?? unreachable()).offset -
          (columns[item.columnIndexes.start + 1] ?? unreachable()).offset,
        0,
      );
      // block-start margin in the baseline writing mode (Blink GetExtraMarginForBaseline).
      const extraMargin =
        direction === 'ltr' ? resolveOrZero(item.margin.left, areaWidth) : resolveOrZero(item.margin.right, areaWidth);
      synths.push(synth);
      stored.push(synth + extraMargin);
    }

    const trackBaseline = stored.reduce((a, b) => Math.max(a, b), 0);
    group.forEach((item, i) => {
      // Blink ComputeBaselineOffset (Major): track - synthesized (extra margin
      // stays in the track max, so it shifts every item equally — matching the
      // LTR margin-left:5 vs 15 case where both land at x=15).
      item.justifyBaselineOffset = trackBaseline - (synths[i] ?? 0);
    });
  }
}

// --- local helpers

function maybeAddSize(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: s.width !== null ? s.width + rhs.width : null,
    height: s.height !== null ? s.height + rhs.height : null,
  };
}

function vMaybeSub(v: number, rhs: Opt): number {
  return rhs !== null ? v - rhs : v;
}

function negate(v: Opt): Opt {
  return v !== null ? -v : null;
}
