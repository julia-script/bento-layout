Two tasks are handoffs the assistant cannot perform — marked **[USER]**. Each gates only
one branch of the work; everything else proceeds around them. See design.md — Migration
Plan for the dependency graph.

## 1. Repository hygiene (local, no credentials)

- [x] 1.1 Add `LICENSE` at the repo root with the full MIT text, copyright Julia Ortiz, matching the `"license": "MIT"` already declared in `package.json`
- [x] 1.2 Remove `"private": true` from the root `package.json`
- [x] 1.3 Add `repository` (`git+https://github.com/julia-script/bento-layout.git`), `homepage` (`https://bento.jlort.com`), `bugs`, `author`, and `keywords` (flexbox, grid, block layout, layout engine, css, typescript, zero-dependency) to the root `package.json`
- [x] 1.4 Run `pnpm build && pnpm test && pnpm typecheck`; confirm all pass and `dist/` is regenerated
- [x] 1.5 Run `npm pack --dry-run` and confirm the tarball contains `dist/` plus `LICENSE`/`README.md` only — no `src/`, `tests/`, `scripts/`, or `docs/`
- [x] 1.6 Add a comment in `docs/next.config.mjs` near the alias recording the Vercel install/build overrides that the alias depends on

## 2. Release workflow

- [x] 2.1 Create `.github/workflows/release.yml` triggered on `push` of tags matching `v*` — filename is fixed, the npm publisher binds to it exactly
- [x] 2.2 Grant the job `permissions: { id-token: write, contents: read }` — the OIDC exchange fails without `id-token: write`
- [x] 2.3 Set up Node 24 and pnpm; assert `npm --version` is ≥ 11.5.1 so a silent downgrade fails loudly rather than falling back to token auth
- [x] 2.4 Install with pnpm, then run build, test, and typecheck as release gates — a failure here must stop the job before publish
- [x] 2.5 Print `npm pack --dry-run` output in the job log for auditability
- [x] 2.6 Publish with `npm publish --provenance --access public` — must be `npm`, not `pnpm`, which does not perform the OIDC exchange
- [x] 2.7 Verify the workflow file parses (`gh workflow view` after push, or a YAML lint locally)

## 3. Publish the source

- [x] 3.1 Commit tasks 1–2 on `main`
- [x] 3.2 Create the public repo: `gh repo create julia-script/bento-layout --public --source . --remote origin --description "Flexbox, grid, and block layout in plain TypeScript — no WASM, no dependencies"`
- [x] 3.3 Push `main` and confirm `.github/workflows/release.yml` is present on the default branch — Trusted Publishing validates against the workflow in the repo
- [x] 3.4 Confirm the pushed tree contains no `node_modules/`, `dist/`, `.next/`, or `.source/`
- [x] 3.5 Set the repo's homepage to `https://bento.jlort.com` and add topics

## 4. [USER] Configure npm Trusted Publishing

- [ ] 4.1 **[USER]** On npmjs.com, add a Trusted Publisher for `bento-layout`: GitHub Actions, org `julia-script`, repo `bento-layout`, workflow `release.yml`. Since the package does not exist yet, this is configured as a pending publisher on the package name. Assistant pauses here and confirms before proceeding to task 5.

## 5. Publish the package

- [ ] 5.1 Tag `v0.1.0` and push the tag
- [ ] 5.2 Watch the run (`gh run watch`); if it 403s at publish, the publisher config does not match — delete the tag, correct it, re-tag. No version is consumed by a failed publish
- [ ] 5.3 Confirm `npm view bento-layout` resolves and reports version `0.1.0`
- [ ] 5.4 Confirm the npm package page shows the provenance attestation linking to the source commit and workflow run
- [ ] 5.5 Install the published package into a scratch directory and import it, confirming the runtime entry and type declarations both resolve

## 6. Vercel project

- [x] 6.1 Create the project from the GitHub repo, framework preset Next.js, on team `juliascripts-projects`
- [x] 6.2 Set Root Directory to the **repo root** — not `docs/`, which prunes `../src` from the build context and breaks every library import
- [x] 6.3 Set Install Command `pnpm --dir docs install --frozen-lockfile`, Build Command `pnpm --dir docs build`, Output Directory `docs/.next`
- [x] 6.4 Trigger a deployment and confirm it builds — expect 15 prerendered routes, matching the verified local build
- [x] 6.5 On the `*.vercel.app` URL, confirm `/`, `/playground`, and a docs page all return 200, and that a playground edit computes a layout
- [x] 6.6 Confirm an unknown route returns 404 rather than a server error

## 7. [USER] DNS

- [x] 7.1 **[USER]** In Cloudflare DNS for `jlort.com`, add `CNAME bento → cname.vercel-dns.com` with proxy **disabled (grey cloud)**. Orange-cloud breaks Vercel's certificate issuance and stacks two CDNs. This record overrides the existing wildcard that currently returns 503. Assistant pauses here and confirms before proceeding to task 8.
- [x] 7.2 Add `bento.jlort.com` as a domain on the Vercel project and confirm it verifies
- [x] 7.3 Confirm `dig bento.jlort.com` returns Vercel's address, not the previous Cloudflare wildcard IPs
- [x] 7.4 Confirm `https://bento.jlort.com` returns 200 with a valid certificate covering the hostname

## 8. Docs metadata

- [x] 8.1 Add a `metadata` export to `docs/app/layout.tsx` with `metadataBase: new URL('https://bento.jlort.com')` — without it Next emits relative social image URLs that scrapers reject, silently nullifying the rest of this section
- [x] 8.2 Add a title `template` (`'%s | bento-layout'`) with a `default`, plus root `description`, `openGraph`, and `twitter` (`summary_large_image`)
- [x] 8.3 Verify the docs pages now compose titles correctly — they set bare titles like "Getting Started" today and must render with the project name appended
- [x] 8.4 Add `docs/app/opengraph-image.tsx` — 1200×630 `ImageResponse` hero card using the bento tokens (washi `hsl(40,45%,97%)`, coral `hsl(13,72%,62%)`, the mark from `app/icon.svg`)
- [x] 8.5 Wire per-page doc cards via fumadocs `createMetadataImage` so `/docs/reference/api` previews with its own title; fall back to a system serif if fetching the display font at build time proves brittle
- [x] 8.6 Add `docs/app/apple-icon.png` at 180×180 — iOS ignores SVG icons
- [x] 8.7 Add a `viewport` export with light/dark `themeColor` drawn from the paper tokens
- [x] 8.8 Add `docs/app/robots.ts` permitting indexing and referencing the sitemap's absolute URL
- [x] 8.9 Add `docs/app/sitemap.ts` derived from `source.getPages()`, appending `/` and `/playground`; confirm a newly added `.mdx` appears without further edits

## 9. Verify the release

- [x] 9.1 Build locally and confirm the OG images render at 1200×630 with legible text, not a blank or fallback card
- [x] 9.2 Deploy and confirm every page's rendered markup carries absolute OG image URLs on the `bento.jlort.com` origin
- [x] 9.3 Check the live landing page and one deep doc link through a social preview validator; confirm populated cards with distinct titles
- [x] 9.4 Fetch `/robots.txt` and `/sitemap.xml` on the live domain; confirm the sitemap lists all 15 routes as absolute URLs
- [x] 9.5 Confirm the favicon and apple-touch icon both serve rather than 404
- [ ] 9.6 Confirm the npm page's repository and homepage links resolve to the live repo and live site — closing the loop that made ordering matter
- [x] 9.7 Merge a trivial docs change to `main` and confirm it auto-deploys to the custom domain
