## ADDED Requirements

### Requirement: Grid style properties

The library SHALL accept grid styling as plain data on the style object: `gridTemplateRows`/`gridTemplateColumns` and `gridAutoRows`/`gridAutoColumns` as arrays of track sizing values (length, percent, `fr`, `auto`, min/max-content, `fit-content()`, `minmax()`, `repeat()`), `gridAutoFlow`, `gridRow`/`gridColumn` placements (line number, `span n`, auto), and `justifyItems`/`justifySelf` — all optional with CSS-conformant defaults, exported as TypeScript types from the package root.

#### Scenario: Typed grid style input

- **WHEN** a consumer constructs a node with `gridTemplateColumns` mixing a fixed length, an `fr` value, and a `minmax()` entry
- **THEN** the style typechecks against exported types and `computeLayout` lays the grid out accordingly
