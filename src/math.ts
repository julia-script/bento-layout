// Port of taffy/src/util/math.rs. `null` plays the role of Rust's `None`.
//
// Two families, matching the Rust impls:
//   m*  — lhs is Option<f32>  (rhs may be Option or plain number; identical semantics)
//   v*  — lhs is f32, rhs is Option<f32>

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

/** taffy's sys::round is `(value + 0.5).floor()` — identical to JS Math.round. */
export function round(v: number): number {
  return Math.round(v);
}
