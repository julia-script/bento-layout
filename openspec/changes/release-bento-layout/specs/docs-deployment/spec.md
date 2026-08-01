## Purpose

Defines how the documentation site gets from the repository to the public internet: the
build contract that lets the site compile against the library source living outside its
own package, and the hosting and domain behavior visitors depend on.

## ADDED Requirements

### Requirement: Docs build resolves the library from repository source

The documentation site imports the library by its published package name but is not
installed from the registry. The build SHALL resolve that name to the library source in
the repository, so the deployed site demonstrates the committed code.

#### Scenario: Build has access to the library source

- **WHEN** the documentation site is built in the hosting environment
- **THEN** the library source directory is present in the build context
- **AND** the build completes without failing to resolve the library's package name

#### Scenario: Deployed site runs the committed engine

- **WHEN** a layout example is rendered on the deployed site
- **THEN** the output matches what the committed library source produces for that input

#### Scenario: Build tolerates the source's import style

- **WHEN** the build resolves imports within the library source
- **THEN** extension-suffixed import specifiers resolve to their TypeScript sources
  rather than failing

### Requirement: Site is publicly reachable at its custom domain

The site SHALL be served over HTTPS at its custom domain with a valid certificate.

#### Scenario: Custom domain serves the site

- **WHEN** the custom domain is requested over HTTPS
- **THEN** the documentation site is returned with a success status
- **AND** the response is not an error placeholder from an intermediate proxy

#### Scenario: Certificate is valid for the domain

- **WHEN** an HTTPS connection to the custom domain is established
- **THEN** the presented certificate is valid and covers that hostname

#### Scenario: Custom domain overrides prior wildcard resolution

- **WHEN** the custom domain's DNS is resolved
- **THEN** it resolves to the hosting provider rather than to the parent domain's
  pre-existing wildcard destination

#### Scenario: Traffic reaches the host directly

- **WHEN** the custom domain's DNS record is inspected
- **THEN** it is not proxied through an additional intermediary in front of the hosting
  provider

### Requirement: Every public route is served

All routes the site publishes SHALL be reachable on the deployed site.

#### Scenario: Primary routes respond

- **WHEN** the landing page, the playground, and a documentation page are requested
- **THEN** each returns a success status

#### Scenario: Interactive playground functions

- **WHEN** the playground is loaded on the deployed site and its input is edited
- **THEN** the resulting layout is computed and displayed

#### Scenario: Unknown route is handled

- **WHEN** a URL matching no published route is requested
- **THEN** a not-found response is returned rather than a server error

### Requirement: Deployment tracks the default branch

Merges to the default branch SHALL produce an updated production deployment without
manual intervention.

#### Scenario: Merge updates production

- **WHEN** a documentation change is merged to the default branch
- **THEN** a production deployment is built from that commit
- **AND** the custom domain serves the updated content once it completes

#### Scenario: Failed build does not replace production

- **WHEN** a deployment build fails
- **THEN** the previously deployed version continues to be served at the custom domain
