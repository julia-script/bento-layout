# layout-tree-api Delta

## MODIFIED Requirements

### Requirement: Opaque node trees

The library SHALL let consumers build a layout tree of opaque nodes constructed from plain style data: a node is created from an optional style object (all properties optional, CSS-like defaults) and optional children. Node internals (style storage, caches, parent links, computed layouts) SHALL NOT be directly assignable by consumers; every mutation goes through a method of the node so the engine can observe it. No registration with an engine instance and no numeric node handles are required.

#### Scenario: Build and lay out a tree

- **WHEN** a consumer constructs nodes from style data and children and calls the layout entry point with available space
- **THEN** each node exposes its computed layout (x, y relative to parent, width, height) through read-only-typed getters

#### Scenario: Style mutation is method-only

- **WHEN** a consumer updates a node's style via the style-setting method and recomputes layout
- **THEN** the new layout reflects the change, and no public property exists through which the style could have been assigned directly

### Requirement: Publishable package

The package SHALL be publishable to npm as ESM with TypeScript declarations, zero runtime dependencies, and a curated root surface: the node class, the layout entry point, its options, the measure-function type, and the style/geometry/layout type vocabulary. Internal engine helpers (axis math, style resolvers, track predicates) SHALL NOT be exported from the package root.

#### Scenario: Consumer install

- **WHEN** a TypeScript project installs and imports the package
- **THEN** the node class, `computeLayout`, and all style/layout types typecheck and run under Node and bundlers without extra configuration

#### Scenario: Curated surface

- **WHEN** a consumer inspects the package root's exports
- **THEN** every exported value is either the node class, the layout entry point and its options, or a documented type — no internal helper functions

## ADDED Requirements

### Requirement: Tree manipulation with GC-native lifetime

The library SHALL support reparenting and detaching: appending a child that already has a parent detaches it from that parent first (single-parent invariant); removing a child yields a live standalone subtree that can be laid out, re-attached, or dropped. The library SHALL NOT require any explicit destroy/free/remove-from-engine call — an unreferenced subtree is reclaimed by garbage collection alone.

#### Scenario: Detach and reattach

- **WHEN** a consumer removes a subtree from its parent and later appends it under a different node
- **THEN** layout computed after reattachment positions the subtree under its new parent, with no other API call required in between

#### Scenario: Dropped subtree needs no cleanup

- **WHEN** a consumer removes a subtree and drops all references to it
- **THEN** no further API call is required, and subsequent layout computations on the original tree are unaffected

### Requirement: Typed style validation errors

The library SHALL report user-supplied style input that would poison layout math (such as a non-finite `repeat()` track count) by throwing an error that is an `instanceof` a dedicated exported error class whose `name` matches the class and whose message identifies the offending value. Style values that CSS defines as invalid-and-ignored (such as a grid placement line of 0) SHALL follow the CSS fallback behavior (treated as `auto`) rather than throwing, matching browsers.

#### Scenario: Non-finite track count

- **WHEN** a consumer supplies `gridTemplateColumns` containing `repeat(NaN, …)` and computes layout
- **THEN** the thrown error is an instance of the exported validation error class, not a bare `Error` with only a string message

#### Scenario: Grid line zero falls back like CSS

- **WHEN** a consumer supplies a grid placement with line number 0 and computes layout
- **THEN** the placement behaves as `auto` (no throw), matching browser handling of invalid placements
