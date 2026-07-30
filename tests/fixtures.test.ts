// Conformance suite: runs every vendored Taffy flex fixture against this port.
// Expectations were generated from Chrome — see tests/fixtures/TAFFY_COMMIT.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/index.js';
import type { Node } from '../src/index.js';
import { parseFixture } from './harness/fixture.js';
import type { ExpectedNode } from './harness/fixture.js';

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const TOLERANCE = 0.1;

const allBoxVariants = (names: string[]): string[] =>
  names.flatMap((name) => [
    `${name}__border_box_ltr`,
    `${name}__border_box_rtl`,
    `${name}__content_box_ltr`,
    `${name}__content_box_rtl`,
  ]);

// Fixtures whose expectations require layout algorithms this package does not
// implement: trees containing display:grid containers (grid templates).
const SKIP_BY_DIR: Record<string, ReadonlySet<string>> = {
  // Grid-rooted skips removed once the grid port lands (port-taffy-grid-layout 4.1)
  flex: new Set(allBoxVariants(['bevy_issue_10343_grid', 'bevy_issue_21240'])),
  block: new Set(),
  blockflex: new Set(),
  grid: new Set(),
  blockgrid: new Set(),
  gridflex: new Set(),
};

function assertLayoutMatches(node: Node, expected: ExpectedNode, path: string): void {
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
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.xml'));

  describe(`taffy ${dir} fixtures`, () => {
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
