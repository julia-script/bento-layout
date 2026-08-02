// Leaf layout: sizing a childless node, including the measure-callback path.

import type { Point, Size } from '../geometry.js';
import { applyAspectRatioClamped, pointNone, rectAdd, sizeZero, sumAxes } from '../geometry.js';
import type { Opt } from '../math.js';
import { vClamp, vMax } from '../math.js';
import type { AvailableSpace, Style } from '../style.js';
import { asMapDefinite, asMaybeSet, asMaybeSub, maybeResolveSize, resolveRectOrZero } from '../style.js';
import type { LayoutInput, LayoutOutput, MeasureFunction } from '../tree.js';
import { collapsibleMarginZero } from '../tree.js';
import { maybeApplyAspectRatioUsed } from './aspectRatio.js';

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
  const rawStyleSize = maybeResolveSize(style.size, parentSize);
  const styleHeightIsDefinite = rawStyleSize.height !== null;
  const styleWidthIsDefinite = rawStyleSize.width !== null;
  if (sizingMode === 'content-size') {
    nodeSize = { ...knownDimensions };
    nodeMinSize = { width: null, height: null };
    nodeMaxSize = { width: null, height: null };
    aspectRatio = null;
  } else {
    aspectRatio = style.aspectRatio;
    const rawMinSize = maybeAdd(maybeResolveSize(style.minSize, parentSize), boxSizingAdjustment);
    const rawMaxSize = maybeAdd(maybeResolveSize(style.maxSize, parentSize), boxSizingAdjustment);
    // The ratio derives the automatic axis from the *used* value of the
    // specified one, so each specified axis is clamped by its own min/max first:
    // `width: 200; aspect-ratio: 2; max-width: 3` is 3x2 in Chrome (the height
    // follows the clamped 3), not 3x100. Applying the ratio to the raw style
    // size instead leaves the derived axis following the pre-clamp value.
    const styleSize = applyAspectRatioClamped(
      maybeAdd(rawStyleSize, boxSizingAdjustment),
      rawMinSize,
      rawMaxSize,
      aspectRatio,
      boxSizingAdjustment,
    );

    // A childless flex container still establishes flex formatting for its
    // anonymous text item. When its inline size is supplied by its parent,
    // Blink resolves an automatic block size through the preferred ratio
    // before laying out that anonymous item (css-sizing-4 §4.2: the result is
    // definite when the ratio-determining input is definite). Chrome 151, a
    // 40px-wide flex leaf with `aspect-ratio: 3` and three lines' worth of
    // breakable text is therefore 40x13, not 40x30. A block leaf remains
    // content-sized at 40x30, so keep this on the flex formatting path only.
    const derivedFromKnown =
      style.display === 'flex'
        ? maybeApplyAspectRatioUsed(knownDimensions, aspectRatio, style.boxSizing, pbSum)
        : { width: null, height: null };

    nodeSize = {
      width: knownDimensions.width ?? styleSize.width ?? derivedFromKnown.width,
      height: knownDimensions.height ?? styleSize.height ?? derivedFromKnown.height,
    };
    // A min/max constraint does NOT transfer through the ratio onto the other
    // axis's constraint: it bounds the ratio-*derived* size (handled by
    // `styleSize` above and by the ratio floor below), never the axis itself,
    // so content that overflows the ratio still wins — `max-width: 40;
    // aspect-ratio: 2` around 60px of text is 40x60 in Chrome, not 40x20, while
    // the same box empty is 40x20 either way. Transferring onto min/max would
    // cap the content and also re-derive axes that have a size of their own.
    nodeMinSize = rawMinSize;
    nodeMaxSize = rawMaxSize;
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

  // Measure node.
  //
  // A measure function sizes *content*, so both its inputs must be content-box
  // values. `availableSpace` above already subtracts `contentBoxInset`;
  // `knownDimensions` arrives as a border-box size (callers pass border-box
  // values — see `child.targetSize` in flexbox.ts, "always a border-box value")
  // and is treated as one again when it becomes `clampedSize` below, so it has
  // to be converted on the way in rather than forwarded raw. Forwarding it gave
  // the content the padding as extra room: Chrome, a row item with
  // `padding: 0 17px 0 7px; flex-basis: 3` wrapping `HHHH<zwsp>H` in Ahem, is
  // 64x20 — two lines, since the 40px content box holds only four glyphs — and
  // this reported 64x10 by measuring the text against the full 64.
  const knownContentSize: Size<Opt> = {
    width:
      knownDimensions.width !== null
        ? Math.max(knownDimensions.width - contentBoxInset.left - contentBoxInset.right, 0)
        : null,
    height:
      knownDimensions.height !== null
        ? Math.max(knownDimensions.height - contentBoxInset.top - contentBoxInset.bottom, 0)
        : null,
  };
  const measuredSize = measureFunction(
    runMode === 'compute-size' ? knownContentSize : { width: null, height: null },
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
  // (css-sizing-4 §5: aspect-ratio produces the automatic size only).
  // Applying the floor unconditionally diverges from Chrome for a leaf with
  // aspect-ratio plus both dimensions definite; found by differential
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
  // The ratio comes in as a parameter rather than being read from the closure:
  // callers only reach these once they have null-checked it, and taking it as a
  // `number` is what lets the compiler see that.
  const transferToHeight = (w: number, ratio: number): number =>
    style.boxSizing === 'content-box' ? Math.max(w - pbSum.width, 0) / ratio + pbSum.height : w / ratio;
  const transferToWidth = (h: number, ratio: number): number =>
    style.boxSizing === 'content-box' ? Math.max(h - pbSum.height, 0) * ratio + pbSum.width : h * ratio;
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
  const arHeight =
    heightIsAutomatic && floorAspectRatio !== null ? transferToHeight(arSourceWidth, floorAspectRatio) : 0;
  const arWidth = widthIsAutomatic && floorAspectRatio !== null ? transferToWidth(arSourceHeight, floorAspectRatio) : 0;
  // The ratio transfer is a *floor*, but a floor never wins over the box's own
  // max-size: `height: 200; aspect-ratio: 2; max-width: 3` is 3 wide in Chrome,
  // not 400. Re-clamp the transferred value so the max survives the max() above
  // (the pb floor below it is exempt — a border box is never smaller than its
  // own padding+border, even under a smaller max-size).
  const size = {
    width: Math.max(flooredWidth, vClamp(arWidth, null, nodeMaxSize.width)),
    height: Math.max(flooredHeight, vClamp(arHeight, null, nodeMaxSize.height)),
  };

  // A measure function reports its baseline relative to the content box, so
  // shift it past the top padding and border to make it border-box relative —
  // which is what every consumer of `firstBaselines` expects. Content with no
  // text returns no baseline; layout then synthesizes one (css-flexbox-1 §8.3).
  const measuredBaseline = measuredSize.baseline;
  const firstBaselines: Point<Opt> =
    measuredBaseline === undefined ? pointNone() : { x: null, y: measuredBaseline + padding.top + border.top };

  return {
    size,
    contentSize: {
      width: measuredSize.width + padding.left + padding.right,
      height: measuredSize.height + padding.top + padding.bottom,
    },
    firstBaselines,
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
