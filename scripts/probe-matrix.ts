// Runs a directory of minimized-tree JSON probes against pinned Chrome and
// prints one PASS/FAIL line per (probe, variant). Unlike `fuzz-triage`, this
// launches Chrome once for the whole matrix and reports per-variant, which is
// what the RTL work needs: a probe file's own `direction` is only one of the
// four variants the harness renders.
//
// Usage: pnpm probe-matrix <dir-of-probe-json>
//        pnpm probe-matrix <dir> -v   (show geometry for passing probes too)

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { computeLayout } from '../src/index.js';
import type { LayoutNode } from '../src/index.js';
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

type Mismatch = { path: string; chrome: string; engine: string };

function collect(node: LayoutNode, expected: ExpectedNode, path: string, out: Mismatch[]): void {
  const { location, size } = node.layout;
  if (
    Math.abs(location.x - expected.x) >= 0.1 ||
    Math.abs(location.y - expected.y) >= 0.1 ||
    Math.abs(size.width - expected.width) >= 0.1 ||
    Math.abs(size.height - expected.height) >= 0.1
  ) {
    out.push({
      path,
      chrome: `(${expected.x},${expected.y} ${expected.width}x${expected.height})`,
      engine: `(${location.x},${location.y} ${size.width}x${size.height})`,
    });
  }
  node.children.forEach((c, i) => collect(c, expected.children[i]!, `${path}/${i}`, out));
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const verbose = process.argv.includes('-v');
  if (!dir) {
    console.error('usage: pnpm probe-matrix <dir-of-probe-json> [-v]');
    process.exit(2);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const supportJs = readFileSync(join(SUPPORT_DIR, 'test_helper.js'), 'utf8');
  const supportCss = readFileSync(join(SUPPORT_DIR, 'test_base_style.css'), 'utf8');

  let failures = 0;
  let total = 0;
  for (const file of files) {
    const tree = JSON.parse(readFileSync(join(dir, file), 'utf8')) as FuzzTree & {
      viewport: FuzzTree['viewport'] | null;
    };
    if (tree.viewport === null) delete (tree as { viewport?: unknown }).viewport;

    const html = fuzzTreeToHtml(tree, { support: 'inline', supportJs, supportCss });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
    const data = JSON.parse((await page.evaluate('getTestData()')) as string) as Record<
      string,
      Record<string, unknown>
    >;

    for (const [key, suffix] of VARIANTS) {
      total += 1;
      const xml = generateTestXml(`probe__${suffix}`, data[key] as Parameters<typeof generateTestXml>[1]);
      const fixture = parseFixture(xml);
      computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
      const out: Mismatch[] = [];
      collect(fixture.root, fixture.expected, 'root', out);
      const name = `${basename(file, '.json')} ${suffix}`;
      if (out.length === 0) {
        if (verbose) console.log(`PASS ${name}`);
      } else {
        failures += 1;
        console.log(`FAIL ${name}`);
        for (const m of out) console.log(`       ${m.path}: chrome=${m.chrome} engine=${m.engine}`);
      }
    }
  }
  await browser.close();
  console.log(`\n${total - failures}/${total} variants pass`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
