import type { Size } from '../geometry.js';
import { maybeApplyAspectRatio } from '../geometry.js';
import type { Opt } from '../math.js';
import type { BoxSizing } from '../style.js';

function maybeAddSize(size: Size<Opt>, adjustment: Size<number>): Size<Opt> {
  return {
    width: size.width === null ? null : size.width + adjustment.width,
    height: size.height === null ? null : size.height + adjustment.height,
  };
}

/**
 * Like `maybeApplyAspectRatio`, but for used border-box sizes. Under
 * `box-sizing: content-box`, css-sizing-4 §4.1 makes the ratio relate the
 * content box: strip the source axis's padding/border before converting and
 * add the destination axis's afterward. A 27px stretched grid area with ratio
 * 1 and padding/border sums 17w/27h therefore derives a 17px width, not 27px.
 */
export function maybeApplyAspectRatioUsed(
  size: Size<Opt>,
  aspectRatio: number | null,
  boxSizing: BoxSizing,
  paddingBorderSize: Size<number>,
): Size<Opt> {
  if (aspectRatio === null || boxSizing !== 'content-box') return maybeApplyAspectRatio(size, aspectRatio);
  if (size.width !== null && size.height === null) {
    return {
      width: size.width,
      height: Math.max(size.width - paddingBorderSize.width, 0) / aspectRatio + paddingBorderSize.height,
    };
  }
  if (size.width === null && size.height !== null) {
    return {
      width: Math.max(size.height - paddingBorderSize.height, 0) * aspectRatio + paddingBorderSize.width,
      height: size.height,
    };
  }
  return { ...size };
}

/**
 * css-sizing-4 §4.4 min-size transfers for a box with a preferred ratio.
 * A transferred minimum is capped by the destination maximum: Chrome sizes
 * an abspos `min-height: 5; max-width: 0; aspect-ratio: 1` box to 0x5, not 5x5.
 */
export function transferMinSizeThroughAspectRatio(
  minSize: Size<number>,
  resolvedMinSize: Size<Opt>,
  resolvedStyleSize: Size<Opt>,
  resolvedMaxSize: Size<Opt>,
  aspectRatio: number | null,
  boxSizing: BoxSizing,
  paddingBorderSize: Size<number>,
): Size<number> {
  const fromWidth = maybeApplyAspectRatioUsed(
    { width: minSize.width, height: null },
    aspectRatio,
    boxSizing,
    paddingBorderSize,
  );
  const fromHeight = maybeApplyAspectRatioUsed(
    { width: null, height: minSize.height },
    aspectRatio,
    boxSizing,
    paddingBorderSize,
  );
  const boxSizingAdjustment = boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const maxSize = maybeAddSize(resolvedMaxSize, boxSizingAdjustment);
  return {
    width:
      resolvedStyleSize.width === null && resolvedMinSize.width === null
        ? Math.max(minSize.width, Math.min(fromHeight.width ?? 0, maxSize.width ?? Infinity))
        : minSize.width,
    height:
      resolvedStyleSize.height === null && resolvedMinSize.height === null
        ? Math.max(minSize.height, Math.min(fromWidth.height ?? 0, maxSize.height ?? Infinity))
        : minSize.height,
  };
}

/**
 * css-sizing-4 §4.4 max-size transfers, floored by definite destination sizes.
 * Chrome keeps `height: 1` in `max-width: 0; aspect-ratio: 1` at 0x1: the
 * transferred zero maximum cannot override the definite destination height.
 */
export function transferMaxSizeThroughAspectRatio(
  resolvedMaxSize: Size<Opt>,
  resolvedStyleSize: Size<Opt>,
  minSize: Size<number>,
  aspectRatio: number | null,
  boxSizing: BoxSizing,
  paddingBorderSize: Size<number>,
): Size<Opt> {
  const boxSizingAdjustment = boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const preferredSize = maybeAddSize(resolvedStyleSize, boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeApplyAspectRatio(resolvedMaxSize, aspectRatio), boxSizingAdjustment);

  return {
    width:
      resolvedMaxSize.width === null && maxSize.width !== null
        ? Math.max(maxSize.width, preferredSize.width ?? 0, minSize.width)
        : maxSize.width,
    height:
      resolvedMaxSize.height === null && maxSize.height !== null
        ? Math.max(maxSize.height, preferredSize.height ?? 0, minSize.height)
        : maxSize.height,
  };
}
