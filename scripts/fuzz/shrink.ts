// Delta-debugging shrinker for Chrome-vs-engine fuzz findings.
//
// It first tries groups of removals, then structural edits, and finally
// progressively simpler text/style values. Every accepted candidate is fed
// back into the next pass until a complete sweep makes no progress or the
// caller's check budget is exhausted.

import { unreachable } from '../../src/assert.js';
import type { Style } from '../../src/index.js';
import { defaultStyle } from '../../src/style.js';
import type { FuzzNode, FuzzTree } from './generate.js';

export interface ShrinkResult {
  tree: FuzzTree;
  /** Accepted atomic reductions. A grouped candidate can add more than one. */
  applied: number;
  /** Total predicate evaluations spent. */
  checks: number;
  budgetExhausted: boolean;
}

type Path = number[];
type ValuePath = Array<string | number>;
type GroupReduction =
  | { kind: 'node'; path: Path }
  | { kind: 'style'; path: Path; key: keyof Style }
  | { kind: 'text'; path: Path }
  | { kind: 'viewport' };

const DEFAULT_STYLE = defaultStyle();
const TRACK_KEYS = new Set<keyof Style>(['gridTemplateRows', 'gridTemplateColumns', 'gridAutoRows', 'gridAutoColumns']);

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
  if (path.length === 0) return null;
  const next = cloneTree(tree);
  const parent = nodeAt(next.root, path.slice(0, -1));
  parent.children.splice(path[path.length - 1] ?? unreachable(), 1);
  return next;
}

/** Drop a wrapper but retain its children at the same sibling position. */
function withNodeUnwrapped(tree: FuzzTree, path: Path): FuzzTree | null {
  if (path.length === 0) return null;
  const next = cloneTree(tree);
  const parent = nodeAt(next.root, path.slice(0, -1));
  const index = path[path.length - 1] ?? unreachable();
  const node = parent.children[index] ?? unreachable();
  if (node.children.length === 0) return null;
  parent.children.splice(index, 1, ...node.children);
  return next;
}

/** Replace a whole subtree (including the root) with one of its children. */
function withSubtreeReplacedByChild(tree: FuzzTree, path: Path, childIndex: number): FuzzTree {
  const next = cloneTree(tree);
  const node = nodeAt(next.root, path);
  const child = node.children[childIndex] ?? unreachable();
  if (path.length === 0) {
    next.root = child;
  } else {
    const parent = nodeAt(next.root, path.slice(0, -1));
    parent.children[path[path.length - 1] ?? unreachable()] = child;
  }
  return next;
}

function collectGroupReductions(tree: FuzzTree): GroupReduction[] {
  const reductions: GroupReduction[] = [];
  if (tree.viewport !== undefined) reductions.push({ kind: 'viewport' });
  for (const path of collectPaths(tree.root)) {
    if (path.length > 0) reductions.push({ kind: 'node', path });
    const node = nodeAt(tree.root, path);
    if (node.text !== undefined) reductions.push({ kind: 'text', path });
    for (const key of Object.keys(node.style) as (keyof Style)[]) {
      reductions.push({ kind: 'style', path, key });
    }
  }
  return reductions;
}

function compareRemovalPaths(a: Path, b: Path): number {
  if (a.length !== b.length) return b.length - a.length;
  for (let i = 0; i < a.length; i++) {
    const difference = (b[i] ?? -1) - (a[i] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function withGroupReductions(tree: FuzzTree, reductions: GroupReduction[]): FuzzTree {
  const next = cloneTree(tree);
  for (const reduction of reductions) {
    if (reduction.kind === 'viewport') delete next.viewport;
    if (reduction.kind === 'text') delete nodeAt(next.root, reduction.path).text;
    if (reduction.kind === 'style') delete nodeAt(next.root, reduction.path).style[reduction.key];
  }
  const removals = reductions
    .filter((reduction): reduction is Extract<GroupReduction, { kind: 'node' }> => reduction.kind === 'node')
    .map((reduction) => reduction.path)
    .sort(compareRemovalPaths);
  for (const path of removals) {
    const parent = nodeAt(next.root, path.slice(0, -1));
    parent.children.splice(path[path.length - 1] ?? unreachable(), 1);
  }
  return next;
}

/**
 * Try progressively smaller chunks of removals. This catches non-monotonic
 * cases where removing A or B alone heals the tree, but removing both retains
 * a simpler failure — something a purely greedy one-at-a-time pass misses.
 */
async function groupedReduction(
  tree: FuzzTree,
  tryCandidate: (candidate: FuzzTree) => Promise<boolean>,
  budgetLeft: () => boolean,
): Promise<{ tree: FuzzTree; applied: number } | null> {
  const reductions = collectGroupReductions(tree);
  if (reductions.length < 2) return null;
  let chunkSize = reductions.length;
  while (chunkSize >= 2 && budgetLeft()) {
    for (let start = 0; start < reductions.length && budgetLeft(); start += chunkSize) {
      const chunk = reductions.slice(start, start + chunkSize);
      if (chunk.length >= 2) {
        const candidate = withGroupReductions(tree, chunk);
        if (await tryCandidate(candidate)) return { tree: candidate, applied: chunk.length };
      }
    }
    if (chunkSize === 2) break;
    chunkSize = Math.max(2, Math.ceil(chunkSize / 2));
  }
  return null;
}

/** Resettable longhands inside resolved Style object shapes. */
function structuredResets(style: Partial<Style>): Array<{ key: keyof Style; subKey: string }> {
  const resets: Array<{ key: keyof Style; subKey: string }> = [];
  for (const key of Object.keys(style) as (keyof Style)[]) {
    const value = style[key];
    const fallback = DEFAULT_STYLE[key];
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof fallback !== 'object' ||
      fallback === null ||
      Array.isArray(fallback)
    ) {
      continue;
    }
    for (const subKey of Object.keys(value)) {
      const current = (value as unknown as Record<string, unknown>)[subKey];
      const defaultValue = (fallback as unknown as Record<string, unknown>)[subKey];
      if (defaultValue !== undefined && !Object.is(current, defaultValue)) resets.push({ key, subKey });
    }
  }
  return resets;
}

function withStructuredReset(tree: FuzzTree, path: Path, key: keyof Style, subKey: string): FuzzTree {
  const candidate = cloneTree(tree);
  const style = nodeAt(candidate.root, path).style;
  const value = style[key] as unknown as Record<string, unknown>;
  const fallback = DEFAULT_STYLE[key] as unknown as Record<string, unknown>;
  value[subKey] = structuredClone(fallback[subKey]);
  return candidate;
}

function uniqueValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const signature = JSON.stringify(value);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function shorterTextCandidates(text: string): string[] {
  const characters = [...text];
  if (characters.length <= 1) return [];
  const candidates: string[] = [];
  if (characters.includes('H')) candidates.push('H');
  else candidates.push(characters[0] ?? '');
  for (let chunkSize = Math.ceil(characters.length / 2); chunkSize >= 1; chunkSize = Math.floor(chunkSize / 2)) {
    for (let start = 0; start < characters.length; start += chunkSize) {
      const candidate = [...characters.slice(0, start), ...characters.slice(start + chunkSize)].join('');
      if (candidate.length > 0 && candidate.length < text.length) candidates.push(candidate);
    }
    if (chunkSize === 1) break;
  }
  return uniqueValues(candidates) as string[];
}

function numericCandidates(key: keyof Style, valuePath: ValuePath, value: number): number[] {
  if (!Number.isFinite(value) || value === 0) return [];
  const leaf = valuePath[valuePath.length - 1];
  const mustStayPositive = key === 'aspectRatio' || leaf === 'span' || leaf === 'repeat' || leaf === 'fr';
  if (mustStayPositive && value === 1) return [];
  const candidates = mustStayPositive ? [1] : value < 0 ? [0, -1] : [0, 1];
  const half = value / 2;
  if (Math.abs(half) >= 1) candidates.push(Number.isInteger(value) ? Math.trunc(half) : half);
  return [...new Set(candidates)].filter((candidate) => candidate !== value);
}

function allowsDimensionKeywords(key: keyof Style, valuePath: ValuePath): boolean {
  const leaf = valuePath[valuePath.length - 1];
  if (key === 'size' || key === 'minSize' || key === 'maxSize') return leaf === 'width' || leaf === 'height';
  if (key === 'flexBasis') return valuePath.length === 0;
  return TRACK_KEYS.has(key) && (leaf === 'min' || leaf === 'max');
}

function stringCandidates(key: keyof Style, valuePath: ValuePath, value: string): string[] {
  const leaf = valuePath[valuePath.length - 1];
  let ordered: string[] = [];
  if (allowsDimensionKeywords(key, valuePath)) {
    ordered = ['auto', 'min-content', 'max-content'];
  } else if (leaf === 'keyword') {
    ordered = [
      'start',
      'center',
      'stretch',
      'end',
      'flex-start',
      'flex-end',
      'baseline',
      'space-between',
      'space-around',
      'space-evenly',
    ];
  } else if (key === 'display') {
    ordered = ['block', 'flex', 'grid', 'none'];
  } else if (key === 'position') {
    ordered = ['relative', 'absolute'];
  } else if (key === 'boxSizing') {
    ordered = ['border-box', 'content-box'];
  } else if (key === 'direction') {
    ordered = ['ltr', 'rtl'];
  } else if (key === 'overflow') {
    ordered = ['visible', 'hidden', 'clip', 'scroll'];
  } else if (key === 'textAlign') {
    ordered = ['auto', 'legacy-left', 'legacy-center', 'legacy-right'];
  } else if (key === 'flexDirection') {
    ordered = ['row', 'column', 'row-reverse', 'column-reverse'];
  } else if (key === 'flexWrap') {
    ordered = ['nowrap', 'wrap', 'wrap-reverse'];
  } else if (key === 'gridAutoFlow') {
    ordered = ['row', 'column', 'row-dense', 'column-dense'];
  }
  const currentRank = ordered.indexOf(value);
  return currentRank >= 0 ? ordered.slice(0, currentRank) : ordered;
}

function shorterArrayCandidates(values: unknown[], allowEmpty: boolean): unknown[][] {
  const candidates: unknown[][] = [];
  if (values.length === 0) return candidates;
  for (let chunkSize = Math.ceil(values.length / 2); chunkSize >= 1; chunkSize = Math.floor(chunkSize / 2)) {
    for (let start = 0; start < values.length; start += chunkSize) {
      const candidate = [...values.slice(0, start), ...values.slice(start + chunkSize)];
      if ((allowEmpty || candidate.length > 0) && candidate.length < values.length) candidates.push(candidate);
    }
    if (chunkSize === 1) break;
  }
  return uniqueValues(candidates) as unknown[][];
}

interface ValueSimplification {
  valuePath: ValuePath;
  candidates: unknown[];
}

function collectValueSimplifications(
  key: keyof Style,
  value: unknown,
  valuePath: ValuePath = [],
): ValueSimplification[] {
  if (typeof value === 'number') {
    const candidates: unknown[] = [];
    if (allowsDimensionKeywords(key, valuePath)) {
      candidates.push('auto', 'min-content', 'max-content');
    }
    candidates.push(...numericCandidates(key, valuePath, value));
    return candidates.length > 0 ? [{ valuePath, candidates }] : [];
  }
  if (typeof value === 'string') {
    const candidates = stringCandidates(key, valuePath, value);
    return candidates.length > 0 ? [{ valuePath, candidates }] : [];
  }
  if (typeof value === 'boolean') {
    return value ? [{ valuePath, candidates: [false] }] : [];
  }
  if (Array.isArray(value)) {
    const own = shorterArrayCandidates(value, valuePath.length === 0);
    return [
      ...(own.length > 0 ? [{ valuePath, candidates: own }] : []),
      ...value.flatMap((entry, index) => collectValueSimplifications(key, entry, [...valuePath, index])),
    ];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([subKey, entry]) =>
      collectValueSimplifications(key, entry, [...valuePath, subKey]),
    );
  }
  return [];
}

function setNestedValue(container: unknown, valuePath: ValuePath, value: unknown): unknown {
  if (valuePath.length === 0) return structuredClone(value);
  let cursor = container as Record<string | number, unknown>;
  for (const segment of valuePath.slice(0, -1)) {
    cursor = cursor[segment] as Record<string | number, unknown>;
  }
  cursor[valuePath[valuePath.length - 1] ?? unreachable()] = structuredClone(value);
  return container;
}

function withStyleValue(tree: FuzzTree, path: Path, key: keyof Style, valuePath: ValuePath, value: unknown): FuzzTree {
  const candidate = cloneTree(tree);
  const style = nodeAt(candidate.root, path).style as Record<keyof Style, unknown>;
  style[key] = setNestedValue(style[key], valuePath, value);
  return candidate;
}

function viewportNumberCandidates(value: number): number[] {
  if (value === 0) return [];
  return [...new Set([0, 1, Math.trunc(value / 2)])].filter((candidate) => candidate !== value && candidate >= 0);
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

    const grouped = await groupedReduction(current, tryCandidate, budgetLeft);
    if (grouped !== null) {
      current = grouped.tree;
      applied += grouped.applied;
      progress = true;
      continue;
    }

    // Structural passes: removal, wrapper unwrapping, then replacing a subtree
    // with one child. Re-collect after a success because sibling paths shift.
    let structuralProgress = true;
    while (structuralProgress && budgetLeft()) {
      structuralProgress = false;
      for (const path of collectPaths(current.root)) {
        if (!budgetLeft()) break;
        if (path.length > 0) {
          const removed = withNodeRemoved(current, path);
          if (removed !== null && (await tryCandidate(removed))) {
            current = removed;
            applied++;
            progress = true;
            structuralProgress = true;
            break;
          }
          const unwrapped = withNodeUnwrapped(current, path);
          if (unwrapped !== null && (await tryCandidate(unwrapped))) {
            current = unwrapped;
            applied++;
            progress = true;
            structuralProgress = true;
            break;
          }
        }
        const node = nodeAt(current.root, path);
        for (let childIndex = 0; childIndex < node.children.length && budgetLeft(); childIndex++) {
          const candidate = withSubtreeReplacedByChild(current, path, childIndex);
          if (await tryCandidate(candidate)) {
            current = candidate;
            applied++;
            progress = true;
            structuralProgress = true;
            break;
          }
        }
        if (structuralProgress) break;
      }
    }

    if (current.viewport !== undefined && budgetLeft()) {
      const candidate = cloneTree(current);
      delete candidate.viewport;
      if (await tryCandidate(candidate)) {
        current = candidate;
        applied++;
        progress = true;
      }
    }
    const viewport = current.viewport;
    if (viewport !== undefined) {
      for (const axis of ['width', 'height'] as const) {
        for (const value of viewportNumberCandidates(viewport[axis])) {
          if (!budgetLeft()) break;
          const candidate = cloneTree(current);
          (candidate.viewport as NonNullable<FuzzTree['viewport']>)[axis] = value;
          if (await tryCandidate(candidate)) {
            current = candidate;
            applied++;
            progress = true;
            break;
          }
        }
      }
    }

    for (const path of collectPaths(current.root)) {
      if (!budgetLeft()) break;

      let text = nodeAt(current.root, path).text;
      if (text !== undefined) {
        const candidate = cloneTree(current);
        delete nodeAt(candidate.root, path).text;
        if (await tryCandidate(candidate)) {
          current = candidate;
          applied++;
          progress = true;
          text = undefined;
        }
      }
      while (text !== undefined && budgetLeft()) {
        let accepted = false;
        for (const shorter of shorterTextCandidates(text)) {
          if (!budgetLeft()) break;
          const candidate = cloneTree(current);
          nodeAt(candidate.root, path).text = shorter;
          if (await tryCandidate(candidate)) {
            current = candidate;
            text = shorter;
            applied++;
            progress = true;
            accepted = true;
            break;
          }
        }
        if (!accepted) break;
      }

      for (const key of Object.keys(nodeAt(current.root, path).style) as (keyof Style)[]) {
        if (!budgetLeft()) break;
        const candidate = cloneTree(current);
        delete nodeAt(candidate.root, path).style[key];
        if (await tryCandidate(candidate)) {
          current = candidate;
          applied++;
          progress = true;
        }
      }

      for (const { key, subKey } of structuredResets(nodeAt(current.root, path).style)) {
        if (!budgetLeft()) break;
        const candidate = withStructuredReset(current, path, key, subKey);
        if (await tryCandidate(candidate)) {
          current = candidate;
          applied++;
          progress = true;
        }
      }

      // Re-collect after every accepted value because array indexes and the
      // next useful numeric boundary can change as a value shrinks.
      let valueProgress = true;
      while (valueProgress && budgetLeft()) {
        valueProgress = false;
        const style = nodeAt(current.root, path).style;
        for (const key of Object.keys(style) as (keyof Style)[]) {
          const simplifications = collectValueSimplifications(key, style[key]);
          for (const simplification of simplifications) {
            for (const value of simplification.candidates) {
              if (!budgetLeft()) break;
              const candidate = withStyleValue(current, path, key, simplification.valuePath, value);
              if (await tryCandidate(candidate)) {
                current = candidate;
                applied++;
                progress = true;
                valueProgress = true;
                break;
              }
            }
            if (valueProgress || !budgetLeft()) break;
          }
          if (valueProgress || !budgetLeft()) break;
        }
      }
    }
  }

  return { tree: current, applied, checks, budgetExhausted: !budgetLeft() };
}
