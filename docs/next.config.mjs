import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';

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
  // Pinned to webpack (`next dev/build --webpack`) rather than Turbopack:
  // src/ is NodeNext TypeScript, so it imports './tree.js' meaning tree.ts.
  // Only webpack's `extensionAlias` does that rewrite; Turbopack has no
  // equivalent and fails to resolve every intra-library import.
  webpack: (cfg) => {
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      'bento-layout': libSrc + '/index.ts',
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
