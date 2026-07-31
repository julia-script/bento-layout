## Why

The docs site currently proves the engine runs inside Next (`components/smoke-test.tsx`) and nothing more. A layout engine is close to unteachable in prose alone: readers need to see boxes move when a property changes. Yoga solves this with a single editable JSX snippet paired with a live preview, reused as both a standalone playground and an inline demo on nearly every styling page. We want the same, and it is cheap — the engine already runs client-side through the `bento-layout` → `../src` alias.

Two things make ours worth more than a copy. The engine covers **grid and block**, which Yoga's flexbox-only playground structurally cannot show. And because demos are literal-only trees rather than programs, the code can be **parsed instead of evaluated**, which makes shareable links inert rather than an XSS vector on the docs origin.

## What Changes

- New `<Demo>` component in the docs package: an editable code pane plus a live layout preview, used inline on docs pages and as the body of a `/playground` route.
- The demo dialect is a **JSX-shaped tree syntax, not React**: `<Layout>` wrapping a tree of `<Node style={{…}}>`. There is no component model, no expressions, no loops, no imports. It is a node-based representation of a layout tree that happens to look like JSX.
- Demo source is **parsed, never evaluated**. An AST whitelist accepts JSX elements whose attributes are object literals of numbers, strings, booleans, arrays, and nested objects; every other node type is a parse error. No `eval`, no `new Function`, no scope object.
- A **playground-local CSS value parser** maps CSS-ish strings to engine types (`'100px'` → `100`, `'50%'` → `{ percent: 0.5 }`, `'1fr'` → `{ min: 'auto', max: { fr: 1 } }`, `minmax()`, `repeat()`, `fit-content()`, `'center'` → `{ keyword: 'center', safe: false }`), built on `postcss-value-parser`. Units are `px`, `%`, and `fr`; `fr` only where a track sizing function is expected.
- A recursive box renderer walks the laid-out tree and paints it as SVG from `node.layout`, coloured by depth: each node is a `<g>` translated by its `location` with a `<rect>` at its `size`, so the drawing space is the engine's own coordinate space with no box model in between.
- Editing is a `<textarea>` overlaid on syntax-highlighted output, so demos add no editor bundle to docs pages. The `/playground` route may adopt a heavier editor later; that decision is deliberately deferred and does not block this change.
- Parse and layout errors render over the last successful preview rather than replacing it, so a half-typed value does not blank the demo.
- Out of scope: **CSS parsing in the library**. `StyleInput` keeps taking structured values, no parser is promoted into `src/`, and string coercion stays a docs-package concern.
  - Amended during implementation: writing demos surfaced that `StyleInput` had no `padding`/`gap` shorthands, which is an ergonomic gap in the library rather than the docs site. That is addressed separately in `style-input-shorthands`; this change consumes it. The boundary still holds — shorthands are structured data, not parsed strings.
- Also out of scope: a tree/inspector UI (Yoga has none), code generation panes, text measurement inside demos, and URL-encoded share links (enabled by the no-eval design, but specified separately).

## Capabilities

### New Capabilities

- `docs-playground`: The demo dialect and its parse rules, the CSS value forms accepted in demo styles, the rendering of computed layout, error behaviour on invalid input, and the guarantee that demo source is never executed.

### Modified Capabilities

(none — the library's public API, style vocabulary, and layout behaviour are untouched by this change)

## Impact

- New: `docs/components/` playground modules (demo parser, style coercion, box renderer, `<Demo>`), a `/playground` route, and demo usage across `docs/content/docs/`.
- Removed: `docs/components/smoke-test.tsx` and its use in `content/docs/index.mdx`, which exist only to prove the alias resolves — superseded by real demos.
- New dependency, docs package only: `postcss-value-parser` (~1.8KB gzip, zero dependencies) plus a JSX-capable parser for the AST whitelist.
- No new runtime dependency for the `bento-layout` package, and no effect on the runtime export snapshot in `tests/api.test.ts`. The one library change this work prompted — uniform style shorthands — is scoped to its own change, `style-input-shorthands`.
- Constrained by the existing docs setup: Next is pinned to webpack because `src/` is NodeNext TypeScript needing `.js` → `.ts` extension aliasing, so anything added here must build under webpack rather than Turbopack.
- Demo styles exercise the engine through the same public API as any consumer, so a demo that renders wrongly is a real bug in `computeLayout`, not in the docs.
