## Purpose

Lets a style be written with CSS's uniform shorthand properties — one value covering four sides or two axes — while keeping the resolved style a pure longhand form, so the convenience exists at the input boundary and nothing downstream of style resolution needs to know about it.

## ADDED Requirements

### Requirement: Uniform shorthands set every longhand they cover

`StyleInput` SHALL accept `padding`, `margin`, `border`, `inset`, `gap`, and `overflow` as shorthand properties. A single value given to one of these SHALL apply to every longhand that shorthand covers.

#### Scenario: A box shorthand sets four sides

- **WHEN** a style specifies `padding: 16`
- **THEN** all four padding longhands resolve to 16

#### Scenario: An axis shorthand sets both axes

- **WHEN** a style specifies `gap: 8`
- **THEN** both the row and column gutters resolve to 8

#### Scenario: Keyword and percentage values expand unchanged

- **WHEN** a style specifies `margin: 'auto'` or `padding: { percent: 0.1 }`
- **THEN** every covered longhand receives that value as given, not a transformed one

#### Scenario: An auto margin still absorbs free space

- **WHEN** an item in a larger container specifies `margin: 'auto'`
- **THEN** it is centred on both axes

### Requirement: Object form sets only the named sides

Each shorthand SHALL also accept an object naming individual sides or axes. Longhands the object does not name SHALL keep the value they already had.

#### Scenario: Naming a subset of sides

- **WHEN** a style specifies `padding: { top: 8, bottom: 8 }`
- **THEN** the top and bottom paddings resolve to 8
- **AND** the left and right paddings are unchanged

#### Scenario: Naming one axis

- **WHEN** a style specifies `gap: { column: 8 }`
- **THEN** the column gutter resolves to 8
- **AND** the row gutter is unchanged

#### Scenario: A resolved style is valid input

- **WHEN** a resolved style read back from a node is passed as input to another node
- **THEN** it resolves to an equivalent style, with no shorthand key misread

### Requirement: Later properties override earlier ones

Shorthand expansion SHALL respect the order properties are written, so a property given after another wins where they overlap, as the CSS cascade does.

#### Scenario: A longhand after a shorthand

- **WHEN** a style specifies `padding: 16` and then `paddingTop: 0`
- **THEN** the top padding resolves to 0
- **AND** the other three resolve to 16

#### Scenario: A shorthand after a longhand

- **WHEN** a style specifies `paddingTop: 0` and then `padding: 16`
- **THEN** all four paddings resolve to 16

### Requirement: Shorthands are an input form only

Shorthands SHALL exist solely in the input dialect. The resolved style read back from a node SHALL contain only the longhand fields, in the same shape it had before shorthands were accepted, and SHALL NOT gain a shorthand property alongside them.

#### Scenario: Resolved style shape is unchanged

- **WHEN** a node is created with `padding: 5`
- **THEN** reading its style back gives the four-sided padding object
- **AND** no scalar `padding` property appears on it

#### Scenario: Layout is identical either way

- **WHEN** two trees are built identically except that one uses a shorthand and the other its longhands
- **THEN** both produce the same computed layout

### Requirement: Multi-value shorthand strings are not supported

The library SHALL NOT accept the multi-value CSS shorthand string forms, because it parses no CSS. Values remain structured data.

#### Scenario: A two-value string is not a shorthand

- **WHEN** a style specifies a multi-value string such as `padding: '10px 20px'`
- **THEN** it is not interpreted as two distinct side values

#### Scenario: The object form covers the same intent

- **WHEN** a caller wants different values per side
- **THEN** the object form or the individual longhands express it
