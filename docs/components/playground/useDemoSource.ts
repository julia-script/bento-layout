'use client';

// The demo's code, and the tree it produces.
//
// Owns the two-source arrangement the playground needs: the PRISTINE source
// (what the page was authored with, or the example the reader just picked) and
// the COMPILED source (Monaco's TS emit, once the reader edits). Before Monaco
// loads, the pristine text runs through a regex import-rewrite instead — which
// is why demo sources must be annotation-free JavaScript.

import { useState } from 'react';
import type { DemoCode } from './Editor.js';
import { type RenderNode, rewriteImports, useDemoRun } from './runner.js';

export interface DemoSource {
  /** Current code, pristine or reader-edited. */
  demoCode: DemoCode;
  /** Pass to `Editor`'s `onCode`. */
  setDemoCode: (code: DemoCode) => void;
  /**
   * The tree to draw: the newest good result, or the last good one while an
   * edit is mid-flight.
   */
  shown: RenderNode | null;
  /** The failure to report, when the newest run did not produce a tree. */
  error: string | null;
}

export function useDemoSource(initial: string, viewport: number): DemoSource {
  // Until the reader edits, the demo runs the import-rewritten pristine
  // source; after that, Monaco's TypeScript emit takes over.
  const [demoCode, setDemoCode] = useState<DemoCode>(() => ({ source: initial, js: rewriteImports(initial) }));

  // A new pristine source (the example gallery switching layouts) replaces the
  // running code. Derived during render rather than in an effect so the
  // preview never paints the previous example's tree under the new one's code.
  // Editor pushes the same source into Monaco; its own compile then takes over.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setDemoCode({ source: initial, js: rewriteImports(initial) });
  }

  const result = useDemoRun(demoCode.js, viewport);

  // Mid-edit invalid states are the common case, not the exception. Keeping the
  // last good tree means a half-typed demo shows an error without blanking the
  // preview the reader is working against.
  //
  // State rather than a ref: a ref written during render is a side-effect that
  // React's double-invoked render (StrictMode, which this app enables) is free
  // to run twice, and the equality guard here keeps it to one update per new
  // tree rather than a render loop.
  const [lastGood, setLastGood] = useState<RenderNode | null>(null);
  if (result?.ok && result.root !== lastGood) setLastGood(result.root);

  return {
    demoCode,
    setDemoCode,
    shown: result?.ok ? result.root : lastGood,
    error: result && !result.ok ? result.message : null,
  };
}
