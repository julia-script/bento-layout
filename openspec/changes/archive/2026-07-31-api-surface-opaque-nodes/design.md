# Design: Opaque node API with a curated surface

## Context

See proposal.md — Why. Constraints that shape the design:

- The engine is a pure-JS object graph today; nodes are plain objects (`src/tree.ts` `Node`) mutated freely by tests and consumers. `computeLayout` clears every cache each call because mutation is invisible.
- 4417 conformance tests, the gentest harness, the differential fuzzer, and the bench scripts all construct trees; migration cost concentrates wherever tree construction is centralized.
- The library's stated reason to exist (vs Yoga/WASM): GC-native ergonomics — build a tree, compute, read sizes, drop it, with no memory management obligations. Any design that reintroduces `free()`-style duties defeats the point.

## Goals / Non-Goals

**Goals**

- A public surface small enough to enumerate by hand (~a dozen values + the type vocabulary).
- Runtime-enforced encapsulation: no consumer path to mutate engine state except through methods the engine observes.
- API shape that *permits* incremental relayout (dirty tracking) without a future breaking change.
- Zero lifecycle obligations for consumers; detached subtrees are ordinary garbage.

**Non-Goals**

- Implementing incremental relayout (only the setter contract that enables it).
- Struct-of-arrays / flat storage (requires the id model; see rejected alternatives).
- Namespace or subpath exports (`flexboxjs/Geometry`) — additive later under semver if a consumer needs the helpers.
- npm publish itself (name, `private: true`) — separate step gated on this change.

## Decisions

### D1: Opaque class with `#private` fields, not ids + arena

`LayoutNode` is a class; `#style`, `#children`, `#parent`, `#cache`, `#unroundedLayout`, `#layout` are ECMAScript private fields (hard privacy at runtime, not advisory `@internal`).

**Rejected: Taffy-style `NodeId` + tree-owned arena.** Explored at length. It buys flat-storage representation freedom and makes dirty tracking trivial, but the arena becomes an owner, so it manufactures a lifecycle problem — `remove()` obligations, leaks for detached-and-forgotten nodes, stale-id (use-after-free) detection via generational ids, and GC-coupling machinery (`FinalizationRegistry` backstops) to soften it. Yoga's mandatory `free()` is that model's known pain point, forced by WASM memory; a pure-JS library taking it on voluntarily gives away its main ergonomic advantage. Dirty tracking never actually needed ids — it needs observable mutation plus a parent pointer, both of which the class provides. Flat storage is the only real loss, and it is speculative; if profiling ever proves it out, that is a v2 decision better made with data.

**Rejected: open data + curated exports only.** Smallest diff, but leaves mutation invisible (no incremental-relayout door) and freezes the open `Node` shape at 1.0.

### D2: Class methods, not data-first module functions

`node.setStyle(s)` / `node.appendChild(c)` rather than `Tree.setStyle(node, s)`. The house ts-patterns style is data-first, but it explicitly allows a handle/service to carry getters, and an encapsulated node *is* a handle — its data is deliberately not public, so there is nothing for sibling functions to take. Methods are also what layout-library consumers expect (Yoga, DOM).

### D3: No tree/engine object

The surface is `LayoutNode` + a free `computeLayout(root, availableSpace, options?)`. The only thing a tree handle would own is per-run config (rounding), which the options bag already carries. Any subtree node is a valid root.

### D4: Tree manipulation and lifetime

- Constructor takes `(style?: Partial<Style>, children?: LayoutNode[])`; `measure` rides in style-adjacent options or a dedicated setter (final shape at implementation).
- `appendChild` / `insertChild(i)` / `removeChild` maintain `#parent`. Appending a node that has a parent implicitly detaches it first (single-parent invariant, DOM-style).
- A removed subtree is a live tree; re-attach or drop it — GC handles the rest. No `destroy`/`free` anywhere in the API.

### D5: Setter contract (dirty-tracking-ready)

`setStyle(partial)` shallow-merges into the resolved style — same semantics as today's `resolveStyle` merge, documented explicitly (nested objects like `size` are replaced whole, not deep-merged). Every mutating method (`setStyle`, child list operations, measure changes) funnels through one internal `#markDirty()` hook. In this change the hook may remain a no-op (computeLayout still clears all caches); the contract it establishes — *the engine observes every mutation* — is what incremental relayout later builds on without any public API change.

### D6: Reads are getters typed readonly

`get layout(): Readonly<Layout>`, `get unroundedLayout(): Readonly<Layout>` (kept public — embedders doing their own rounding need pre-rounded values), `get style(): Readonly<Style>`, `get children(): readonly LayoutNode[]`, `get parentNode(): LayoutNode | null`. Enforcement is type-level only (per explicit user decision); getters return internal objects, not defensive copies, keeping the read path allocation-free.

### D7: Curated barrel

`src/index.ts` drops both `export *` lines and explicitly exports: `LayoutNode`, `computeLayout`, `ComputeLayoutOptions`, `MeasureFunction`, `Layout`, `Style` and its component types (`Dimension`, `LengthPercentage`, `AvailableSpace`, display/position/overflow/alignment types, grid template & placement types), and `Size`/`Rect`/`Point`. The ~80 helpers stay exported from their modules (the engine and tests need them) but are no longer re-exported from the root; `tsconfig.build` continues to emit them, which is acceptable since the package's `exports` map only exposes `"."`.

### D8: Typed validation errors

One `InvalidStyleError extends Error` (name set, message from typed params, `cause` where wrapping) replaces the user-reachable `throw new Error(string)` sites in grid placement/track validation. Internal invariant throws stay plain.

## Risks / Trade-offs

- [Big-bang migration of 4417 tests + harness + fuzzer] → Migrate the harness/gentest constructors first; most tests build trees through them. A temporary internal shim (`createNode`-shaped function returning `LayoutNode`) can stage the diff; it must not survive to publish.
- [Private fields add property-access indirection on hot paths] → The compute engine accesses internals via `#`-field friend accessors within `tree.ts` (static helpers or exposed internal views), not through public getters; verify with `npm run bench` against the pre-change baseline before merging.
- [`Readonly<T>` is advisory; JS consumers can still mutate returned layout objects] → Accepted explicitly (user decision). Documented as unsupported; engine recomputes layouts each run anyway.
- [Shallow `setStyle` merge surprises users mutating one axis of `size`] → Document with an example; a deep-merge convenience or per-property setters are additive later.
- [Surface too small — someone needs a helper we unexported] → Additive under semver: promote into the root or a namespace in a minor. The reverse (shipping then removing) is the expensive direction; this trade is deliberate.

## Migration Plan

1. Introduce `LayoutNode` class in `tree.ts` alongside the old interface; engine reads via internal accessors.
2. Migrate harness/gentest, then test files, then fuzzer/bench scripts; suite green at each step.
3. Rewrite `src/index.ts` barrel; delete `createNode` and the old `Node` interface; typecheck finds stragglers.
4. Add `InvalidStyleError`; update grid validation throws + tests asserting on them.
5. Bench regression check; update README examples.

Rollback: pre-publish, single-consumer repo — revert the branch.

## Open Questions

- Where `measure` lives (constructor option vs `setMeasure`) — deferrable, harness migration will reveal the ergonomic answer.
- Whether `Style` keeps nested `size`/`margin` objects or flattens to `width`/`height`/`marginTop`… CSS-style scalars at the public boundary — current nested shape is assumed; flattening would be a separate proposal.
