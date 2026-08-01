## Purpose

Defines the documentation site's discoverability and sharing surface: the canonical
origin every absolute URL derives from, how page titles compose, what a shared link
renders as on social and chat platforms, the icons each client requests, and what
crawlers are told.

## ADDED Requirements

### Requirement: Site declares a canonical origin

The site SHALL declare a single absolute base origin from which all generated absolute
URLs — social image URLs, canonical links, and sitemap entries — are derived. That origin
SHALL be the site's public custom domain.

#### Scenario: Social image URLs are absolute

- **WHEN** any page's rendered markup is inspected
- **THEN** the social preview image is referenced by an absolute URL, not a
  root-relative path

#### Scenario: Origin matches the public domain

- **WHEN** a generated absolute URL is inspected
- **THEN** its origin is the site's public custom domain, not a deployment-specific or
  localhost origin

### Requirement: Page titles compose against the site name

Every page SHALL present a browser title that identifies both the page and the project.
A page that does not set its own title SHALL still present a meaningful default.

#### Scenario: Sub-page title includes the project name

- **WHEN** a documentation page that declares its own title is rendered
- **THEN** the browser title contains both that page's title and the project name

#### Scenario: Untitled page falls back

- **WHEN** a page that declares no title of its own is rendered
- **THEN** the browser title is the project's default title rather than being empty

### Requirement: Shared links render a preview card

Every page SHALL supply the metadata needed for social and chat platforms to render a
preview card containing a title, a description, and an image. The image SHALL be sized
so platforms render it as a large summary card rather than a thumbnail.

#### Scenario: Link preview has all three parts

- **WHEN** any page's rendered markup is inspected
- **THEN** it declares an Open Graph title, description, and image
- **AND** it declares the equivalent metadata for card-based platforms

#### Scenario: Preview image renders at card dimensions

- **WHEN** the social preview image is fetched
- **THEN** it is served as an image at 1200×630 pixels

#### Scenario: Preview reflects the site's visual identity

- **WHEN** the social preview image is viewed
- **THEN** it presents the project name and the bento visual identity, rather than a
  generic or default placeholder

#### Scenario: Preview card is not blank

- **WHEN** a page URL is submitted to a social preview validator
- **THEN** the validator reports a populated card rather than missing metadata

### Requirement: Site supplies icons for every requesting client

The site SHALL supply a browser tab icon and a home-screen icon suitable for clients
that do not accept vector icons.

#### Scenario: Browser tab icon is served

- **WHEN** a browser requests the site's icon
- **THEN** an icon is served rather than returning not-found

#### Scenario: Touch icon is a raster image

- **WHEN** a client that requires a raster home-screen icon requests one
- **THEN** a 180×180 pixel raster icon is served

#### Scenario: Browser UI is themed

- **WHEN** the site is loaded on a client that themes its browser UI from page metadata
- **THEN** a theme color is declared
- **AND** it differs between the light and dark presentations

### Requirement: Crawlers are given directives and a page inventory

The site SHALL serve crawler directives permitting indexing, and a sitemap enumerating
every publicly reachable page. The directives SHALL point to the sitemap.

#### Scenario: Crawler directives permit indexing

- **WHEN** the crawler directives are fetched
- **THEN** they permit indexing of the site's public pages
- **AND** they reference the sitemap's absolute URL

#### Scenario: Sitemap enumerates all pages

- **WHEN** the sitemap is fetched
- **THEN** it lists the landing page, the playground, and every documentation page
- **AND** each entry is an absolute URL on the canonical origin

#### Scenario: Sitemap tracks content changes

- **WHEN** a documentation page is added and the site is rebuilt
- **THEN** the sitemap includes the new page without further manual edits
