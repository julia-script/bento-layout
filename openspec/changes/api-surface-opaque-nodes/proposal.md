# Proposal: Opaque node API with a curated surface

## Why

The package root currently re-exports ~110 symbols, of which consumers need about a dozen; the other ~80 are Taffy port internals (axis math, style resolvers, grid track predicates) flattened in by two `export *` lines, with generic names (`main`, `cross`, `size`, `round`) squatting the package namespace. Everything public at first publish is frozen by semver, and the current open `Node` interface (mutable `style`, exposed `cache`, writable layouts) makes mutations invisible to the engine — which forces full-tree cache clearing on every `computeLayout` call and permanently closes the door on incremental relayout. Shrinking and hardening the surface is free now and a major version later.

## What Changes

- **BREAKING** `LayoutNode` becomes an opaque class with runtime-private (`#`) fields replacing the open `Node` interface. Construction from plain style data; children via constructor or `appendChild`/`removeChild`/`insertChild`; all style mutation through a setter method; layouts read through getters typed `Readonly<Layout>`.
- **BREAKING** The `createNode` factory and direct field access (`node.style.x = y`, `node.cache`, writable `node.layout`) are removed.
- **BREAKING** The package root stops re-exporting `geometry.ts` and `style.ts` wholesale. The curated surface is: `LayoutNode`, `computeLayout`, the options interfaces, `MeasureFunction`, `Layout`, and the style/geometry type vocabulary (`Style`, `Dimension`, `AvailableSpace`, `Size`, `Rect`, alignment and grid types). Internal helpers become unexported or module-internal.
- Setters are written to support dirty tracking (a mutation can mark the node and its ancestor chain), but incremental relayout itself is **out of scope** — this change only guarantees the API shape permits it.
- Detach/reattach works by ordinary object semantics: a subtree removed from its parent is a live tree of its own, garbage-collected when dropped. No arena, no ids, no `free()`/`remove()` lifecycle obligations — deliberately unlike Taffy/Yoga (see design.md alternatives).
- User-reachable input validation errors (non-finite grid track counts) become a typed `Error` subclass instead of `throw new Error("string")`; grid line 0 keeps its CSS-conformant treated-as-auto fallback.
- Tests, fixtures, the gentest harness, and the fuzzer migrate to the new API.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `layout-tree-api`: the "plain-object node trees" requirement is replaced by opaque encapsulated nodes (construction still from plain style data; still no engine registration and no numeric handles); the "publishable package" requirement gains a curated-surface constraint (no internal helper exports); a new requirement covers tree manipulation (append/insert/remove, detach-and-reattach, GC-native lifetime) and typed validation errors.

## Impact

- `src/index.ts` (barrel rewrite), `src/tree.ts` (Node → LayoutNode class), `src/style.ts` / `src/geometry.ts` (visibility only, no behavior change), `src/compute/**` (read nodes through the new internals).
- All of `tests/`, `tests/harness`, `scripts/gentest.ts`, `scripts/fuzz.ts`, `scripts/bench.ts` — mechanical migration, concentrated in the harness where possible.
- No dependency changes; behavior of layout computation itself is unchanged (4417 tests must stay green through the migration).
- Unblocks the pending npm publish (`private: true` removal is a separate step).
