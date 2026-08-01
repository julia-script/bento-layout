import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors the `bento-layout` -> ../src alias in next.config.mjs so playground
// tests run against the same live library source the site does. The `.js` ->
// `.ts` rewrite is needed because src/ is NodeNext TypeScript, where
// `./tree.js` means tree.ts.
const libSrc = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { 'bento-layout': `${libSrc}/index.ts` },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    include: ['components/**/*.test.ts'],
  },
});
