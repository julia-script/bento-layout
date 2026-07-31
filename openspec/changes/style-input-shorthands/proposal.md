## Why

`StyleInput` accepted longhands only, so setting uniform padding meant four properties:

```typescript
LayoutNode.make({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 });
```

That is verbosity with no design rationale behind it. The longhand-only rule was inherited from the flat-key rewrite, whose actual motivation was that a flat key should set exactly one field rather than replacing a whole `Rect` — a shorthand that expands into those same fields does not violate it.

The gap surfaced while building the docs playground: the first demo written by hand reached for `padding: 16`, which silently overwrote the engine's `Rect` with a scalar and failed deep in layout with `Cannot read properties of undefined (reading 'percent')`. That is evidence about what people type. The playground could have rejected it locally, but the ergonomic problem is the library's, not the docs site's.

## What Changes

- `StyleInput` accepts six **uniform shorthands**: `padding`, `margin`, `border`, `inset`, `gap`, and `overflow`. Each sets every longhand it covers from a single value.
- Each shorthand also accepts an **object form** naming only some sides or axes — `padding: { top: 8, bottom: 8 }`, `gap: { column: 8 }` — leaving the unnamed ones as they were.
- Expansion happens in `mergeStyle`, which walks input in insertion order, so **a longhand written after a shorthand overrides it**, matching the cascade: `{ padding: 16, paddingTop: 0 }` is 16 on three sides and 0 on top.
- New exported types: `EdgesInput<T>`, `GapInput`, `OverflowInput`.
- `GapInput` and `OverflowInput` accept the resolved `Style` spellings (`width`/`height`, `x`/`y`) alongside the CSS ones (`row`/`column`), preserving the property that a resolved style can be passed back in as input.
- **Not** included: the multi-value CSS shorthand strings (`padding: '10px 20px'`, `margin: '0 auto'`, `flex: '1 1 auto'`). Those are string syntax, and this library has no CSS parser — the object form covers the same cases as data.
- **Not** included: `flex`, `gridRow`, and `gridColumn`. They are not uniform — `flex: 1` sets basis to `0%` rather than distributing one value, and the grid pair is start/end rather than symmetric — so each needs its own decision rather than riding along with the uniform six.
- Non-breaking: every existing longhand spelling keeps working unchanged, and the resolved `Style` shape is untouched.

## Capabilities

### New Capabilities

- `style-shorthands`: Which shorthands `StyleInput` accepts, how a uniform value and an object form each expand, how shorthands and longhands interact when both are given, and what remains unsupported.

### Modified Capabilities

(none — no existing spec covers `StyleInput`'s accepted property set)

## Impact

- `src/style.ts`: `SHORTHAND_TO_LONGHANDS` and `OBJECT_FORM_KEYS` tables, `expandShorthand`, an expansion pass at the top of `mergeStyle`, six new optional `StyleInput` properties, and three new exported interfaces.
- `src/index.ts`: exports `EdgesInput`, `GapInput`, `OverflowInput` — an addition to the curated public surface. The export snapshot in `tests/api.test.ts` does not move, since it asserts the runtime surface and types are erased.
- Documentation: the `StyleInput` and `Style` TSDoc both asserted that shorthands are absent; both are corrected, and the distinction that survives is uniform-shorthand-yes / multi-value-string-no.
- No change to the resolved `Style` type, to layout behaviour, or to any fixture: the 5304-case conformance suite and the style round-trip in `tests/fuzz.test.ts` pass unchanged.
- Enables the docs playground to write `padding: '16px'` in demo source, which is what motivated the change.
