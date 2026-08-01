// Progress meter for a fuzz batch: re-judges every collected finding against
// the current engine and reports how many are still open. No browser — Chrome's
// verdict was frozen into each finding's fixture XMLs at collection time, so
// this runs in milliseconds and can sit in a fix loop.
//
// Findings are clustered by the style properties present in the shrunk tree, so
// the output points at what to fix next rather than at 1000 individual trees.
//
// Usage: pnpm fuzz-batch-status [FILE] [--verbose] [--cluster N] [--prune]

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFixtures } from './fuzz/check.js';
import type { FuzzNode } from './fuzz/generate.js';
import { loadBatch, type BatchFinding } from './fuzz-batch.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BATCH_DIR = join(ROOT, 'tests', 'fuzz-batches');

/** Most recently modified batch file, when none is named on the command line. */
function latestBatch(): string {
  const files = readdirSync(BATCH_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`no batches in ${BATCH_DIR} — collect one with: pnpm fuzz-batch`);
    process.exit(2);
  }
  return join(BATCH_DIR, files.sort().at(-1) as string);
}

/** Where the wrongness is, not what the tree contains: the set of node paths
 *  that differ, reduced to a shape. A bug in root intrinsic sizing shows up as
 *  `root` regardless of which properties the generator happened to sprinkle
 *  below it, so grouping on this points at one fix instead of one tree.
 *
 *  ponytail: purely structural — no per-property taxonomy. Refine only if a
 *  cluster stays large after its obvious root cause is fixed. */
function clusterKey(f: BatchFinding): string {
  const paths = new Set(f.mismatches.map((m) => m.path));
  const axes = new Set(f.mismatches.map((m) => m.axis));
  // A mismatch on a node whose parent also mismatches is usually a knock-on
  // effect; the shallowest differing paths are the real signal.
  const minDepth = Math.min(...[...paths].map((p) => p.split('/').length));
  const roots = [...paths].filter((p) => p.split('/').length === minDepth).sort();
  const displays = new Set<string>();
  const walk = (node: FuzzNode): void => {
    displays.add((node.style as { display?: string }).display ?? 'flex');
    node.children.forEach(walk);
  };
  walk(f.tree.root);
  return `${roots.join('+')} [${[...axes].sort().join(',')}] {${[...displays].sort().join(',')}}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--')) ?? latestBatch();
  const verbose = args.includes('--verbose');
  const prune = args.includes('--prune');
  const idx = args.indexOf('--cluster');
  const clusterLimit = idx >= 0 ? Number(args[idx + 1]) : 12;

  const batch = loadBatch(file);
  const open: BatchFinding[] = [];
  const fixed: BatchFinding[] = [];

  for (const finding of batch.findings) {
    (checkFixtures(finding.fixtures).length === 0 ? fixed : open).push(finding);
  }

  const total = batch.findings.length;
  const pct = total === 0 ? 100 : Math.round((fixed.length / total) * 100);
  console.log(`batch: ${file}`);
  console.log(`  collected ${batch.createdAt.slice(0, 10)} against ${batch.chrome}`);
  console.log(`  ${fixed.length}/${total} fixed (${pct}%) — ${open.length} open\n`);

  if (open.length > 0) {
    const clusters = new Map<string, BatchFinding[]>();
    for (const f of open) {
      const key = clusterKey(f);
      const list = clusters.get(key);
      if (list === undefined) clusters.set(key, [f]);
      else list.push(f);
    }
    const ranked = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`open findings cluster into ${ranked.length} group(s) by where they differ; largest first:\n`);
    for (const [key, list] of ranked.slice(0, clusterLimit)) {
      const sample = list.reduce((a, b) => (a.nodes <= b.nodes ? a : b));
      console.log(`  ${String(list.length).padStart(4)}x  ${key}`);
      console.log(`        smallest: ${sample.id} (${sample.nodes} nodes)`);
      console.log(`        triage:   pnpm fuzz-triage '${JSON.stringify(sample.tree)}'`);
      if (verbose) {
        for (const m of sample.mismatches.slice(0, 4)) {
          console.log(`        ${m.variant} ${m.path} ${m.axis}: chrome=${m.expected} engine=${m.actual}`);
        }
      }
      console.log();
    }
    if (ranked.length > clusterLimit) console.log(`  … and ${ranked.length - clusterLimit} smaller cluster(s)\n`);
  }

  if (prune && fixed.length > 0) {
    writeFileSync(file, `${JSON.stringify({ ...batch, findings: open }, null, 2)}\n`);
    console.log(`pruned ${fixed.length} fixed finding(s) from the batch file.`);
  }

  if (open.length === 0) console.log('batch clear — collect the next one with: pnpm fuzz-batch');
}

main();
