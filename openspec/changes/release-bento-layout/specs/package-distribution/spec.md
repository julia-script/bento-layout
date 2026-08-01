## Purpose

Defines how the layout engine is distributed as an installable npm package: the identity
metadata consumers and registries rely on, what the published tarball contains, the
licensing terms, the versioning promise, and the authenticity guarantees of the publish
pipeline.

## ADDED Requirements

### Requirement: Package is publishable

The package SHALL be publishable to the public npm registry under the unscoped name
`bento-layout`. The package manifest SHALL NOT mark the package as private.

#### Scenario: Publish is not blocked by the private flag

- **WHEN** a publish of the package is attempted
- **THEN** the registry accepts it
- **AND** the publish is not rejected for the package being marked private

#### Scenario: Package is publicly installable

- **WHEN** a consumer runs an install of `bento-layout` from the public registry
- **THEN** the package resolves and installs without requiring authentication

### Requirement: Package declares its provenance metadata

The published manifest SHALL identify where the source lives, where its documentation is
hosted, and where defects are reported, so registry pages and tooling can link back to
them.

#### Scenario: Registry metadata resolves to live destinations

- **WHEN** the published package's metadata is inspected
- **THEN** it declares a repository location, a homepage, and an issue-reporting location
- **AND** each of those locations is reachable rather than returning not-found

#### Scenario: Package is discoverable by subject

- **WHEN** the published package's metadata is inspected
- **THEN** it declares keywords describing the subject matter, including its layout
  modes and its dependency-free nature
- **AND** it declares an author

### Requirement: License is unambiguous

The repository SHALL contain the full text of the license that the package manifest
declares. The declared license identifier and the license text SHALL agree.

#### Scenario: Declared license has matching text

- **WHEN** the repository is inspected
- **THEN** a license file containing the full MIT license text is present
- **AND** the manifest's declared license identifier is `MIT`

#### Scenario: License ships to consumers

- **WHEN** the published tarball's contents are listed
- **THEN** the license file is included

### Requirement: Published tarball contains only build output

The published tarball SHALL contain the compiled distributable and its type
declarations. It SHALL NOT contain source, tests, fixtures, benchmarks, or the
documentation site.

#### Scenario: Tarball excludes development material

- **WHEN** the published tarball's contents are listed
- **THEN** no test file, fixture, benchmark script, or documentation-site file is present

#### Scenario: Declared entry points resolve

- **WHEN** a consumer imports the package by its name
- **THEN** the runtime entry point resolves from the tarball contents
- **AND** the TypeScript type declarations resolve from the tarball contents

### Requirement: Initial release signals an unstable API

The package SHALL be released in the `0.x` version range, communicating that the public
API may change without a major-version bump.

#### Scenario: First published version is below 1.0

- **WHEN** the first version is published
- **THEN** its version is within the `0.x` range

### Requirement: Publishing is credential-free and attested

Publishing SHALL be performed by an automated workflow authenticating to the registry
via short-lived, workload-identity credentials. No long-lived registry token SHALL be
stored in the repository or its secrets. Each published version SHALL carry a provenance
attestation linking it to the source commit and the workflow that built it.

#### Scenario: No long-lived token exists

- **WHEN** the repository's stored secrets are inspected
- **THEN** no long-lived npm registry token is present

#### Scenario: Published version carries provenance

- **WHEN** a published version's registry entry is inspected
- **THEN** it reports a provenance attestation
- **AND** that attestation references the source repository and the workflow run that
  produced it

#### Scenario: Publishing outside the trusted workflow is rejected

- **WHEN** a publish is attempted from somewhere other than the configured trusted
  workflow, without separate credentials
- **THEN** the registry rejects it

### Requirement: Only tested code is published

A publish SHALL occur only after the package's test suite and type check pass against
the committed source.

#### Scenario: Failing checks block the release

- **WHEN** a release is triggered and the test suite or type check fails
- **THEN** no version is published to the registry

#### Scenario: Release is deliberately triggered

- **WHEN** ordinary commits land on the default branch without a release being triggered
- **THEN** no publish occurs
