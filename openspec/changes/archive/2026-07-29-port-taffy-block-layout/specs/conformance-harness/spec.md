## MODIFIED Requirements

### Requirement: XML fixture execution

The test harness SHALL parse each vendored Taffy fixture from the `flex`, `block`, and `blockflex` directories (`<test>` with `<viewport>`, `<input>`, `<expectations>`), build the corresponding node tree from the styled `<div>`/`<text>` elements (including `text-align` on block containers), compute layout at the fixture's viewport, and assert every node's x/y/width/height against expectations with 0.1px tolerance. Fixtures with `use-rounding="true"` run with the rounding pass enabled. Only fixtures whose trees require CSS Grid may be skipped, and each skip is enumerated with its reason in the suite.

#### Scenario: Full suite run

- **WHEN** `pnpm test` runs
- **THEN** every vendored flex, block, and blockflex fixture executes as an individually-reported vitest case, and the suite passes only when all match

#### Scenario: Block-rooted fixtures no longer skipped

- **WHEN** the suite runs after block layout is implemented
- **THEN** the `bevy_issue_10343_block` and `blitz_issue_88` fixture variants execute and pass, and the skip list contains only grid-rooted fixtures
