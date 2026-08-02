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
 * Resolve a definite CSS size to the used outer (border-box) size that enters
 * aspect-ratio calculations. css-sizing-3 §3.3 floors a border-box size at
 * its padding/border, while a content-box size grows by those insets.
 */
export function toUsedBorderBoxSize(size: Size<Opt>, boxSizing: BoxSizing, paddingBorderSize: Size<number>): Size<Opt> {
  if (boxSizing === 'content-box') return maybeAddSize(size, paddingBorderSize);
  return {
    width: size.width === null ? null : Math.max(size.width, paddingBorderSize.width),
    height: size.height === null ? null : Math.max(size.height, paddingBorderSize.height),
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
 * Transfer a min/max constraint through `aspect-ratio` onto the stretched
 * axis of a normal-flow block child (css-sizing-4 §4.4).
 *
 * Inputs are used border-box sizes. The ratio therefore strips/adds insets for
 * content-box sizing and floors a derived border-box axis at its own insets.
 * Chrome 151 gives 481.5px, not 60px, for a border-box child with
 * `max-height: 40px; aspect-ratio: 1.5` and 321px of vertical padding: the
 * used 321px maximum transfers through the ratio.
 */
export function transferUsedConstraintToStretchedAxis(
  constraint: Size<Opt>,
  styleSize: Size<Opt>,
  aspectRatio: number | null,
  stretched: Size<boolean>,
  boxSizing: BoxSizing,
  paddingBorderSize: Size<number>,
  combine?: (own: number, transferred: number) => number,
): Size<Opt> {
  if (aspectRatio === null) return { ...constraint };

  const transfer = (source: Size<Opt>, destination: 'width' | 'height'): number | null => {
    const derived = maybeApplyAspectRatioUsed(source, aspectRatio, boxSizing, paddingBorderSize)[destination];
    if (derived === null || boxSizing === 'content-box') return derived;
    return Math.max(derived, paddingBorderSize[destination]);
  };

  const resolve = (axis: 'width' | 'height'): number | null => {
    if (!stretched[axis] || styleSize[axis] !== null) return constraint[axis];
    const otherAxis = axis === 'width' ? 'height' : 'width';
    const other = constraint[otherAxis];
    if (other === null) return constraint[axis];
    const source = axis === 'width' ? { width: null, height: other } : { width: other, height: null };
    const transferred = transfer(source, axis);
    if (transferred === null) return constraint[axis];
    const own = constraint[axis];
    return own === null || combine === undefined ? (own ?? transferred) : combine(own, transferred);
  };

  return { width: resolve('width'), height: resolve('height') };
}

/**
 * css-sizing-4 §4.4 min-size transfers for a box with a preferred ratio.
 * Blink combines a transferred minimum with a definite minimum in the
 * destination axis whenever the preferred size there is automatic; its
 * ComputeMinMaxInlineSizes takes their maximum after resolving both.
 * A transferred minimum is capped by the destination maximum: Chrome sizes
 * an abspos `min-height: 5; max-width: 0; aspect-ratio: 1` box to 0x5, not 5x5.
 */
export function transferMinSizeThroughAspectRatio(
  minSize: Size<number>,
  // Kept in the shared signature because callers already resolve both ranges;
  // Blink's used-size transfer is gated by the preferred size, not this value.
  _resolvedMinSize: Size<Opt>,
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
      resolvedStyleSize.width === null
        ? Math.max(minSize.width, Math.min(fromHeight.width ?? 0, maxSize.width ?? Infinity))
        : minSize.width,
    height:
      resolvedStyleSize.height === null
        ? Math.max(minSize.height, Math.min(fromWidth.height ?? 0, maxSize.height ?? Infinity))
        : minSize.height,
  };
}

/**
 * css-sizing-4 §4.4 max-size transfers, floored by definite destination sizes.
 * Chrome keeps `height: 1` in `max-width: 0; aspect-ratio: 1` at 0x1: the
 * transferred zero maximum cannot override the definite destination height.
 * Callers can opt an automatic destination axis into combining a definite
 * maximum with the transfer: `max-width: 97; max-height: 3; aspect-ratio: 3`
 * then has a 9px used inline maximum, not 97px.
 */
export function transferMaxSizeThroughAspectRatio(
  resolvedMaxSize: Size<Opt>,
  resolvedStyleSize: Size<Opt>,
  minSize: Size<number>,
  aspectRatio: number | null,
  boxSizing: BoxSizing,
  paddingBorderSize: Size<number>,
  combineWithDefiniteMaximum: Size<boolean> = { width: false, height: false },
): Size<Opt> {
  const boxSizingAdjustment = boxSizing === 'content-box' ? paddingBorderSize : { width: 0, height: 0 };
  const preferredSize = maybeAddSize(resolvedStyleSize, boxSizingAdjustment);
  const maxSize = maybeAddSize(maybeApplyAspectRatio(resolvedMaxSize, aspectRatio), boxSizingAdjustment);

  const result = {
    width:
      resolvedMaxSize.width === null && maxSize.width !== null
        ? Math.max(maxSize.width, preferredSize.width ?? 0, minSize.width)
        : maxSize.width,
    height:
      resolvedMaxSize.height === null && maxSize.height !== null
        ? Math.max(maxSize.height, preferredSize.height ?? 0, minSize.height)
        : maxSize.height,
  };

  const usedMaxSize = toUsedBorderBoxSize(resolvedMaxSize, boxSizing, paddingBorderSize);
  const combine = (axis: 'width' | 'height', source: Size<Opt>): void => {
    if (!combineWithDefiniteMaximum[axis] || resolvedStyleSize[axis] !== null || result[axis] === null) return;
    const transferred = maybeApplyAspectRatioUsed(source, aspectRatio, boxSizing, paddingBorderSize)[axis];
    if (transferred === null) return;
    result[axis] = Math.min(result[axis], Math.max(transferred, preferredSize[axis] ?? 0, minSize[axis]));
  };
  combine('width', { width: null, height: usedMaxSize.height });
  combine('height', { width: usedMaxSize.width, height: null });
  return result;
}
