## Why

The engine is done and the docs site is written, but nothing is reachable: there is no
GitHub repo, no npm package, no deployed site, and `package.json` still carries
`"private": true`. The work exists only on one laptop.

Two things also need fixing before anything goes out, because both are cheap now and
expensive later. `package.json` declares `"license": "MIT"` with no LICENSE file in the
repo — a declared license with no text is legally ambiguous once people depend on it. And
the npm name `bento-layout` is currently unregistered; names get taken.

## What Changes

**Publish the source.**
- Create the public GitHub repo `julia-script/bento-layout` and push `main`.
- Add the missing `LICENSE` (MIT, matching the existing declaration).

**Publish the package.**
- Flip `"private": true` → remove it, so `npm publish` is permitted at all.
- Add `repository`, `homepage`, `bugs`, `keywords`, and `author` to `package.json`.
- Publish `bento-layout@0.1.0` from CI via **npm Trusted Publishing** (GitHub Actions
  OIDC), not a long-lived `NPM_TOKEN`. This also yields a provenance attestation.
- Stay on `0.x` deliberately: it signals an unstable API, which is honest for a new
  layout engine.

**Deploy the docs.**
- Create the Vercel project and deploy `docs/` at `https://bento.jlort.com`.
- Vercel Root Directory must be the **repo root**, not `docs/` — the docs build resolves
  `bento-layout` to `../src` via a webpack alias and cannot see above its own root.
- DNS: `CNAME bento → cname.vercel-dns.com` on Cloudflare, **DNS-only (grey cloud)**.

**Close the docs metadata gap.**
- Root-layout metadata: `metadataBase`, title template, `openGraph`, `twitter`.
  Today the root layout exports none of these, so every link preview is blank.
- Add `opengraph-image`, `apple-icon`, `robots.ts`, `sitemap.ts`, and theme-color.

## Capabilities

### New Capabilities
- `package-distribution`: how the library is published to npm — identity metadata,
  tarball contents, licensing, versioning policy, and the CI-based Trusted Publishing
  flow that produces provenance.
- `docs-site-metadata`: the docs site's discoverability surface — canonical origin,
  title composition, social/link-preview cards, icons, and crawler directives.
- `docs-deployment`: how the docs site is built and served — the monorepo build
  contract that lets `docs/` reach `../src`, the hosting project, and the custom domain.

### Modified Capabilities

None. This change ships existing behavior; it does not alter the layout engine's
requirements. No `openspec/specs/` entry changes.

## Impact

**Two steps require credentials this project does not have and cannot obtain**, so they
are handoffs to the user, each blocking what follows it:
- **Cloudflare DNS** for `jlort.com` — no API token available in the session.
- **npm Trusted Publishing** — configuring the publisher is a manual step in npm's web
  UI; it cannot be done from the CLI.

Affected files:
- `package.json` (root) — private flag, identity metadata.
- New: `LICENSE`, `.github/workflows/release.yml`.
- `docs/app/layout.tsx` — add the metadata export it currently lacks.
- New: `docs/app/opengraph-image.tsx`, `docs/app/apple-icon.png`,
  `docs/app/robots.ts`, `docs/app/sitemap.ts`.

Pre-existing conditions confirmed by inspection:
- `bento.jlort.com` already resolves to Cloudflare IPs (a wildcard/apex catch-all with
  no origin). The new CNAME must override it and must not be proxied.
- The docs build is pinned to webpack (`next build --webpack`); the `.js`→`.ts`
  extension alias has no Turbopack equivalent. This constrains the Vercel build.
- No secrets are present in tracked files (scanned); the repo is safe to make public.
