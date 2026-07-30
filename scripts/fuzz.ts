// Differential fuzzer: engine vs pinned Chrome.
//
// For each seeded random tree: render its HTML in headless Chrome, extract the
// four box-sizing/direction variants with the gentest helper, convert each to
// fixture XML (generateTestXml), parse it back with the conformance harness
// (parseFixture), lay it out with the engine, and compare at the harness
// tolerance. Judging mismatches through the exact fixture pipeline guarantees
// every persisted finding reproduces as a failing XML regression fixture.
//
// A mismatch is re-checked from its seed before shrinking (flake guard), shrunk
// to a near-minimal reproduction, filtered against known-divergence signatures,
// and written to tests/html/fuzz-found/ for `pnpm gentest` to pick up.
//
// Usage: pnpm fuzz [--seed N] [--iterations N] [--mode flex|grid|block|mixed]
//                  [--only N] [--max-findings N] [--no-write]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import { computeLayout } from '../src/index.js';
import type { Node } from '../src/index.js';
import { parseFixture } from '../tests/harness/fixture.js';
import type { ExpectedNode } from '../tests/harness/fixture.js';
import { generateTestXml } from './gentest.js';
import { countNodes, generateTree, treeRespectsPercentInvariant } from './fuzz/generate.js';
import type { FuzzMode, FuzzTree } from './fuzz/generate.js';
import { deriveSeed } from './fuzz/prng.js';
import { signatureHash, treeSignature } from './fuzz/signature.js';
import { fuzzTreeToHtml } from './fuzz/serialize.js';
import { shrinkTree } from './fuzz/shrink.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUPPORT_DIR = join(ROOT, 'tests', 'html', 'support');
const FUZZ_FOUND_DIR = join(ROOT, 'tests', 'html', 'fuzz-found');
const DIVERGENCES_FILE = join(FUZZ_FOUND_DIR, 'known-divergences.json');
const TOLERANCE = 0.1;

const VARIANTS = [
  ['borderBoxLtrData', 'border_box_ltr'],
  ['contentBoxLtrData', 'content_box_ltr'],
  ['borderBoxRtlData', 'border_box_rtl'],
  ['contentBoxRtlData', 'content_box_rtl'],
] as const;

// --- Comparison --------------------------------------------------------------

export interface Mismatch {
  variant: string;
  path: string;
  axis: 'x' | 'y' | 'width' | 'height';
  expected: number;
  actual: number;
}

function collectMismatches(node: Node, expected: ExpectedNode, path: string, variant: string, out: Mismatch[]): void {
  // A display:none node has no box, so Chrome's getBoundingClientRect returns
  // all zeros and the extractor reports x/y as `0 - parentOrigin` — a negative
  // offset that tracks the parent's position rather than any layout decision.
  // Its SIZE is still meaningful (both sides must agree it is 0x0), so compare
  // that and skip the coordinates. Not an engine divergence: the vendored
  // corpus only ever places hidden nodes under parents at the origin, where
  // the artifact is invisible.
  const isHidden = node.style.display === 'none';
  const { location, size } = node.layout;
  const checks: [Mismatch['axis'], number, number][] = isHidden
    ? [
        ['width', expected.width, size.width],
        ['height', expected.height, size.height],
      ]
    : [
        ['x', expected.x, location.x],
        ['y', expected.y, location.y],
        ['width', expected.width, size.width],
        ['height', expected.height, size.height],
      ];
  for (const [axis, exp, act] of checks) {
    if (Math.abs(exp - act) >= TOLERANCE) out.push({ variant, path, axis, expected: exp, actual: act });
  }
  // Child-count mismatch is structurally impossible (both sides come from the
  // same extraction) — walk the overlap defensively anyway.
  const n = Math.min(node.children.length, expected.children.length);
  for (let i = 0; i < n; i++) {
    collectMismatches(node.children[i]!, expected.children[i]!, `${path}/${i}`, variant, out);
  }
}

// --- Chrome execution --------------------------------------------------------

interface Executor {
  page: Page;
  supportJs: string;
  supportCss: string;
}

async function checkTree(exec: Executor, tree: FuzzTree): Promise<Mismatch[]> {
  const html = fuzzTreeToHtml(tree, {
    support: 'inline',
    supportJs: exec.supportJs,
    supportCss: exec.supportCss,
  });
  await exec.page.setContent(html, { waitUntil: 'load' });
  await exec.page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  const raw = (await exec.page.evaluate('getTestData()')) as string;
  const data = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  const mismatches: Mismatch[] = [];
  for (const [key, suffix] of VARIANTS) {
    const xml = generateTestXml(`fuzz__${suffix}`, data[key] as Parameters<typeof generateTestXml>[1]);
    const fixture = parseFixture(xml);
    computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
    collectMismatches(fixture.root, fixture.expected, 'root', suffix, mismatches);
  }
  return mismatches;
}

// --- Known-divergence signatures (design decision 3) --------------------------

interface KnownDivergence {
  signature: string;
  name: string;
  reason: string;
}

function loadKnownDivergences(): KnownDivergence[] {
  if (!existsSync(DIVERGENCES_FILE)) return [];
  return JSON.parse(readFileSync(DIVERGENCES_FILE, 'utf8')) as KnownDivergence[];
}

// --- Persistence (failure-to-fixture) ----------------------------------------

function persistFinding(tree: FuzzTree, meta: { seed: number; index: number; chrome: string }): string {
  const hash = signatureHash(treeSignature(tree));
  const name = `fuzz_${hash}`;
  const html = fuzzTreeToHtml(tree, {
    support: 'relative',
    title: `Fuzz-found conformance mismatch (${name})`,
    headerComment: [
      `fuzz-found: seed=${meta.seed} index=${meta.index}`,
      `date: ${new Date().toISOString().slice(0, 10)}`,
      `chrome: ${meta.chrome}`,
      `Regenerate the XML fixtures with: pnpm gentest ${name}`,
    ],
  });
  mkdirSync(FUZZ_FOUND_DIR, { recursive: true });
  const file = join(FUZZ_FOUND_DIR, `${name}.html`);
  writeFileSync(file, html);
  return file;
}

// --- CLI driver --------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const seed = Number(argValue('--seed') ?? (Date.now() >>> 0));
  const iterations = Number(argValue('--iterations') ?? 200);
  const mode = (argValue('--mode') ?? 'mixed') as FuzzMode;
  const only = argValue('--only') !== undefined ? Number(argValue('--only')) : null;
  const maxFindings = Number(argValue('--max-findings') ?? 5);
  const write = !process.argv.includes('--no-write');

  if (!['flex', 'grid', 'block', 'mixed'].includes(mode)) {
    console.error(`unknown mode: ${mode}`);
    process.exit(2);
  }

  console.log(`fuzz: seed=${seed} iterations=${iterations} mode=${mode}${only !== null ? ` only=${only}` : ''}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const chrome = await browser.version();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  const exec: Executor = {
    page,
    supportJs: readFileSync(join(SUPPORT_DIR, 'test_helper.js'), 'utf8'),
    supportCss: readFileSync(join(SUPPORT_DIR, 'test_base_style.css'), 'utf8'),
  };
  const known = loadKnownDivergences();

  const indices = only !== null ? [only] : Array.from({ length: iterations }, (_, i) => i);
  const startTime = Date.now();
  let checked = 0;
  let findings = 0;
  let knownSkipped = 0;

  for (const index of indices) {
    const treeSeed = deriveSeed(seed, index);
    const tree = generateTree(treeSeed, mode);
    const mismatches = await checkTree(exec, tree);
    checked++;

    if (mismatches.length === 0) continue;

    // Flake guard: regenerate from seed and re-render before believing it.
    const recheck = await checkTree(exec, generateTree(treeSeed, mode));
    if (recheck.length === 0) {
      console.warn(`tree ${index}: mismatch did not reproduce on re-check — ignored (flake)`);
      continue;
    }

    console.log(`\ntree ${index} (seed ${treeSeed}, ${countNodes(tree.root)} nodes): ${recheck.length} mismatch(es)`);

    const shrunk = await shrinkTree(
      tree,
      async (candidate) => (await checkTree(exec, candidate)).length > 0,
      250,
      treeRespectsPercentInvariant,
    );
    const minimal = shrunk.tree;
    const finalMismatches = await checkTree(exec, minimal);
    console.log(
      `  shrunk to ${countNodes(minimal.root)} nodes in ${shrunk.checks} checks` +
        (shrunk.budgetExhausted ? ' (budget exhausted)' : ''),
    );

    const signature = treeSignature(minimal);
    const knownMatch = known.find((k) => k.signature === signature);
    if (knownMatch) {
      knownSkipped++;
      console.log(`  matches known divergence '${knownMatch.name}' — skipped`);
      continue;
    }

    findings++;
    console.log(`  minimized: ${treeSignature(minimal)}`);
    for (const m of finalMismatches.slice(0, 8)) {
      console.log(`  ${m.variant} ${m.path} ${m.axis}: chrome=${m.expected} engine=${m.actual}`);
    }
    if (finalMismatches.length > 8) console.log(`  … and ${finalMismatches.length - 8} more`);
    console.log(`  reproduce: pnpm fuzz --seed ${seed} --only ${index} --mode ${mode}`);

    if (write) {
      const file = persistFinding(minimal, { seed, index, chrome });
      console.log(`  persisted: ${file}`);
    }

    if (findings >= maxFindings) {
      console.log(`\nstopping at ${maxFindings} findings (--max-findings)`);
      break;
    }
  }

  await browser.close();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(
    `\nchecked ${checked} trees in ${elapsed.toFixed(1)}s (${(checked / elapsed).toFixed(1)} trees/s) — ` +
      `${findings} finding(s)${knownSkipped > 0 ? `, ${knownSkipped} known divergence(s) skipped` : ''}`,
  );
  process.exit(findings > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
