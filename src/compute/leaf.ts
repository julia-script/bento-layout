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
  if (sizingMode === 'content-size') {
    nodeSize = { ...knownDimensions };
    nodeMinSize = { width: null, height: null };
    nodeMaxSize = { width: null, height: null };
    aspectRatio = null;
  } else {
    aspectRatio = style.aspectRatio;
    const styleSize = maybeAdd(
      maybeApplyAspectRatio(maybeResolveSize(style.size, parentSize), aspectRatio),
      boxSizingAdjustment,
    );
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
  const size = {
    width: Math.max(clampedSize.width, pbSum.width),
    height: Math.max(
      Math.max(clampedSize.height, aspectRatio !== null ? clampedSize.width / aspectRatio : 0),
      pbSum.height,
    ),
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
