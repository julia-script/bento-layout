// Layout dispatch: routes a child to its display mode's algorithm, through the
// layout cache, with `display: none` short-circuited.

import type { AbsoluteAxis, Size } from '../geometry.js';
import { sizeGetAbs } from '../geometry.js';
import type { Opt } from '../math.js';
import type { AvailableSpace } from '../style.js';
import { traceLayout } from '../trace.js';
import type { LayoutInput, LayoutNode, LayoutOutput, Line, SizingMode } from '../tree.js';
import { internals, LINE_FALSE, layoutOutputHidden, layoutWithOrder } from '../tree.js';
import type { BlockContext } from './block.js';
import { computeBlockLayout } from './block.js';
import { computeFlexboxLayout } from './flexbox.js';
import { computeGridLayout } from './grid/mod.js';
import { computeLeafLayout } from './leaf.js';

const HIDDEN_INPUT: LayoutInput = {
  runMode: 'perform-hidden-layout',
  sizingMode: 'inherent-size',
  axis: 'both',
  knownDimensions: { width: null, height: null },
  parentSize: { width: null, height: null },
  availableSpace: { width: 'max-content', height: 'max-content' },
  verticalMarginsAreCollapsible: LINE_FALSE,
};

export function computeChildLayout(node: LayoutNode, inputs: LayoutInput, blockCtx?: BlockContext): LayoutOutput {
  // If RunMode is PerformHiddenLayout then an ancestor node is display:none.
  if (inputs.runMode === 'perform-hidden-layout') {
    return computeHiddenLayout(node);
  }

  const nd = internals(node);
  for (const axis of ['width', 'height'] as const) {
    const value = inputs.knownDimensions[axis];
    if (value !== null) {
      traceLayout(node, {
        phase: 'input',
        source: 'parent-known',
        axis,
        value,
        detail: `${inputs.runMode}/${inputs.sizingMode}`,
      });
    }
  }
  const cached = nd.cache.get(inputs);
  if (cached) return cached;

  let output: LayoutOutput;
  if (nd.style.display === 'none') {
    output = computeHiddenLayout(node);
  } else if (nd.style.display === 'block' && nd.children.length > 0) {
    output = computeBlockLayout(node, inputs, blockCtx);
  } else if (nd.style.display === 'grid' && (nd.children.length > 0 || nd.measure === undefined)) {
    // Unlike empty flex/block containers (which size like leaves), an empty
    // grid still sizes to its explicit tracks — `grid-template-rows: 120px`
    // makes it 120px tall with no items (css-grid-1 §5.1; matches Chrome).
    // Routing childless grids to leaf layout drops the tracks; found by
    // differential fuzzing. Text leaves (measure fn) stay on the leaf path.
    output = computeGridLayout(node, inputs);
  } else if (nd.children.length > 0) {
    output = computeFlexboxLayout(node, inputs);
  } else {
    const measure = nd.measure ?? (() => ({ width: 0, height: 0 }));
    output = computeLeafLayout(inputs, nd.style, measure);
  }

  nd.cache.store(inputs, output);
  traceLayout(node, {
    phase: 'output',
    source: 'algorithm-output',
    axis: 'width',
    value: output.size.width,
    detail: nd.style.display,
  });
  traceLayout(node, {
    phase: 'output',
    source: 'algorithm-output',
    axis: 'height',
    value: output.size.height,
    detail: nd.style.display,
  });
  return output;
}

export function computeHiddenLayout(node: LayoutNode): LayoutOutput {
  const nd = internals(node);
  nd.cache.clear();
  nd.unroundedLayout = layoutWithOrder(0);
  for (const child of nd.children) {
    computeChildLayout(child, HIDDEN_INPUT);
  }
  return layoutOutputHidden();
}

export function measureChildSize(
  node: LayoutNode,
  knownDimensions: Size<Opt>,
  parentSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  sizingMode: SizingMode,
  axis: AbsoluteAxis,
  verticalMarginsAreCollapsible: Line<boolean> = LINE_FALSE,
): number {
  return sizeGetAbs(
    computeChildLayout(node, {
      knownDimensions,
      parentSize,
      availableSpace,
      sizingMode,
      axis,
      runMode: 'compute-size',
      verticalMarginsAreCollapsible,
    }).size,
    axis,
  );
}

export function measureChildSizeBoth(
  node: LayoutNode,
  knownDimensions: Size<Opt>,
  parentSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  sizingMode: SizingMode,
  verticalMarginsAreCollapsible: Line<boolean> = LINE_FALSE,
): Size<number> {
  return computeChildLayout(node, {
    knownDimensions,
    parentSize,
    availableSpace,
    sizingMode,
    axis: 'both',
    runMode: 'compute-size',
    verticalMarginsAreCollapsible,
  }).size;
}

export function performChildLayout(
  node: LayoutNode,
  knownDimensions: Size<Opt>,
  parentSize: Size<Opt>,
  availableSpace: Size<AvailableSpace>,
  sizingMode: SizingMode,
  verticalMarginsAreCollapsible: Line<boolean> = LINE_FALSE,
  knownDimensionsAreHard?: Size<boolean>,
): LayoutOutput {
  return computeChildLayout(node, {
    knownDimensions,
    parentSize,
    availableSpace,
    sizingMode,
    axis: 'both',
    runMode: 'perform-layout',
    verticalMarginsAreCollapsible,
    ...(knownDimensionsAreHard === undefined ? {} : { knownDimensionsAreHard }),
  });
}
