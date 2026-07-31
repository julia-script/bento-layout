# conformance-harness (delta)

## MODIFIED Requirements

### Requirement: Ahem text measurement

The harness SHALL implement Taffy's test measure function for `<text>` fixture
nodes: Ahem-font semantics where each glyph is a 10×10px square, known
dimensions short-circuit measurement, and text wraps within available width at
break opportunities. A break opportunity SHALL be a zero-width space (U+200B)
**or** ordinary whitespace, so that prose imported from WPT — which carries no
explicit U+200B — wraps as the reference browser wraps it. Adding whitespace
breaking SHALL NOT change the measurement of any text that contains no
whitespace.

#### Scenario: Wrapping text fixture

- **WHEN** a fixture's `<text>` node with 9 four-glyph words is measured under 50px available width
- **THEN** measurement yields the same size Taffy's test harness produces, and the fixture's expectations are met

#### Scenario: Prose wraps on spaces

- **WHEN** a `<text>` node whose content is space-separated prose with no
  zero-width spaces is measured under a definite available width narrower than
  its single-line length
- **THEN** it wraps onto multiple lines, and its min-content contribution is the
  longest *word* rather than the whole string
