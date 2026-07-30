// Grammar-based random layout-tree generator (design decision 2).
//
// Trees are generated in engine-style space (Partial<Style>) from weighted
// tables with a quantized value palette — boundary values (0, 1px, round
// percentages) surface interaction bugs far more often than arbitrary floats.
// Per-mode profiles bias the container mix; child-context awareness attaches
// flex-item props under flex parents, placements under grid parents, etc.

import type {
  AlignContent,
  AlignContentKeyword,
  AlignItems,
  AlignItemsKeyword,
  Dimension,
  GridPlacement,
  GridTemplateComponent,
  LengthPercentage,
  LengthPercentageAuto,
  Style,
  TrackSizingFunction,
} from '../../src/index.js';
import { Rng } from './prng.js';

export type FuzzMode = 'flex' | 'grid' | 'block' | 'mixed';

export interface FuzzNode {
  style: Partial<Style>;
  children: FuzzNode[];
  /** Ahem text: runs of 'H' separated by zero-width spaces. Leaf nodes only. */
  text?: string;
}

export interface FuzzTree {
  root: FuzzNode;
  /** Definite viewport (rendered as a `.viewport` wrapper); absent = max-content. */
  viewport?: { width: number; height: number };
}

// --- Style-space coverage ----------------------------------------------------
//
// Compile-time exhaustiveness over the Style interface (design risk 4): adding
// a field to Style without deciding its fuzz treatment fails typecheck here.
export const STYLE_COVERAGE = {
  display: 'generated',
  boxSizing: 'generated',
  direction: 'generated',
  overflow: 'generated',
  // Environment-controlled: headless Chrome reports 0-width scrollbars and the
  // extraction helper echoes the measured width, so generating a value here
  // would desynchronize the engine tree from what Chrome actually used.
  scrollbarWidth: 'excluded',
  position: 'generated',
  inset: 'generated',
  size: 'generated',
  minSize: 'generated',
  maxSize: 'generated',
  aspectRatio: 'generated',
  margin: 'generated',
  padding: 'generated',
  border: 'generated',
  alignItems: 'generated',
  alignSelf: 'generated',
  alignContent: 'generated',
  justifyContent: 'generated',
  gap: 'generated',
  textAlign: 'generated',
  flexDirection: 'generated',
  flexWrap: 'generated',
  flexBasis: 'generated',
  flexGrow: 'generated',
  flexShrink: 'generated',
  justifyItems: 'generated',
  justifySelf: 'generated',
  gridTemplateRows: 'generated',
  gridTemplateColumns: 'generated',
  gridAutoRows: 'generated',
  gridAutoColumns: 'generated',
  gridAutoFlow: 'generated',
  gridRow: 'generated',
  gridColumn: 'generated',
} as const satisfies Record<keyof Style, 'generated' | 'excluded'>;

// --- Value palettes ----------------------------------------------------------

const PX = [0, 1, 3, 7, 10, 17, 20, 40, 55, 97, 120, 200, 320] as const;
/** Integer percents only: n/100 and (n/100)*100 round-trip exactly through CSS. */
const PCT = [1, 5, 10, 20, 25, 30, 40, 50, 60, 75, 90, 100] as const;
const ASPECT_RATIOS = [0.5, 1, 1.5, 2, 3] as const;
const GROW = [0.5, 1, 1, 2, 3] as const;
const SHRINK = [0, 1, 2] as const;
const SPANS = [1, 2, 2, 3] as const;
const LINES = [1, 2, 3, 4, -1, -2, -3] as const;
const FR = [0.5, 1, 1, 2, 3] as const;

const ALIGN_ITEMS_KEYWORDS: readonly AlignItemsKeyword[] = [
  'start',
  'end',
  'flex-start',
  'flex-end',
  'center',
  'baseline',
  'stretch',
];
const ALIGN_CONTENT_KEYWORDS: readonly AlignContentKeyword[] = [
  'start',
  'end',
  'flex-start',
  'flex-end',
  'center',
  'stretch',
  'space-between',
  'space-evenly',
  'space-around',
];

const ZWS = '​';

function lengthPercentage(rng: Rng): LengthPercentage {
  return rng.chance(0.65) ? rng.pick(PX) : { percent: rng.pick(PCT) / 100 };
}

function lengthPercentageAuto(rng: Rng, autoWeight = 0.15): LengthPercentageAuto {
  return rng.chance(autoWeight) ? 'auto' : lengthPercentage(rng);
}

function dimension(rng: Rng, autoWeight = 0.2): Dimension {
  return lengthPercentageAuto(rng, autoWeight);
}

function alignItems(rng: Rng): AlignItems {
  const keyword = rng.pick(ALIGN_ITEMS_KEYWORDS);
  // `safe` only changes behavior for overflow-prone keywords; keep it rare.
  const safe = keyword !== 'stretch' && keyword !== 'baseline' && rng.chance(0.1);
  return { keyword, safe };
}

function alignContent(rng: Rng): AlignContent {
  const keyword = rng.pick(ALIGN_CONTENT_KEYWORDS);
  const safe = keyword !== 'stretch' && rng.chance(0.1);
  return { keyword, safe };
}

function trackSizingFunction(rng: Rng): TrackSizingFunction {
  return rng.weighted<TrackSizingFunction>([
    [3, { min: 'auto', max: 'auto' }],
    [2, (() => { const v = rng.pick(PX); return { min: v, max: v }; })()],
    [2, (() => { const p = { percent: rng.pick(PCT) / 100 }; return { min: p, max: p }; })()],
    [1, { min: 'min-content', max: 'min-content' }],
    [1, { min: 'max-content', max: 'max-content' }],
    [3, { min: 'auto', max: { fr: rng.pick(FR) } }],
    [1, { min: 'auto', max: { fitContent: rng.chance(0.5) ? rng.pick(PX) : { percent: rng.pick(PCT) / 100 } } }],
    [2, { min: rng.chance(0.5) ? rng.pick(PX) : 'auto', max: rng.chance(0.5) ? { fr: rng.pick(FR) } : 'auto' }],
    [1, { min: 'min-content', max: 'max-content' }],
  ]);
}

/** A fixed-size track (auto-fill/auto-fit repeats require one). */
function fixedTrack(rng: Rng): TrackSizingFunction {
  if (rng.chance(0.6)) {
    const v = rng.pick(PX.filter((p) => p > 0));
    return { min: v, max: v };
  }
  const p = { percent: rng.pick(PCT) / 100 };
  return { min: p, max: p };
}

function gridTemplate(rng: Rng): GridTemplateComponent[] {
  const components: GridTemplateComponent[] = [];
  const count = rng.int(1, 4);
  for (let i = 0; i < count; i++) {
    if (rng.chance(0.12)) {
      const repeat = rng.weighted<number | 'auto-fill' | 'auto-fit'>([
        [2, rng.int(2, 3)],
        [1, 'auto-fill'],
        [1, 'auto-fit'],
      ]);
      const tracks =
        repeat === 'auto-fill' || repeat === 'auto-fit'
          ? [fixedTrack(rng)]
          : Array.from({ length: rng.int(1, 2) }, () => trackSizingFunction(rng));
      components.push({ repeat, tracks });
    } else {
      components.push(trackSizingFunction(rng));
    }
  }
  return components;
}

function gridPlacement(rng: Rng): GridPlacement {
  return rng.weighted<GridPlacement>([
    [5, 'auto'],
    [3, { line: rng.pick(LINES) }],
    [2, { span: rng.pick(SPANS) }],
  ]);
}

function ahemText(rng: Rng): string {
  const runs = rng.int(1, 5);
  return Array.from({ length: runs }, () => 'H'.repeat(rng.int(1, 5))).join(ZWS);
}

// --- Tree generation ---------------------------------------------------------

interface GenContext {
  mode: FuzzMode;
  parentDisplay: Style['display'];
  depth: number;
  /** Mutable node budget shared across the whole tree. */
  budget: { remaining: number };
}

function containerDisplay(rng: Rng, mode: FuzzMode): Style['display'] {
  switch (mode) {
    case 'flex':
      return 'flex';
    case 'grid':
      return 'grid';
    case 'block':
      return 'block';
    case 'mixed':
      return rng.weighted<Style['display']>([
        [4, 'flex'],
        [3, 'grid'],
        [3, 'block'],
      ]);
  }
}

/**
 * Root nodes live under a contract the fixture model imposes (and the vendored
 * corpus follows): the XML viewport cannot express the body as a containing
 * block, and the harness always places the root at (0,0). So the root gets no
 * margins/insets/position, and no percentages in properties that resolve
 * against the containing block — px-only sizes and padding. Children carry the
 * full style space, percentages included.
 */
function pxSize(rng: Rng, autoWeight: number): Dimension {
  return rng.chance(autoWeight) ? 'auto' : rng.pick(PX);
}

function genCommonStyle(rng: Rng, style: Partial<Style>, isRoot: boolean): void {
  if (isRoot) {
    if (rng.chance(0.8)) style.size = { width: pxSize(rng, 0.15), height: pxSize(rng, 0.15) };
    if (rng.chance(0.15)) style.minSize = { width: pxSize(rng, 0.4), height: pxSize(rng, 0.4) };
    if (rng.chance(0.15)) style.maxSize = { width: pxSize(rng, 0.4), height: pxSize(rng, 0.4) };
    if (rng.chance(0.1)) style.aspectRatio = rng.pick(ASPECT_RATIOS);
    if (rng.chance(0.25)) {
      style.padding = { left: rng.pick(PX), right: rng.pick(PX), top: rng.pick(PX), bottom: rng.pick(PX) };
    }
    if (rng.chance(0.2)) {
      style.border = { left: rng.pick(PX), right: rng.pick(PX), top: rng.pick(PX), bottom: rng.pick(PX) };
    }
    if (rng.chance(0.05)) style.boxSizing = rng.pick(['border-box', 'content-box'] as const);
    if (rng.chance(0.05)) style.direction = rng.pick(['ltr', 'rtl'] as const);
    return;
  }

  if (rng.chance(0.45)) {
    style.size = { width: dimension(rng), height: dimension(rng) };
  }
  if (rng.chance(0.2)) style.minSize = { width: dimension(rng, 0.4), height: dimension(rng, 0.4) };
  if (rng.chance(0.2)) style.maxSize = { width: dimension(rng, 0.4), height: dimension(rng, 0.4) };
  if (rng.chance(0.15)) style.aspectRatio = rng.pick(ASPECT_RATIOS);

  if (rng.chance(0.4)) {
    style.margin = {
      left: lengthPercentageAuto(rng),
      right: lengthPercentageAuto(rng),
      top: lengthPercentageAuto(rng),
      bottom: lengthPercentageAuto(rng),
    };
  }
  if (rng.chance(0.3)) {
    style.padding = {
      left: lengthPercentage(rng),
      right: lengthPercentage(rng),
      top: lengthPercentage(rng),
      bottom: lengthPercentage(rng),
    };
  }
  if (rng.chance(0.2)) {
    // CSS border-width takes lengths only, never percentages.
    style.border = {
      left: rng.pick(PX),
      right: rng.pick(PX),
      top: rng.pick(PX),
      bottom: rng.pick(PX),
    };
  }

  if (rng.chance(0.08)) {
    style.position = 'absolute';
    style.inset = {
      left: rng.chance(0.6) ? lengthPercentage(rng) : 'auto',
      right: rng.chance(0.6) ? lengthPercentage(rng) : 'auto',
      top: rng.chance(0.6) ? lengthPercentage(rng) : 'auto',
      bottom: rng.chance(0.6) ? lengthPercentage(rng) : 'auto',
    };
  } else if (!isRoot && rng.chance(0.03)) {
    // Relative inset (offset without affecting siblings)
    style.inset = {
      left: rng.chance(0.5) ? lengthPercentage(rng) : 'auto',
      right: 'auto',
      top: rng.chance(0.5) ? lengthPercentage(rng) : 'auto',
      bottom: 'auto',
    };
  }

  if (rng.chance(0.08)) {
    style.overflow = {
      x: rng.pick(['visible', 'hidden', 'scroll', 'clip'] as const),
      y: rng.pick(['visible', 'hidden', 'scroll', 'clip'] as const),
    };
  }
  if (rng.chance(0.05)) style.boxSizing = rng.pick(['border-box', 'content-box'] as const);
  if (rng.chance(0.05)) style.direction = rng.pick(['ltr', 'rtl'] as const);
}

function genContainerStyle(rng: Rng, style: Partial<Style>, display: Style['display']): void {
  if (display === 'flex') {
    if (rng.chance(0.6)) {
      style.flexDirection = rng.pick(['row', 'column', 'row-reverse', 'column-reverse'] as const);
    }
    if (rng.chance(0.3)) style.flexWrap = rng.pick(['wrap', 'wrap-reverse'] as const);
    if (rng.chance(0.3)) style.alignItems = alignItems(rng);
    if (style.flexWrap !== undefined && rng.chance(0.4)) style.alignContent = alignContent(rng);
    if (rng.chance(0.35)) style.justifyContent = alignContent(rng);
    if (rng.chance(0.35)) style.gap = { width: lengthPercentage(rng), height: lengthPercentage(rng) };
  } else if (display === 'grid') {
    if (rng.chance(0.85)) style.gridTemplateColumns = gridTemplate(rng);
    if (rng.chance(0.85)) style.gridTemplateRows = gridTemplate(rng);
    if (rng.chance(0.25)) style.gridAutoColumns = [trackSizingFunction(rng)];
    if (rng.chance(0.25)) style.gridAutoRows = [trackSizingFunction(rng)];
    if (rng.chance(0.3)) style.gridAutoFlow = rng.pick(['row', 'column', 'row-dense', 'column-dense'] as const);
    if (rng.chance(0.2)) style.alignItems = alignItems(rng);
    if (rng.chance(0.2)) style.justifyItems = alignItems(rng);
    if (rng.chance(0.25)) style.alignContent = alignContent(rng);
    if (rng.chance(0.25)) style.justifyContent = alignContent(rng);
    if (rng.chance(0.4)) style.gap = { width: lengthPercentage(rng), height: lengthPercentage(rng) };
  } else if (display === 'block') {
    if (rng.chance(0.15)) style.textAlign = rng.pick(['legacy-left', 'legacy-right', 'legacy-center'] as const);
  }
}

function genChildStyle(rng: Rng, style: Partial<Style>, parentDisplay: Style['display']): void {
  if (parentDisplay === 'flex') {
    if (rng.chance(0.35)) style.flexGrow = rng.pick(GROW);
    if (rng.chance(0.2)) style.flexShrink = rng.pick(SHRINK);
    if (rng.chance(0.25)) style.flexBasis = dimension(rng, 0.1);
    if (rng.chance(0.15)) style.alignSelf = alignItems(rng);
  } else if (parentDisplay === 'grid') {
    if (rng.chance(0.5)) style.gridColumn = { start: gridPlacement(rng), end: gridPlacement(rng) };
    if (rng.chance(0.5)) style.gridRow = { start: gridPlacement(rng), end: gridPlacement(rng) };
    if (rng.chance(0.15)) style.alignSelf = alignItems(rng);
    if (rng.chance(0.15)) style.justifySelf = alignItems(rng);
  }
}

function genNode(rng: Rng, ctx: GenContext): FuzzNode {
  ctx.budget.remaining--;
  const isRoot = ctx.depth === 0;

  const leafChance = isRoot ? 0 : Math.min(0.95, 0.25 + ctx.depth * 0.18);
  const isLeaf = ctx.budget.remaining <= 0 || ctx.depth >= 4 || rng.chance(leafChance);

  const style: Partial<Style> = {};

  if (isLeaf) {
    genCommonStyle(rng, style, isRoot);
    genChildStyle(rng, style, ctx.parentDisplay);
    if (!isRoot && rng.chance(0.02)) style.display = 'none';
    const node: FuzzNode = { style, children: [] };
    if (rng.chance(0.3)) node.text = ahemText(rng);
    return node;
  }

  const display = containerDisplay(rng, ctx.mode);
  style.display = display;
  genCommonStyle(rng, style, isRoot);
  genContainerStyle(rng, style, display);
  if (!isRoot) genChildStyle(rng, style, ctx.parentDisplay);
  if (!isRoot && rng.chance(0.02)) style.display = 'none';

  const childCount = display === 'grid' ? rng.int(1, 6) : rng.int(1, 5);
  const children: FuzzNode[] = [];
  for (let i = 0; i < childCount && ctx.budget.remaining > 0; i++) {
    children.push(genNode(rng, { ...ctx, parentDisplay: display, depth: ctx.depth + 1 }));
  }
  return { style, children };
}

export function generateTree(seed: number, mode: FuzzMode, maxNodes = 40): FuzzTree {
  const rng = new Rng(seed);
  const root = genNode(rng, {
    mode,
    parentDisplay: 'block',
    depth: 0,
    budget: { remaining: maxNodes },
  });
  // No viewport wrapper in v1: a definite-size `.viewport` makes the root a
  // flex item of the wrapper in Chrome (grow/stretch interactions the engine's
  // root model doesn't express). Definite available space is exercised via
  // px-sized roots instead. The FuzzTree.viewport plumbing stays for
  // hand-written reproductions.
  return { root };
}

export function countNodes(node: FuzzNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}
