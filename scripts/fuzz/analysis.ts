import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Batch, BatchFinding } from '../fuzz-batch.js';
import { checkFixtures, type Mismatch } from './check.js';
import type { FuzzNode } from './generate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BATCH_DIR = join(ROOT, 'tests', 'fuzz-batches');
const ACTIVE_BATCH_FILE = 'active.json';

export interface JudgedFinding {
  finding: BatchFinding;
  mismatches: Mismatch[];
  properties: Set<string>;
}

export interface PropertyEnrichment {
  property: string;
  openCount: number;
  fixedCount: number;
  enrichment: number;
}

export interface FindingCluster {
  key: string;
  findings: JudgedFinding[];
  volume: number;
  sample: JudgedFinding;
  sharedProperties: string[];
  propertyFrequency: Map<string, number>;
  coherence: number;
  causalConfidence: number;
  novelty: number;
  estimatedCost: number;
  payoff: number;
}

export interface StopAssessment {
  recommendation: 'continue' | 'consider-stopping' | 'batch-clear';
  largeCoherentClusters: number;
  highPayoffClusters: number;
  longTailFindings: number;
  longTailShare: number;
  reasons: string[];
}

export interface BatchAnalysis {
  batch: Batch;
  open: JudgedFinding[];
  fixed: JudgedFinding[];
  enrichment: PropertyEnrichment[];
  clusters: FindingCluster[];
  stop: StopAssessment;
}

export function defaultBatchPath(batchDir = BATCH_DIR): string {
  return join(batchDir, ACTIVE_BATCH_FILE);
}

/** The active work queue has a stable name. Never infer campaign state from
 * filenames: archived and legacy payloads can sort after the current batch. */
export function latestBatchPath(batchDir = BATCH_DIR): string {
  const file = defaultBatchPath(batchDir);
  if (!existsSync(file)) {
    throw new Error(`no active fuzz batch at ${file}; rehydrate or collect one there explicitly`);
  }
  return file;
}

export function collectProperties(root: FuzzNode): Set<string> {
  const properties = new Set<string>();
  const walk = (node: FuzzNode): void => {
    for (const property of Object.keys(node.style)) properties.add(property);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return properties;
}

export function geometryClusterKey(finding: Pick<JudgedFinding, 'finding' | 'mismatches'>): string {
  const paths = new Set(finding.mismatches.map(({ path }) => path));
  const axes = new Set(finding.mismatches.map(({ axis }) => axis));
  const minDepth = Math.min(...[...paths].map((path) => path.split('/').length));
  const roots = [...paths].filter((path) => path.split('/').length === minDepth).sort();
  const displays = new Set<string>();
  const walk = (node: FuzzNode): void => {
    displays.add((node.style as { display?: string }).display ?? 'flex');
    for (const child of node.children) walk(child);
  };
  walk(finding.finding.tree.root);
  return `${roots.join('+')} [${[...axes].sort().join(',')}] {${[...displays].sort().join(',')}}`;
}

function intersectionOverUnion(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / union.size;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

export function computeEnrichment(open: JudgedFinding[], fixed: JudgedFinding[]): PropertyEnrichment[] {
  const names = new Set([...open, ...fixed].flatMap(({ properties }) => [...properties]));
  return [...names]
    .map((property) => {
      const openCount = open.filter(({ properties }) => properties.has(property)).length;
      const fixedCount = fixed.filter(({ properties }) => properties.has(property)).length;
      const openShare = open.length === 0 ? 0 : openCount / open.length;
      const fixedShare = fixed.length === 0 ? 0 : fixedCount / fixed.length;
      return {
        property,
        openCount,
        fixedCount,
        enrichment: fixedShare === 0 ? (openCount === 0 ? 0 : Number.POSITIVE_INFINITY) : openShare / fixedShare,
      };
    })
    .filter(({ openCount }) => openCount > 0)
    .sort((a, b) => b.enrichment - a.enrichment || b.openCount - a.openCount || a.property.localeCompare(b.property));
}

export function rankClusters(open: JudgedFinding[], enrichment: PropertyEnrichment[]): FindingCluster[] {
  const enrichmentByProperty = new Map(enrichment.map((row) => [row.property, row.enrichment]));
  const grouped = new Map<string, JudgedFinding[]>();
  for (const finding of open) {
    const key = geometryClusterKey(finding);
    const group = grouped.get(key) ?? [];
    group.push(finding);
    grouped.set(key, group);
  }

  return [...grouped]
    .map(([key, findings]) => {
      const propertyFrequency = new Map<string, number>();
      for (const { properties } of findings) {
        for (const property of properties) propertyFrequency.set(property, (propertyFrequency.get(property) ?? 0) + 1);
      }
      const sharedProperties = [...propertyFrequency]
        .filter(([, count]) => count === findings.length)
        .map(([property]) => property)
        .sort();

      let pairCount = 0;
      let pairSimilarity = 0;
      for (let i = 0; i < findings.length; i++) {
        for (let j = i + 1; j < findings.length; j++) {
          pairSimilarity += intersectionOverUnion(
            findings[i]?.properties ?? new Set(),
            findings[j]?.properties ?? new Set(),
          );
          pairCount++;
        }
      }
      const coherence = pairCount === 0 ? 1 : pairSimilarity / pairCount;
      const unionSize = propertyFrequency.size;
      const sharedRatio = unionSize === 0 ? 1 : sharedProperties.length / unionSize;
      const causalConfidence = (coherence + sharedRatio) / 2;
      const strongestEnrichment = Math.max(
        1,
        ...sharedProperties.map((property) => enrichmentByProperty.get(property) ?? 1),
      );
      const novelty = Number.isFinite(strongestEnrichment) ? Math.min(strongestEnrichment / 3, 1) : 1;
      const estimatedCost = Math.max(1, median(findings.map(({ finding }) => finding.nodes)) * (1 + unionSize / 10));
      const payoff = (findings.length * (0.5 + causalConfidence) * (0.5 + novelty)) / Math.sqrt(estimatedCost);
      const sample = findings.reduce((smallest, candidate) =>
        smallest.finding.nodes <= candidate.finding.nodes ? smallest : candidate,
      );
      return {
        key,
        findings,
        volume: findings.length,
        sample,
        sharedProperties,
        propertyFrequency,
        coherence,
        causalConfidence,
        novelty,
        estimatedCost,
        payoff,
      };
    })
    .sort((a, b) => b.payoff - a.payoff || b.volume - a.volume || a.key.localeCompare(b.key));
}

export function assessStopping(open: JudgedFinding[], clusters: FindingCluster[]): StopAssessment {
  if (open.length === 0) {
    return {
      recommendation: 'batch-clear',
      largeCoherentClusters: 0,
      highPayoffClusters: 0,
      longTailFindings: 0,
      longTailShare: 0,
      reasons: ['No open findings remain in the frozen batch.'],
    };
  }

  const largeCoherentClusters = clusters.filter(({ volume, coherence }) => volume >= 5 && coherence >= 0.35).length;
  const highPayoffClusters = clusters.filter(({ volume, payoff }) => volume >= 3 && payoff >= 2).length;
  const longTailFindings = clusters.filter(({ volume }) => volume <= 2).reduce((sum, { volume }) => sum + volume, 0);
  const longTailShare = longTailFindings / open.length;
  const recommendation =
    largeCoherentClusters === 0 && highPayoffClusters === 0 && longTailShare >= 0.7 ? 'consider-stopping' : 'continue';
  const reasons = [
    `${largeCoherentClusters} cluster(s) still have at least 5 findings and coherence >= 0.35.`,
    `${highPayoffClusters} cluster(s) have payoff >= 2 with at least 3 findings.`,
    `${Math.round(longTailShare * 100)}% of open findings are in clusters of one or two.`,
  ];
  if (recommendation === 'consider-stopping') {
    reasons.push(
      'The remaining batch is predominantly a heterogeneous long tail; require a specific high-value reason to continue.',
    );
  } else {
    reasons.push('At least one coherent/high-payoff target remains, so another fix loop is justified.');
  }
  return { recommendation, largeCoherentClusters, highPayoffClusters, longTailFindings, longTailShare, reasons };
}

export function analyzeBatch(batch: Batch): BatchAnalysis {
  const open: JudgedFinding[] = [];
  const fixed: JudgedFinding[] = [];
  for (const finding of batch.findings) {
    const mismatches = checkFixtures(finding.fixtures);
    const judged = { finding, mismatches, properties: collectProperties(finding.tree.root) };
    (mismatches.length === 0 ? fixed : open).push(judged);
  }
  const enrichment = computeEnrichment(open, fixed);
  const clusters = rankClusters(open, enrichment);
  return { batch, open, fixed, enrichment, clusters, stop: assessStopping(open, clusters) };
}
