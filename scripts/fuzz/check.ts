// One tree, one verdict: render in pinned Chrome, extract the four
// box-sizing/direction variants, push each through the real fixture pipeline
// (generateTestXml -> parseFixture -> computeLayout) and diff at the harness
// tolerance. Judging through that pipeline is what guarantees every finding
// reproduces as a failing XML regression fixture.
//
// Shared by scripts/fuzz.ts (one finding at a time) and scripts/fuzz-batch.ts
// (whole batches, several pages in flight).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'puppeteer';
import { unreachable } from '../../src/assert.js';
import type { LayoutNode } from '../../src/index.js';
import { computeLayout } from '../../src/index.js';
import type { ExpectedNode } from '../../tests/harness/fixture.js';
import { parseFixture } from '../../tests/harness/fixture.js';
import { generateTestXml } from '../gentest.js';
import type { FuzzTree } from './generate.js';
import { DEFAULT_PAGE_VIEWPORT } from './oracle.js';
import { fuzzTreeToHtml } from './serialize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPPORT_DIR = join(ROOT, 'tests', 'html', 'support');

export const TOLERANCE = 0.1;

const MAX_INTRINSIC_VIEWPORT_WIDTH = 163_840;

export const VARIANTS = [
  ['borderBoxLtrData', 'border_box_ltr'],
  ['contentBoxLtrData', 'content_box_ltr'],
  ['borderBoxRtlData', 'border_box_rtl'],
  ['contentBoxRtlData', 'content_box_rtl'],
] as const;

export interface Mismatch {
  variant: string;
  path: string;
  axis: 'x' | 'y' | 'width' | 'height';
  expected: number;
  actual: number;
}

export interface Executor {
  page: Page;
  supportJs: string;
  supportCss: string;
}

type ChromeData = Record<string, Record<string, unknown>>;

export async function createExecutor(browser: Browser): Promise<Executor> {
  const page = await browser.newPage();
  await page.setViewport({ ...DEFAULT_PAGE_VIEWPORT, deviceScaleFactor: 1 });
  return {
    page,
    supportJs: readFileSync(join(SUPPORT_DIR, 'test_helper.js'), 'utf8'),
    supportCss: readFileSync(join(SUPPORT_DIR, 'test_base_style.css'), 'utf8'),
  };
}

export function collectMismatches(
  node: LayoutNode,
  expected: ExpectedNode,
  path: string,
  variant: string,
  out: Mismatch[],
): void {
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
    collectMismatches(
      node.children[i] ?? unreachable(),
      expected.children[i] ?? unreachable(),
      `${path}/${i}`,
      variant,
      out,
    );
  }
}

async function renderData(
  exec: Executor,
  tree: FuzzTree,
  pageViewport: { width: number; height: number },
): Promise<ChromeData> {
  await exec.page.setViewport({ ...pageViewport, deviceScaleFactor: 1 });
  const html = fuzzTreeToHtml(tree, {
    support: 'inline',
    supportJs: exec.supportJs,
    supportCss: exec.supportCss,
  });
  await exec.page.setContent(html, { waitUntil: 'load' });
  await exec.page.evaluate(() => (document as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
  const raw = (await exec.page.evaluate('getTestData()')) as string;
  return JSON.parse(raw) as ChromeData;
}

function rootTouchesInlineViewport(data: ChromeData, viewportWidth: number): boolean {
  return VARIANTS.some(([key]) => {
    const layout = data[key]?.unroundedLayout as { width?: unknown } | undefined;
    return typeof layout?.width !== 'number' || layout.width >= viewportWidth - TOLERANCE;
  });
}

async function renderOracleData(exec: Executor, tree: FuzzTree): Promise<ChromeData> {
  if (tree.pageViewport !== undefined) return renderData(exec, tree, tree.pageViewport);

  let viewport: { width: number; height: number } = { ...DEFAULT_PAGE_VIEWPORT };
  let data = await renderData(exec, tree, viewport);
  if (tree.viewport !== undefined || !rootTouchesInlineViewport(data, viewport.width)) return data;

  // A fixture that records max-content must not freeze geometry constrained by
  // Puppeteer's finite initial containing block. Grow the page until the whole
  // extracted verdict is identical at two successive widths. The generator's
  // root contract excludes viewport-relative root styles, so stabilization is
  // equivalent to reaching the intrinsic result without changing the DOM.
  let signature = JSON.stringify(data);
  while (viewport.width < MAX_INTRINSIC_VIEWPORT_WIDTH) {
    viewport = { width: Math.min(viewport.width * 2, MAX_INTRINSIC_VIEWPORT_WIDTH), height: viewport.height };
    const widerData = await renderData(exec, tree, viewport);
    const widerSignature = JSON.stringify(widerData);
    if (widerSignature === signature) return widerData;
    data = widerData;
    signature = widerSignature;
  }
  throw new Error(`max-content oracle did not stabilize by ${MAX_INTRINSIC_VIEWPORT_WIDTH}px: ${JSON.stringify(tree)}`);
}

function expectedFixtureViewport(tree: FuzzTree): { width: number | 'max-content'; height: number | 'max-content' } {
  return tree.pageViewport ?? tree.viewport ?? { width: 'max-content', height: 'max-content' };
}

/** Chrome's verdict for one tree, as the four fixture XMLs the harness parses.
 *  Captured once so a finding can be re-judged later without a browser. */
export async function renderFixtures(exec: Executor, tree: FuzzTree): Promise<Record<string, string>> {
  const data = await renderOracleData(exec, tree);
  const expectedViewport = expectedFixtureViewport(tree);

  const xmls: Record<string, string> = {};
  for (const [key, suffix] of VARIANTS) {
    const xml = generateTestXml(`fuzz__${suffix}`, data[key] as Parameters<typeof generateTestXml>[1]);
    const actualViewport = parseFixture(xml).viewport;
    if (actualViewport.width !== expectedViewport.width || actualViewport.height !== expectedViewport.height) {
      throw new Error(
        `Chrome oracle viewport ${JSON.stringify(actualViewport)} does not match fuzz input ${JSON.stringify(expectedViewport)}`,
      );
    }
    xmls[suffix] = xml;
  }
  return xmls;
}

/** Re-judge captured fixtures against the current engine — no browser needed. */
export function checkFixtures(xmls: Record<string, string>): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const [, suffix] of VARIANTS) {
    const xml = xmls[suffix];
    if (xml === undefined) continue;
    const fixture = parseFixture(xml);
    computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
    collectMismatches(fixture.root, fixture.expected, 'root', suffix, mismatches);
  }
  return mismatches;
}

export async function checkTree(exec: Executor, tree: FuzzTree): Promise<Mismatch[]> {
  return checkFixtures(await renderFixtures(exec, tree));
}
