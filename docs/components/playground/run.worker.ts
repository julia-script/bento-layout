// Runs a demo's compiled JavaScript and reports the laid-out tree.
//
// Demos are real code, so they are *executed*, and execution happens here in a
// dedicated worker rather than on the page: an accidental `while (true)` typed
// mid-edit must cost a worker (which the runner terminates and respawns), not
// the tab. The old dialect parser guarded against the NaN flavour of this
// hazard for the same reason; eval broadens it to arbitrary loops, so the
// whole run moves off the main thread.
//
// The code arrives as CommonJS (Monaco's TS emit, or the import rewrite in
// runner.ts before Monaco loads). `require` resolves exactly one module —
// the real engine — so a demo pasted into a reader's own project works
// unchanged apart from `renderPlayground`, which their renderer replaces.

import * as bento from 'bento-layout';
import type { RenderNode, RunRequest, RunResponse } from './runner.js';
import { serialize } from './serialize.js';

/**
 * Reject non-finite geometry before it reaches the page.
 *
 * Type errors do not stop execution — Monaco still emits for `width: true` —
 * and garbage style values can come out of the engine as NaN boxes, which SVG
 * then chokes on. One guard here keeps every renderer downstream honest.
 */
function assertFiniteGeometry(node: RenderNode): void {
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
    throw new Error('layout produced non-finite geometry — check the style values for invalid input');
  }
  for (const child of node.children) assertFiniteGeometry(child);
}

const post = (message: RunResponse) => (self as unknown as { postMessage(m: RunResponse): void }).postMessage(message);

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { id, js, width } = event.data;
  try {
    const rendered: bento.LayoutNode[] = [];
    const renderPlayground = (root: bento.LayoutNode) => {
      if (!(root instanceof bento.LayoutNode)) {
        throw new Error('renderPlayground() takes the root LayoutNode of your tree');
      }
      rendered.push(root);
    };
    const requireShim = (specifier: string) => {
      if (specifier === 'bento-layout') return bento;
      throw new Error(`demos can only import 'bento-layout', got '${specifier}'`);
    };

    // eslint-style dynamic evaluation is the point here: the demo is code.
    const run = new Function('require', 'exports', 'module', 'renderPlayground', js);
    const moduleShim = { exports: {} };
    run(requireShim, moduleShim.exports, moduleShim, renderPlayground);

    const root = rendered.at(-1);
    if (!root) {
      throw new Error('call renderPlayground(root) to display a layout');
    }
    // The playground lays the tree out against its own viewport, so the drag
    // handle and zoom presets rerun the demo against real widths. A demo that
    // already called computeLayout itself is simply laid out again.
    bento.computeLayout(root, { width, height: 'max-content' });
    const serialized = serialize(root);
    if (!serialized) throw new Error('the root node has display: none — nothing to display');
    assertFiniteGeometry(serialized);
    post({ id, ok: true, root: serialized });
  } catch (err) {
    post({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
