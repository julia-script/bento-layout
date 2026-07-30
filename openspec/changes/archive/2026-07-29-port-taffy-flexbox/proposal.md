## Why

There is no maintained, TypeScript-only, dependency-free flexbox layout engine on npm — existing options are WASM builds (heavy, opaque) or abandoned ports (css-layout/yoga-js era). Taffy (Rust) is the best-tested open implementation, and it ships 2,252 Chrome-derived, language-agnostic XML conformance fixtures for flexbox, which makes a faithful port verifiable without ever running Rust.

## What Changes

- New pnpm/TypeScript package implementing Taffy's flexbox algorithm (CSS Flexible Box spec) including the full box model: margin/padding/border, `box-sizing` (border-box and content-box), min/max constraints, aspect-ratio, absolute positioning, ltr/rtl.
- Vitest conformance harness that runs Taffy's `tests/xml/flex` fixtures (vendored into this repo, pinned to a recorded Taffy commit) with the same 0.1px tolerance, including the Ahem-font text measure function for `<text>` fixtures.
- Public API: plain-object style input, tree of nodes, `computeLayout(root, availableSpace)`, optional measure callback for leaf content, optional pixel-grid rounding pass.
- Publishable package setup: ESM build, type declarations, docs, CI-runnable test suite.
- Architecture is simplified for JS: no trait layer, no arena/NodeId, no bit-packed lengths — discriminated unions and plain objects instead. Grid, block layout, and `calc()` are explicitly out of scope for this change.

## Capabilities

### New Capabilities
- `flexbox-layout`: Computing CSS flexbox layout (sizes and positions) for a tree of styled nodes, including box model, constraints, alignment, wrapping, absolute children, and rounding.
- `layout-tree-api`: The public TypeScript API surface — node/style construction, layout computation entry point, measure functions, and reading back results.
- `conformance-harness`: Running the vendored Taffy XML fixtures under vitest and comparing computed layouts against Chrome-derived expectations.

### Modified Capabilities

(none — greenfield project)

## Impact

- New codebase from scratch in this repo: `src/`, `tests/`, vendored `tests/fixtures/flex/*.xml`.
- Dev dependencies only: typescript, vitest, an XML parser for the harness (or a minimal hand-rolled one). Runtime dependencies: none.
- Reference: Taffy cloned at a pinned commit; commit hash recorded in the repo for future fixture syncs.
