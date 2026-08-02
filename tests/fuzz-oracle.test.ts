import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecutor, renderFixtures } from '../scripts/fuzz/check.js';
import type { FuzzTree } from '../scripts/fuzz/generate.js';
import { treeRespectsPercentInvariant } from '../scripts/fuzz/generate.js';
import { oracleConstraintAt, treeRespectsOracleInvariant, withOracleConstraint } from '../scripts/fuzz/oracle.js';
import { fuzzTreeToHtml } from '../scripts/fuzz/serialize.js';
import { treeSignature } from '../scripts/fuzz/signature.js';
import { parseFixture } from './harness/fixture.js';

describe('fuzz oracle available space', () => {
  let browser: Browser;
  let exec: Awaited<ReturnType<typeof createExecutor>>;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
    });
    exec = await createExecutor(browser);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('records a definite page viewport without wrapping the root', async () => {
    const tree: FuzzTree = {
      pageViewport: { width: 70, height: 80 },
      root: {
        style: {},
        children: [{ style: {}, children: [], text: 'HHHHH\u200bHHHHH' }],
      },
    };
    const html = fuzzTreeToHtml(tree, { support: 'inline' });

    expect(html).toContain('data-test-page-viewport-width="70"');
    expect(html).not.toContain('class="viewport"');

    const fixtures = await renderFixtures(exec, tree);
    const fixture = parseFixture(fixtures.border_box_ltr ?? '');

    expect(fixture.viewport).toEqual({ width: 70, height: 80 });
    expect(fixture.expected.width).toBe(70);
    expect(fixture.expected.height).toBe(20);
  });

  it('stabilizes an intrinsic oracle before recording max-content', async () => {
    const tree: FuzzTree = {
      root: {
        style: {},
        children: [{ style: {}, children: [], text: `${'H'.repeat(65)}\u200b${'H'.repeat(65)}` }],
      },
    };

    const fixtures = await renderFixtures(exec, tree);
    const fixture = parseFixture(fixtures.border_box_ltr ?? '');

    expect(fixture.viewport).toEqual({ width: 'max-content', height: 'max-content' });
    expect(fixture.expected.width).toBe(1300);
    expect(fixture.expected.height).toBe(10);
  });

  it('alternates mixed campaigns and keeps the oracle in the signature', () => {
    const base: FuzzTree = { root: { style: {}, children: [] } };
    const intrinsic = withOracleConstraint(base, oracleConstraintAt('mixed', 0));
    const viewport = withOracleConstraint(base, oracleConstraintAt('mixed', 1));

    expect(intrinsic.pageViewport).toBeUndefined();
    expect(viewport.pageViewport).toEqual({ width: 1280, height: 800 });
    expect(treeSignature(intrinsic)).not.toBe(treeSignature(viewport));
  });

  it('rejects root percentages only when the containing block is intrinsic', () => {
    const rootPercentage: FuzzTree = {
      root: {
        style: { padding: { left: 0, right: { percent: 1 }, top: 0, bottom: 0 } },
        children: [],
      },
    };

    expect(treeRespectsPercentInvariant(rootPercentage)).toBe(false);
    expect(treeRespectsPercentInvariant(withOracleConstraint(rootPercentage, 'viewport'))).toBe(true);
  });

  it('keeps root auto-repeat grids in a definite oracle during generation and shrinking', () => {
    const autoRepeat: FuzzTree = {
      root: {
        style: {
          display: 'grid',
          gridTemplateColumns: [{ repeat: 'auto-fit', tracks: [{ min: 'auto', max: 0 }] }],
        },
        children: [{ style: {}, children: [] }],
      },
    };

    const constrained = withOracleConstraint(autoRepeat, 'intrinsic');
    expect(constrained.pageViewport).toEqual({ width: 1280, height: 800 });
    expect(treeRespectsOracleInvariant(autoRepeat)).toBe(false);
    expect(treeRespectsOracleInvariant(constrained)).toBe(true);
  });

  it('keeps inset-stretched absolute roots in a definite oracle', () => {
    const stretched: FuzzTree = {
      root: {
        style: {
          position: 'absolute',
          inset: { left: 0, right: 0, top: 'auto', bottom: 'auto' },
        },
        children: [],
      },
    };

    expect(withOracleConstraint(stretched, 'intrinsic').pageViewport).toEqual({ width: 1280, height: 800 });
    expect(treeRespectsOracleInvariant(stretched)).toBe(false);
  });

  it('keeps auto-width in-flow roots in a definite oracle', () => {
    const inFlow: FuzzTree = {
      root: { style: { display: 'grid', position: 'relative', aspectRatio: 1 }, children: [] },
    };

    expect(withOracleConstraint(inFlow, 'intrinsic').pageViewport).toEqual({ width: 1280, height: 800 });
    expect(treeRespectsOracleInvariant(inFlow)).toBe(false);
  });
});
