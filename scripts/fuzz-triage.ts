// Triage helper for fuzz findings: takes minimized-tree JSON (as printed by
// `pnpm fuzz` in a finding's `minimized:` line, or a path to a file containing
// it), renders it in pinned Chrome, and prints chrome-vs-engine geometry for
// every node in every variant, marking the ones that differ.
//
// Usage: pnpm fuzz-triage '<json>'
//        pnpm fuzz-triage path/to/tree.json

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { computeLayout } from '../src/index.js';
import type { Node } from '../src/index.js';
import { parseFixture } from '../tests/harness/fixture.js';
import type { ExpectedNode } from '../tests/harness/fixture.js';
import { generateTestXml } from './gentest.js';
import type { FuzzTree } from './fuzz/generate.js';
import { fuzzTreeToHtml } from './fuzz/serialize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORT_DIR = join(ROOT, 'tests', 'html', 'support');

const VARIANTS = [
  ['borderBoxLtrData', 'border_box_ltr'],
  ['contentBoxLtrData', 'content_box_ltr'],
  ['borderBoxRtlData', 'border_box_rtl'],
  ['contentBoxRtlData', 'content_box_rtl'],
] as const;

function report(node: Node, expected: ExpectedNode, path: string, lines: string[]): void {
  const { location, size } = node.layout;
  const differs =
    Math.abs(location.x - expected.x) >= 0.1 ||
    Math.abs(location.y - expected.y) >= 0.1 ||
    Math.abs(size.width - expected.width) >= 0.1 ||
    Math.abs(size.height - expected.height) >= 0.1;
  lines.push(
    `  ${path}: chrome=(${expected.x},${expected.y} ${expected.width}x${expected.height}) ` +
      `engine=(${location.x},${location.y} ${size.width}x${size.height})${differs ? '   *** DIFFERS' : ''}`,
  );
  node.children.forEach((c, i) => report(c, expected.children[i]!, `${path}/${i}`, lines));
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: pnpm fuzz-triage '<minimized-tree-json>' | <file.json>");
    process.exit(2);
  }
  const json = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
  const tree = JSON.parse(json) as FuzzTree & { viewport: FuzzTree['viewport'] | null };
  if (tree.viewport === null) delete (tree as { viewport?: unknown }).viewport;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  const html = fuzzTreeToHtml(tree, {
    support: 'inline',
    supportJs: readFileSync(join(SUPPORT_DIR, 'test_helper.js'), 'utf8'),
    supportCss: readFileSync(join(SUPPORT_DIR, 'test_base_style.css'), 'utf8'),
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  const data = JSON.parse((await page.evaluate('getTestData()')) as string) as Record<
    string,
    Record<string, unknown>
  >;
  await browser.close();

  for (const [key, suffix] of VARIANTS) {
    const xml = generateTestXml(`triage__${suffix}`, data[key] as Parameters<typeof generateTestXml>[1]);
    const fixture = parseFixture(xml);
    computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
    const lines: string[] = [];
    report(fixture.root, fixture.expected, 'root', lines);
    console.log(`${suffix}:`);
    console.log(lines.join('\n'));
  }
}

await main();
