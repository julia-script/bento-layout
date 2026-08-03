'use client';

// Main-thread side of demo execution: the worker protocol, the pre-Monaco
// import rewrite, and the hook that owns a worker's lifecycle.
//
// Demo code runs in run.worker.ts (see there for why), so this file's job is
// plumbing: post the latest compiled source, keep only the newest answer, and
// treat silence as a hung demo — terminate the worker and start a fresh one,
// because a busy-looping worker never answers and never dies on its own.

import { useEffect, useRef, useState } from 'react';

/** A laid-out node as plain data. `x`/`y` are relative to the parent box. */
export interface RenderNode {
  /** The node's resolved style as inline CSS, for the browser overlay. */
  css: Record<string, string>;
  display: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: RenderNode[];
}

export interface RunRequest {
  id: number;
  /** CommonJS JavaScript — Monaco's TS emit, or {@link rewriteImports} output. */
  js: string;
  width: number;
}

export type RunResponse = { id: number; ok: true; root: RenderNode } | { id: number; ok: false; message: string };

export type RunResult = { ok: true; root: RenderNode } | { ok: false; message: string };

/**
 * Rewrite ES import statements to the `require` calls the worker provides.
 *
 * Only the module-less path: it covers the pristine demo source a page loads
 * with, which is authored here and uses plain named imports. The moment the
 * reader edits, Monaco is up and its TypeScript emit replaces this entirely —
 * including type annotations and every import form.
 */
export function rewriteImports(source: string): string {
  return source
    .replace(/^import\s+type\s+[^;]*from\s*['"]bento-layout['"];?\s*$/gm, '')
    .replace(
      /^import\s*\{([^}]*)\}\s*from\s*['"]bento-layout['"];?\s*$/gm,
      (_, names: string) => `const {${names.replace(/\btype\s+/g, '')}} = require('bento-layout');`,
    )
    .replace(/^import\s*\*\s*as\s+(\w+)\s+from\s*['"]bento-layout['"];?\s*$/gm, "const $1 = require('bento-layout');");
}

/**
 * How long a run may stay silent before it counts as hung.
 *
 * A layout run is single-digit milliseconds; the margin covers a cold worker
 * (module fetch + engine parse) on a slow connection, not real work.
 */
const RUN_TIMEOUT_MS = 3000;

/**
 * Run demo code in a worker whenever it (or the viewport) changes.
 *
 * Returns the latest completed result, or null before the first one. Stale
 * answers are dropped by id, so a slow older run can never overwrite a newer
 * one. On timeout the worker is killed and the next change starts a new one.
 */
export function useDemoRun(js: string, width: number): RunResult | null {
  const [result, setResult] = useState<RunResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = ++nextId.current;

    if (!workerRef.current) {
      const worker = new Worker(new URL('./run.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<RunResponse>) => {
        if (event.data.id !== nextId.current) return; // stale run
        if (watchdog.current) clearTimeout(watchdog.current);
        const { id: _, ...rest } = event.data;
        setResult(rest);
      };
      workerRef.current = worker;
    }

    workerRef.current.postMessage({ id, js, width } satisfies RunRequest);

    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      workerRef.current?.terminate();
      workerRef.current = null;
      setResult({ ok: false, message: 'this demo ran for too long and was stopped — check for an infinite loop' });
    }, RUN_TIMEOUT_MS);

    return () => {
      if (watchdog.current) clearTimeout(watchdog.current);
    };
  }, [js, width]);

  // Terminate on unmount only — the run effect above reuses the worker.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return result;
}
