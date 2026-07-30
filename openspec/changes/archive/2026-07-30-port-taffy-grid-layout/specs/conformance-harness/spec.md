## MODIFIED Requirements

### Requirement: XML fixture execution

The test harness SHALL parse each vendored Taffy fixture from the `flex`, `block`, `blockflex`, `grid`, `blockgrid`, and `gridflex` directories (`<test>` with `<viewport>`, `<input>`, `<expectations>`), build the corresponding node tree from the styled `<div>`/`<text>` elements (including `text-align` and the grid template/placement/auto-flow attributes), compute layout at the fixture's viewport, and assert every node's x/y/width/height against expectations with 0.1px tolerance. Fixtures with `use-rounding="true"` run with the rounding pass enabled. No fixtures are skipped.

#### Scenario: Full suite run

- **WHEN** `pnpm test` runs
- **THEN** every vendored fixture from all six directories executes as an individually-reported vitest case, and the suite passes only when all match

#### Scenario: No skipped fixtures remain

- **WHEN** the suite runs after grid layout is implemented
- **THEN** the skip lists are empty — the previously grid-rooted flex fixtures (`bevy_issue_10343_grid`, `bevy_issue_21240` variants) execute and pass
