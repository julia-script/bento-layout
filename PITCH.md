# bento-layout — Pitch

A flexbox, CSS Grid, and block layout engine in plain TypeScript. Style data
goes in, pixel positions come out — and that is the whole transaction. No WASM
binary to load, no async initialization, no engine instance to register nodes
with, no `free()` or `destroy()` to remember: nodes are ordinary JavaScript
objects with ordinary lifetimes, and an unreferenced subtree is just garbage
collected. `import { LayoutNode, computeLayout }` and you are laying out boxes
on the next line, in Node, a browser, a worker, or anywhere else JavaScript
runs. Zero runtime dependencies.

The bet is that for most JavaScript projects that need layout outside the DOM —
a canvas renderer, a terminal UI, a PDF generator, an SVG diagram — the engine's
job is to be *correct and invisible*. The incumbent engines are excellent native
code first and JavaScript citizens second: Yoga ships as a WebAssembly blob
behind an async loader (or a slower asm.js fallback when you need a sync API),
and its C-heritage API keeps manual node lifecycle management. Those are
reasonable costs for React Native's constraints; they are baggage for a
TypeScript project that just wants a nice layout. bento-layout takes the other
route: accept the managed-runtime tax and in exchange be a library that feels
like it was written for TypeScript — because it was.



## The parts

bento-layout is a single package, so its parts are its major capabilities
rather than sub-packages.

### The engine — three layout modes, one tree

Flexbox, CSS Grid, and block layout (with margin collapsing per CSS 2.2) over
the full box model: min/max constraints, aspect ratios, percentages, auto
margins, absolute positioning, RTL, `box-sizing`, gaps, alignment including
`safe` variants, and scrollbar gutters. All three modes compose in one tree —
a grid inside a flex row inside a block page is the normal case, not a special
one. Leaf nodes take a measure callback so text and images report their own
size. It deliberately does not paint, own a DOM, or parse CSS strings — it computes
geometry, full stop. **Useful alone for:** anyone positioning boxes outside a
browser's layout pass — canvas/WebGL UIs, TUIs, document generators.

### The API — plain data in, plain objects out

`LayoutNode.make(style, children)` builds a tree from flat camelCase CSS
properties — the same spelling as `element.style` — with uniform shorthands
(`padding: 16`, `gap: { column: 8 }`) expanding in cascade order. Styles change
through `setStyle` (a per-property merge), structure through
`appendChild`/`insertChild`/`removeChild`, results come back through the
`layout` getter, snapped to whole pixels the way browsers round (cumulatively,
so adjacent boxes never gap or overlap — or unrounded, your choice). A removed
subtree is a live tree of its own: lay it out, re-attach it, or drop it and let
the GC take it. Invalid style input throws a typed `InvalidStyleError`; values
CSS defines as invalid-and-ignored fall back the way browsers fall back.
**Useful alone for:** the person evaluating layout engines by reading the
first code sample — this one has no setup step to show.

### The conformance pipeline — Chrome is the oracle

An in-repo pipeline (`pnpm gentest`) renders HTML fixture sources headless in a
pinned Chrome and commits the extracted geometry as XML expectations, four
variants each (both `box-sizing` modes, LTR and RTL); `pnpm test` then never
needs a browser. On top of the same oracle sit a differential fuzzer
(`pnpm fuzz`) that generates random trees, shrinks every disagreement to a
minimal reproduction, and persists findings as permanent regression fixtures —
and a WPT importer that scores the engine against a spec-organized subset of
web-platform-tests, with failures quarantined in the open rather than dropped
from the denominator. Deliberate divergences require a spec citation in
`KNOWN_DIVERGENCES.md`; there is currently one class-level entry (cyclic
percentage resolution) and zero fixture-level ones. **Useful alone for:** the
methodology — any layout engine, in any language, could adopt this
browser-as-oracle pipeline.

## Why this exists at all

If you want spec-grade flexbox *and* CSS Grid in a JavaScript project today,
your options each carry a tax:

- **Yoga** (Meta) is the battle-tested standard, but every published release
  is flexbox-only — CSS Grid exists as an open, unmerged pull request
  ([facebook/yoga#1865](https://github.com/facebook/yoga/pull/1865)) — and the
  npm package is C++ compiled to a base64-encoded WebAssembly blob behind an
  async loader, with asm.js as the synchronous fallback. Sound engineering for
  its goals; real friction for bundlers, edge runtimes, and quick starts.
- **The Rust engines** have excellent flexbox, grid, and block algorithms, but
  they are crates serving Rust UI toolkits. Using one
  from JavaScript means a WASM build and a binding layer, with the allocation
  and lifetime bookkeeping that implies.
- **Hand-rolled layout math** is where many canvas and PDF projects actually
  land, and it is a slow leak: each new alignment mode or percentage edge case
  is another divergence from what CSS-trained intuition expects.

bento-layout fills the specific gap those leave: one plain-TypeScript package
where flexbox, grid, and block all work, verified against a browser, that
installs and runs with the ceremony of `lodash`. The engines above are better
choices when their strengths are your constraints — Yoga when you are in the
React Native ecosystem, a Rust crate when you are writing Rust. This is the
choice for when you are writing TypeScript and want layout to be a small,
boring dependency.

## Why "just TypeScript" earns its keep

The absence of a native core is not a compromise here; it is the feature.

- **No loading problem.** No async WASM instantiation, no top-level await, no
  bundler configuration, no sync-vs-async API fork. It is an ES module.
- **No lifetime problem.** WASM linear memory cannot be garbage collected from
  JS, which is why bindings grow `free()` methods and node registries. Plain
  objects dissolve that whole class of bug — there is nothing to leak.
- **No boundary problem.** Every measure callback in a WASM engine crosses the
  JS↔native boundary twice; here a measure function is just a function call.
  Styles are structural TypeScript types checked at compile time, not enums
  marshalled through a binding.
- **Debuggable to the bottom.** A wrong position is a breakpoint in readable
  TypeScript, not a wall at a compiled frame.

And correctness is anchored to something external rather than to another
implementation: conformance is defined by a pinned Chrome, and the
browser-oracle fuzzer and WPT scoreboard exist to keep that claim measured
rather than asserted. Where any other engine and the browser disagree, the
browser wins — which is what lets this one fix inherited bugs instead of
faithfully reproducing them.

## Goals

- **Browser-faithful layout**: match pinned-Chrome geometry within 0.1px on
  every conformance fixture; deliberate divergences are documented with spec
  citations, never silent.
- **Zero-ceremony adoption**: zero runtime dependencies, no WASM, no async
  setup, no manual memory management — install, import, lay out.
- **All three layout modes as peers**: flexbox, CSS Grid, and block layout
  composing freely in one tree, with RTL and both `box-sizing` modes
  first-class (every fixture asserts all four variants).
- **Verification that outruns hand-written tests**: keep the differential
  fuzzer and WPT scoreboard maturing alongside the engine, so correctness
  claims stay measured rather than asserted.

## Non-goals

- **Rendering, styling cascade, or a DOM** — the engine computes geometry from
  resolved style data; owning paint or selector matching would make it a
  framework rather than a small dependency.
- **CSS string parsing in the library** — styles are structured data
  (`{ percent: 0.5 }`, `{ fr: 1 }`), not `'50%'` strings; keeping the parser
  out keeps the engine's input unambiguous and the docs playground owns the
  CSS-ish syntax instead.
- **Beating native performance** — parity with native code is not the target;
  chasing it would trade away the plain-TypeScript simplicity that is the
  point.
- **The full CSS layout surface** — floats, inline layout, `calc()`, named
  grid lines/`grid-template-areas`, and subgrid are not implemented today;
  scope is chosen so that what *is* claimed is browser-verified rather than
  approximate.
- **API compatibility with another engine** — the API is designed for
  TypeScript idioms (GC lifetimes, structural types, per-property merge), not
  for symmetry with any existing flexbox or grid implementation.

## Audience

- **Canvas/WebGL UI builders** — game UIs, editors, design tools that draw
  their own boxes and want CSS-shaped layout without a DOM.
- **Server-side and edge document generators** — PDF, SVG, and image
  composition in Node or edge runtimes, where WASM loading and native addons
  are the usual friction.
- **Terminal UI authors** — flexbox and grid for character grids, with the
  measure callback handling text.
- **React Native / custom-renderer experimenters** — anyone who wants grid
  today in a JS layout engine rather than tracking an unmerged native PR.
- **People learning CSS layout** — the playground shows how flex, grid, and
  block resolve sizes, interactively, with the real engine.

## Success criteria

- `pnpm test` passes every conformance fixture (currently 5,304, all four
  box-sizing/direction variants) at 0.1px tolerance, browserless, in seconds.
- `KNOWN_DIVERGENCES.md` stays exhaustive: any engine-vs-Chrome disagreement
  is either fixed or documented with a spec citation — zero silent divergence.
- The published package has zero runtime dependencies and no WASM asset, and
  the README quick-start works as-is in Node and in a browser bundle with no
  loader or configuration step.
- A fuzz campaign at the documented default budget produces no new findings at
  the current tolerance — and when it does, each finding lands as a permanent
  committed fixture.

## Acknowledgements

Thanks to [Taffy](https://github.com/DioxusLabs/taffy) (MIT), a major reference
while this engine was being built.
