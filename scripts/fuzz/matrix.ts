import type { Style } from '../../src/style.js';
import type { FuzzNode, FuzzTree } from './generate.js';

export interface MatrixProbe {
  name: string;
  changedProperty: string | null;
  tree: FuzzTree;
}

type Path = number[];

function cloneTree(tree: FuzzTree): FuzzTree {
  return structuredClone(tree);
}

function nodeAt(root: FuzzNode, path: Path): FuzzNode {
  let node = root;
  for (const index of path) node = node.children[index] as FuzzNode;
  return node;
}

function occurrences(root: FuzzNode): Array<{ path: Path; property: keyof Style; value: unknown }> {
  const out: Array<{ path: Path; property: keyof Style; value: unknown }> = [];
  const walk = (node: FuzzNode, path: Path): void => {
    for (const property of Object.keys(node.style) as (keyof Style)[]) {
      out.push({ path, property, value: node.style[property] });
    }
    node.children.forEach((child, index) => walk(child, [...path, index]));
  };
  walk(root, []);
  return out;
}

function slug(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('"', '')
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function unique(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function replaceObjectField(value: unknown, field: string, candidates: unknown[]): unknown[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return candidates.map((candidate) => ({ ...structuredClone(value), [field]: candidate }));
}

function propertyCandidates(property: keyof Style, value: unknown): unknown[] {
  const candidates: unknown[] = [];
  if (property === 'aspectRatio') candidates.push(0.5, 1, 2, 3, 20);
  if (property === 'flexDirection') candidates.push('row', 'column', 'row-reverse', 'column-reverse');
  if (property === 'flexWrap') candidates.push('nowrap', 'wrap', 'wrap-reverse');
  if (property === 'boxSizing') candidates.push('border-box', 'content-box');
  if (property === 'position') candidates.push('relative', 'absolute');
  if (property === 'display') candidates.push('flex', 'grid', 'block');
  if (property === 'alignItems' || property === 'alignSelf' || property === 'alignContent') {
    for (const keyword of ['start', 'center', 'stretch', 'end', 'flex-start', 'flex-end', 'baseline']) {
      candidates.push({ keyword, safe: false }, { keyword, safe: true });
    }
  }
  if (property === 'overflow') {
    for (const axis of ['x', 'y']) {
      candidates.push(...replaceObjectField(value, axis, ['visible', 'hidden', 'clip', 'scroll']));
    }
  }
  if (property === 'size' || property === 'minSize' || property === 'maxSize' || property === 'gap') {
    for (const axis of ['width', 'height']) {
      candidates.push(...replaceObjectField(value, axis, ['auto', 0, 1, 20]));
    }
  }
  if (property === 'margin' || property === 'padding' || property === 'border' || property === 'inset') {
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      candidates.push(
        ...replaceObjectField(value, edge, [0, 1, 20, property === 'margin' || property === 'inset' ? 'auto' : 0]),
      );
    }
  }
  if (typeof value === 'number' && property !== 'aspectRatio') candidates.push(0, 1, 2, 20);
  return unique(candidates).filter((candidate) => JSON.stringify(candidate) !== JSON.stringify(value));
}

export function generateMatrixProbes(
  tree: FuzzTree,
  options: { properties?: Set<string>; maxProbes?: number } = {},
): MatrixProbe[] {
  const maxProbes = options.maxProbes ?? 40;
  const probes: MatrixProbe[] = [{ name: '00-baseline', changedProperty: null, tree: cloneTree(tree) }];
  let index = 1;
  for (const occurrence of occurrences(tree.root)) {
    if (options.properties !== undefined && !options.properties.has(occurrence.property)) continue;
    const pathName = occurrence.path.length === 0 ? 'root' : `root-${occurrence.path.join('-')}`;

    const removed = cloneTree(tree);
    delete nodeAt(removed.root, occurrence.path).style[occurrence.property];
    probes.push({
      name: `${String(index++).padStart(2, '0')}-${pathName}-${occurrence.property}-unset`,
      changedProperty: occurrence.property,
      tree: removed,
    });
    if (probes.length >= maxProbes) break;

    for (const candidate of propertyCandidates(occurrence.property, occurrence.value)) {
      const mutated = cloneTree(tree);
      (nodeAt(mutated.root, occurrence.path).style as Record<string, unknown>)[occurrence.property] = candidate;
      probes.push({
        name: `${String(index++).padStart(2, '0')}-${pathName}-${occurrence.property}-${slug(candidate)}`,
        changedProperty: occurrence.property,
        tree: mutated,
      });
      if (probes.length >= maxProbes) break;
    }
    if (probes.length >= maxProbes) break;
  }
  return probes;
}
