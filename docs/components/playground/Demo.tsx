'use client';

// The editable demo: source on one side, the engine's layout on the other.
//
// One component serves both inline docs demos and the standalone playground —
// they differ only in size. Editing is a transparent <textarea> over
// Shiki-highlighted output, so a docs page carrying a demo does not also carry
// an editor bundle; Fumadocs already ships Shiki for its code blocks.

import type { LayoutNode } from 'bento-layout';
import { computeLayout } from 'bento-layout';
import { useShiki } from 'fumadocs-core/highlight/client';
import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AGREEMENT_EPSILON, type BrowserInfo, detectBrowser, issueUrl, maxDelta, type Rect } from './browser.js';
import { ChromeOverlay } from './ChromeOverlay.js';
import { type HoveredNode, LayoutCanvas } from './LayoutBox.js';
import { buildTree, parseDemo, type StyleNode } from './parse.js';

export interface DemoProps {
  /** Initial demo source. Readers edit from here; edits are not persisted. */
  children?: string;
  /** Alias for `children`, for callers passing source as a prop. */
  code?: string;
  /** Preview height. Defaults to a size that suits an inline docs demo. */
  height?: number | string;
  /**
   * Force the stacked (single-column) layout. Leave unset to stack
   * automatically when the laid-out tree is too wide for a side-by-side pane.
   */
  stacked?: boolean;
  /**
   * Zoom this demo starts at: 1, 0.5, or 0.25.
   *
   * Defaults to 1 (viewport = the space available), which is right when the
   * demo's point survives at any width. Set it lower for a demo that only makes
   * sense at desktop widths — a three-column grid or a sidebar layout reads as
   * a single stacked column on a phone at 100%, which is not what the
   * surrounding prose is describing. At 0.5 the same demo lays out against
   * twice the width and is drawn half-size, so a phone reader sees the desktop
   * result. The reader can still change it.
   */
  zoom?: 1 | 0.5 | 0.25;
}

/**
 * Widest tree that still reads well beside the editor.
 *
 * Side-by-side splits the demo in half, and the docs column is itself inset by
 * the sidebar and table of contents, so a half-pane is only ~340px even on a
 * 1280px window — and `.fd-demo-preview`'s 1rem padding takes 32px more. A
 * tree wider than what is left would be clipped into a scroll box, which
 * silently hides exactly the comparison a wide demo exists to make, so it gets
 * the full width instead. Not scaled down: the preview is 1:1 with the
 * engine's own units on purpose.
 */
const SIDE_BY_SIDE_MAX_WIDTH = 260;

type Result = { ok: true; root: LayoutNode; styles: StyleNode } | { ok: false; message: string };

/**
 * Parse, build, and lay out demo source.
 *
 * Every failure mode is caught here: dialect errors, coercion errors, and
 * anything the engine itself throws (`InvalidStyleError` for a `repeat()` with
 * a non-finite count, say). A demo must never take the page down.
 *
 * The parsed `styles` are returned alongside the laid-out tree because the
 * Chrome overlay renders the *same* source as real DOM: the demo dialect is
 * CSS-shaped, so those strings go straight onto elements without a second
 * translation that could itself be the thing that differs.
 */
function runDemo(source: string, available: number): Result {
  try {
    const styles = parseDemo(source);
    const root = buildTree(styles);
    computeLayout(root, { width: available, height: 'max-content' });
    return { ok: true, root, styles };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The engine's boxes, flattened to absolute coordinates in document order.
 *
 * Document order is what makes this comparable with the overlay: both walk the
 * same source tree depth-first, so index i is the same node in both lists.
 * `display: none` nodes are skipped in both — the overlay never renders one,
 * and the engine lays it out at zero size.
 */
function engineBoxes(node: LayoutNode, originX = 0, originY = 0, out: Rect[] = []): Rect[] {
  if (node.style.display === 'none') return out;
  const { location, size } = node.layout;
  const x = originX + location.x;
  const y = originY + location.y;
  out.push({ x, y, width: size.width, height: size.height });
  for (const child of node.children) engineBoxes(child, x, y, out);
  return out;
}

/**
 * Fallback available width, used for SSR and until the ResizeObserver reports.
 *
 * The viewport normally derives its width from the pane, but the first render
 * happens on the server where no pane exists. Demos in the docs are written
 * against this width, and `docs-demos.test.ts` asserts they lay out at it.
 */
const AVAILABLE_WIDTH = 600;

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
const ZOOMS = [1, 0.5, 0.25] as const;

/** Narrow enough to be useless; the drag handle stops here. */
const MIN_VIEWPORT = 80;

/**
 * Screen px the frame needs outside the viewport box: the dashed outline's
 * 4px offset on both sides, plus room for the handle straddling the right edge.
 */
const FRAME_ROOM = 26;

function Highlighted({ code }: { code: string }) {
  const rendered = useShiki(code, {
    lang: 'jsx',
    theme: 'github-light',
    components: {
      // The <pre> is a backdrop for the textarea, so it must not scroll or
      // capture events independently — the textarea on top owns both. Keep
      // shiki's own classes: `.shiki` is what the theme-switching CSS matches.
      pre: (props) => <pre {...props} className={`${props.className ?? ''} fd-demo-pre`} />,
    },
  });
  return <>{rendered}</>;
}

export function Demo({ children, code, height, stacked, zoom: initialZoom }: DemoProps) {
  const initial = (code ?? children ?? '').replace(/^\n/, '').trimEnd();
  const [source, setSource] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Highlighting is heavier than layout, so let it lag a keystroke behind
  // rather than blocking the preview update.
  const deferredSource = useDeferredValue(source);

  const [zoom, setZoom] = useState<number>(initialZoom ?? ZOOMS[0]);
  // Screen width of the preview pane. Null until measured, so the first paint
  // (and SSR) falls back to AVAILABLE_WIDTH rather than flashing a wrong size.
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  // Viewport width in ENGINE px, when the reader has dragged it. Null means
  // "follow the pane", which is the default at every zoom level.
  const [dragged, setDragged] = useState<number | null>(null);
  // Hover is transient; selection survives the pointer leaving. On touch there
  // is no hover at all, so tapping a node is the only way to inspect it.
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const [selected, setSelected] = useState<HoveredNode | null>(null);
  const [engines, setEngines] = useState<{ bento: boolean; browser: boolean }>({ bento: true, browser: false });
  const [browserBoxes, setBrowserBoxes] = useState<Rect[] | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  // The overlay is the *current* browser, whichever that is — naming it
  // "chrome" everywhere would be a lie on Safari, and the report wording below
  // depends on whether this browser is the conformance oracle. Resolved after
  // mount: navigator does not exist during SSR.
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  useEffect(() => setBrowser(detectBrowser(navigator.userAgent)), []);

  // What the highlight and badge describe: the pointer wins while it is over a
  // node, otherwise the last tap/click stands.
  const inspected = hovered ?? selected;

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setPaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clicking anywhere that is not a node clears the selection. Bound to the
  // document rather than the stage so a click outside the demo dismisses it
  // too; the rects call stopPropagation, so their own clicks never reach here.
  useEffect(() => {
    if (!selected) return;
    const clear = () => setSelected(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('click', clear);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', clear);
      document.removeEventListener('keydown', onKey);
    };
  }, [selected]);

  // At zoom z the viewport is drawn at scale z, so filling a pane of P screen
  // px takes P/z engine px. That is what makes 50% show twice the layout width
  // in the same space. FRAME_ROOM keeps the dashed outline and the drag handle
  // (which sit outside the viewport box) inside the pane at 100%.
  const fitted = ((paneWidth ?? AVAILABLE_WIDTH) - FRAME_ROOM) / zoom;
  const viewport = Math.max(MIN_VIEWPORT, dragged ?? fitted);

  const result = useMemo(() => runDemo(source, viewport), [source, viewport]);

  // Mid-edit invalid states are the common case, not the exception. Keeping the
  // last good tree means a half-typed value shows an error without blanking the
  // preview the reader is working against.
  const lastGood = useRef<LayoutNode | null>(null);
  if (result.ok) lastGood.current = result.root;
  const shown = result.ok ? result.root : lastGood.current;

  // Decided from the tree on screen, so a demo the reader widens by editing
  // reflows to stacked rather than starting to clip.
  const tooWide = (shown?.layout.size.width ?? 0) > SIDE_BY_SIDE_MAX_WIDTH;

  // The frame wraps the laid-out tree, with a floor so an empty or very short
  // demo still shows a viewport to drag rather than a collapsed line. Numeric
  // `height` is the caller's pane size, so it is unzoomed into engine px.
  const floor = typeof height === 'number' ? height / zoom : 200;
  const contentHeight = Math.max(floor, shown?.layout.size.height ?? 0);

  // Engine vs. browser, in the same units and the same order.
  const ours = useMemo(() => (shown ? engineBoxes(shown) : []), [shown]);
  const delta = engines.browser && browserBoxes ? maxDelta(ours, browserBoxes) : undefined;
  const agrees = delta !== undefined && delta !== null && delta <= AGREEMENT_EPSILON;
  const disagrees = delta !== undefined && !agrees;

  // Per-node browser geometry for the tooltip, matched by document order.
  const inspectedIndex = inspected ? ours.findIndex((b) => b.x === inspected.x && b.y === inspected.y) : -1;
  const inspectedBrowserBox = inspectedIndex >= 0 ? (browserBoxes?.[inspectedIndex] ?? null) : null;

  // Drag resizes from the right edge. The viewport is centered, so the pointer
  // travels half as far as the width changes — hence the doubling.
  const onDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = viewport;
    const move = (ev: PointerEvent) => {
      setDragged(Math.max(MIN_VIEWPORT, startWidth + ((ev.clientX - startX) * 2) / zoom));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      void ev;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Keyboard equivalent of the drag, so the viewport is not mouse-only.
  const onHandleKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
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
  };

  return (
    <div
      className="fd-demo not-prose my-6 overflow-hidden rounded-lg border border-fd-border"
      data-stacked={(stacked ?? tooWide) ? '' : undefined}
    >
      <div className="fd-demo-panes">
        <div className="fd-demo-editor">
          <Suspense fallback={<pre className="fd-demo-pre fd-demo-fallback">{deferredSource}</pre>}>
            <Highlighted code={deferredSource} />
          </Suspense>
          <textarea
            ref={textareaRef}
            className="fd-demo-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Editable layout demo source"
            style={{ minHeight: height ?? undefined }}
          />
        </div>

        {/* Measured here, not on the stage: the stage's width follows the
            viewport, so observing it would feed back into its own size. */}
        <div className="fd-demo-preview" ref={paneRef} style={{ minHeight: height ?? 220 }}>
          {/* Above everything, not tucked under the preview: a divergence from
              the oracle is the most important thing on screen when it happens,
              and a reader who scrolled to the layout should not have to scroll
              past it to learn the engine disagrees.
              In a Chromium browser the oracle itself disagrees, which means the
              engine is wrong — that is a bug report. Elsewhere the engine may be
              faithfully matching Chrome while this browser differs from it, so
              the ask is softer but still worth filing. */}
          {disagrees && browser && (
            <p className="fd-demo-report" role="alert">
              <span className="fd-demo-report-icon" aria-hidden="true">
                !
              </span>
              <span>
                {browser.isOracle ? (
                  <>
                    <strong>You found a bug.</strong> bento-layout aims to match {browser.name} exactly, so this
                    difference is a defect worth fixing.
                  </>
                ) : (
                  <>
                    <strong>Possibly a bug.</strong> bento-layout is verified against Chrome, so this may be{' '}
                    {browser.name} diverging from Chrome rather than an engine defect — please report it anyway and we
                    will take a look.
                  </>
                )}{' '}
                <a
                  className="fd-demo-report-link"
                  href={issueUrl({ source, browser, viewport, delta: delta ?? null })}
                  target="_blank"
                  rel="noreferrer"
                >
                  Report it →
                </a>
              </span>
            </p>
          )}

          <div className="fd-demo-toolbar">
            <fieldset className="fd-demo-zooms" aria-label="Preview zoom">
              {ZOOMS.map((z) => (
                <button
                  key={z}
                  type="button"
                  className="fd-demo-zoom"
                  data-active={z === zoom ? '' : undefined}
                  aria-pressed={z === zoom}
                  // Dragged width is in engine px and was chosen against the old
                  // zoom; clearing it refits the viewport to the new one.
                  onClick={() => {
                    setZoom(z);
                    setDragged(null);
                  }}
                >
                  {z * 100}%
                </button>
              ))}
            </fieldset>
            {/* Which engine's result is drawn. Both at once is the point of the
                comparison, so these are independent toggles, not a radio set.
                The second is labelled with the browser actually rendering the
                page, not a hardcoded name. */}
            <fieldset className="fd-demo-engines" aria-label="Layout engine">
              {(['bento', 'browser'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="fd-demo-engine"
                  data-engine={key}
                  data-active={engines[key] ? '' : undefined}
                  aria-pressed={engines[key]}
                  // Never let both go dark: turning off the last one would show
                  // an empty frame with no hint why.
                  onClick={() =>
                    setEngines((e) => {
                      const next = { ...e, [key]: !e[key] };
                      return next.bento || next.browser ? next : e;
                    })
                  }
                >
                  {key === 'bento' ? 'bento' : (browser?.name.toLowerCase() ?? 'browser')}
                </button>
              ))}
            </fieldset>

            {agrees && (
              <span className="fd-demo-verdict" data-match="">
                match
              </span>
            )}
            {disagrees && (
              <span className="fd-demo-verdict" data-mismatch="">
                {delta === null ? 'differs' : `differs by ${delta.toFixed(1)}px`}
              </span>
            )}

            {/* status, not a bare span: the value changes as the viewport is
                dragged, and a live region is what announces that. */}
            <output className="fd-demo-dims">
              {Math.round(viewport)} × {Math.round(shown?.layout.size.height ?? 0)} px
            </output>
          </div>

          {/* The viewport sits inside the stage, centered.
              A scaled element keeps its UNSCALED size in flow, so the stage is
              given the scaled height explicitly — otherwise 25% would reserve
              four times the space it visibly occupies. */}
          <div className="fd-demo-stage" style={{ height: contentHeight * zoom }}>
            {/* Unscaled chrome, sized to the viewport's screen footprint. */}
            <div className="fd-demo-frame" style={{ width: viewport * zoom, height: contentHeight * zoom }} />

            <div
              className="fd-demo-viewport"
              style={{ width: viewport, height: contentHeight, transform: `scale(${zoom})` }}
            >
              {engines.browser && result.ok && (
                <ChromeOverlay styles={result.styles} width={viewport} onMeasure={setBrowserBoxes} />
              )}

              {shown && engines.bento ? (
                <LayoutCanvas root={shown} hovered={inspected} onHover={setHovered} onSelect={setSelected} />
              ) : null}
              {!shown && <p className="fd-demo-empty">Nothing to show yet.</p>}

              {inspected &&
                (() => {
                  // Positioned in engine px inside the scaled viewport, but
                  // counter-scaled so the label stays readable at 25% rather
                  // than shrinking with the boxes. It sits above the node, and
                  // flips below when the node is too close to the top edge.
                  const gap = 5 / zoom;
                  const tipHeight = 21 / zoom;
                  const below = inspected.y < tipHeight + gap;
                  return (
                    <div
                      className="fd-demo-tip"
                      style={{
                        left: inspected.x,
                        top: below ? inspected.y + inspected.height + gap : inspected.y - tipHeight - gap,
                        transform: `scale(${1 / zoom})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      <span className="fd-demo-tip-tag">{inspected.display}</span>
                      <span>
                        {Math.round(inspected.width)} × {Math.round(inspected.height)}
                      </span>
                      {/* Both engines' numbers when the overlay is on, so the
                          comparison is readable per node and not just in
                          aggregate. */}
                      {inspectedBrowserBox && (
                        <span className="fd-demo-tip-alt">
                          {browser?.name.toLowerCase() ?? 'browser'} {Math.round(inspectedBrowserBox.width)} ×{' '}
                          {Math.round(inspectedBrowserBox.height)}
                        </span>
                      )}
                    </div>
                  );
                })()}
            </div>
            <button
              type="button"
              className="fd-demo-handle"
              onPointerDown={onDragStart}
              onKeyDown={onHandleKey}
              onDoubleClick={() => setDragged(null)}
              aria-label={`Viewport width, ${Math.round(viewport)} pixels. Arrow keys to resize, Home to fit.`}
              style={{ left: `calc(50% + ${(viewport * zoom) / 2}px)` }}
            />
          </div>

          {/* A disagreement is the interesting case, so it gets a way to act on
              it. In a Chromium browser the oracle itself disagrees, which means
              the engine is wrong — that is a bug report. Elsewhere the engine
              may be faithfully matching Chrome while this browser differs from
              it, so the ask is softer but still worth filing. */}
          {!result.ok && (
            <p className="fd-demo-error" role="alert">
              {result.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Demo;
