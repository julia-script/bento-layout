import { defineConfig } from 'vitest/config';

// The docs site is a separate package with its own vitest config, which aliases
// `bento-layout` to ../src. Without this exclude the root runner also picks up
// docs/**/*.test.ts, resolves `bento-layout` through node_modules to the stale
// `dist/` build instead, and fails on code that is no longer in src/.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
