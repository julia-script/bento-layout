// One-command diagnosis matrix:
//   resolve a tree/finding -> minimize it -> generate one-property mutations ->
//   compare every probe against pinned Chrome using one browser process.
//
// Usage:
//   pnpm exec tsx scripts/fuzz-matrix.ts '<tree-json>'
//   pnpm exec tsx scripts/fuzz-matrix.ts <finding-id> --properties aspectRatio,alignItems
//   pnpm exec tsx scripts/fuzz-matrix.ts tree.json --no-minimize --max-probes 60

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { latestBatchPath } from './fuzz/analysis.js';
import { checkTree, createExecutor } from './fuzz/check.js';
import type { FuzzTree } from './fuzz/generate.js';
import { countNodes } from './fuzz/generate.js';
import { generateMatrixProbes } from './fuzz/matrix.js';
import { shrinkTree } from './fuzz/shrink.js';
import { loadBatch } from './fuzz-batch.js';

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArg(): string | undefined {
  const valueFlags = new Set(['--batch', '--max-checks', '--max-probes', '--properties', '--out-dir']);
  for (let i = 2; i < process.argv.length; i++) {
    const value = process.argv[i];
    if (value === undefined || value.startsWith('--')) continue;
    if (valueFlags.has(process.argv[i - 1] ?? '')) continue;
    return value;
  }
  return undefined;
}

function readTree(arg: string): FuzzTree {
  if (existsSync(arg)) return JSON.parse(readFileSync(arg, 'utf8')) as FuzzTree;
  if (arg.startsWith('{')) return JSON.parse(arg) as FuzzTree;
  const batch = loadBatch(flagValue('--batch') ?? latestBatchPath());
  const finding = batch.findings.find(({ id }) => id === arg);
  if (finding === undefined) throw new Error(`no finding ${arg} in the selected batch`);
  return finding.tree;
}

async function main(): Promise<void> {
  const arg = positionalArg();
  if (arg === undefined) {
    console.error('usage: pnpm exec tsx scripts/fuzz-matrix.ts <tree-json|file|finding-id> [options]');
    process.exitCode = 2;
    return;
  }
  let tree = readTree(arg);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
  });
  const exec = await createExecutor(browser);

  try {
    const initial = await checkTree(exec, tree);
    if (initial.length === 0) throw new Error('input currently matches Chrome; no failing matrix to build');
    if (!process.argv.includes('--no-minimize')) {
      const anchor = initial[0];
      const maxChecks = Number(flagValue('--max-checks') ?? 300);
      console.error(
        `minimizing ${countNodes(tree.root)} node(s), preserving ${anchor?.variant} ${anchor?.path} ${anchor?.axis}...`,
      );
      const shrunk = await shrinkTree(
        tree,
        async (candidate) => {
          const mismatches = await checkTree(exec, candidate);
          return mismatches.some(
            (mismatch) =>
              mismatch.variant === anchor?.variant && mismatch.path === anchor.path && mismatch.axis === anchor.axis,
          );
        },
        maxChecks,
      );
      tree = shrunk.tree;
      console.error(
        `${countNodes(tree.root)} node(s), ${shrunk.checks} checks${shrunk.budgetExhausted ? ' (budget exhausted)' : ''}`,
      );
    }

    const requested = flagValue('--properties');
    const properties = requested === undefined ? undefined : new Set(requested.split(',').filter(Boolean));
    const probes = generateMatrixProbes(tree, {
      ...(properties === undefined ? {} : { properties }),
      maxProbes: Number(flagValue('--max-probes') ?? 40),
    });
    const outDir = flagValue('--out-dir');
    if (outDir !== undefined) mkdirSync(outDir, { recursive: true });

    let passingVariants = 0;
    let totalVariants = 0;
    for (const probe of probes) {
      if (outDir !== undefined) writeFileSync(join(outDir, `${probe.name}.json`), `${JSON.stringify(probe.tree)}\n`);
      const mismatches = await checkTree(exec, probe.tree);
      const byVariant = new Map<string, typeof mismatches>();
      for (const mismatch of mismatches) {
        const list = byVariant.get(mismatch.variant) ?? [];
        list.push(mismatch);
        byVariant.set(mismatch.variant, list);
      }
      for (const variant of ['border_box_ltr', 'content_box_ltr', 'border_box_rtl', 'content_box_rtl']) {
        totalVariants++;
        const failures = byVariant.get(variant) ?? [];
        if (failures.length === 0) {
          passingVariants++;
          console.log(`PASS ${probe.name} ${variant}`);
        } else {
          console.log(`FAIL ${probe.name} ${variant}`);
          for (const mismatch of failures.slice(0, 4)) {
            console.log(
              `     ${mismatch.path} ${mismatch.axis}: chrome=${mismatch.expected} engine=${mismatch.actual}`,
            );
          }
        }
      }
    }
    console.log(`\n${passingVariants}/${totalVariants} variants pass across ${probes.length} one-property probe(s)`);
    console.log(`minimized baseline: ${JSON.stringify(tree)}`);
    process.exitCode = passingVariants === totalVariants ? 0 : 1;
  } finally {
    await browser.close();
  }
}

await main();
