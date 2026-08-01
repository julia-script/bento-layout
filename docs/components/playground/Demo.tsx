'use client';

// The editable demo: source on one side, the engine's layout on the other.
//
// One component serves both inline docs demos and the standalone playground —
// they differ only in size. Editing is a transparent <textarea> over
// Shiki-highlighted output, so a docs page carrying a demo does not also carry
// an editor bundle; Fumadocs already ships Shiki for its code blocks.

import { Suspense, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useShiki } from 'fumadocs-core/highlight/client';
import { computeLayout } from 'bento-layout';
import type { LayoutNode } from 'bento-layout';
import { demoToTree } from './parse.js';
import { LayoutCanvas } from './LayoutBox.js';

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

type Result =
  | { ok: true; root: LayoutNode }
  | { ok: false; message: string };

/**
 * Parse, build, and lay out demo source.
 *
 * Every failure mode is caught here: dialect errors, coercion errors, and
 * anything the engine itself throws (`InvalidStyleError` for a `repeat()` with
 * a non-finite count, say). A demo must never take the page down.
 */
function runDemo(source: string, available: number): Result {
  try {
    const root = demoToTree(source);
    computeLayout(root, { width: available, height: 'max-content' });
    return { ok: true, root };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** The demo's own available width. Fixed so a demo lays out the same for everyone. */
const AVAILABLE_WIDTH = 600;

function Highlighted({ code }: { code: string }) {
  const rendered = useShiki(code, {
    lang: 'jsx',
    themes: { light: 'github-light', dark: 'github-dark' },
    // Colors via CSS variables rather than inline light-theme colors, so
    // fumadocs' `.dark .shiki` rules can switch the palette.
    defaultColor: false,
    components: {
      // The <pre> is a backdrop for the textarea, so it must not scroll or
      // capture events independently — the textarea on top owns both. Keep
      // shiki's own classes: `.shiki` is what the theme-switching CSS matches.
      pre: (props) => (
        <pre {...props} className={`${props.className ?? ''} fd-demo-pre`} />
      ),
    },
  });
  return <>{rendered}</>;
}

export function Demo({ children, code, height, stacked }: DemoProps) {
  const initial = (code ?? children ?? '').replace(/^\n/, '').trimEnd();
  const [source, setSource] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Highlighting is heavier than layout, so let it lag a keystroke behind
  // rather than blocking the preview update.
  const deferredSource = useDeferredValue(source);

  const result = useMemo(() => runDemo(source, AVAILABLE_WIDTH), [source]);

  // Mid-edit invalid states are the common case, not the exception. Keeping the
  // last good tree means a half-typed value shows an error without blanking the
  // preview the reader is working against.
  const lastGood = useRef<LayoutNode | null>(null);
  if (result.ok) lastGood.current = result.root;
  const shown = result.ok ? result.root : lastGood.current;

  // Decided from the tree on screen, so a demo the reader widens by editing
  // reflows to stacked rather than starting to clip.
  const tooWide = (shown?.layout.size.width ?? 0) > SIDE_BY_SIDE_MAX_WIDTH;

  return (
    <div
      className="fd-demo not-prose my-6 overflow-hidden rounded-lg border border-fd-border"
      data-stacked={(stacked ?? tooWide) ? '' : undefined}
    >
      <div className="fd-demo-panes">
        <div className="fd-demo-editor">
          <Suspense
            fallback={<pre className="fd-demo-pre fd-demo-fallback">{deferredSource}</pre>}
          >
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

        <div className="fd-demo-preview" style={{ minHeight: height ?? 220 }}>
          {shown ? (
            <LayoutCanvas root={shown} />
          ) : (
            <p className="fd-demo-empty">Nothing to show yet.</p>
          )}
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
