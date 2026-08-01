import type { LayoutNode } from './tree.js';
import { internals } from './tree.js';

export type LayoutTraceAxis = 'width' | 'height';
export type LayoutTraceSource =
  | 'parent-known'
  | 'available-space'
  | 'preferred-size'
  | 'aspect-ratio'
  | 'min-max-clamp'
  | 'intrinsic-content'
  | 'stretch'
  | 'algorithm-output';

export interface LayoutTraceEvent {
  path: string;
  phase: string;
  source: LayoutTraceSource;
  axis: LayoutTraceAxis;
  value: number | null;
  detail?: string;
}

export type LayoutTraceSink = (event: LayoutTraceEvent) => void;

interface TraceContext {
  paths: WeakMap<LayoutNode, string>;
  sink: LayoutTraceSink;
}

let active: TraceContext | null = null;

/** Install a synchronous, nest-safe trace context for one computeLayout call. */
export function withLayoutTrace(root: LayoutNode, sink: LayoutTraceSink, run: () => void): void {
  const previous = active;
  const paths = new WeakMap<LayoutNode, string>();
  const walk = (node: LayoutNode, path: string): void => {
    paths.set(node, path);
    internals(node).children.forEach((child, index) => walk(child, `${path}/${index}`));
  };
  walk(root, 'root');
  active = { paths, sink };
  try {
    run();
  } finally {
    active = previous;
  }
}

/** No-op unless computeLayout was called with a trace sink. */
export function traceLayout(node: LayoutNode, event: Omit<LayoutTraceEvent, 'path'>): void {
  if (active === null) return;
  active.sink({ path: active.paths.get(node) ?? 'detached', ...event });
}
