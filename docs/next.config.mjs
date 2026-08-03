import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// The library lives one directory up, outside this app's package. Alias its
// published name to the TypeScript source so docs and playground always run
// the code in src/ — no `pnpm build` in the loop, and edits hot-reload.
// When the npm name changes, change it here; MDX imports stay untouched.
//
// Deploy note: because this reaches outside docs/, the Vercel project's Root
// Directory is the REPO ROOT, not docs/ — Vercel prunes files above the root,
// which would leave ../src missing and every import below unresolvable. The
// project therefore overrides:
//   Install: pnpm --dir docs install --frozen-lockfile
//   Build:   pnpm --dir docs build
//   Output:  docs/.next
// (docs/ has its own lockfile and is not a pnpm workspace member.)
const libSrc = fileURLToPath(new URL('../src', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Build directory, overridable so a second dev server can run against this
  // same checkout. `next dev` takes a lock on its distDir and refuses to start
  // when another dev server already owns it — that is a DIRECTORY conflict, not
  // a port one, so changing the port does not help. Pointing a second instance
  // at its own distDir is what actually separates them.
  // Unset (the default) means `.next`, so Vercel and everyone else are
  // unaffected; only a caller that explicitly exports NEXT_DIST_DIR opts in.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Pinned to webpack (`next dev/build --webpack`) rather than Turbopack:
  // src/ is NodeNext TypeScript, so it imports './tree.js' meaning tree.ts.
  // Only webpack's `extensionAlias` does that rewrite; Turbopack has no
  // equivalent and fails to resolve every intra-library import.
  webpack: (cfg) => {
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      'bento-layout': `${libSrc}/index.ts`,
    };
    // Same .js -> .ts rewrite for the webpack path.
    cfg.resolve.extensionAlias = {
      ...cfg.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return cfg;
  },
};

export default withMDX(config);
