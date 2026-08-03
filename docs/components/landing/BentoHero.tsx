'use client';

// The landing hero: a bento box laid out by the engine itself.
//
// Every variant is a real style tree handed to `computeLayout`; the divs are
// positioned from `node.layout` and nothing else. CSS transitions carry the
// boxes between one computed state and the next, so the animation the visitor
// watches *is* the engine re-running — not a canned keyframe of it.
//
// Only the PAINT layer is themed: the compartments are drawn as flat vector
// food with an offset "cartoon depth" shadow. The layout logic below (specs,
// computeLayout, flatten, scaling, auto-advance) is what the page is actually
// demonstrating — do not restructure it.

import type { StyleInput } from 'bento-layout';
import { computeLayout, LayoutNode } from 'bento-layout';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

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

/** Greens compartment. Its two children still participate in layout (the node
 *  count stays honest) but paint nothing — see `paintBox`. */
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
  /** Shown under the tray: the style object that produced this arrangement. */
  chip: string;
  root: Spec;
}

const VARIANTS: Variant[] = [
  {
    name: 'grid',
    chip: `{ display: 'grid', padding: 16, gap: 12,
  gridTemplateColumns: [fr(1.4), fr(1), fr(1), fr(0.8)],
  gridTemplateRows: [fr(1), fr(1.4)] }`,
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
    chip: `{ display: 'flex', gap: 12 }
salmon: { flexGrow: 1.3 }, rice: { flexGrow: 1.7 }`,
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
    chip: `{ display: 'flex', flexWrap: 'wrap', gap: 12 }
flexBasis: '55%', '38%', '16%', '26%', '42%'`,
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
    chip: `{ display: 'grid',
  gridTemplateColumns: [{ repeat: 4, tracks: [fr(1)] }] }
rice: { gridColumnEnd: { span: 4 } }`,
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

const ink = (a: number) => `color-mix(in srgb, var(--organic-text) ${a}%, transparent)`;

/** Marbling / sprinkle overlays. `stretch` lets the salmon's waves distort
 *  with the box; the rice sprinkle keeps its aspect. */
function Overlay({ viewBox, stretch, children }: { viewBox: string; stretch?: boolean; children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
    >
      {children}
    </svg>
  );
}

/**
 * One computed box, painted. Returns null for nodes that participate in layout
 * but are deliberately not drawn.
 */
function paintBox(b: Box) {
  const style = { left: b.x + 16, top: b.y + 16, width: b.w, height: b.h };
  const key = `${b.id}-${b.depth}`;

  if (b.id === 'tray') return <div key={key} className="bh-tray" style={style} />;

  if (b.id === 'salmon')
    return (
      <div key={key} className="bh-item bh-salmon" style={style}>
        <Overlay viewBox="0 0 100 100" stretch>
          <path
            d="M-6 24 Q 20 14 48 26 T 106 22"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth={4.5}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M-6 52 Q 24 42 52 54 T 106 50"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={4.5}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M-6 80 Q 20 70 48 82 T 106 78"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={4.5}
            fill="none"
            strokeLinecap="round"
          />
        </Overlay>
      </div>
    );

  if (b.id === 'rice')
    return (
      <div key={key} className="bh-item bh-rice" style={style}>
        <Overlay viewBox="0 0 100 100">
          {/* grain arcs */}
          <path
            d="M14 26 q6 -7 12 0 M70 20 q6 -7 12 0 M20 76 q6 -7 12 0 M74 70 q6 -7 12 0"
            stroke="var(--color-neutral-300)"
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
          />
          {/* nori */}
          <rect
            x={42}
            y={40}
            width={6.5}
            height={6.5}
            rx={1}
            transform="rotate(14 45 43)"
            fill="var(--color-accent-2-900)"
          />
          <rect
            x={56}
            y={50}
            width={6}
            height={6}
            rx={1}
            transform="rotate(-18 59 53)"
            fill="var(--color-accent-2-900)"
          />
          <rect
            x={38}
            y={56}
            width={5.5}
            height={5.5}
            rx={1}
            transform="rotate(30 41 59)"
            fill="var(--color-accent-2-900)"
          />
          {/* sesame */}
          <ellipse cx={52} cy={34} rx={2.6} ry={1.6} transform="rotate(24 52 34)" fill="var(--color-accent-700)" />
          <ellipse cx={62} cy={42} rx={2.6} ry={1.6} transform="rotate(-30 62 42)" fill="var(--color-accent-700)" />
          <ellipse cx={34} cy={46} rx={2.6} ry={1.6} transform="rotate(10 34 46)" fill="var(--color-accent-700)" />
          <ellipse cx={48} cy={64} rx={2.6} ry={1.6} transform="rotate(-14 48 64)" fill="var(--color-accent-700)" />
          <circle cx={58} cy={60} r={1.4} fill={ink(60)} />
          <circle cx={42} cy={32} r={1.4} fill={ink(60)} />
        </Overlay>
      </div>
    );

  if (b.id === 'tamago') return <div key={key} className="bh-item bh-tamago" style={style} />;

  // t1 / t2 / t3 — the egg slices.
  if (b.id.startsWith('t')) return <div key={key} className="bh-item bh-slice" style={style} />;

  // In layout, not on screen: at compartment scale these read as clutter.
  if (b.id === 'g1' || b.id === 'g2') return null;

  if (b.id === 'greens') return <div key={key} className="bh-item bh-greens" style={style} />;

  if (b.id === 'pickles')
    return (
      <div key={key} className="bh-item bh-pickles" style={style}>
        <Overlay viewBox="0 0 80 60">
          {/* cucumber slices */}
          <circle
            cx={50}
            cy={20}
            r={11}
            fill="var(--color-accent-2-200)"
            stroke="var(--color-accent-2-700)"
            strokeWidth={3}
          />
          <circle cx={50} cy={20} r={6} fill="var(--color-accent-2-100)" />
          <circle
            cx={26}
            cy={28}
            r={14}
            fill="var(--color-accent-2-200)"
            stroke="var(--color-accent-2-700)"
            strokeWidth={3}
          />
          <circle cx={26} cy={28} r={8.5} fill="var(--color-accent-2-100)" />
          <ellipse cx={23} cy={25} rx={1.8} ry={1.1} fill="var(--color-accent-2-600)" />
          <ellipse cx={29} cy={28} rx={1.8} ry={1.1} transform="rotate(50 29 28)" fill="var(--color-accent-2-600)" />
          <ellipse cx={25} cy={32} rx={1.8} ry={1.1} transform="rotate(-40 25 32)" fill="var(--color-accent-2-600)" />
          {/* kamaboko */}
          <path
            d="M46 46 a14 14 0 0 1 28 0 Z"
            fill="var(--color-accent-300)"
            stroke="var(--color-accent-600)"
            strokeWidth={2.5}
          />
          <path d="M52 46 a8 8 0 0 1 16 0" fill="none" stroke="var(--color-accent-500)" strokeWidth={2} />
        </Overlay>
      </div>
    );

  return <div key={key} className="bh-item" style={style} />;
}

const CYCLE_MS = 3600;

export function BentoHero() {
  const [variant, setVariant] = useState(0);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLButtonElement>(null);
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

  const next = () => setVariant((v) => (v + 1) % VARIANTS.length);

  // The measured time differs on every run, so the server's number and the
  // client's never agree — printing it during SSR throws a hydration mismatch,
  // which unmounts the whole client tree (and with it every Reveal on the
  // page). Render it only after mount; the server emits the node count alone.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
      {/* Advancing the variant is the dots' job too; this is a shortcut, so it
          stays a button for keyboard and AT rather than a click handler on a
          div. */}
      <button
        type="button"
        ref={stageRef}
        className="bh-stage w-full"
        style={{ height: (TRAY_H + 32) * scale }}
        onClick={next}
        aria-label="Show the next layout variant"
      >
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
          {boxes.map(paintBox)}
        </div>
      </button>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="bh-chip flex-1">
          <span className="bh-chip-comment">{`// ${VARIANTS[variant].name}`}</span>
          {'\n'}
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
        {nodeCount} nodes, laid out by the engine{mounted ? ` in ${ms < 0.05 ? '<0.05' : ms.toFixed(2)} ms` : ''} — the
        boxes only move between its computed positions.
      </p>
    </div>
  );
}

export default BentoHero;
