import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixtures } from "../../scripts/fuzz/check.js";

interface FuzzNode {
  style: Record<string, unknown>;
  children: FuzzNode[];
  text?: string;
}

interface Finding {
  id: string;
  seed: number;
  index: number;
  mode: string;
  nodes: number;
  tree: { root: FuzzNode };
  fixtures: Record<string, string>;
}

interface Batch {
  createdAt: string;
  chrome: string;
  findings: Finding[];
}

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(dashboardRoot, "..");
const batchPath = resolve(
  repoRoot,
  "tests/fuzz-batches/batch-rehydrated-20260731.json",
);
const outputPath = resolve(dashboardRoot, "app/findings.json");
const batch = JSON.parse(readFileSync(batchPath, "utf8")) as Batch;

function collectProperties(node: FuzzNode, into: Set<string>): void {
  for (const property of Object.keys(node.style)) into.add(property);
  for (const child of node.children) collectProperties(child, into);
}

const open = [];
let engineFixed = 0;

for (const finding of batch.findings) {
  const mismatches = checkFixtures(finding.fixtures);
  if (mismatches.length === 0) {
    engineFixed += 1;
    continue;
  }

  const properties = new Set<string>();
  collectProperties(finding.tree.root, properties);
  open.push({
    id: finding.id,
    seed: finding.seed,
    index: finding.index,
    mode: finding.mode,
    nodes: finding.nodes,
    properties: [...properties].sort(),
    mismatches: mismatches.map((mismatch) => ({
      ...mismatch,
      delta: mismatch.actual - mismatch.expected,
    })),
    tree: finding.tree,
  });
}

const payload = {
  generatedAt: new Date().toISOString(),
  batchCreatedAt: batch.createdAt,
  chrome: batch.chrome,
  total: batch.findings.length,
  engineFixed,
  open,
};

writeFileSync(outputPath, `${JSON.stringify(payload)}\n`);
console.log(
  `Generated ${open.length} open findings (${engineFixed}/${batch.findings.length} engine-fixed) at ${outputPath}`,
);
