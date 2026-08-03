'use client';

// The preview viewport: how wide the engine lays out, and at what scale.
//
// Split out of Demo because these values feed the worker, and getting them
// wrong is expensive in a way the rest of the UI is not — a width that changes
// on sub-pixel noise re-runs a layout, and a width derived from something the
// layout itself affects oscillates forever.
//
// Two rules live here, both learned from shipped bugs:
//
//   * Every width this returns is a WHOLE number. `contentRect.width` is
//     fractional under a zoomed browser, and `/ zoom` is fractional at 0.25 for
//     most panes; either would re-run the engine on changes no reader can see.
//
//   * The pane is measured, never the stage. The stage's width follows the
//     viewport, so observing it would feed its own output back in.
//
// What is deliberately NOT here: whether the demo is stacked. That is CSS's
// alone (`@media (min-width: 768px)`), because a fluid demo's width is a
// function of the pane and the pane's width is a function of stacking — a
// feedback loop that measured 299 flips in 300 frames when this component
// tried to decide it in JS.

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Zoom presets.
 *
 * Zoom is a scale transform, NOT a layout change: at 50% the viewport holds
 * twice as many engine pixels and is drawn at half size, so it occupies the
 * same screen space. That is the point — a reader on a phone picks 50% or 25%
 * to see what the layout does at desktop widths, on a screen that could never
 * show those widths 1:1. The engine re-runs at the wider viewport, so the
 * reflow is real rather than a shrunk picture of the narrow one.
 */
export const ZOOMS = [1, 0.5, 0.25] as const;

export type Zoom = (typeof ZOOMS)[number];

/**
 * Fallback available width, used for SSR and until the ResizeObserver reports.
 *
 * The viewport normally derives its width from the pane, but the first render
 * happens on the server where no pane exists. Demos in the docs are written
 * against this width, and `docs-demos.test.ts` asserts they lay out at it.
 */
export const AVAILABLE_WIDTH = 600;

/** Narrow enough to be useless; the drag handle stops here. */
const MIN_VIEWPORT = 80;

/**
 * Screen px the frame needs outside the viewport box: the dashed outline's
 * 4px offset on both sides, plus room for the handle straddling the right edge.
 */
const FRAME_ROOM = 26;

export interface ViewportControls {
  /** Attach to the preview pane; its width drives the fitted viewport. */
  paneRef: RefObject<HTMLDivElement | null>;
  /** Width the engine lays out against, in engine px. Always integral. */
  viewport: number;
  zoom: number;
  /** Switch zoom, refitting the viewport to the new scale. */
  setZoom: (zoom: number) => void;
  /** Pointer drag from the viewport's right edge. */
  onDragStart: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /** Keyboard equivalent, so the viewport is not mouse-only. */
  onHandleKey: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Drop a dragged width and go back to following the pane. */
  resetWidth: () => void;
}

export function useViewport(initialZoom?: Zoom): ViewportControls {
  const [zoom, setZoomState] = useState<number>(initialZoom ?? ZOOMS[0]);
  // Screen width of the preview pane. Null until measured, so the first paint
  // (and SSR) falls back to AVAILABLE_WIDTH rather than flashing a wrong size.
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  // Viewport width in ENGINE px, when the reader has dragged it. Null means
  // "follow the pane", which is the default at every zoom level.
  const [dragged, setDragged] = useState<number | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      setPaneWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // At zoom z the viewport is drawn at scale z, so filling a pane of P screen
  // px takes P/z engine px. That is what makes 50% show twice the layout width
  // in the same space. FRAME_ROOM keeps the dashed outline and the drag handle
  // (which sit outside the viewport box) inside the pane at 100%.
  const fitted = ((paneWidth ?? AVAILABLE_WIDTH) - FRAME_ROOM) / zoom;
  const viewport = Math.round(Math.max(MIN_VIEWPORT, dragged ?? fitted));

  // Dragged width is in engine px and was chosen against the old zoom;
  // clearing it refits the viewport to the new one.
  const setZoom = useCallback((next: number) => {
    setZoomState(next);
    setDragged(null);
  }, []);

  // Drag resizes from the right edge. The viewport is centered, so the pointer
  // travels half as far as the width changes — hence the doubling.
  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = viewport;
      const move = (ev: PointerEvent) => {
        setDragged(Math.max(MIN_VIEWPORT, Math.round(startWidth + ((ev.clientX - startX) * 2) / zoom)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [viewport, zoom],
  );

  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 100 : 20;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setDragged(Math.max(MIN_VIEWPORT, viewport - step));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setDragged(viewport + step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setDragged(null);
      }
    },
    [viewport],
  );

  const resetWidth = useCallback(() => setDragged(null), []);

  return { paneRef, viewport, zoom, setZoom, onDragStart, onHandleKey, resetWidth };
}
