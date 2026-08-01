# bento-layout

A flexbox, CSS Grid, and block layout engine in plain TypeScript. Style data
goes in, pixel positions come out — and that is the whole transaction. No
WASM binary to load, no async initialization, no engine instance to register
nodes with, no `free()` or `destroy()` to remember: nodes are ordinary
JavaScript objects with ordinary lifetimes, and an unreferenced subtree is
just garbage collected. Zero runtime dependencies.

```typescript
import { LayoutNode, computeLayout } from 'bento-layout';

const left = LayoutNode.make({ flexGrow: 1 });
const right = LayoutNode.make({ flexGrow: 1 });
const root = LayoutNode.make({ width: 400, height: 300 }, [left, right]);

computeLayout(root, { width: 'max-content', height: 'max-content' });

left.layout.size; // { width: 200, height: 300 }
right.layout.location; // { x: 200, y: 0 }
```

That is the entire setup, and it runs the same in Node, a browser, a worker,
or an edge runtime. The engine computes geometry, full stop — it does not
paint, own a DOM, or parse CSS strings — which makes it the layout half of a
canvas renderer, a terminal UI, a PDF generator, or an SVG diagram, without
dragging in the rest of a browser.

## Why

If you want spec-grade flexbox *and* CSS Grid in a JavaScript project today,
your options each carry a tax. **Yoga** is the battle-tested standard, but
every published release is flexbox-only (Grid is an open, unmerged PR:
[facebook/yoga#1865](https://github.com/facebook/yoga/pull/1865)), and the
npm package is C++-compiled WASM behind an async loader. **Taffy** has
excellent flexbox, grid, and block algorithms — this project began from
them — but it is a Rust crate; using it from JS means a WASM build and a
binding layer with manual lifetime bookkeeping. **Hand-rolled layout math**
is a slow leak: every alignment mode and percentage edge case is another
divergence from CSS-trained intuition.

bento-layout fills the gap those leave: one plain-TypeScript package where
flexbox, grid, and block all work, verified against a browser, that installs
and runs with the ceremony of `lodash`. Yoga and Taffy remain better choices
when their strengths are your constraints — React Native, or Rust. This is
the choice for when you are writing TypeScript and want layout to be a
small, boring dependency.

## What it computes

- **Flexbox, CSS Grid, and block layout** (with CSS 2.2 margin collapsing),
  composing freely in one tree — a grid inside a flex row inside a block
  page is the normal case.
- **The full box model:** min/max constraints, aspect ratios, percentages,
  auto margins, absolute positioning, RTL, both `box-sizing` modes, gaps,
  alignment including the `safe` variants, and scrollbar gutters.
- **Content-driven sizing:** leaf nodes take a measure callback, so text and
  images report their own size.
- **Browser-faithful rounding:** results snap to whole pixels the way
  browsers round — cumulatively, so adjacent boxes never gap or overlap — or
  stay unrounded, your choice.

Styles are structured data (`{ percent: 0.5 }`, `{ fr: 1 }`), not CSS
strings, in flat camelCase properties with the same spelling as
`element.style`. Uniform shorthands (`padding: 16`, `gap: { column: 8 }`)
expand in cascade order. Styles change through `setStyle` (a per-property
merge), structure through `appendChild` / `insertChild` / `removeChild`. A
removed subtree is a live tree of its own: lay it out, re-attach it, or drop
it and let the GC take it.

## Conformance: Chrome is the oracle

Correctness is defined as agreement with a pinned Chrome, not with the
reference implementation the algorithms came from:

- **5,304 conformance fixtures** — geometry extracted from headless Chrome
  by an in-repo pipeline (`pnpm gentest`) and asserted at 0.1px tolerance,
  each in four variants (both `box-sizing` modes × LTR and RTL). `pnpm test`
  replays them browserless, in seconds.
- **A differential fuzzer** (`pnpm fuzz`) generates random trees, compares
  the engine against Chrome, shrinks every disagreement to a minimal
  reproduction, and commits findings as permanent regression fixtures.
- **A WPT scoreboard** imports a spec-organized subset of web-platform-tests
  (`css-flexbox`, `css-grid`, `css-sizing`, `css-align`) through the same
  pipeline, with failures quarantined in the open rather than dropped from
  the denominator.
- **Zero silent divergence:** any engine-vs-Chrome disagreement is either
  fixed or documented with a spec citation in
  [KNOWN_DIVERGENCES.md](KNOWN_DIVERGENCES.md) — currently one class-level
  entry (cyclic percentage resolution) and no fixture-level ones.

The algorithms began from [Taffy](https://github.com/DioxusLabs/taffy)'s,
and `src/compute/` preserves Taffy's module structure so upstream fixes
transfer. Where Chrome and Taffy disagree, this engine follows Chrome; each
Taffy-inherited bug found that way is logged in
[UPSTREAM_TAFFY.md](UPSTREAM_TAFFY.md) with a minimized reproduction and
spec citation, staged for filing upstream.

## Documentation

The full documentation — a getting-started tutorial, guides for measuring
content, grid, and renderer integration, a complete style-property
reference, and the conformance story — lives in the [docs site](docs/)
(`cd docs && pnpm dev`), with live, editable demos running the real engine.

## Non-goals

- **Rendering, styling cascade, or a DOM** — the engine computes geometry
  from resolved style data.
- **CSS string parsing** — styles are structured data; the docs playground
  owns the CSS-ish syntax instead.
- **Beating native performance** — parity with native code is not the
  target; [BENCHMARKS.md](BENCHMARKS.md) keeps honest numbers and their
  limits.
- **The full CSS layout surface** — floats, inline layout, `calc()`, named
  grid lines/areas, and subgrid are out of scope, so that what *is* claimed
  is browser-verified rather than approximate.
- **Taffy API compatibility** — the API is designed for TypeScript idioms
  (GC lifetimes, structural types, per-property merge), not for symmetry
  with the Rust crate.

## License

MIT
