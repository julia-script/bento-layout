// Batch collector for differential-fuzzing findings.
//
// Where `pnpm fuzz` stops at the first few findings so you can fix one tree at
// a time, this walks a whole seed range, shrinks every mismatch, dedupes by
// canonical signature, and writes the batch to a single JSON file. The batch is
// then a fixed target: fix engine code, re-run `pnpm fuzz-batch-status`, watch
// the open count fall. Collect the next batch when this one is empty.
//
// Findings are appended as they are shrunk, so killing the run mid-flight still
// leaves a usable batch file.
//
// Usage: pnpm fuzz-batch [--seed N] [--iterations N] [--mode flex|grid|block|mixed]
//                        [--target N] [--concurrency N] [--out FILE] [--append]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { checkFixtures, checkTree, createExecutor, renderFixtures, type Executor } from './fuzz/check.js';
import { countNodes, generateTree, treeRespectsPercentInvariant } from './fuzz/generate.js';
import type { FuzzMode, FuzzTree } from './fuzz/generate.js';
import { deriveSeed } from './fuzz/prng.js';
import { signatureHash, treeSignature } from './fuzz/signature.js';
import { shrinkTree } from './fuzz/shrink.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_DIR = join(ROOT, 'tests', 'fuzz-batches');

export interface BatchFinding {
  /** FNV-1a hash of the shrunk signature — stable id across runs. */
  id: string;
  /** Reproduction: `pnpm fuzz --seed <seed> --only <index> --mode <mode>`. */
  seed: number;
  index: number;
  mode: FuzzMode;
  nodes: number;
  /** Shrunk tree, ready for `pnpm fuzz-triage '<json>'`. */
  tree: FuzzTree;
  /** Chrome's verdict, frozen as the four fixture XMLs the harness parses.
   *  Lets `fuzz-batch-status` re-judge the finding with no browser. */
  fixtures: Record<string, string>;
  /** One line per differing box, at collection time. */
  mismatches: { variant: string; path: string; axis: string; expected: number; actual: number }[];
}

export interface Batch {
  createdAt: string;
  chrome: string;
  findings: BatchFinding[];
}

export function loadBatch(file: string): Batch {
  return JSON.parse(readFileSync(file, 'utf8')) as Batch;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Run `worker` over indices with `concurrency` in flight; stop when `done()`. */
async function pool(
  indices: number[],
  concurrency: number,
  done: () => boolean,
  worker: (index: number, slot: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, slot) => {
      while (!done()) {
        const i = next++;
        if (i >= indices.length) return;
        await worker(indices[i] as number, slot);
      }
    }),
  );
}

async function main(): Promise<void> {
  const seed = Number(argValue('--seed') ?? (Date.now() >>> 0));
  const iterations = Number(argValue('--iterations') ?? 20000);
  const mode = (argValue('--mode') ?? 'mixed') as FuzzMode;
  const target = Number(argValue('--target') ?? 1000);
  const concurrency = Number(argValue('--concurrency') ?? 8);
  const append = process.argv.includes('--append');

  if (!['flex', 'grid', 'block', 'mixed'].includes(mode)) {
    console.error(`unknown mode: ${mode}`);
    process.exit(2);
  }

  mkdirSync(BATCH_DIR, { recursive: true });
  const out = argValue('--out') ?? join(BATCH_DIR, `batch-${seed}-${mode}.json`);

  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const chrome = await browser.version();
  const execs: Executor[] = [];
  for (let i = 0; i < concurrency; i++) execs.push(await createExecutor(browser));

  const findings: BatchFinding[] = append && existsSync(out) ? loadBatch(out).findings : [];
  const seen = new Set(findings.map((f) => f.id));
  const startedWith = findings.length;

  console.log(
    `fuzz-batch: seed=${seed} iterations=${iterations} mode=${mode} target=${target} ` +
      `concurrency=${concurrency}${startedWith > 0 ? ` (resuming from ${startedWith})` : ''}\n  out: ${out}`,
  );

  const started = Date.now();
  let checked = 0;
  let duplicates = 0;
  const flush = (): void =>
    writeFileSync(out, `${JSON.stringify({ createdAt: new Date().toISOString(), chrome, findings }, null, 2)}\n`);

  await pool(
    Array.from({ length: iterations }, (_, i) => i),
    concurrency,
    () => findings.length >= target,
    async (index, slot) => {
      const exec = execs[slot] as Executor;
      const treeSeed = deriveSeed(seed, index);
      const tree = generateTree(treeSeed, mode);
      const mismatches = await checkTree(exec, tree);
      checked++;
      if (checked % 50 === 0) {
        const rate = checked / ((Date.now() - started) / 1000);
        console.log(
          `  … ${checked} checked, ${findings.length}/${target} findings, ` +
            `${duplicates} dup (${rate.toFixed(1)} trees/s)`,
        );
      }
      if (mismatches.length === 0) return;

      // Flake guard, same as `pnpm fuzz`: regenerate and re-render before
      // spending a shrink budget on it.
      if ((await checkTree(exec, generateTree(treeSeed, mode))).length === 0) return;

      const shrunk = await shrinkTree(
        tree,
        async (candidate) => (await checkTree(exec, candidate)).length > 0,
        250,
        treeRespectsPercentInvariant,
      );
      const minimal = shrunk.tree;
      const id = signatureHash(treeSignature(minimal));
      if (seen.has(id)) {
        duplicates++;
        return;
      }
      seen.add(id);
      const fixtures = await renderFixtures(exec, minimal);
      findings.push({
        id,
        seed,
        index,
        mode,
        nodes: countNodes(minimal.root),
        tree: minimal,
        fixtures,
        mismatches: checkFixtures(fixtures).map((m) => ({
          variant: m.variant,
          path: m.path,
          axis: m.axis,
          expected: m.expected,
          actual: m.actual,
        })),
      });
      flush();
    },
  );

  flush();
  await browser.close();

  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `\nchecked ${checked} trees in ${elapsed.toFixed(1)}s — ` +
      `${findings.length - startedWith} new finding(s), ${duplicates} duplicate(s) collapsed\n` +
      `batch: ${out} (${findings.length} open)`,
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
