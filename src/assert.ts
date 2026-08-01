// Assertions for cases the type system can't prove but the algorithm guarantees.

/**
 * Marks a branch the algorithm guarantees is never taken.
 *
 * @remarks
 * Use it with `??` in place of a non-null assertion, wherever an index or
 * lookup is known to be in range by a preceding length check, a loop bound, or
 * an invariant the surrounding algorithm maintains:
 *
 * ```typescript
 * const first = tracks[0] ?? unreachable();
 * ```
 *
 * The gain over `tracks[0]!` is that a broken invariant fails loudly at the
 * point it broke, instead of propagating `undefined` into arithmetic and
 * surfacing as a `NaN` in the layout output far from the cause.
 *
 * Reserve it for genuine impossibilities. Input that *could* be absent —
 * anything derived from a caller's style or measure function — deserves real
 * handling, not this.
 *
 * @throws Always. The return type is `never`, so it satisfies any position.
 */
export function unreachable(message = 'unreachable'): never {
  throw new Error(message);
}
