'use client';

// The engine-vs-browser comparison: the overlay's measurement and the verdict.
//
// Split out of Demo because this is the part with a genuine correctness
// hazard. The overlay reports geometry the BROWSER computed, read back from
// real laid-out DOM, and that read is only meaningful once the DOM has settled
// at the current tree, viewport, and zoom. Every false "You found a bug" this
// component has produced came from comparing a measurement taken against one
// state with an engine result from another.
//
// The invariant this hook exists to hold: a measurement is comparable only
// while the state it was taken against is still on screen. `stampsMatch` is
// the whole of that rule, and keeping it beside the state it guards is why
// this is a module rather than four loose values in a 500-line component.

import { useCallback, useState } from 'react';
import { AGREEMENT_EPSILON, maxDelta, type Rect } from './browser.js';
import type { RenderNode } from './runner.js';

/** What the overlay was showing when it read the DOM. */
interface Stamp {
  root: RenderNode;
  width: number;
  zoom: number;
}

interface Measurement extends Stamp {
  boxes: Rect[];
}

export interface BrowserComparison {
  /**
   * The browser's boxes, or null when there is nothing trustworthy to compare.
   *
   * Null both before the first measurement and whenever the current state has
   * moved on from the one measured — a stale answer is not a mismatch, and
   * reporting it as one is exactly the bug this guards.
   */
  browserBoxes: Rect[] | null;
  /**
   * Worst per-edge disagreement.
   *
   * `undefined` when not comparing at all; `null` when the two box lists do
   * not correspond (different node counts), which reads as a disagreement but
   * has no pixel figure to quote.
   */
  delta: number | null | undefined;
  /** The engines agree within tolerance. */
  agrees: boolean;
  /** The engines genuinely disagree — this is what raises the bug banner. */
  disagrees: boolean;
  /** Pass to `ChromeOverlay`'s `onMeasure`. */
  onMeasure: (boxes: Rect[]) => void;
}

/**
 * Compare the engine's boxes against the browser's, safely.
 *
 * `enabled` is the overlay toggle: with it off there is no measurement to
 * trust and no verdict to show. `ours` and the stamp inputs must describe the
 * same frame — they all come from the same render in Demo.
 */
export function useBrowserComparison(
  enabled: boolean,
  ours: Rect[],
  root: RenderNode | null,
  viewport: number,
  zoom: number,
): BrowserComparison {
  const [measured, setMeasured] = useState<Measurement | null>(null);

  // Identity-stable per stamp, so the overlay's measuring effect re-runs when
  // the thing being measured changes and not on every unrelated render.
  const onMeasure = useCallback(
    (boxes: Rect[]) => {
      if (root) setMeasured({ boxes, root, width: viewport, zoom });
    },
    [root, viewport, zoom],
  );

  const fresh = measured !== null && measured.root === root && measured.width === viewport && measured.zoom === zoom;

  const browserBoxes = fresh && measured ? measured.boxes : null;
  const delta = enabled && browserBoxes ? maxDelta(ours, browserBoxes) : undefined;
  const agrees = delta !== undefined && delta !== null && delta <= AGREEMENT_EPSILON;
  const disagrees = delta !== undefined && !agrees;

  return { browserBoxes, delta, agrees, disagrees, onMeasure };
}
