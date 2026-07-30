# block-layout Specification

## Purpose

Computes CSS block layout for `display: block` containers — vertical stacking with margin collapsing and stretch-fit widths — interoperating with flexbox nodes in the same tree.

## Requirements

### Requirement: Block container layout

The engine SHALL lay out in-flow children of a `display: block` container in document order as vertically stacked boxes, where each child's automatic width stretches to fill the container's content box (minus the child's margins) and each child's automatic height is determined by its content.

#### Scenario: Vertical stacking with stretch-fit widths

- **WHEN** a 600px-wide block container has two children with `height: 20px` and no width
- **THEN** both children are 600px wide, positioned at y=0 and y=20

#### Scenario: Conformance with Chrome-derived fixtures

- **WHEN** any vendored Taffy `block` or `blockflex` fixture's input tree is laid out
- **THEN** every node's x, y, width, and height match the fixture's expectations within 0.1px

### Requirement: Vertical margin collapsing

The engine SHALL collapse adjacent vertical margins per CSS 2.2 §8.3.1: between in-flow siblings, between a parent and its first/last child (when no padding/border/height separates them), and through empty blocks; the collapsed margin is the sum of the largest positive and smallest negative participating margins.

#### Scenario: Sibling margins collapse

- **WHEN** two stacked blocks have `margin-bottom: 20px` and `margin-top: 10px` respectively
- **THEN** the gap between them is 20px, not 30px

#### Scenario: Collapse blocked by padding

- **WHEN** a parent with `padding-top: 1px` contains a first child with `margin-top: 10px`
- **THEN** the child's margin stays inside the parent (child at y=11) instead of collapsing out

### Requirement: Text alignment of block children

The engine SHALL horizontally position narrower-than-container in-flow children per the container's `text-align` value (`-webkit-left`, `-webkit-center`, `-webkit-right`), defaulting to direction-aware flow-start when unset.

#### Scenario: Centered child

- **WHEN** a 600px-wide block container with `text-align: -webkit-center` has a 100px-wide child
- **THEN** the child is placed at x=250

### Requirement: Mixed block and flex trees

The engine SHALL support arbitrary nesting of block containers inside flex containers and vice versa, with each container laid out by its own algorithm and sizes negotiated through the shared measurement protocol.

#### Scenario: Flex inside block

- **WHEN** a `display: block` root contains a `display: flex` child whose content is text
- **THEN** the flex child stretches to the block root's width and the layout matches the corresponding `blockflex` fixture expectations

### Requirement: Absolute positioning in block containers

The engine SHALL size and position `position: absolute` children of block containers from their insets against the container's border box (minus border), with static-position fallback consistent with block flow when insets are auto.

#### Scenario: Inset-positioned child of a block

- **WHEN** a block container has an absolute child with `top: 10px`, `left: 10px` and definite size
- **THEN** the child is placed 10px from the container's top-left border-box corner
