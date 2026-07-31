## Context

See proposal.md — Why.

`StyleInput` is a flat CSS-named dialect; `Style` is the resolved form the engine reads, where related longhands are grouped into `Rect`/`Size`/`Point` objects because the axis-generic math needs pairs. `mergeStyle` is the single seam between them: it walks input keys and, for each, either writes a scalar directly or looks up `FLAT_TO_NESTED` to find the `[nestedKey, subKey]` it belongs to.

That table is the entire flat-to-nested mapping, and `resolveStyle` does nothing else — which is what makes shorthands cheap to add: they are one more rewrite in front of the same table, not a new resolution path.

## Goals / Non-Goals

**Goals**

- Uniform shorthands that expand to existing longhands, with no new resolved-style fields.
- Cascade-correct interaction between shorthands and longhands.
- Preserve the round-trip property: a resolved style is valid input.

**Non-Goals**

- CSS shorthand *strings*. `padding: '10px 20px'` is parsing, which this library does not do.
- The non-uniform shorthands (`flex`, `gridRow`, `gridColumn`). See Decisions.
- Any change to `Style`, to layout, or to how the engine reads styles.

## Decisions

### Expand before the existing merge loop, not inside it

`mergeStyle` builds a flat entry list first, expanding any shorthand in place, then runs its existing per-key loop over that list. The alternative — special-casing shorthands inside the loop — would have to replicate the nested-object rebuild logic that already exists there.

Expanding in place is also what makes ordering correct for free. `Object.entries` preserves insertion order, so `{ padding: 16, paddingTop: 0 }` produces `[paddingTop:16, paddingRight:16, paddingBottom:16, paddingLeft:16, paddingTop:0]`, and the loop's last-write-wins behaviour resolves it exactly as the cascade would. No precedence rules were written; they fall out.

### Object form rather than multi-value strings

CSS expresses per-side variation positionally (`padding: '10px 20px 30px'`). That is string syntax, and adopting it would put a parser in a library whose stated position is that it has none. An object — `{ top: 8, bottom: 8 }` — expresses the same thing as data, reads better than counting positions, and needs no parsing.

It also composes differently, in a way worth noting: CSS's positional form always sets all four sides, while the object form sets only what it names. `{ padding: { top: 8 } }` leaves the other three alone, which makes it useful with `setStyle` for adjusting one edge.

### Distinguishing a value from an edges object

`expandShorthand` treats a non-null object as the per-side form — except for `{ percent: n }`, which is a length, and `'auto'`, which is a string and so never reaches that branch. Both are legal uniform values (`margin: 'auto'`, `padding: { percent: 0.1 }`), and reading either as an edges object would silently produce a style with no sides set.

The `'percent' in value` guard is the load-bearing part. It is narrow rather than a general "is this a length" check because the length vocabulary is small and closed: a `LengthPercentage` is a number, a `{ percent }`, or `'auto'`.

### `GapInput` and `OverflowInput` accept both spellings

`Style.gap` is a `Size` (`width` = column gutter, `height` = row gutter), while CSS names those `column-gap` and `row-gap`. `Style.overflow` is a `Point` (`x`/`y`).

Accepting only the CSS spellings would have broken a property that held before this change: a resolved `Style` could be passed straight back in as `StyleInput`. `tests/fuzz.test.ts` relies on it for its round-trip assertion, and it caught the regression immediately — `Size<LengthPercentage>` is not assignable to `{ row?, column? }`.

So both spellings are accepted. The alternative, renaming `Style.gap`'s fields to `row`/`column`, would touch the engine's hot paths to fix an input-dialect problem.

### `flex`, `gridRow`, and `gridColumn` are left out

The six included shorthands are *uniform*: one value, applied to each covered longhand. Those three are not, and each raises a question the uniform six do not:

- `flex: 1` in CSS sets `flex-basis` to `0%`, not `auto` — the single most common source of surprise in flexbox, and a semantic this library would be choosing to import or not.
- `gridRow: '1 / -1'` is a slash-separated start/end pair, which is string syntax again.

Bundling them in would mean deciding both questions silently, as a side effect of a verbosity fix. They stay unsupported, and each can be proposed on its own terms.

## Risks / Trade-offs

- **Two ways to write the same style** → Acceptable and normal for CSS-shaped APIs; the TSDoc shows the shorthand as the default and the longhand as the override case, so examples stay consistent.
- **`{ percent: n }` misread as an edges object if the length vocabulary grows** → The guard is explicit and tested; a new length form would need to be added to it, and the round-trip test in `tests/fuzz.test.ts` fails loudly if any style shape stops resolving to itself.
- **Export surface grows by three types**, on a package whose exports were recently curated deliberately → They are input-only types with no engine role, and they are needed to write a typed style object externally.
- **A shorthand hides which longhands exist** → The resolved `Style` still shows all four sides, so `node.style` remains the answer to "what did that actually set".

## Migration Plan

Purely additive; every existing longhand call site keeps working. The export snapshot in `tests/api.test.ts` is unaffected — it asserts the runtime surface, and the three additions are types. No consumer action is required.

## Open Questions

- Whether `flex` should eventually be supported, and if so whether it takes CSS's `0%` basis or the engine's `auto`. Deferrable: nothing here depends on the answer, and the current behaviour (unsupported) is not a wrong default that has to be lived with.
- Whether `gridRow`/`gridColumn` are worth a start/end object form (`{ start, end }`) now that the object-form pattern exists.
