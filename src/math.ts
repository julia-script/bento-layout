// Arithmetic over optional numbers — `null` is the absent value.
//
// Two families:
//   m*  — lhs is Option<f32>  (rhs may be Option or plain number; identical semantics)
//   v*  — lhs is f32, rhs is Option<f32>

/**
 * A number that may be absent — this port's stand-in for Rust's `Option<f32>`.
 *
 * @remarks
 * `null` means "not yet known" rather than zero, a distinction that matters
 * throughout layout: an unresolved width and a width of `0` lead to different
 * results. You meet it in a {@link MeasureFunction}, whose `knownDimensions`
 * carries `null` on any axis the engine has not decided yet.
 *
 * Always test with `=== null`, never for falsiness — `0` is a perfectly good
 * known value.
 */
export type Opt = number | null;

export function mMin(l: Opt, r: Opt): Opt {
  return l !== null ? (r !== null ? Math.min(l, r) : l) : null;
}

export function mMax(l: Opt, r: Opt): Opt {
  return l !== null ? (r !== null ? Math.max(l, r) : l) : null;
}

export function mClamp(base: Opt, min: Opt, max: Opt): Opt {
  if (base === null) return null;
  let v = base;
  if (max !== null) v = Math.min(v, max);
  if (min !== null) v = Math.max(v, min);
  return v;
}

export function mAdd(l: Opt, r: Opt): Opt {
  return l !== null ? (r !== null ? l + r : l) : null;
}

export function mSub(l: Opt, r: Opt): Opt {
  return l !== null ? (r !== null ? l - r : l) : null;
}

export function vMin(l: number, r: Opt): number {
  return r !== null ? Math.min(l, r) : l;
}

export function vMax(l: number, r: Opt): number {
  return r !== null ? Math.max(l, r) : l;
}

/** Note the order: `.min(max).max(min)` — min wins when min > max. */
export function vClamp(v: number, min: Opt, max: Opt): number {
  let out = v;
  if (max !== null) out = Math.min(out, max);
  if (min !== null) out = Math.max(out, min);
  return out;
}

export function vAdd(l: number, r: Opt): number {
  return r !== null ? l + r : l;
}

export function vSub(l: number, r: Opt): number {
  return r !== null ? l - r : l;
}

/** Rust `f32::is_normal()`: not zero, subnormal, infinite, or NaN. */
const F32_MIN_POSITIVE = 1.17549435e-38;
export function isNormal(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) >= F32_MIN_POSITIVE;
}

/** Rounds half toward positive infinity, i.e. `(value + 0.5).floor()`. */
export function round(v: number): number {
  return Math.round(v);
}
