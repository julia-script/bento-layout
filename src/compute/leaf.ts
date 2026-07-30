// Port of taffy/src/compute/leaf.rs (block-layout margin-collapsing paths dropped).

import { maybeApplyAspectRatio, pointNone, rectAdd, sizeZero, sumAxes } from '../geometry.js';
import type { Size } from '../geometry.js';
import { vClamp, vMax } from '../math.js';
import type { Opt } from '../math.js';
import { asMapDefinite, asMaybeSet, asMaybeSub, maybeResolveSize, resolveRectOrZero } from '../style.js';
import type { AvailableSpace, Style } from '../style.js';
import { collapsibleMarginZero } from '../tree.js';
import type { LayoutInput, LayoutOutput, MeasureFunction } from '../tree.js';

export function computeLeafLayout(inputs: LayoutInput, style: Style, measureFunction: MeasureFunction): LayoutOutput {
  const { knownDimensions, parentSize, sizingMode, runMode } = inputs;

  // Both horizontal and vertical percentage padding/borders are resolved against
  // the container's inline size (i.e. width) — this is how CSS is specified.
  const margin = resolveRectOrZero(style.margin, parentSize.width);
  const padding = resolveRectOrZero(style.padding, parentSize.width);
  const border = resolveRectOrZero(style.border, parentSize.width);
  const paddingBorder = rectAdd(padding, border);
  const pbSum = sumAxes(paddingBorder);
  const boxSizingAdjustment = style.boxSizing === 'content-box' ? pbSum : sizeZero();

  let nodeSize: Size<Opt>;
  let nodeMinSize: Size<Opt>;
  let nodeMaxSize: Size<Opt>;
  let aspectRatio: number | null;
  let styleHeightIsDefinite = false;
  let styleWidthIsDefinite = false;
  if (sizingMode === 'content-size') {
    nodeSize = { ...knownDimensions };
    nodeMinSize = { width: null, height: null };
    nodeMaxSize = { width: null, height: null };
    aspectRatio = null;
  } else {
    aspectRatio = style.aspectRatio;
    const rawStyleSize = maybeResolveSize(style.size, parentSize);
    styleHeightIsDefinite = rawStyleSize.height !== null;
    styleWidthIsDefinite = rawStyleSize.width !== null;
    const styleSize = maybeAdd(maybeApplyAspectRatio(rawStyleSize, aspectRatio), boxSizingAdjustment);
    const styleMinSize = maybeAdd(
      maybeApplyAspectRatio(maybeResolveSize(style.minSize, parentSize), aspectRatio),
      boxSizingAdjustment,
    );
    const styleMaxSize = maybeAdd(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);

    nodeSize = {
      width: knownDimensions.width ?? styleSize.width,
      height: knownDimensions.height ?? styleSize.height,
    };
    nodeMinSize = styleMinSize;
    nodeMaxSize = styleMaxSize;
  }

  // Scrollbar gutters are reserved when `overflow` is Scroll (axes transposed).
  const scrollbarGutter = {
    x: style.overflow.y === 'scroll' ? style.scrollbarWidth : 0,
    y: style.overflow.x === 'scroll' ? style.scrollbarWidth : 0,
  };
  const contentBoxInset = { ...paddingBorder };
  contentBoxInset.right += scrollbarGutter.x;
  contentBoxInset.bottom += scrollbarGutter.y;

  const hasStylesPreventingBeingCollapsedThrough =
    style.display !== 'block' ||
    style.overflow.x === 'hidden' ||
    style.overflow.x === 'scroll' ||
    style.overflow.y === 'hidden' ||
    style.overflow.y === 'scroll' ||
    style.position === 'absolute' ||
    padding.top > 0 ||
    padding.bottom > 0 ||
    border.top > 0 ||
    border.bottom > 0 ||
    (nodeSize.height !== null && nodeSize.height > 0) ||
    (nodeMinSize.height !== null && nodeMinSize.height > 0);

  // Return early if both width and height are known
  if (
    runMode === 'compute-size' &&
    hasStylesPreventingBeingCollapsedThrough &&
    nodeSize.width !== null &&
    nodeSize.height !== null
  ) {
    const size = {
      width: vMax(vClamp(nodeSize.width, nodeMinSize.width, nodeMaxSize.width), pbSum.width),
      height: vMax(vClamp(nodeSize.height, nodeMinSize.height, nodeMaxSize.height), pbSum.height),
    };
    return {
      size,
      contentSize: sizeZero(),
      firstBaselines: pointNone(),
      topMargin: collapsibleMarginZero(),
      bottomMargin: collapsibleMarginZero(),
      marginsCanCollapseThrough: false,
    };
  }

  // Compute available space
  const availableSpace: Size<AvailableSpace> = {
    width: asMapDefinite(
      asMaybeSet(
        asMaybeSet(
          asMaybeSub(knownDimensions.width ?? inputs.availableSpace.width, margin.left + margin.right),
          knownDimensions.width,
        ),
        nodeSize.width,
      ),
      (size) => vClamp(size, nodeMinSize.width, nodeMaxSize.width) - contentBoxInset.left - contentBoxInset.right,
    ),
    height: asMapDefinite(
      asMaybeSet(
        asMaybeSet(
          asMaybeSub(knownDimensions.height ?? inputs.availableSpace.height, margin.top + margin.bottom),
          knownDimensions.height,
        ),
        nodeSize.height,
      ),
      (size) => vClamp(size, nodeMinSize.height, nodeMaxSize.height) - contentBoxInset.top - contentBoxInset.bottom,
    ),
  };

  // Measure node
  const measuredSize = measureFunction(
    runMode === 'compute-size' ? { ...knownDimensions } : { width: null, height: null },
    availableSpace,
  );
  const clampedSize = {
    width: vClamp(
      knownDimensions.width ?? nodeSize.width ?? measuredSize.width + contentBoxInset.left + contentBoxInset.right,
      nodeMinSize.width,
      nodeMaxSize.width,
    ),
    height: vClamp(
      knownDimensions.height ?? nodeSize.height ?? measuredSize.height + contentBoxInset.top + contentBoxInset.bottom,
      nodeMinSize.height,
      nodeMaxSize.height,
    ),
  };
  // An aspect-ratio floor keeps the height in ratio with the (possibly clamped)
  // used width — but only when the height is otherwise automatic. A definite
  // height (from the parent or an explicit style height) wins over the ratio
  // (css-sizing-4 §5: aspect-ratio produces the automatic size only). Taffy
  // applies this floor unconditionally, which diverges from Chrome for a leaf
  // with aspect-ratio plus both dimensions definite; found by differential
  // fuzzing (tests/html/fuzz-found).
  const heightIsAutomatic = knownDimensions.height === null && !styleHeightIsDefinite;
  const widthIsAutomatic = knownDimensions.width === null && !styleWidthIsDefinite;
  // The padding+border floor transfers through `aspect-ratio` even in
  // content-size mode (where `aspectRatio` above is nulled by protocol): the
  // floor is a property of the box itself, not of the styles the parent has
  // already accounted for. Chrome: a leaf with `aspect-ratio: 1` and a 27px
  // vertical border sum is 27 wide under border-box — its width *contribution*
  // already carries the transferred floor.
  const floorAspectRatio = style.aspectRatio;
  // `aspect-ratio` relates the two axes of the box named by `box-sizing`, so
  // under content-box the ratio applies to the *content* box: strip the source
  // axis's padding+border before applying the ratio and add the target's back.
  // Under content-box the pb floors therefore stay independent (the content box
  // is 0x0 either way) and these transfers are no-ops on them.
  const transferToHeight = (w: number): number =>
    style.boxSizing === 'content-box'
      ? Math.max(w - pbSum.width, 0) / floorAspectRatio! + pbSum.height
      : w / floorAspectRatio!;
  const transferToWidth = (h: number): number =>
    style.boxSizing === 'content-box'
      ? Math.max(h - pbSum.height, 0) * floorAspectRatio! + pbSum.width
      : h * floorAspectRatio!;
  // The ratio floors run in both directions, but only into automatic axes. In
  // inherent-size mode the full pb-floored size of the other axis transfers; in
  // content-size mode only the pb floor itself does (style sizes are the
  // parent's responsibility there). The two directions have a closed-form fixed
  // point — substituting one floor into the other collapses to a single max —
  // so each is computed once from the other axis's pre-transfer value.
  const flooredWidth = Math.max(clampedSize.width, pbSum.width);
  const flooredHeight = Math.max(clampedSize.height, pbSum.height);
  const arSourceWidth = sizingMode === 'content-size' ? pbSum.width : flooredWidth;
  const arSourceHeight = sizingMode === 'content-size' ? pbSum.height : flooredHeight;
  const arHeight = heightIsAutomatic && floorAspectRatio !== null ? transferToHeight(arSourceWidth) : 0;
  const arWidth = widthIsAutomatic && floorAspectRatio !== null ? transferToWidth(arSourceHeight) : 0;
  const size = {
    width: Math.max(flooredWidth, arWidth),
    height: Math.max(flooredHeight, arHeight),
  };

  return {
    size,
    contentSize: {
      width: measuredSize.width + padding.left + padding.right,
      height: measuredSize.height + padding.top + padding.bottom,
    },
    firstBaselines: pointNone(),
    topMargin: collapsibleMarginZero(),
    bottomMargin: collapsibleMarginZero(),
    marginsCanCollapseThrough:
      !hasStylesPreventingBeingCollapsedThrough && size.height === 0 && measuredSize.height === 0,
  };
}

function maybeAdd(s: Size<Opt>, rhs: Size<number>): Size<Opt> {
  return {
    width: s.width !== null ? s.width + rhs.width : null,
    height: s.height !== null ? s.height + rhs.height : null,
  };
}
