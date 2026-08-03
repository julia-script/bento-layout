'use client';

// The editable demo: source on one side, the engine's layout on the other.
//
// One component serves both inline docs demos and the standalone playground —
// they differ only in size. The source is real TypeScript against the real
// engine API; it is compiled in the editor (Monaco's TS emit) and executed in
// a worker (see run.worker.ts), and the demo shows whatever tree the code
// hands to `renderPlayground`.
//
// This file is composition and markup. The state lives in four hooks, one per
// concern, because every bug this component has shipped came from one concern
// reading another's values:
//
//   useDemoSource        pristine vs. compiled code, and the tree it produces
//   useViewport          how wide the engine lays out, and at what scale
//   useBrowserComparison the overlay's measurement and the match/differs verdict
//   useInspection        which node the reader is pointing at
//
// The rule that keeps them independent: nothing may derive a layout INPUT from
// a layout OUTPUT. The stacked/side-by-side split is CSS's alone, the viewport
// comes from the pane rather than the tree, and the comparison only trusts a
// measurement stamped with the state still on screen.

import { useShiki } from 'fumadocs-core/highlight/client';
import { Suspense, useEffect, useId, useMemo, useState } from 'react';
import { type BrowserInfo, detectBrowser, issueUrl, type Rect } from './browser.js';
import { ChromeOverlay } from './ChromeOverlay.js';
import { Editor } from './Editor.js';
import { LayoutCanvas } from './LayoutBox.js';
import type { RenderNode } from './runner.js';
import { useBrowserComparison } from './useBrowserComparison.js';
import { useDemoSource } from './useDemoSource.js';
import { useInspection } from './useInspection.js';
import { useViewport, ZOOMS, type Zoom } from './useViewport.js';

export interface DemoProps {
  /** Initial demo source. Readers edit from here; edits are not persisted. */
  children?: string;
  /** Alias for `children`, for callers passing source as a prop. */
  code?: string;
  /** Preview height. Defaults to a size that suits an inline docs demo. */
  height?: number | string;
  /**
   * Force the stacked (single-column) layout at every window width.
   *
   * Leave unset for the default, which is CSS's alone: side-by-side above
   * 768px, stacked below. This must stay a static caller decision — deriving
   * it from the pane or the laid-out tree creates a feedback loop, since a
   * fluid demo's width is itself a function of whether it is stacked.
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
  zoom?: Zoom;
}

/**
 * The engine's boxes, flattened to absolute coordinates in document order.
 *
 * Document order is what makes this comparable with the overlay: both walk the
 * same serialized tree depth-first, so index i is the same node in both lists.
 * (`display: none` subtrees never reach either — the worker drops them when it
 * serializes.)
 */
function engineBoxes(node: RenderNode, originX = 0, originY = 0, out: Rect[] = []): Rect[] {
  const x = originX + node.x;
  const y = originY + node.y;
  out.push({ x, y, width: node.width, height: node.height });
  for (const child of node.children) engineBoxes(child, x, y, out);
  return out;
}

function Highlighted({ code }: { code: string }) {
  const rendered = useShiki(code, {
    lang: 'typescript',
    theme: 'github-light',
    components: {
      // Purely a stand-in while Monaco loads, so it must not scroll or capture
      // events of its own. Keep shiki's own classes: `.shiki` is what the
      // theme-switching CSS matches.
      //
      // `backgroundColor: undefined` drops the theme's own inline background.
      // github-light's is white, and as an inline style it beat the
      // stylesheet — the editor pane flashed a white slab on every load until
      // Monaco mounted and replaced it.
      pre: (props) => (
        <pre
          {...props}
          className={`${props.className ?? ''} fd-demo-pre`}
          style={{ ...props.style, backgroundColor: undefined }}
        />
      ),
    },
  });
  return <>{rendered}</>;
}

/**
 * The engine disagreed with the browser — the most important thing on screen.
 *
 * Rendered above the preview, not under it: a reader who scrolled to the layout
 * should not have to scroll past it to learn the engine is wrong. In a Chromium
 * browser the oracle itself disagrees, so that IS a defect; elsewhere the
 * engine may be faithfully matching Chrome while this browser differs from it,
 * so the ask is softer but still worth filing.
 */
function DivergenceReport({
  browser,
  source,
  viewport,
  delta,
}: {
  browser: BrowserInfo;
  source: string;
  viewport: number;
  delta: number | null;
}) {
  return (
    <p className="fd-demo-report" role="alert">
      <span className="fd-demo-report-icon" aria-hidden="true">
        !
      </span>
      <span>
        {browser.isOracle ? (
          <>
            <strong>You found a bug.</strong> bento-layout aims to match {browser.name} exactly, so this difference is a
            defect worth fixing.
          </>
        ) : (
          <>
            <strong>Possibly a bug.</strong> bento-layout is verified against Chrome, so this may be {browser.name}{' '}
            diverging from Chrome rather than an engine defect — please report it anyway and we will take a look.
          </>
        )}{' '}
        <a
          className="fd-demo-report-link"
          href={issueUrl({ source, browser, viewport, delta })}
          target="_blank"
          rel="noreferrer"
        >
          Report it →
        </a>
      </span>
    </p>
  );
}

export function Demo({ children, code, height, stacked, zoom: initialZoom }: DemoProps) {
  const initial = (code ?? children ?? '').replace(/^\n/, '').trimEnd();
  const editorPath = `demo-${useId().replace(/[^a-zA-Z0-9]/g, '')}.ts`;

  const { paneRef, viewport, zoom, setZoom, onDragStart, onHandleKey, resetWidth } = useViewport(initialZoom);
  const { demoCode, setDemoCode, shown, error } = useDemoSource(initial, viewport);
  const { inspected, setHovered, setSelected } = useInspection();

  const [engines, setEngines] = useState<{ bento: boolean; browser: boolean }>({ bento: true, browser: false });

  const ours = useMemo(() => (shown ? engineBoxes(shown) : []), [shown]);
  const { browserBoxes, delta, agrees, disagrees, onMeasure } = useBrowserComparison(
    engines.browser,
    ours,
    shown,
    viewport,
    zoom,
  );

  // The overlay is the *current* browser, whichever that is — naming it
  // "chrome" everywhere would be a lie on Safari, and the report wording
  // depends on whether this browser is the conformance oracle. Resolved after
  // mount: navigator does not exist during SSR.
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  useEffect(() => setBrowser(detectBrowser(navigator.userAgent)), []);

  // The frame wraps the laid-out tree, with a floor so an empty or very short
  // demo still shows a viewport to drag rather than a collapsed line. Numeric
  // `height` is the caller's pane size, so it is unzoomed into engine px.
  const floor = typeof height === 'number' ? height / zoom : 200;
  const contentHeight = Math.max(floor, shown?.height ?? 0);

  // Per-node browser geometry for the tooltip, matched by document order.
  const inspectedIndex = inspected ? ours.findIndex((b) => b.x === inspected.x && b.y === inspected.y) : -1;
  const inspectedBrowserBox = inspectedIndex >= 0 ? (browserBoxes?.[inspectedIndex] ?? null) : null;

  return (
    <div
      className="fd-demo not-prose my-6 overflow-hidden rounded-lg border border-fd-border"
      data-stacked={stacked ? '' : undefined}
    >
      <div className="fd-demo-panes">
        <Editor
          path={editorPath}
          initialSource={initial}
          onCode={setDemoCode}
          minHeight={typeof height === 'number' ? height : 160}
          fallback={
            <Suspense fallback={<pre className="fd-demo-pre fd-demo-fallback">{initial}</pre>}>
              <Highlighted code={initial} />
            </Suspense>
          }
        />

        {/* Measured here, not on the stage: the stage's width follows the
            viewport, so observing it would feed back into its own size. */}
        <div className="fd-demo-preview" ref={paneRef} style={{ minHeight: height ?? 220 }}>
          {disagrees && browser && (
            <DivergenceReport browser={browser} source={demoCode.source} viewport={viewport} delta={delta ?? null} />
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
                  onClick={() => setZoom(z)}
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
                {delta === null || delta === undefined ? 'differs' : `differs by ${delta.toFixed(1)}px`}
              </span>
            )}

            {/* status, not a bare span: the value changes as the viewport is
                dragged, and a live region is what announces that. */}
            <output className="fd-demo-dims">
              {viewport} × {Math.round(shown?.height ?? 0)} px
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
              {engines.browser && shown && (
                <ChromeOverlay root={shown} width={viewport} zoom={zoom} onMeasure={onMeasure} />
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
              onDoubleClick={resetWidth}
              aria-label={`Viewport width, ${viewport} pixels. Arrow keys to resize, Home to fit.`}
              style={{ left: `calc(50% + ${(viewport * zoom) / 2}px)` }}
            />
          </div>

          {/* Errors are part of editing, not a failure of the page: a half-typed
              demo, a missing renderPlayground call, or a runtime throw all land
              here while the last good layout stays up. */}
          {error && (
            <p className="fd-demo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Demo;
