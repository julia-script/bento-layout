// Rank the frozen fuzz batch by coherent root-cause candidates and optionally
// build a live dossier: independently minimize several representatives and
// ablate one CSS property at a time to distinguish causal from incidental
// styling.
//
// Browser-free ranking:
//   pnpm exec tsx scripts/fuzz-dossier.ts
//   pnpm exec tsx scripts/fuzz-dossier.ts --property alignItems --cluster 0
// Live dossier (one shared Chrome process):
//   pnpm exec tsx scripts/fuzz-dossier.ts --property alignItems --live --samples 3

import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import {
  analyzeBatch,
  collectProperties,
  type FindingCluster,
  latestBatchPath,
  rankClusters,
} from './fuzz/analysis.js';
import { checkTree, createExecutor, type Mismatch } from './fuzz/check.js';
import type { FuzzNode, FuzzTree } from './fuzz/generate.js';
import { countNodes } from './fuzz/generate.js';
import { shrinkTree } from './fuzz/shrink.js';
import { loadBatch } from './fuzz-batch.js';

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function cloneTree(tree: FuzzTree): FuzzTree {
  return structuredClone(tree);
}

function removeProperty(tree: FuzzTree, property: string): FuzzTree {
  const candidate = cloneTree(tree);
  const walk = (node: FuzzNode): void => {
    delete (node.style as Record<string, unknown>)[property];
    for (const child of node.children) walk(child);
  };
  walk(candidate.root);
  return candidate;
}

function mismatchKey(mismatch: Mismatch): string {
  return `${mismatch.variant} ${mismatch.path} ${mismatch.axis}`;
}

function similarity(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / union.size;
}

/** Pick small representatives first, then maximize property-set diversity. */
function selectSamples(cluster: FindingCluster, count: number) {
  const remaining = [...cluster.findings].sort((a, b) => a.finding.nodes - b.finding.nodes);
  const selected = remaining.splice(0, 1);
  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      if (candidate === undefined) continue;
      const closest = Math.max(...selected.map((picked) => similarity(candidate.properties, picked.properties)));
      const distance = 1 - closest;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    if (picked !== undefined) selected.push(picked);
  }
  return selected;
}

function printRankings(analysis: ReturnType<typeof analyzeBatch>, clusters: FindingCluster[]): void {
  console.log(
    `${analysis.fixed.length}/${analysis.batch.findings.length} fixed — ${analysis.open.length} open; ` +
      `stop recommendation: ${analysis.stop.recommendation}`,
  );
  for (const reason of analysis.stop.reasons) console.log(`  ${reason}`);

  console.log('\nproperty enrichment:');
  for (const row of analysis.enrichment.slice(0, 12)) {
    const ratio = Number.isFinite(row.enrichment) ? `${row.enrichment.toFixed(2)}x` : 'inf';
    console.log(
      `  ${row.property.padEnd(20)} ${String(row.openCount).padStart(4)}/${String(row.fixedCount).padEnd(4)} ${ratio}`,
    );
  }

  console.log('\nranked coherent targets:');
  clusters.slice(0, 12).forEach((cluster, index) => {
    const shared = cluster.sharedProperties.length === 0 ? 'none' : cluster.sharedProperties.join(',');
    console.log(
      `  ${String(index).padStart(2)}. payoff=${cluster.payoff.toFixed(2)} volume=${cluster.volume} ` +
        `coherence=${cluster.coherence.toFixed(2)} cost=${cluster.estimatedCost.toFixed(1)} ${cluster.key}`,
    );
    console.log(`      shared=${shared}; sample=${cluster.sample.finding.id} (${cluster.sample.finding.nodes} nodes)`);
  });
}

async function buildLiveDossier(cluster: FindingCluster, sampleCount: number, maxChecks: number) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env.GENTEST_NO_SANDBOX ? ['--no-sandbox'] : [])],
  });
  const exec = await createExecutor(browser);
  const samples = [];
  const causalCounts = new Map<string, { necessary: number; tested: number }>();

  try {
    for (const judged of selectSamples(cluster, sampleCount)) {
      const initial = await checkTree(exec, judged.finding.tree);
      const anchor = initial[0];
      if (anchor === undefined) continue;
      const shrunk = await shrinkTree(
        judged.finding.tree,
        async (candidate) => {
          const mismatches = await checkTree(exec, candidate);
          return mismatches.some((mismatch) => mismatchKey(mismatch) === mismatchKey(anchor));
        },
        maxChecks,
      );
      const finalMismatches = await checkTree(exec, shrunk.tree);
      const properties = [...collectProperties(shrunk.tree.root)].sort();
      const ablations = [];
      for (const property of properties) {
        const candidate = removeProperty(shrunk.tree, property);
        const mismatches = await checkTree(exec, candidate);
        const necessary = !mismatches.some((mismatch) => mismatchKey(mismatch) === mismatchKey(anchor));
        const count = causalCounts.get(property) ?? { necessary: 0, tested: 0 };
        count.tested++;
        if (necessary) count.necessary++;
        causalCounts.set(property, count);
        ablations.push({ property, necessary, remainingMismatches: mismatches.length });
      }
      samples.push({
        id: judged.finding.id,
        nodesBefore: judged.finding.nodes,
        nodesAfter: countNodes(shrunk.tree.root),
        checks: shrunk.checks,
        budgetExhausted: shrunk.budgetExhausted,
        tree: shrunk.tree,
        mismatches: finalMismatches,
        ablations,
      });
    }
  } finally {
    await browser.close();
  }

  const causalProperties = [...causalCounts]
    .map(([property, counts]) => ({ property, ...counts, confidence: counts.necessary / counts.tested }))
    .sort((a, b) => b.confidence - a.confidence || b.tested - a.tested || a.property.localeCompare(b.property));
  return { samples, causalProperties };
}

async function main(): Promise<void> {
  const batchPath = flagValue('--batch') ?? latestBatchPath();
  const analysis = analyzeBatch(loadBatch(batchPath));
  const property = flagValue('--property');
  const findingId = flagValue('--id');
  let clusters = analysis.clusters;
  if (property !== undefined) {
    clusters = rankClusters(
      analysis.open.filter(({ properties }) => properties.has(property)),
      analysis.enrichment,
    );
  }
  if (findingId !== undefined) {
    clusters = clusters.filter(({ findings }) => findings.some(({ finding }) => finding.id === findingId));
  }
  printRankings(analysis, clusters);

  const clusterIndex = Number(flagValue('--cluster') ?? 0);
  const selected = clusters[clusterIndex];
  if (selected === undefined) {
    if (clusters.length === 0) console.error('\nno cluster matches the requested filters');
    process.exitCode = clusters.length === 0 ? 1 : 0;
    return;
  }
  const focused =
    findingId === undefined
      ? selected
      : { ...selected, findings: selected.findings.filter(({ finding }) => finding.id === findingId) };
  console.log(`\nselected cluster ${clusterIndex}: ${selected.key}`);
  for (const judged of selectSamples(focused, Number(flagValue('--samples') ?? 3))) {
    console.log(`  ${judged.finding.id}: ${judged.finding.nodes} nodes`);
    console.log(`    pnpm fuzz-minimize '${JSON.stringify(judged.finding.tree)}' --preserve-mismatch`);
  }

  let live: Awaited<ReturnType<typeof buildLiveDossier>> | undefined;
  if (process.argv.includes('--live')) {
    const samples = Number(flagValue('--samples') ?? 3);
    const maxChecks = Number(flagValue('--max-checks') ?? 250);
    console.error(`\nbuilding live dossier: ${samples} sample(s), ${maxChecks} checks each...`);
    live = await buildLiveDossier(focused, samples, maxChecks);
    console.log('\ncausal ablation:');
    for (const row of live.causalProperties) {
      console.log(
        `  ${row.property.padEnd(20)} necessary ${row.necessary}/${row.tested} ` +
          `(${Math.round(row.confidence * 100)}%)`,
      );
    }
    console.log('\nindependently minimized samples:');
    for (const sample of live.samples) {
      console.log(`  ${sample.id}: ${sample.nodesBefore} -> ${sample.nodesAfter} nodes, ${sample.checks} checks`);
      console.log(`  ${JSON.stringify(sample.tree)}`);
    }
  }

  const out = flagValue('--out');
  if (out !== undefined) {
    const serializableCluster = {
      ...selected,
      propertyFrequency: Object.fromEntries(selected.propertyFrequency),
      findings: selected.findings.map(({ finding, mismatches, properties }) => ({
        id: finding.id,
        nodes: finding.nodes,
        tree: finding.tree,
        mismatches,
        properties: [...properties],
      })),
    };
    writeFileSync(
      out,
      `${JSON.stringify({ batchPath, stop: analysis.stop, cluster: serializableCluster, live }, null, 2)}\n`,
    );
    console.error(`wrote ${out}`);
  }
}

await main();
