## Context

See proposal.md — Why. The constraints below were established by inspecting the repo and
running the build; they shape every decision that follows.

**The docs site is not part of a workspace.** `docs/` has its own `package.json`,
its own `pnpm-lock.yaml` (172 KB), and its own `pnpm-workspace.yaml`. The root has a
separate lockfile (44 KB) and no `workspaces` field. They are two independent pnpm
projects that happen to share a directory tree.

**But the docs build reads the library from `../src`.** `docs/next.config.mjs` aliases
the bare specifier `bento-layout` to `../src/index.ts`, and sets
`extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }` because the library is NodeNext
TypeScript importing `'./tree.js'` to mean `tree.ts`. So install must happen *inside*
`docs/`, while the build needs a parent directory that install never touches. That
tension is the central deployment decision.

**The build is pinned to webpack.** Turbopack has no `extensionAlias` equivalent, so
`next dev/build --webpack` is load-bearing, not a leftover.

**The site is fully static.** A verification build produced 15 prerendered routes and no
server-rendered ones — no SSR, no runtime library calls, no environment variables.

**Auth is in place; two credentials are not.** `gh` (julia-script), `npm` (juliascript,
CLI 11.17.0), and `vercel` (juliascript, zero projects) are all authenticated. Cloudflare
has no token in this environment, and npm Trusted Publishing is configured only through
npm's web UI.

**`bento.jlort.com` already resolves** to Cloudflare IPs shared with the apex — a
wildcard or apex catch-all with no origin behind it, returning 503.

## Goals / Non-Goals

**Goals:**
- One deployment configuration that satisfies both the install-in-`docs/` and
  build-needs-`../src` constraints, chosen deliberately rather than by trial and error.
- A publish path with no long-lived registry token anywhere.
- An ordering that never publishes an artifact pointing at something that does not exist.
- Clear isolation of the two steps the user must perform, so neither blocks work that
  could proceed without it.

**Non-Goals:**
- Restructuring the repo into a real pnpm workspace. It would make Vercel's job easier,
  but it churns both lockfiles and the alias for a build that already works.
- Publishing the docs site as an npm package, or the library to any other registry.
- Per-page CI (lint, matrix testing). One release workflow only.
- A `1.0.0` API-stability commitment.

## Decisions

### Vercel Root Directory = repo root, not `docs/`

The intuitive setting is Root Directory `docs/`. It fails: Vercel prunes files above the
root directory from the build context, so `../src` would not exist and every import of
`bento-layout` would fail to resolve.

Two ways out:

| Option | How | Cost |
|---|---|---|
| Root = `docs/`, enable "Include files outside root directory" | Vercel setting | Setting is easy to lose; the failure mode is a resolve error far from its cause |
| **Root = repo root, override install and build commands** | `pnpm --dir docs install` / `pnpm --dir docs build` | Commands are explicit and visible in project config |

**Chosen: root = repo root**, with Install Command `pnpm --dir docs install --frozen-lockfile`,
Build Command `pnpm --dir docs build`, and Output Directory `docs/.next`. The whole tree
is in the build context, `../src` resolves naturally, and the intent is legible in the
Vercel UI rather than hidden behind a checkbox. `--dir` is used instead of `cd docs &&`
so pnpm resolves the lockfile in `docs/` unambiguously.

Framework preset stays **Next.js** — the output is a normal `.next` build. No
`vercel.json` is added; the settings live in project config, since they are deployment
configuration rather than repository content.

### Publish via GitHub Actions OIDC (Trusted Publishing), tag-triggered

npm Trusted Publishing exchanges a short-lived GitHub OIDC token for publish rights, so
no `NPM_TOKEN` secret exists to leak or rotate. It also emits a provenance attestation
that ties the tarball to the commit and workflow run, which is exactly what the
`package-distribution` spec requires.

Requirements this imposes:
- npm CLI ≥ 11.5.1 in CI (local is 11.17.0; CI pins Node 24 which ships a satisfying npm).
- Workflow permissions `id-token: write` and `contents: read`.
- `npm publish` runs with `--provenance`. It must be `npm`, not `pnpm` — pnpm's publish
  path does not perform the OIDC exchange. Dependencies are still installed with pnpm.
- The publisher is configured on npm against a specific repo *and* workflow filename, so
  the file must be named before the user configures it. Fixed: `.github/workflows/release.yml`.

**Trigger: pushing a `v*` tag**, not every merge to `main`. The spec requires that
ordinary commits do not publish. A tag is an explicit, auditable release act.

Alternative rejected: classic automation token in repo secrets. Simpler to set up, but
it is a long-lived credential in a public repo's settings and produces no provenance.

Ordering constraint: **the package cannot be published until the repo exists and the
workflow file is on the default branch**, because Trusted Publishing validates the
publish against a workflow in that repo.

### Registry name claimed before anything else ships

`bento-layout` is unregistered today. Everything in the docs — install command, every
import in every code sample — assumes that name. If it is taken mid-release, the
documentation becomes wrong.

The first tagged release therefore happens as early as the dependency chain allows
(immediately after repo + workflow land), rather than last. Publishing `0.1.0` claims the
name and validates the whole pipeline while the stakes are low.

### `metadataBase` is a hard prerequisite for the metadata work

Without `metadataBase`, Next emits relative social image URLs and most scrapers reject
them, so the OG work silently produces nothing. It is set once on the root layout to
`https://bento.jlort.com` and everything else inherits.

This creates a real dependency: the domain must be decided (it is) before metadata is
written, though not before it is *deployed* — the origin is a build-time constant, not a
runtime lookup.

### Per-page OG images via fumadocs, static card for the rest

Fumadocs ships `createMetadataImage`, which renders each doc page's title into its own
card at build time. Since the site is fully static, these are generated during the build
with no runtime cost. Deep links to `/docs/reference/api` preview with "API Reference"
on the card instead of a generic hero.

The landing page and playground get a single static hero card built with the same
`ImageResponse` primitive and the same bento tokens (washi paper `hsl(40,45%,97%)`, coral
`hsl(13,72%,62%)`, the bento mark).

Rejected: static-only. It is one file less work, but a docs site's value is in deep
links, and blank-looking cards on every internal page undercuts the launch.

Note: the display font is loaded from Google Fonts via `<link>` in the layout. Font
loading inside `ImageResponse` requires fetching the font binary at build time; if that
proves brittle, the cards fall back to a system serif rather than blocking the release.

### Sitemap derives from the fumadocs source, not a hand-written list

`source.getPages()` already enumerates every doc page — the same loader that builds the
nav tree. Generating `sitemap.ts` from it means a new `.mdx` file appears in the sitemap
automatically, satisfying the spec's "without further manual edits" scenario. The landing
and playground routes are appended explicitly, as they are not fumadocs pages.

### DNS: unproxied CNAME, and it must override a wildcard

`bento → cname.vercel-dns.com`, **DNS-only (grey cloud)**. Proxying (orange cloud) puts
Cloudflare's edge in front of Vercel's, which interferes with Vercel's certificate
issuance and stacks two CDNs for no benefit.

Because `bento.jlort.com` already resolves through the wildcard, this is an *override* of
existing resolution, not a fresh record. An explicit record at that exact name takes
precedence over `*`, so the 503 disappears once it propagates — but the old value may be
cached briefly.

### LICENSE is fixed as part of this change, not deferred

The manifest already declares MIT with no text present. Adding `LICENSE` costs one file
now; after publication it means shipping a corrective version to a package people have
already installed under ambiguous terms.

## Risks / Trade-offs

**Trusted Publishing misconfiguration fails only at publish time** → The publisher binds
to an exact repo and workflow filename. A mismatch surfaces as a 403 during the first
tagged release, after the tag is already pushed. Mitigation: fix the filename
(`release.yml`) before the user configures it; if the first attempt 403s, delete the tag,
correct the npm-side config, re-tag. No version is consumed by a failed publish.

**A published version cannot be recalled** → npm unpublish is restricted after 72 hours,
and even within the window it is disruptive. Mitigation: `npm pack --dry-run` is inspected
in CI before publish; the tarball was already verified locally at 36 files / 461 KB from
`dist/` only. Starting at `0.1.0` also keeps expectations low.

**Making the repo public exposes full history, not just the current tree** → The secret
scan covered tracked files at HEAD; a secret committed and later removed would still be
in history. Mitigation: this repo's history is a from-scratch port with no deployment
credentials involved, and the scan found only CSS-tokenizer vocabulary. Accepted risk,
noted so it is a decision rather than an oversight.

**Vercel install/build override is invisible to the repo** → Someone reading the source
cannot tell why the build works. Mitigation: record the settings in the repo's README or
a comment in `next.config.mjs`, next to the alias they exist to support.

**Cloudflare proxy default is orange** → Cloudflare adds new records proxied by default,
so the likely error is a working-looking record that breaks certificate issuance.
Mitigation: called out explicitly in the handoff, and verified after the fact by checking
that the resolved IPs are Vercel's rather than Cloudflare's.

**Two user-blocked steps could stall the whole release** → Mitigation: they gate different
branches of the work. DNS blocks only domain verification; npm publisher config blocks only
the tagged release. All file changes, the repo push, the Vercel project, and the metadata
work proceed without either.

## Migration Plan

Nothing is being migrated — this is a first release. The ordering below exists because
each step produces something the next one references.

```
  ①  LICENSE + package.json + workflow file   (local, no credentials)
              │
              ▼
  ②  create public repo, push main            ─── unblocks Trusted Publishing
              │
              ├──────────────┐
              ▼              ▼
  ③  [USER] npm         ④  Vercel project     (deploys to *.vercel.app)
      publisher config       root = repo root
              │              │
              ▼              ▼
  ⑤  tag v0.1.0         ⑥  [USER] Cloudflare CNAME (grey cloud)
      → published            → domain verified
                             │
                             ▼
  ⑦  metadata: metadataBase, OG, icons, robots, sitemap
                             │
                             ▼
  ⑧  verify: live cards, provenance badge, cert, all routes
```

③ and ④ are independent and can proceed in parallel. ⑦ is written against
`https://bento.jlort.com` regardless of whether ⑥ has completed, since the origin is a
build-time constant.

**Rollback:** Each step is independently reversible except publication. The Vercel
project can be deleted, the domain detached, the repo made private, and the tag deleted.
A published npm version is effectively permanent — which is why it sits behind an explicit
tag and a dry-run inspection.

## Resolved Questions

- **Repo name: `julia-script/bento-layout`.** Chosen over `flexboxjs` to match the
  package name and docs branding, so the npm↔GitHub link is obvious from either side.
  The local directory stays `flexboxjs`; that mismatch is cosmetic and accepted.
- **First release publishes for real**, not as a dry run — claiming the unregistered
  name is the priority, and `0.1.0` keeps expectations low. CI still inspects
  `npm pack --dry-run` output before the publish step within the same run.

## Open Questions

- Whether to add release-notes automation or a changelog. Deferrable; affects neither
  the specs nor the task breakdown.
