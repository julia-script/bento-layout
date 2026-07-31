# Tasks

All work is in the `docs/` package. The library (`src/`, `tests/`, root `package.json`) is not touched by this change.

## 1. Groundwork

- [x] 1.1 Verify Fumadocs exposes a usable syntax highlighter at runtime for the textarea overlay; if it is build-time only, note the fallback chosen (design.md — Risks). — Resolved: `fumadocs-core/highlight/client` exports a `useShiki(code, options, deps)` React hook for client-side highlighting, and `shiki` is already a transitive dependency of `fumadocs-core`. No fallback needed; no extra highlighter bundle.
- [x] 1.2 Add `postcss-value-parser` and a JSX-capable parser to the docs package; confirm both build under the pinned webpack config (not Turbopack). — Added `postcss-value-parser`, `acorn`, `acorn-jsx` to `docs/package.json` only (root `package.json` untouched). All three are zero-dependency. Full webpack build verified in 7.1.

## 2. Style coercion

- [x] 2.1 Coerce lengths: `'100px'` → `100`, `'50%'` → `{ percent: 0.5 }`; accept bare numbers unchanged.
- [x] 2.2 Reject unsupported units (`rem`, `em`, `vh`, …) and non-finite numbers with a message naming the offending value.
- [x] 2.3 Coerce alignment keywords: `'center'`, `'space-between'`, `'safe center'` → `{ keyword, safe }`.
- [x] 2.4 Coerce grid track values: `'1fr'`, `'auto'`, `'min-content'`, `'max-content'`, `minmax(...)`, `fit-content(...)`, `repeat(...)`, and space-separated track lists. Carry over the fixture parser's semantics — bare `fr` and `fit-content` take an `auto` minimum (design.md).
- [x] 2.5 Reject `fr` anywhere a track sizing function is not expected.
- [x] 2.6 Pass structured engine values through unchanged, so both dialects work.
- [x] 2.7 Tests: each accepted form maps to the expected engine value; each rejected form errors rather than producing `NaN`.

## 3. Demo dialect parser

- [x] 3.1 Parse source to an AST and walk it under a whitelist: `JSXElement`, `ObjectExpression`, `Literal`, `ArrayExpression`, numeric negation. Everything else is a parse error.
- [x] 3.2 Enforce dialect shape: a single `<Layout>` root, `<Node>` children only, `style` the only recognized attribute.
- [x] 3.3 Produce `{ style, children }` data, then build `LayoutNode`s via the public API with styles run through coercion (§2).
- [x] 3.4 Error messages that name the unsupported construct, not just its AST node type.
- [x] 3.5 Tests: nested trees parse; expressions, identifiers, calls, and member access are each rejected without evaluation. — Also added a root `vitest.config.ts` scoping the root runner to `tests/`, so it no longer sweeps `docs/**` and resolve `bento-layout` to the stale `dist/` build.

## 4. Preview renderer

- [x] 4.1 Recursively render the laid-out tree from `node.layout`, with depth-based colouring. — Rendered as SVG: a `<g transform="translate(x y)">` per node holding a `<rect>`, so nesting mirrors the engine's parent-relative `location` directly.
- [x] 4.2 Account for any border the preview draws that the engine does not know about, so drawn boxes align with computed geometry. — SVG strokes straddle the path, so each rect is inset by half a stroke width; unlike the div version's per-level border subtraction, this is a constant that cannot accumulate with depth. Collapsed nodes need explicit handling: SVG renders no rect at zero width or height, so a one-axis collapse draws a line. A 0x0 node draws nothing, deliberately.
- [x] 4.3 Confirm `flex`, `grid`, and `block` roots all render.

## 5. Demo component

- [x] 5.1 Compose parser, coercion, layout, and renderer into `<Demo>`, taking initial source and optional sizing.
- [x] 5.2 Textarea-over-highlighted-source editor; recompute on edit.
- [x] 5.3 Overlay errors on the last successful preview; clear on recovery.
- [x] 5.4 Register `<Demo>` in `mdx-components.tsx` so MDX pages can use it without importing it per file.

## 6. Wire into the site

- [x] 6.1 Add a `/playground` route rendering `<Demo>` at full size with a seeded example.
- [x] 6.2 Replace the `SmokeTest` usage in `content/docs/index.mdx` with a real demo; delete `components/smoke-test.tsx`.
- [x] 6.3 Add demos to the styling pages, exercising flex, grid, and block. — The site had only `index.mdx`, so this added three styling pages (`flex-direction`, `grid-tracks`, `block-layout`) carrying 10 demos between them. Writing the full documentation set is a separate job; these establish the pattern and cover all three layout modes.
- [x] 6.4 State in prose, where demos first appear, that demo source accepts CSS-shaped strings while the library's own API takes structured values.

## 7. Verification

- [x] 7.1 `pnpm build` in `docs/` passes under webpack.
- [x] 7.2 Editing a demo into an invalid state shows an error and keeps the previous preview; recovery clears it.
- [x] 7.3 Malformed input (`'2rem'`, `'1f'`, `repeat(3)`, a bare identifier) errors without hanging the page.
- [x] 7.4 Confirm the library is unchanged: no diff under `src/`, and `pnpm test` at the repo root still passes with the export snapshot unmoved. — Amended: `src/style.ts` and `src/index.ts` *are* changed, by the separate `style-input-shorthands` change this work prompted; the runtime export snapshot is unmoved (types are erased) and root tests pass at 5381. Root `package.json` untouched. Two other files outside `docs/`: a root `vitest.config.ts` (scopes the root runner to `tests/` so it stops sweeping `docs/**`) and `.claude/launch.json` (dev-server config for browser verification).
