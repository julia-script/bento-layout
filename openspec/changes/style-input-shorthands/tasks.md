# Tasks

Implemented alongside `docs-jsx-playground`, which motivated it. Library work is
in `src/style.ts` and `src/index.ts`.

## 1. Expansion

- [x] 1.1 Add `SHORTHAND_TO_LONGHANDS` (uniform value → longhand keys) and `OBJECT_FORM_KEYS` (per-side/axis object → longhand keys) next to `FLAT_TO_NESTED`.
- [x] 1.2 Add `expandShorthand`, distinguishing a uniform value from an edges object. Guard `{ percent: n }` and `'auto'`, both legal uniform values that must not be read as objects.
- [x] 1.3 Expand shorthands into a flat entry list at the top of `mergeStyle`, before its existing per-key loop, so insertion order gives cascade-correct precedence without explicit rules.

## 2. Types

- [x] 2.1 Add `EdgesInput<T>`, `GapInput`, `OverflowInput`.
- [x] 2.2 Add the six optional shorthand properties to `StyleInput`, each typed as its value form or its object form.
- [x] 2.3 Accept the resolved `Style` spellings in `GapInput` (`width`/`height`) and `OverflowInput` (`x`/`y`) so a resolved style stays valid as input — `tests/fuzz.test.ts` round-trips one.
- [x] 2.4 Export the three new types from `src/index.ts`.

## 3. Documentation

- [x] 3.1 Correct the `StyleInput` TSDoc, which asserted only longhands are accepted; state that uniform shorthands work and multi-value strings do not.
- [x] 3.2 Correct the same claim in the `Style` TSDoc, distinguishing the resolved longhand-only form from the input dialect.
- [x] 3.3 TSDoc on each shorthand property, with examples covering the uniform value, the object form, and the longhand override.

## 4. Verification

- [x] 4.1 Tests in `tests/shorthand.test.ts`: uniform expansion for all six; object form; both orderings; `margin: 'auto'` centring; resolved-style round-trip; layout parity between shorthand and longhand trees; resolved style keeps its longhand-only shape.
- [x] 4.2 `pnpm test` at the root passes — 5381 tests, including the 5304-case conformance suite and the fuzz round-trip, unchanged.
- [x] 4.3 `tsc --noEmit` clean.
- [x] 4.4 Verified in the browser through the docs playground: uniform `padding`, `padding` + `paddingTop` override, object form, `margin: 'auto'` centring, and a per-side error message naming `padding.top`.
- [x] 4.5 Check the export snapshot in `tests/api.test.ts`. — No update needed: it asserts the *runtime* surface (`Object.keys` of the module) and types are erased, so three added type exports do not move it. The snapshot stays `['InvalidStyleError', 'LayoutNode', 'computeLayout']`.

## 5. Downstream

- [x] 5.1 Remove the shorthand rejection from the playground's `coerce.ts`, now redundant, and coerce shorthand values (uniform and per-side) instead.
- [x] 5.2 Simplify demos written around the missing shorthands (`padding`, `gap`, `overflow`), and confirm the rewritten ones produce identical geometry.
- [x] 5.3 Correct the docs prose that said the library has no shorthands.
