## MODIFIED Requirements

### Requirement: Pinned fixture provenance

The committed XML fixtures SHALL be produced by the in-repo browser generation pipeline from the HTML fixture-source tree, with the generating Chrome version recorded in the repository, so that fixture updates are deliberate, diffable, and reproducible. The historical Taffy-commit provenance applies only until a fixture directory has been regenerated through the pipeline.

#### Scenario: Fixture provenance audit

- **WHEN** a contributor checks fixture provenance
- **THEN** the recorded Chrome version (and the HTML source file each XML fixture derives from) identifies exactly how the fixtures were produced, and re-running the pipeline reproduces them
