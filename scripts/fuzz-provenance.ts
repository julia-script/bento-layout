// Explain a fuzz mismatch using the engine's opt-in sizing trace. Frozen batch
// findings need no browser; arbitrary trees are rendered once in pinned Chrome.
//
//   pnpm exec tsx scripts/fuzz-provenance.ts <finding-id>
//   pnpm exec tsx scripts/fuzz-provenance.ts '<tree-json>' --path root/0

import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { computeLayout, type LayoutTraceEvent } from '../src/index.js';
import { parseFixture } from '../tests/harness/fixture.js';
import { latestBatchPath } from './fuzz/analysis.js';
import { collectMismatches, createExecutor, type Mismatch, renderFixtures, VARIANTS } from './fuzz/check.js';
import type { FuzzTree } from './fuzz/generate.js';
import { loadBatch } from './fuzz-batch.js';

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArg(): string | undefined {
  const valueFlags = new Set(['--batch', '--path']);
  for (let index = 2; index < process.argv.length; index++) {
    const value = process.argv[index];
    if (value === undefined || value.startsWith('--')) continue;
    if (valueFlags.has(process.argv[index - 1] ?? '')) continue;
    return value;
  }
  return undefined;
}

async function resolveFixtures(arg: string): Promise<{ label: string; fixtures: Record<string, string> }> {
  if (!arg.startsWith('{') && !existsSync(arg)) {
    const batch = loadBatch(flagValue('--batch') ?? latestBatchPath());
    const finding = batch.findings.find(({ id }) => id === arg);
    if (finding !== undefined) return { label: finding.id, fixtures: finding.fixtures };
  }

  const tree = JSON.parse(existsSync(arg) ? readFileSync(arg, 'utf8') : arg) as FuzzTree;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
  });
  try {
    const exec = await createExecutor(browser);
    return { label: existsSync(arg) ? arg : 'inline tree', fixtures: await renderFixtures(exec, tree) };
  } finally {
    await browser.close();
  }
}

function pathRelated(eventPath: string, mismatchPath: string): boolean {
  return (
    eventPath === mismatchPath || eventPath.startsWith(`${mismatchPath}/`) || mismatchPath.startsWith(`${eventPath}/`)
  );
}

async function main(): Promise<void> {
  const arg = positionalArg();
  if (arg === undefined) {
    console.error('usage: pnpm exec tsx scripts/fuzz-provenance.ts <tree-json|file|finding-id> [--path root/0]');
    process.exitCode = 2;
    return;
  }

  const { label, fixtures } = await resolveFixtures(arg);
  const requestedPath = flagValue('--path');
  let mismatchCount = 0;
  console.log(`provenance for ${label}`);

  for (const [, variant] of VARIANTS) {
    const xml = fixtures[variant];
    if (xml === undefined) continue;
    const fixture = parseFixture(xml);
    const events: LayoutTraceEvent[] = [];
    computeLayout(fixture.root, fixture.viewport, {
      rounding: fixture.useRounding,
      trace: (event) => events.push(event),
    });
    const mismatches: Mismatch[] = [];
    collectMismatches(fixture.root, fixture.expected, 'root', variant, mismatches);
    const selected = requestedPath === undefined ? mismatches : mismatches.filter(({ path }) => path === requestedPath);
    if (selected.length === 0) continue;

    console.log(`\n${variant}`);
    for (const mismatch of selected) {
      mismatchCount++;
      console.log(
        `  ${mismatch.path} ${mismatch.axis}: expected=${mismatch.expected}, actual=${mismatch.actual}, ` +
          `delta=${(mismatch.actual - mismatch.expected).toFixed(2)}`,
      );
      const relevant = events.filter(({ path }) => pathRelated(path, mismatch.path));
      for (const event of relevant) {
        console.log(
          `    ${event.path.padEnd(12)} ${event.axis.padEnd(6)} ${event.source.padEnd(17)} ` +
            `${String(event.value).padStart(8)}  ${event.phase}${event.detail === undefined ? '' : ` — ${event.detail}`}`,
        );
      }
    }
  }

  if (mismatchCount === 0) {
    console.log(
      requestedPath === undefined ? '\nNo current mismatches.' : `\nNo current mismatches at ${requestedPath}.`,
    );
  }
}

await main();
