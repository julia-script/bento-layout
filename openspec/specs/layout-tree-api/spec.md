# layout-tree-api Specification

## Purpose

The public TypeScript API for building styled node trees, computing layout, and reading results — plain objects and functions, no WASM, no runtime dependencies.

## Requirements

### Requirement: Plain-object node trees

The library SHALL let consumers build a layout tree from plain data: each node carries a style object (all properties optional, CSS-like defaults) and an array of children. No registration with an engine instance or numeric node handles is required.

#### Scenario: Build and lay out a tree

- **WHEN** a consumer constructs `{ style: {...}, children: [...] }` nodes and calls the layout entry point with available space
- **THEN** each node exposes its computed layout (x, y relative to parent, width, height)

### Requirement: Layout entry point

The library SHALL expose a `computeLayout(root, availableSpace)` function where each axis of available space is a definite pixel value, `min-content`, or `max-content`. Results are stored on the nodes and remain readable until the next computation.

#### Scenario: Max-content viewport

- **WHEN** layout is computed with `max-content` available space on both axes
- **THEN** the root sizes to its content's max-content size

### Requirement: Measure functions for leaf content

The library SHALL support an optional measure callback on leaf nodes, invoked with known dimensions and available space, returning content size — sufficient to implement text measurement. Nodes with a measure callback and no children are treated as content leaves.

#### Scenario: Text-like leaf

- **WHEN** a leaf's measure callback returns width based on available space (word-wrapping behavior)
- **THEN** the flex algorithm uses that size for the leaf's content sizing and final layout

### Requirement: Publishable package

The package SHALL be publishable to npm as ESM with TypeScript declarations, zero runtime dependencies, and all public types exported from the package root.

#### Scenario: Consumer install

- **WHEN** a TypeScript project installs and imports the package
- **THEN** `computeLayout`, node/style types, and enums typecheck and run under Node and bundlers without extra configuration

### Requirement: Grid style properties

The library SHALL accept grid styling as plain data on the style object: `gridTemplateRows`/`gridTemplateColumns` and `gridAutoRows`/`gridAutoColumns` as arrays of track sizing values (length, percent, `fr`, `auto`, min/max-content, `fit-content()`, `minmax()`, `repeat()`), `gridAutoFlow`, `gridRow`/`gridColumn` placements (line number, `span n`, auto), and `justifyItems`/`justifySelf` — all optional with CSS-conformant defaults, exported as TypeScript types from the package root.

#### Scenario: Typed grid style input

- **WHEN** a consumer constructs a node with `gridTemplateColumns` mixing a fixed length, an `fr` value, and a `minmax()` entry
- **THEN** the style typechecks against exported types and `computeLayout` lays the grid out accordingly
