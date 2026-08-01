'use client';

// The landing hero: a bento box laid out by the engine itself.
//
// Every variant is a real style tree handed to `computeLayout`; the divs are
// positioned from `node.layout` and nothing else. CSS transitions carry the
// boxes between one computed state and the next, so the animation the visitor
// watches *is* the engine re-running — not a canned keyframe of it.

import type { StyleInput } from 'bento-layout';
import { computeLayout, LayoutNode } from 'bento-layout';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Fixed tray size in engine units; scaled to the container with a transform. */
const TRAY_W = 560;
const TRAY_H = 340;

/** `1fr`-style track with a zero minimum, so ratios hold exactly. */
const fr = (n: number) => ({ min: 0, max: { fr: n } }) as const;

interface Spec {
  id: string;
  style: StyleInput;
  children?: Spec[];
}

/** Tamago compartment: three slices the inner flex lays out. */
const tamago = (direction: 'row' | 'column', style: StyleInput = {}): Spec => ({
  id: 'tamago',
  style: { display: 'flex', flexDirection: direction, gap: 8, padding: 10, ...style },
  children: ['t1', 't2', 't3'].map((id) => ({
    id,
    style: { flexGrow: 1, flexBasis: 0 },
  })),
});

/** Greens compartment: broccoli + tomato, aligned by the inner flex. */
const greens = (style: StyleInput = {}): Spec => ({
  id: 'greens',
  style: {
    display: 'flex',
    alignItems: { keyword: 'flex-end', safe: false },
    justifyContent: { keyword: 'center', safe: false },
    gap: 8,
    padding: 10,
    ...style,
  },
  children: [
    { id: 'g1', style: { flexGrow: 1, height: '70%' } },
    { id: 'g2', style: { width: 34, height: 34 } },
  ],
});

interface Variant {
  name: string;
  /** Shown under the tray: the style that produced this arrangement. */
  chip: string;
  root: Spec;
}

const VARIANTS: Variant[] = [
  {
    name: 'grid',
    chip: `display: 'grid',\ngridTemplateColumns: [fr(1.4), fr(1), fr(1), fr(0.8)]`,
    root: {
      id: 'tray',
      style: {
        width: TRAY_W,
        height: TRAY_H,
        display: 'grid',
        padding: 16,
        gap: 12,
        gridTemplateColumns: [fr(1.4), fr(1), fr(1), fr(0.8)],
        gridTemplateRows: [fr(1), fr(1.4)],
      },
      children: [
        { id: 'salmon', style: { gridRowEnd: { span: 2 } } },
        tamago('row', { gridColumnEnd: { span: 2 } }),
        { id: 'pickles', style: {} },
        greens(),
        { id: 'rice', style: { gridColumnEnd: { span: 2 } } },
      ],
    },
  },
  {
    name: 'flex row',
    chip: `display: 'flex', gap: 12,\nsalmon: { flexGrow: 1.3 } · rice: { flexGrow: 1.7 }`,
    root: {
      id: 'tray',
      style: {
        width: TRAY_W,
        height: TRAY_H,
        display: 'flex',
        padding: 16,
        gap: 12,
      },
      children: [
        { id: 'salmon', style: { flexGrow: 1.3, flexBasis: 0 } },
        tamago('column', { flexGrow: 1, flexBasis: 0 }),
        { id: 'pickles', style: { width: 52, height: 120, alignSelf: { keyword: 'center', safe: false } } },
        greens({ flexGrow: 1, flexBasis: 0 }),
        { id: 'rice', style: { flexGrow: 1.7, flexBasis: 0 } },
      ],
    },
  },
  {
    name: 'flex wrap',
    chip: `flexWrap: 'wrap',\nflexBasis: '55%' · '38%' · '16%' · …`,
    root: {
      id: 'tray',
      style: {
        width: TRAY_W,
        height: TRAY_H,
        display: 'flex',
        flexWrap: 'wrap',
        padding: 16,
        gap: 12,
        alignContent: { keyword: 'stretch', safe: false },
      },
      children: [
        { id: 'salmon', style: { flexBasis: '55%', flexGrow: 1 } },
        tamago('row', { flexBasis: '38%', flexGrow: 1 }),
        { id: 'pickles', style: { flexBasis: '16%', flexGrow: 1 } },
        greens({ flexBasis: '26%', flexGrow: 1 }),
        { id: 'rice', style: { flexBasis: '42%', flexGrow: 1 } },
      ],
    },
  },
  {
    name: 'grid, remixed',
    chip: `gridTemplateColumns: [{ repeat: 4, tracks: [fr(1)] }],\nrice: { gridColumnEnd: { span: 4 } }`,
    root: {
      id: 'tray',
      style: {
        width: TRAY_W,
        height: TRAY_H,
        display: 'grid',
        padding: 16,
        gap: 12,
        gridTemplateColumns: [{ repeat: 4, tracks: [fr(1)] }],
        gridTemplateRows: [fr(1), fr(1.1)],
      },
      children: [
        { id: 'salmon', style: {} },
        tamago('row'),
        { id: 'pickles', style: {} },
        greens(),
        { id: 'rice', style: { gridColumnEnd: { span: 4 } } },
      ],
    },
  },
];

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

function build(spec: Spec): LayoutNode {
  return LayoutNode.make(spec.style, (spec.children ?? []).map(build));
}

function flatten(spec: Spec, node: LayoutNode, px: number, py: number, depth: number, out: Box[]) {
  const { location, size } = node.layout;
  const x = px + location.x;
  const y = py + location.y;
  out.push({ id: spec.id, x, y, w: size.width, h: size.height, depth });
  spec.children?.forEach((child, i) => flatten(child, node.children[i], x, y, depth + 1, out));
}

/** Paint class per node id; slices share one. */
function paint(id: string): string {
  if (id.startsWith('t')) return 'bh-slice';
  if (id === 'g1') return 'bh-broccoli';
  if (id === 'g2') return 'bh-tomato';
  return `bh-${id}`;
}

const CYCLE_MS = 3600;

export function BentoHero() {
  const [variant, setVariant] = useState(0);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const { boxes, ms, nodeCount } = useMemo(() => {
    const spec = VARIANTS[variant].root;
    const root = build(spec);
    const t0 = performance.now();
    computeLayout(root, { width: 'max-content', height: 'max-content' });
    const t1 = performance.now();
    const out: Box[] = [];
    flatten(spec, root, 0, 0, 0, out);
    return { boxes: out, ms: t1 - t0, nodeCount: out.length };
  }, [variant]);

  // Auto-advance, unless hovered, hidden, or the visitor prefers less motion.
  useEffect(() => {
    if (paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      if (!document.hidden) setVariant((v) => (v + 1) % VARIANTS.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [paused]);

  // Scale the fixed-size tray to whatever width the hero column gives us.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / (TRAY_W + 32)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // Presentational wrapper: hovering (or tabbing into) the hero pauses the
    // decorative cycle. It activates nothing, so it gets no role — but focus
    // has to pause it too, or keyboard users can't hold a frame still.
    // biome-ignore lint/a11y/noStaticElementInteractions: hover/focus only pauses an animation; not a control.
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div ref={stageRef} className="bh-stage" style={{ height: (TRAY_H + 32) * scale }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            width: TRAY_W + 32,
            height: TRAY_H + 32,
            transform: `translateX(-50%) scale(${scale})`,
            transformOrigin: 'top center',
          }}
        >
          {boxes.map((b) =>
            b.depth === 0 ? (
              <div key={b.id} className="bh-tray" style={{ left: b.x + 16, top: b.y + 16, width: b.w, height: b.h }} />
            ) : (
              <div
                key={b.id}
                className={`bh-item ${paint(b.id)}`}
                style={{ left: b.x + 16, top: b.y + 16, width: b.w, height: b.h }}
              />
            ),
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="bh-chip flex-1">
          <strong>{VARIANTS[variant].name}</strong>
          {'  ·  '}
          {VARIANTS[variant].chip}
        </p>
        <div className="flex shrink-0 items-center gap-2" role="tablist" aria-label="Layout variants">
          {VARIANTS.map((v, i) => (
            <button
              key={v.name}
              type="button"
              role="tab"
              aria-selected={i === variant}
              aria-label={v.name}
              className="bh-dot"
              data-active={i === variant ? '' : undefined}
              onClick={() => setVariant(i)}
            />
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-fd-muted-foreground">
        {nodeCount} nodes, laid out by the engine in {ms < 0.05 ? '<0.05' : ms.toFixed(2)}&thinsp;ms — the boxes only
        transition between its computed positions.
      </p>
    </div>
  );
}

export default BentoHero;
