// Portable seed manifest for a fuzz batch.
//
// A batch file carries every finding's shrunk tree plus Chrome's frozen
// verdict, which makes it fast but several MB — too big to track. The manifest
// keeps only what a finding is *derived* from: `(seed, index, mode, oracle)`. That is a
// few tens of KB, commits cleanly, and rehydrates into a full batch on any
// machine with the pinned Chrome.
//
// The shrunk tree is deliberately NOT stored. Shrinking asks the current engine
// which candidates still fail, so a tree minimized before a fix is not the
// minimum after it. Re-shrinking on rehydrate keeps reproductions honest, and
// findings that a fix already resolved simply drop out.
//
// Usage: pnpm fuzz-batch-manifest save [BATCH] [--out FILE]
//        pnpm fuzz-batch-manifest rehydrate [MANIFEST] [--out FILE] [--concurrency N]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { checkFixtures, checkTree, createExecutor, type Executor, renderFixtures } from './fuzz/check.js';
import type { FuzzMode } from './fuzz/generate.js';
import { countNodes, generateTree } from './fuzz/generate.js';
import type { FuzzOracleConstraint } from './fuzz/oracle.js';
import { oracleConstraintOf, treeRespectsOracleInvariant, withOracleConstraint } from './fuzz/oracle.js';
import { deriveSeed } from './fuzz/prng.js';
import { shrinkTree } from './fuzz/shrink.js';
import { signatureHash, treeSignature } from './fuzz/signature.js';
import { type Batch, type BatchFinding, loadBatch } from './fuzz-batch.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_DIR = join(ROOT, 'tests', 'fuzz-batches');
const DEFAULT_MANIFEST = join(ROOT, 'tests', 'fuzz-seeds.json');

interface ManifestEntry {
  seed: number;
  index: number;
  mode: FuzzMode;
  /** Absent in legacy manifests means the historical 1280×800 page viewport. */
  oracle?: FuzzOracleConstraint;
}

interface Manifest {
  /** Chrome the seeds were collected against — a different build may diverge. */
  chrome: string;
  createdAt: string;
  entries: ManifestEntry[];
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function latestBatch(): string {
  const files = readdirSync(BATCH_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`no batches in ${BATCH_DIR} — collect one with: pnpm fuzz-batch`);
    process.exit(2);
  }
  return join(BATCH_DIR, files.sort().at(-1) as string);
}

/** batch -> manifest: keep the derivation, drop the derived. */
function save(): void {
  const args = process.argv.slice(3);
  const batchFile = args.find((a) => !a.startsWith('--')) ?? latestBatch();
  const out = argValue('--out') ?? DEFAULT_MANIFEST;

  const batch = loadBatch(batchFile);
  const manifest: Manifest = {
    chrome: batch.chrome,
    createdAt: batch.createdAt,
    entries: batch.findings.map((f) => ({
      seed: f.seed,
      index: f.index,
      mode: f.mode,
      // Legacy batches rendered Chrome at Puppeteer's 1280×800 page even
      // though their XML mislabeled that space as max-content.
      oracle: f.oracle ?? 'viewport',
    })),
  };
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  const kb = (JSON.stringify(manifest).length / 1024).toFixed(0);
  console.log(`saved ${manifest.entries.length} seed(s) to ${out} (${kb} KB)`);
  console.log(`rehydrate with: pnpm fuzz-batch-manifest rehydrate`);
}

/** manifest -> batch: regenerate, re-shrink, re-freeze Chrome's verdict. */
async function rehydrate(): Promise<void> {
  const args = process.argv.slice(3);
  const manifestFile = args.find((a) => !a.startsWith('--')) ?? DEFAULT_MANIFEST;
  const concurrency = Number(argValue('--concurrency') ?? 8);
  if (!existsSync(manifestFile)) {
    console.error(`no manifest at ${manifestFile} — create one with: pnpm fuzz-batch-manifest save`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
  const out = argValue('--out') ?? join(BATCH_DIR, `batch-rehydrated-${manifest.entries[0]?.seed ?? 0}.json`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
  });
  const chrome = await browser.version();
  if (chrome !== manifest.chrome) {
    console.warn(`warning: manifest was collected against ${manifest.chrome}, this is ${chrome}`);
  }
  const execs: Executor[] = [];
  for (let i = 0; i < concurrency; i++) execs.push(await createExecutor(browser));

  const findings: BatchFinding[] = [];
  const seen = new Set<string>();
  let done = 0;
  let alreadyFixed = 0;
  const started = Date.now();

  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, slot) => {
      const exec = execs[slot] as Executor;
      for (;;) {
        const i = next++;
        const entry = manifest.entries[i];
        if (entry === undefined) return;

        const requestedOracle = entry.oracle ?? 'viewport';
        const tree = withOracleConstraint(
          generateTree(deriveSeed(entry.seed, entry.index), entry.mode),
          requestedOracle,
        );
        const oracle = oracleConstraintOf(tree);
        done++;
        if (done % 50 === 0) {
          const rate = done / ((Date.now() - started) / 1000);
          console.log(
            `  … ${done}/${manifest.entries.length} replayed, ${findings.length} still failing ` +
              `(${rate.toFixed(1)} trees/s)`,
          );
        }
        if ((await checkTree(exec, tree)).length === 0) {
          // Fixed since the manifest was written — that is the point of the
          // exercise, not an error.
          alreadyFixed++;
          continue;
        }

        const shrunk = await shrinkTree(
          tree,
          async (candidate) => (await checkTree(exec, candidate)).length > 0,
          250,
          treeRespectsOracleInvariant,
        );
        const minimal = shrunk.tree;
        const id = signatureHash(treeSignature(minimal));
        if (seen.has(id)) continue;
        seen.add(id);

        const fixtures = await renderFixtures(exec, minimal);
        findings.push({
          id,
          seed: entry.seed,
          index: entry.index,
          mode: entry.mode,
          oracle,
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
      }
    }),
  );

  const batch: Batch = { createdAt: new Date().toISOString(), chrome, findings };
  writeFileSync(out, `${JSON.stringify(batch, null, 2)}\n`);
  await browser.close();

  console.log(
    `\nrehydrated ${findings.length} open finding(s) from ${manifest.entries.length} seed(s) ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      `${alreadyFixed > 0 ? ` — ${alreadyFixed} already fixed` : ''}\n` +
      `batch: ${out}`,
  );
}

const command = process.argv[2];
if (command === 'save') {
  save();
} else if (command === 'rehydrate') {
  await rehydrate();
} else {
  console.error('usage: pnpm fuzz-batch-manifest save|rehydrate [file] [--out FILE]');
  process.exit(2);
}
