// Conformance suite: runs every vendored Taffy flex fixture against this port.
// Expectations were generated from Chrome — see tests/fixtures/TAFFY_COMMIT.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/index.js';
import type { LayoutNode } from '../src/index.js';
import { parseFixture } from './harness/fixture.js';
import type { ExpectedNode } from './harness/fixture.js';

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const TOLERANCE = 0.1;

// All vendored fixtures run — flexbox, block, and grid are all implemented.
// fuzz-found holds regression fixtures persisted by `pnpm fuzz` (differential
// fuzzing against Chrome); they run exactly like the vendored corpus.
// WPT imports that currently diverge from Chrome. They stay out of the default
// run so `pnpm test` keeps its always-green invariant; `pnpm wpt-score` runs
// them all and owns the red. Promote by deleting the entry in the fixing commit.
const WPT_QUARANTINE: ReadonlySet<string> = new Set(
  (JSON.parse(readFileSync(join(FIXTURES_ROOT, 'wpt-quarantine.json'), 'utf8')) as { quarantined: string[] })
    .quarantined,
);

const SKIP_BY_DIR: Record<string, ReadonlySet<string>> = {
  flex: new Set(),
  block: new Set(),
  blockflex: new Set(),
  grid: new Set(),
  blockgrid: new Set(),
  gridflex: new Set(),
  'fuzz-found': new Set(),
  'wpt/css-flexbox': WPT_QUARANTINE,
  'wpt/css-grid': WPT_QUARANTINE,
  'wpt/css-sizing': WPT_QUARANTINE,
  'wpt/css-align': WPT_QUARANTINE,
};

function assertLayoutMatches(node: LayoutNode, expected: ExpectedNode, path: string): void {
  const { location, size } = node.layout;
  expect.soft(location.x, `${path} x`).toBeCloseToTolerance(expected.x, TOLERANCE);
  expect.soft(location.y, `${path} y`).toBeCloseToTolerance(expected.y, TOLERANCE);
  expect.soft(size.width, `${path} width`).toBeCloseToTolerance(expected.width, TOLERANCE);
  expect.soft(size.height, `${path} height`).toBeCloseToTolerance(expected.height, TOLERANCE);
  expect(node.children.length, `${path} child count`).toBe(expected.children.length);
  for (let i = 0; i < expected.children.length; i++) {
    assertLayoutMatches(node.children[i]!, expected.children[i]!, `${path}/${i}`);
  }
}

expect.extend({
  toBeCloseToTolerance(received: number, expected: number, tolerance: number) {
    const pass = Math.abs(received - expected) < tolerance;
    return {
      pass,
      message: () => `expected ${received} to be within ${tolerance} of ${expected}`,
    };
  },
});

declare module 'vitest' {
  interface Assertion<T> {
    toBeCloseToTolerance(expected: number, tolerance: number): T;
  }
}

for (const dir of Object.keys(SKIP_BY_DIR)) {
  const fixtureDir = join(FIXTURES_ROOT, dir);
  const skip = SKIP_BY_DIR[dir]!;
  if (!existsSync(fixtureDir)) continue; // wpt dirs appear only after `pnpm wpt-import`
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.xml'));
  if (files.length === 0) continue; // fuzz-found starts empty

  describe(`${dir} fixtures`, () => {
    for (const file of files) {
      const name = file.replace(/\.xml$/, '');
      const runner = skip.has(name) ? it.skip : it;
      runner(name, () => {
        const xml = readFileSync(join(fixtureDir, file), 'utf8');
        const fixture = parseFixture(xml);
        computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
        assertLayoutMatches(fixture.root, fixture.expected, 'root');
      });
    }
  });
}
