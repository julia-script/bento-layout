// Track alignment and final item positioning.

import type { Rect, Size } from '../../geometry.js';
import { maybeApplyAspectRatio, rectAdd, sumAxes } from '../../geometry.js';
import type { Opt } from '../../math.js';
import { mClamp, vMax } from '../../math.js';
import type { AlignContent, AlignContentKeyword, AlignItems, Direction, Position } from '../../style.js';
import { maybeResolve, maybeResolveSize } from '../../style.js';
import type { Layout, LayoutNode } from '../../tree.js';
import { internals } from '../../tree.js';
import {
  absoluteAxisStretches,
  applyAlignmentFallback,
  computeAlignmentOffset,
  computeContentSizeContribution,
  insetModifiedContainingBlockSize,
  resolveAlignedAbsoluteAxis,
  resolveSelfAlignmentSafety,
} from '../alignment.js';
import {
  maybeApplyAspectRatioUsed,
  transferMaxSizeThroughAspectRatio,
  transferMinSizeThroughAspectRatio,
} from '../aspectRatio.js';
import { measureChildSize, measureChildSizeBoth, performChildLayout } from '../dispatch.js';
import type { GridTrack } from './types.js';
import { resolveGridInsets } from './types.js';

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

  if (numTracks === 0) {
    // Grid §10.3 says an empty grid's sole line is start-aligned, but pinned
    // Blink 7922's ComputeFirstSetGeometry still applies content alignment to
    // its zero-set collection. Chrome 151 puts that line at 10px for `center`
    // and `space-around`, and at 20px for `end` and `space-evenly`, in a 20px
    // container. Preserve the logical offset here; RTL mirrors it physically.
    const keyword = trackAlignmentStyle.keyword;
    const safeFreeSpace = trackAlignmentStyle.safe ? Math.max(freeSpace, 0) : freeSpace;
    let logicalOffset = 0;
    if (keyword === 'center') {
      logicalOffset = safeFreeSpace / 2;
    } else if (keyword === 'end' || keyword === 'flex-end') {
      logicalOffset = safeFreeSpace;
    } else if (keyword === 'space-around') {
      logicalOffset = freeSpace >= 0 ? freeSpace / 2 : 0;
    } else if (keyword === 'space-evenly') {
      logicalOffset = freeSpace >= 0 ? freeSpace : 0;
    }
    const physicalOffset = axisIsReversed ? freeSpace - logicalOffset : logicalOffset;
    for (const track of tracks) track.offset = origin + physicalOffset;
    return;
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
 */
export function alignAndPositionItem(
  node: LayoutNode,
  order: number,
  gridArea: Rect<number>,
  containerAlignmentStyles: { horizontal: AlignItems | null; vertical: AlignItems | null },
  baselineShim: number,
  direction: Direction,
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
  const padding = resolveGridInsets(style.padding, gridAreaSize.width);
  const border = resolveGridInsets(style.border, gridAreaSize.width);
  const paddingBorderSize = sumAxes(rectAdd(padding, border));
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };

  const resolvedStyleSize = maybeResolveSize(style.size, gridAreaSize);
  const inherentSize = maybeAddSize(maybeApplyAspectRatio(resolvedStyleSize, aspectRatio), boxSizingAdjustment);
  const resolvedMinSize = maybeResolveSize(style.minSize, gridAreaSize);
  const resolvedMaxSize = maybeResolveSize(style.maxSize, gridAreaSize);
  const minSizeRaw = maybeAddSize(resolvedMinSize, boxSizingAdjustment);
  const minSizeBase = {
    width: vMax(minSizeRaw.width ?? paddingBorderSize.width, paddingBorderSize.width),
    height: vMax(minSizeRaw.height ?? paddingBorderSize.height, paddingBorderSize.height),
  };
  // css-sizing-4 §4.4 transfers min/max constraints through a preferred
  // aspect ratio before applying them. Do both directions independently: a
  // 98x97 border box at ratio .5 gets a 196px transferred minimum height,
  // while ratio 2 gets a 194px transferred minimum width. For content-box the
  // same padding/border minima transfer back to themselves.
  let minSize = transferMinSizeThroughAspectRatio(
    minSizeBase,
    resolvedMinSize,
    resolvedStyleSize,
    resolvedMaxSize,
    aspectRatio,
    style.boxSizing,
    paddingBorderSize,
  );
  const maxSize = transferMaxSizeThroughAspectRatio(
    resolvedMaxSize,
    resolvedStyleSize,
    minSize,
    aspectRatio,
    style.boxSizing,
    paddingBorderSize,
  );
  const explicitBlockAlignment = alignSelf ?? containerAlignmentStyles.vertical;
  const hasHorizontalAutoMargin = style.margin.left === 'auto' || style.margin.right === 'auto';
  const ratioAutoMinInlineApplies =
    aspectRatio !== null &&
    style.minSize.width === 'auto' &&
    overflow.x === 'visible' &&
    (overflow.y === 'visible' || overflow.y === 'clip') &&
    ((position === 'absolute' &&
      (resolvedStyleSize.height !== null || (insetVertical.start !== null && insetVertical.end !== null))) ||
      (position !== 'absolute' &&
        (resolvedStyleSize.height !== null || explicitBlockAlignment?.keyword === 'stretch')));
  if (ratioAutoMinInlineApplies) {
    const minContentWidth = measureChildSize(
      node,
      { width: null, height: null },
      gridAreaSize,
      { width: 'min-content', height: 'max-content' },
      'content-size',
      'horizontal',
    );
    minSize = { ...minSize, width: Math.max(minSize.width, Math.min(minContentWidth, maxSize.width ?? Infinity)) };
  }

  // css-grid-1 §6.6: with an explicitly stretched block axis, `normal` inline
  // alignment must not become explicit stretch for an aspect-ratio item.
  // Chrome 151 gives a 3:1 item in a 72x120 area a 360px width; explicit
  // inline stretch still gives 72px. Preserve implicit inline stretch when
  // both axes are normal: a 2:1 item in a 100x100 area is 100x50 in Chrome.
  // An inline auto margin also suppresses that axis's implicit stretch before
  // resolving the other axis (Grid §10.2). Blink 7922's
  // AxisEdgeFromItemPosition returns a non-stretch edge for the auto margin;
  // Chrome then block-stretches a 1.5:1 item in a 180x120 area with 18px/54px
  // block margins to 72x48, rather than collapsing it to 0x0.
  const normalInlineAlignmentUsesStart =
    inherentSize.width !== null ||
    (aspectRatio !== null && (explicitBlockAlignment?.keyword === 'stretch' || hasHorizontalAutoMargin));

  // Resolve default alignment styles if set on neither the parent nor the node itself
  const horizontalAlignment =
    justifySelf ??
    containerAlignmentStyles.horizontal ??
    (normalInlineAlignmentUsesStart ? ALIGN_START : ALIGN_STRETCH_LOCAL);
  const alignmentStyles = {
    horizontal: horizontalAlignment,
    vertical:
      alignSelf ??
      containerAlignmentStyles.vertical ??
      (inherentSize.height !== null || (aspectRatio !== null && horizontalAlignment.keyword === 'stretch')
        ? ALIGN_START
        : ALIGN_STRETCH_LOCAL),
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

  // css-align-3#justify-self-property makes a non-stretched automatic inline
  // size fit-content, while css-sizing-4#aspect-ratio-automatic transfers a
  // definite opposite-axis size through the preferred ratio. Blink gives a
  // non-replaced grid item's automatic block axis kStretchImplicit: when the
  // inline axis is non-stretched, a 10px row and ratio 2 produce a 20x10 item.
  // Explicit block alignment and auto block margins suppress this transfer.
  const ratioSourceHeight =
    inherentSize.height === null &&
    resolvedStyleSize.height === null &&
    margin.top !== null &&
    margin.bottom !== null &&
    alignmentStyles.vertical.keyword === 'stretch' &&
    !alignmentStyles.vertical.safe &&
    position !== 'absolute'
      ? gridAreaMinusItemMarginsSize.height
      : inherentSize.height;

  // css-grid-1 §6.6: explicit stretch uses the stretch-fit size and can
  // distort a preferred aspect ratio. Blink models this as kStretchExplicit,
  // which wins before its aspect-ratio size transfer. Chrome 151 stretches a
  // 40px-wide, 3:1 item to its 27px row; retaining the ratio-derived 13px
  // height here left it aligned at the row start. Test the unresolved style
  // axis, because `inherentSize` can already contain that transferred 13px.
  // Absolute positioning: derive width from left+right insets; stretch alignment otherwise
  let width = maybeApplyAspectRatioUsed(
    { width: inherentSize.width, height: ratioSourceHeight },
    aspectRatio,
    style.boxSizing,
    paddingBorderSize,
  ).width;
  if (
    width === null &&
    position === 'absolute' &&
    insetHorizontal.start !== null &&
    insetHorizontal.end !== null &&
    absoluteAxisStretches(justifySelf)
  ) {
    width = Math.max(gridAreaMinusItemMarginsSize.width - insetHorizontal.start - insetHorizontal.end, 0);
  } else if (
    resolvedStyleSize.width === null &&
    margin.left !== null &&
    margin.right !== null &&
    alignmentStyles.horizontal.keyword === 'stretch' &&
    !alignmentStyles.horizontal.safe &&
    position !== 'absolute'
  ) {
    width = gridAreaMinusItemMarginsSize.width;
  } else if (
    width === null &&
    resolvedStyleSize.width === null &&
    (hasHorizontalAutoMargin ||
      ((justifySelf !== null || containerAlignmentStyles.horizontal !== null) &&
        alignmentStyles.horizontal.keyword !== 'stretch')) &&
    position !== 'absolute'
  ) {
    // css-grid-1 §6.6: every other self-alignment value makes an automatic
    // inline size fit-content. Grid §10.2 gives auto margins precedence over
    // self-alignment, so they also retain fit-content behavior instead of the
    // implicit stretch default. Blink 7922's AxisEdgeFromItemPosition leaves
    // `kFitContent` set when either auto margin selects the alignment edge.
    // Measure contributions before final layout so a descendant's flex-basis
    // cannot masquerade as the grid item's used width.
    const measureKnownSize = { width: null, height: inherentSize.height };
    const minContentWidth = measureChildSize(
      node,
      measureKnownSize,
      gridAreaSize,
      { width: 'min-content', height: gridAreaMinusItemMarginsSize.height },
      'content-size',
      'horizontal',
    );
    const maxContentWidth = measureChildSize(
      node,
      measureKnownSize,
      gridAreaSize,
      { width: 'max-content', height: gridAreaMinusItemMarginsSize.height },
      'content-size',
      'horizontal',
    );
    width = Math.max(minContentWidth, Math.min(Math.max(gridAreaMinusItemMarginsSize.width, 0), maxContentWidth));
  }
  // The inline min/max range applies before this used inline size becomes the
  // ratio-determining input (css-sizing-4 §4.2; see itemKnownDimensions).
  width = mClamp(width, minSize.width, maxSize.width);
  // Reapply aspect ratio after stretch/absolute width adjustments (used
  // border-box values, so the transfer must respect box-sizing)
  let size = maybeApplyAspectRatioUsed(
    { width, height: inherentSize.height },
    aspectRatio,
    style.boxSizing,
    paddingBorderSize,
  );

  let height = size.height;
  // CSS Align §6.2.2 makes an automatic abspos block size fit-content for
  // every explicit non-stretch alignment. Blink 7922 selects kFitContent for
  // those values before sizing into the inset-modified containing block: an
  // empty centered box in an 11px band is 0px tall at y=5.5, not 11px tall.
  if (
    height === null &&
    position === 'absolute' &&
    insetVertical.start !== null &&
    insetVertical.end !== null &&
    absoluteAxisStretches(alignSelf)
  ) {
    height = Math.max(gridAreaMinusItemMarginsSize.height - insetVertical.start - insetVertical.end, 0);
  } else if (
    resolvedStyleSize.height === null &&
    margin.top !== null &&
    margin.bottom !== null &&
    alignmentStyles.vertical.keyword === 'stretch' &&
    !alignmentStyles.vertical.safe &&
    position !== 'absolute'
  ) {
    height = gridAreaMinusItemMarginsSize.height;
  }
  // Reapply aspect ratio after stretch/absolute height adjustments
  size = maybeApplyAspectRatioUsed({ width: size.width, height }, aspectRatio, style.boxSizing, paddingBorderSize);

  // CSS Sizing 4 §4.3: when aspect-ratio supplies an automatic block size,
  // its non-scrollable automatic minimum is the intrinsic content height,
  // capped by max-height. Blink 7922 passes that intrinsic size to
  // ComputeBlockSizeForFragment and resolves `min-intrinsic` before clamping.
  // Explicit block-axis stretch is not ratio sizing and therefore keeps the
  // grid area's height instead.
  const ratioAutoMinBlockApplies =
    position !== 'absolute' &&
    aspectRatio !== null &&
    resolvedStyleSize.height === null &&
    style.minSize.height === 'auto' &&
    overflow.y === 'visible' &&
    (overflow.x === 'visible' || overflow.x === 'clip') &&
    explicitBlockAlignment?.keyword !== 'stretch' &&
    internals(node).measure === undefined;
  const ratioAutomaticMinimumWidth = size.width;
  if (ratioAutoMinBlockApplies && ratioAutomaticMinimumWidth !== null) {
    const minContentHeight = measureChildSize(
      node,
      { width: ratioAutomaticMinimumWidth, height: null },
      gridAreaSize,
      { width: ratioAutomaticMinimumWidth, height: 'max-content' },
      'content-size',
      'vertical',
    );
    minSize = { ...minSize, height: Math.max(minSize.height, Math.min(minContentHeight, maxSize.height ?? Infinity)) };
  }

  // Clamp by min/max
  size = {
    width: mClamp(size.width, minSize.width, maxSize.width),
    height: mClamp(size.height, minSize.height, maxSize.height),
  };
  if (
    ratioAutoMinInlineApplies &&
    resolvedStyleSize.height === null &&
    size.width !== null &&
    explicitBlockAlignment?.keyword !== 'stretch'
  ) {
    size = maybeApplyAspectRatioUsed(
      { width: size.width, height: null },
      aspectRatio,
      style.boxSizing,
      paddingBorderSize,
    );
    size = {
      width: mClamp(size.width, minSize.width, maxSize.width),
      height: mClamp(size.height, minSize.height, maxSize.height),
    };
  }

  // Blink passes the full containing grid area to an in-flow item's
  // constraint space; the child resolves its margins from that space exactly
  // once. Pre-subtracting a 10% end margin here made an auto-sized text item
  // subtract 2px twice in a 20px max-content track (16px vs Chrome's 18).
  const availableSpace = {
    width:
      position === 'absolute'
        ? insetModifiedContainingBlockSize(gridAreaMinusItemMarginsSize.width, insetHorizontal)
        : gridAreaSize.width,
    height:
      position === 'absolute'
        ? insetModifiedContainingBlockSize(gridAreaMinusItemMarginsSize.height, insetVertical)
        : gridAreaMinusItemMarginsSize.height,
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
    true,
    justifySelf,
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
    false,
    alignSelf,
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
  isInlineAxis: boolean,
  actualAbsposAlignment: AlignItems | null = alignmentStyle,
): [number, { start: number; end: number }] {
  // Calculate grid area dimension in the axis
  const nonAutoMargin = { start: (margin.start ?? 0) + baselineShim, end: margin.end ?? 0 };
  const gridAreaSize = Math.max(gridArea.end - gridArea.start, 0);
  const autoMarginCount = (margin.start === null ? 1 : 0) + (margin.end === null ? 1 : 0);
  const absoluteAxis =
    position === 'absolute'
      ? resolveAlignedAbsoluteAxis(
          gridAreaSize,
          inset,
          margin,
          resolvedSize,
          isInlineAxis,
          direction !== 'rtl',
          actualAbsposAlignment,
        )
      : null;
  const freeSpace = Math.max(gridAreaSize - resolvedSize - nonAutoMargin.start - nonAutoMargin.end, 0);
  const autoMarginSize = autoMarginCount > 0 ? freeSpace / autoMarginCount : 0;
  const resolvedMargin = absoluteAxis
    ? { start: absoluteAxis.margin.start + baselineShim, end: absoluteAxis.margin.end }
    : {
        start: (margin.start ?? autoMarginSize) + baselineShim,
        end: margin.end ?? autoMarginSize,
      };
  const resolvedInset = absoluteAxis?.inset ?? inset;

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
  switch (alignmentKeyword) {
    case 'baseline':
      // css-align-3 baseline-export synthesizes an inline-axis baseline from
      // the line-under border edge. For horizontal text that edge is physical
      // left in RTL (vertical-rl), not logical inline-start: Chrome 151 places
      // a 20px RTL baseline item at x=0 in a 50px intrinsic grid area. An
      // absolutely positioned item has no baseline-sharing group and therefore
      // uses the normal self-start fallback instead (x=80 in a 100px RTL area).
      alignmentBasedOffset =
        position === 'absolute' && direction === 'rtl'
          ? gridAreaSize - resolvedSize - resolvedMargin.end
          : resolvedMargin.start;
      break;
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
    if (resolvedInset.start !== null && resolvedInset.end !== null) {
      offsetWithinArea =
        direction === 'rtl'
          ? gridAreaSize - resolvedInset.end - resolvedSize - resolvedMargin.end
          : resolvedInset.start + resolvedMargin.start;
    } else if (resolvedInset.start !== null) {
      offsetWithinArea = resolvedInset.start + resolvedMargin.start;
    } else if (resolvedInset.end !== null) {
      offsetWithinArea = gridAreaSize - resolvedInset.end - resolvedSize - resolvedMargin.end;
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
