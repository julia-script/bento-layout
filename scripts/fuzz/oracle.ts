import type { GridTemplateComponent } from '../../src/style.js';
import { type FuzzTree, treeRespectsPercentInvariant } from './generate.js';

export const DEFAULT_PAGE_VIEWPORT = { width: 1280, height: 800 } as const;

export type FuzzOracleConstraint = 'intrinsic' | 'viewport';
export type FuzzOracleMode = FuzzOracleConstraint | 'mixed';

export function isFuzzOracleMode(value: string): value is FuzzOracleMode {
  return value === 'intrinsic' || value === 'viewport' || value === 'mixed';
}

export function oracleConstraintAt(mode: FuzzOracleMode, index: number): FuzzOracleConstraint {
  if (mode !== 'mixed') return mode;
  return index % 2 === 0 ? 'intrinsic' : 'viewport';
}

function hasAutoRepeat(template: GridTemplateComponent[] | undefined): boolean {
  return template?.some((component) => 'repeat' in component && typeof component.repeat !== 'number') ?? false;
}

function rootNeedsDefiniteAvailableSpace(tree: FuzzTree): boolean {
  const { gridTemplateColumns, gridTemplateRows, inset, position, size } = tree.root.style;
  if (hasAutoRepeat(gridTemplateColumns) || hasAutoRepeat(gridTemplateRows)) return true;

  const autoWidth = size?.width === undefined || size.width === 'auto';
  const autoHeight = size?.height === undefined || size.height === 'auto';

  // An in-flow block-level root with auto width fills the page's containing
  // block. Unlike the base stylesheet's absolutely positioned shrink-wrap
  // root, it therefore cannot converge as the page is widened.
  if (position === 'relative' && autoWidth) return true;

  // test_base_style.css absolutely positions a root unless its inline style
  // explicitly says `relative`. With an auto size and both opposing insets,
  // CSS computes that axis from the initial containing block.
  if (position === 'relative') return false;
  const definiteInset = (value: unknown): boolean => value !== undefined && value !== 'auto';
  return (
    (autoWidth && definiteInset(inset?.left) && definiteInset(inset?.right)) ||
    (autoHeight && definiteInset(inset?.top) && definiteInset(inset?.bottom))
  );
}

export function withOracleConstraint(tree: FuzzTree, constraint: FuzzOracleConstraint): FuzzTree {
  if (tree.viewport !== undefined) return tree;
  // css-grid-1 §7.2.3.2 makes auto-repeat count depend on definite available
  // space. An absolutely positioned root acquires that definite size from the
  // browser page, so widening the page can never converge to max-content.
  // Keep those trees in the definite regime instead of freezing a fake
  // intrinsic verdict at an arbitrary Puppeteer width.
  if (constraint === 'intrinsic' && !rootNeedsDefiniteAvailableSpace(tree)) {
    const intrinsic = structuredClone(tree);
    delete intrinsic.pageViewport;
    return intrinsic;
  }
  return { ...tree, pageViewport: { ...DEFAULT_PAGE_VIEWPORT } };
}

export function oracleConstraintOf(tree: FuzzTree): FuzzOracleConstraint {
  return tree.pageViewport === undefined ? 'intrinsic' : 'viewport';
}

/** Keep shrink candidates inside the available-space regime their HTML records. */
export function treeRespectsOracleInvariant(tree: FuzzTree): boolean {
  if (!treeRespectsPercentInvariant(tree)) return false;
  return tree.viewport !== undefined || tree.pageViewport !== undefined || !rootNeedsDefiniteAvailableSpace(tree);
}
