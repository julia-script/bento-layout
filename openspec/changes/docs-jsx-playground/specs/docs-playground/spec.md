## Purpose

Lets documentation readers see and edit a layout tree and watch the engine lay it out live, using a JSX-shaped node syntax that is parsed rather than executed, so the same component serves both inline docs demos and a standalone playground without ever running reader-supplied code.

## ADDED Requirements

### Requirement: Demo source describes a layout tree, not a program

The demo dialect SHALL consist of a single `<Layout>` root containing a tree of `<Node>` elements, where each `<Node>` carries an optional `style` attribute holding an object literal. The dialect SHALL NOT support expressions, function calls, identifiers, loops, conditionals, imports, or any other executable construct. `<Node>` is tree syntax and SHALL NOT behave as a React component.

#### Scenario: A nested tree is accepted

- **WHEN** the source is `<Layout><Node style={{width: 200}}><Node style={{flexGrow: 1}} /></Node></Layout>`
- **THEN** the demo renders a root box containing one child box

#### Scenario: A computed value is rejected

- **WHEN** a style attribute contains an expression such as `{{width: 100 * 3}}`
- **THEN** the demo reports a parse error naming the unsupported construct
- **AND** no part of the expression is evaluated

#### Scenario: An identifier reference is rejected

- **WHEN** the source references a bare identifier, such as `{{width: someVar}}`
- **THEN** the demo reports a parse error
- **AND** the identifier is not resolved against any scope

### Requirement: Demo source is never executed

The system SHALL derive the layout tree from demo source by parsing only. It SHALL NOT pass demo source, or anything derived from it, to `eval`, `new Function`, dynamic `import`, or any other execution facility. Input that does not match the accepted grammar SHALL fail as a parse error rather than running.

#### Scenario: Hostile source cannot run

- **WHEN** demo source contains a construct that would execute code if evaluated, such as a function call or property access on a global
- **THEN** the demo reports a parse error
- **AND** no code from the source runs

#### Scenario: Malformed input cannot hang the page

- **WHEN** demo source produces a value the engine cannot lay out, including a numeric value that would resolve to `NaN`
- **THEN** the value is rejected before reaching layout
- **AND** the page remains responsive

### Requirement: Demo styles accept CSS-shaped value strings

Demo style objects SHALL accept CSS-shaped strings in addition to the engine's structured values, so demo source reads like CSS rather than like engine internals. Accepted units SHALL be `px`, `%`, and `fr`. A percentage SHALL be converted to the engine's fractional form, so `'50%'` means half. `fr` SHALL be accepted only where a track sizing function is expected.

#### Scenario: Lengths and percentages

- **WHEN** a style specifies `width: '100px'` and `height: '50%'`
- **THEN** the width resolves to 100 pixels
- **AND** the height resolves to half of the containing block, not to 50 times it

#### Scenario: Alignment keywords

- **WHEN** a style specifies `alignItems: 'center'`
- **THEN** it resolves to the engine's centered alignment with the safe modifier off

#### Scenario: Grid track lists

- **WHEN** a style specifies `gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))'`
- **THEN** it resolves to the engine's equivalent repeated track list
- **AND** a bare `fr` track receives an automatic minimum

#### Scenario: An unsupported unit is rejected

- **WHEN** a style specifies a value in a unit the engine cannot resolve, such as `'2rem'`
- **THEN** the demo reports an error naming the unsupported unit
- **AND** the value does not reach layout

#### Scenario: `fr` outside a track position is rejected

- **WHEN** a style specifies `width: '1fr'`
- **THEN** the demo reports an error
- **AND** the value does not reach layout

#### Scenario: Structured values remain valid

- **WHEN** a style specifies an engine-structured value, such as `alignItems: { keyword: 'center', safe: false }`
- **THEN** it is accepted unchanged alongside string forms

### Requirement: The preview shows computed layout

The demo SHALL lay the parsed tree out with the engine and render every node at its computed position and size. Nesting depth SHALL be visually distinguishable so tree structure is readable from the preview alone.

#### Scenario: Layout matches the engine

- **WHEN** a tree is laid out
- **THEN** each rendered box's position and size correspond to that node's computed layout

#### Scenario: All supported layout modes render

- **WHEN** a demo's root uses `display` of `flex`, `grid`, or `block`
- **THEN** the preview renders the resulting layout for that mode

#### Scenario: Nesting is visible

- **WHEN** a tree contains nodes at several depths
- **THEN** boxes at different depths are visually distinguishable

#### Scenario: A node collapsed on one axis stays visible

- **WHEN** a node lays out with zero width but non-zero height, or the reverse
- **THEN** its remaining extent is still drawn, marked as collapsed

#### Scenario: A hidden node is not drawn

- **WHEN** a node has `display: 'none'`
- **THEN** nothing is drawn for it

### Requirement: Errors preserve the last good preview

While demo source is invalid, the demo SHALL display an error describing the problem and SHALL continue to display the most recent successfully rendered preview. It SHALL NOT blank the preview area.

#### Scenario: Mid-edit invalid state

- **WHEN** a reader edits a demo into a temporarily invalid state
- **THEN** an error message appears
- **AND** the previously rendered preview remains visible

#### Scenario: Recovery on valid input

- **WHEN** the source becomes valid again
- **THEN** the error clears
- **AND** the preview updates to the new tree

### Requirement: Demos are editable wherever they appear

Every demo SHALL be editable in place, whether embedded in a documentation page or presented as a standalone playground. Editing SHALL update the preview without a page reload. Embedding a demo in a documentation page SHALL NOT require that page to load a separate code-editor bundle.

#### Scenario: Inline docs demo is editable

- **WHEN** a reader edits a demo embedded in a documentation page
- **THEN** the preview updates in place

#### Scenario: Standalone playground

- **WHEN** a reader opens the playground route
- **THEN** they get the same demo behaviour with a larger editing surface
