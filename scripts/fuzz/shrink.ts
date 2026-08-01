// Greedy delta-debugging shrinker (design decision 5).
//
// Alternates node-removal passes (leaf-first) and style-property-reset passes,
// re-checking the failure after every candidate edit, until a full sweep makes
// no progress or the check budget is exhausted. Every check re-renders in
// Chrome, which is acceptable because shrinking only runs on failures — and the
// pre-shrink tree is kept by the caller as a fallback reproduction.

import { unreachable } from '../../src/assert.js';
import type { Style } from '../../src/index.js';
import type { FuzzNode, FuzzTree } from './generate.js';

export interface ShrinkResult {
  tree: FuzzTree;
  /** Accepted edits (each one removed a node, a property, text, or the viewport). */
  applied: number;
  /** Total predicate evaluations spent. */
  checks: number;
  budgetExhausted: boolean;
}

type Path = number[];

function cloneTree(tree: FuzzTree): FuzzTree {
  return structuredClone(tree);
}

function nodeAt(root: FuzzNode, path: Path): FuzzNode {
  let node = root;
  for (const i of path) node = node.children[i] ?? unreachable();
  return node;
}

/** All node paths, deepest-first so leaves are attempted before their parents. */
function collectPaths(root: FuzzNode): Path[] {
  const paths: Path[] = [];
  const walk = (node: FuzzNode, path: Path): void => {
    node.children.forEach((child, i) => walk(child, [...path, i]));
    paths.push(path);
  };
  walk(root, []);
  return paths.sort((a, b) => b.length - a.length);
}

function withNodeRemoved(tree: FuzzTree, path: Path): FuzzTree | null {
  if (path.length === 0) return null; // never remove the root
  const next = cloneTree(tree);
  const parent = nodeAt(next.root, path.slice(0, -1));
  parent.children.splice(path[path.length - 1] ?? unreachable(), 1);
  return next;
}

export async function shrinkTree(
  tree: FuzzTree,
  stillFails: (candidate: FuzzTree) => Promise<boolean>,
  maxChecks = 250,
  /** Reject candidates leaving the modeled space (e.g. percent invariant). */
  isValid: (candidate: FuzzTree) => boolean = () => true,
): Promise<ShrinkResult> {
  let current = cloneTree(tree);
  let applied = 0;
  let checks = 0;

  const budgetLeft = (): boolean => checks < maxChecks;
  const tryCandidate = async (candidate: FuzzTree): Promise<boolean> => {
    if (!isValid(candidate)) return false;
    checks++;
    return stillFails(candidate);
  };

  let progress = true;
  while (progress && budgetLeft()) {
    progress = false;

    // Pass 1: node removal, leaf-first. Re-collect after each success — paths
    // shift when a sibling disappears.
    let removed = true;
    while (removed && budgetLeft()) {
      removed = false;
      for (const path of collectPaths(current.root)) {
        if (path.length === 0 || !budgetLeft()) continue;
        const candidate = withNodeRemoved(current, path);
        if (candidate !== null && (await tryCandidate(candidate))) {
          current = candidate;
          applied++;
          progress = true;
          removed = true;
          break;
        }
      }
    }

    // Pass 2: drop the viewport wrapper.
    if (current.viewport !== undefined && budgetLeft()) {
      const candidate = cloneTree(current);
      delete candidate.viewport;
      if (await tryCandidate(candidate)) {
        current = candidate;
        applied++;
        progress = true;
      }
    }

    // Pass 3: per-node edits — drop text, then reset style properties one at a
    // time (deleting a key restores the engine/CSS default for that property).
    for (const path of collectPaths(current.root)) {
      if (!budgetLeft()) break;
      const liveNode = nodeAt(current.root, path);

      if (liveNode.text !== undefined) {
        const candidate = cloneTree(current);
        delete nodeAt(candidate.root, path).text;
        if (await tryCandidate(candidate)) {
          current = candidate;
          applied++;
          progress = true;
        }
      }

      for (const key of Object.keys(liveNode.style) as (keyof Style)[]) {
        if (!budgetLeft()) break;
        const candidate = cloneTree(current);
        delete nodeAt(candidate.root, path).style[key];
        if (await tryCandidate(candidate)) {
          current = candidate;
          applied++;
          progress = true;
        }
      }
    }
  }

  return { tree: current, applied, checks, budgetExhausted: !budgetLeft() };
}
