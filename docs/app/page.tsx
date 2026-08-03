import { highlight } from 'fumadocs-core/highlight';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BentoHero } from '@/components/landing/BentoHero';
import { CopyCommand } from '@/components/landing/CopyCommand';
import { MiniLayout, type MiniSpec } from '@/components/landing/MiniLayout';
import { OracleDiagram } from '@/components/landing/OracleDiagram';
import { Reveal } from '@/components/landing/Reveal';
import { BentoMark, SiteNav } from '@/components/landing/SiteNav';

export const metadata: Metadata = {
  // absolute: the title already names the project, so skip the root template's
  // "| bento-layout" suffix rather than repeating it.
  title: { absolute: 'bento-layout — flexbox, grid & block layout in plain TypeScript' },
  description:
    'A layout engine for TypeScript: style data in, pixel positions out. No WASM, no async loader, no node lifecycles. Verified against Chrome.',
};

/** `1fr` track. */
const fr = (n: number) => ({ min: 0, max: { fr: n } }) as const;

const SNIPPET = `import { LayoutNode, computeLayout } from 'bento-layout';

const left = LayoutNode.make({ flexGrow: 1 });
const right = LayoutNode.make({ flexGrow: 1 });
const root = LayoutNode.make({ width: 400, height: 300 }, [left, right]);

computeLayout(root, { width: 'max-content', height: 'max-content' });

left.layout.size;      // { width: 200, height: 300 }
right.layout.location; // { x: 200, y: 0 }`;

// The three mode cards each render a layout the engine computes on the
// server at request time — small, but real output.
const MODES: { title: string; body: string; spec: MiniSpec }[] = [
  {
    title: 'Flexbox',
    body: 'Grow, shrink, wrap, alignment with the safe variants, auto margins — the full algorithm, not the easy subset.',
    spec: {
      style: { width: 220, height: 110, display: 'flex', padding: 10, gap: 8 },
      children: [
        { style: { flexGrow: 1 } },
        {
          style: { flexGrow: 2, display: 'flex', padding: 8, gap: 6 },
          children: [{ style: { flexGrow: 1 } }, { style: { flexGrow: 1 } }],
        },
        { style: { width: 34 } },
      ],
    },
  },
  {
    title: 'CSS Grid',
    body: 'Tracks, spans, repeat(), auto-fill, dense packing — the grid Yoga releases still don’t ship.',
    spec: {
      style: {
        width: 220,
        height: 110,
        display: 'grid',
        padding: 10,
        gap: 8,
        gridTemplateColumns: [fr(1), fr(1), fr(1)],
        gridTemplateRows: [fr(1), fr(1)],
      },
      children: [
        { style: { gridColumnEnd: { span: 2 } } },
        { style: {} },
        { style: {} },
        { style: { gridColumnEnd: { span: 2 } } },
      ],
    },
  },
  {
    title: 'Block',
    body: 'Normal flow with CSS 2.2 margin collapsing — the mode document generators actually spend their time in.',
    spec: {
      style: { width: 220, display: 'block', padding: 10 },
      children: [
        { style: { height: 24, marginBottom: 14 } },
        { style: { height: 24, marginBottom: 8, marginLeft: 24 } },
        { style: { height: 24, marginLeft: 48 } },
      ],
    },
  },
];

// `target` drives the count-up on reveal; 0 is rendered as authored.
const FACTS: { n: string; target: number; label: string; tint: 'accent' | 'accent-2' }[] = [
  {
    n: '5,304',
    target: 5304,
    label: 'conformance fixtures, asserted at 0.1px against headless Chrome',
    tint: 'accent',
  },
  { n: '0', target: 0, label: 'runtime dependencies, WASM binaries, and async loaders', tint: 'accent-2' },
  { n: '3', target: 3, label: 'layout modes — flexbox, grid, block — composing in one tree', tint: 'accent-2' },
  { n: '4', target: 4, label: 'variants per fixture: both box-sizing modes × LTR and RTL', tint: 'accent' },
];

const API_POINTS: [term: string, rest: string, dot: string][] = [
  ['Styles are data', 'flat camelCase properties, the same spelling as element.style.', 'var(--organic-accent)'],
  ['Content-driven sizing', 'leaf nodes take a measure callback for text and images.', 'var(--organic-accent-2)'],
  [
    'Browser-faithful rounding',
    'pixels snap cumulatively, so adjacent boxes never gap or overlap.',
    'var(--color-accent-300)',
  ],
];

export default async function HomePage() {
  const code = await highlight(SNIPPET, {
    lang: 'typescript',
    theme: 'github-light',
  });

  return (
    <main className="relative overflow-x-clip">
      <SiteNav />

      {/* --- Hero --------------------------------------------------------- */}
      <section className="relative">
        {/* Decorative only, and below the nav's z-index so the circle can never
            cover the "Get started" pill. */}
        <div
          aria-hidden="true"
          className="ld-blob"
          style={{ top: -40, right: -120, width: 420, height: 420, background: 'var(--color-accent-100)' }}
        />
        <div
          aria-hidden="true"
          className="ld-blob"
          style={{
            top: 280,
            right: '44%',
            width: 180,
            height: 180,
            background: 'var(--color-accent-2-100)',
            animationDuration: '9s',
            animationDelay: '1.5s',
          }}
        />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-22 pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <span className="ld-tag ld-rise" style={{ ['--rise' as string]: 0 }}>
              {/* "layer" — the stacking this engine does. */}
              <span lang="ja">層</span> · a layout engine for TypeScript
            </span>
            <h1
              className="ld-display ld-rise mt-5 text-balance text-[54px] leading-[1.1] text-fd-foreground"
              style={{ ['--rise' as string]: 1 }}
            >
              Every box, neatly in its <span style={{ color: 'var(--color-accent-700)' }}>place</span>.
            </h1>
            <p
              className="ld-rise mt-5 max-w-[440px] text-pretty text-fd-muted-foreground"
              style={{ ['--rise' as string]: 2 }}
            >
              Flexbox, CSS Grid, and block layout in plain TypeScript. Style data in, pixel positions out — no WASM, no
              async init, no node lifecycles. Verified against Chrome.
            </p>
            <div className="ld-rise mt-8 flex flex-wrap items-center gap-3" style={{ ['--rise' as string]: 3 }}>
              <Link href="/docs" className="ld-btn ld-btn-primary">
                Get started
              </Link>
              <Link href="/playground" className="ld-btn ld-btn-secondary">
                Open the playground
              </Link>
            </div>
            <div className="ld-rise mt-5" style={{ ['--rise' as string]: 4 }}>
              <CopyCommand command="npm install bento-layout" />
            </div>
          </div>

          <div className="ld-rise" style={{ ['--rise' as string]: 2 }}>
            <BentoHero />
          </div>
        </div>
      </section>

      {/* --- Three modes ---------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <Reveal>
          <h2 className="ld-display text-center text-4xl text-fd-foreground">Three modes, one tree</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-fd-muted-foreground">
            A grid inside a flex row inside a block page is the normal case, not a special one. Each preview below is
            computed by the engine on the server, as this page renders.
          </p>
        </Reveal>
        <div className="mt-11 grid gap-6 md:grid-cols-3">
          {MODES.map((mode, i) => (
            <Reveal key={mode.title} delay={i * 120}>
              <div className="ld-card h-full">
                <div
                  className="p-4"
                  style={{
                    borderRadius: 16,
                    border: '1px solid var(--color-neutral-300)',
                    background: 'var(--organic-bg)',
                  }}
                >
                  <MiniLayout spec={mode.spec} />
                </div>
                <h3 className="ld-display mt-[18px] text-[22px] text-fd-foreground">{mode.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{mode.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --- API ------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        {/* Not an even split: the sample's longest line needs ~640px at 13px
            mono, and half of a 1152px container clips it mid-token. */}
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Reveal>
            <h2 className="ld-display text-4xl text-fd-foreground">The whole setup, ten lines</h2>
            <p className="mt-4 text-fd-muted-foreground">
              Nodes are ordinary JavaScript objects with ordinary lifetimes — an unreferenced subtree is just garbage
              collected. No engine instance to register with, no <code className="text-fd-foreground">free()</code> to
              remember, and it runs the same in Node, a browser, a worker, or an edge runtime.
            </p>
            <ul className="mt-6 flex list-none flex-col gap-3.5 p-0 text-sm text-fd-muted-foreground">
              {API_POINTS.map(([term, rest, dot]) => (
                <li key={term} className="flex items-baseline gap-3">
                  <span className="shrink-0" style={{ width: 10, height: 10, borderRadius: 999, background: dot }} />
                  <span>
                    <strong className="font-semibold text-fd-foreground">{term}</strong> — {rest}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm">
              <Link href="/docs/getting-started" className="text-fd-primary underline underline-offset-4">
                Five minutes to first layout →
              </Link>
            </p>
          </Reveal>
          <Reveal delay={150}>
            <div className="ld-code">{code}</div>
          </Reveal>
        </div>
      </section>

      {/* --- Numbers ---------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.label} delay={i * 100} className="text-center">
              <div
                className="ld-fact-circle"
                style={{
                  background: fact.tint === 'accent' ? 'var(--color-accent-100)' : 'var(--color-accent-2-100)',
                  color: fact.tint === 'accent' ? 'var(--color-accent-800)' : 'var(--color-accent-2-800)',
                }}
              >
                {/* Reveal reads data-count and animates 0 → target over 1300ms. */}
                <span data-count={fact.target}>{fact.n}</span>
              </div>
              <p className="mx-auto mt-3.5 max-w-[220px] text-sm leading-relaxed text-fd-muted-foreground">
                {fact.label}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --- Correctness ------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Reveal>
            <h2 className="ld-display text-4xl text-fd-foreground">Chrome is the oracle</h2>
            <p className="mt-4 text-fd-muted-foreground">
              Correctness is defined as agreement with a pinned Chrome. An in-repo pipeline extracts geometry from the
              real browser into replayable fixtures, and a differential fuzzer generates random trees, compares the
              engine against Chrome, and shrinks every disagreement to a minimal reproduction. When this engine says a
              box is at <code className="text-fd-foreground">x: 137</code>, that is where Chrome puts it too.
            </p>
            <p className="mt-4 text-fd-muted-foreground">
              The job of a layout engine is to be <em>correct and invisible</em> — a small, boring dependency that
              installs with the ceremony of <code>lodash</code>.
            </p>
            <p className="mt-6 text-sm">
              <Link href="/docs/explanation/correctness" className="text-fd-primary underline underline-offset-4">
                How conformance is measured →
              </Link>
            </p>
          </Reveal>
          <Reveal delay={150}>
            <OracleDiagram />
          </Reveal>
        </div>
      </section>

      {/* --- Closing CTA -------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <Reveal>
          <div className="ld-patch">
            <h2 className="ld-display text-[40px] text-fd-foreground">Ready when you are.</h2>
            <p className="mx-auto mt-3 max-w-[440px] text-fd-muted-foreground">
              One import, zero dependencies, layout on the next line.
            </p>
            {/* Said just before you start eating. Romaji as a subtitle under the
                kana — glossing the meaning would be explaining the joke. */}
            <p className="mt-6">
              <span lang="ja" className="ld-display block text-xl text-fd-foreground">
                いただきます
              </span>
              <span className="mt-1 block text-[13px] text-fd-muted-foreground" style={{ letterSpacing: '0.14em' }}>
                itadakimasu
              </span>
            </p>
            <div className="mt-7 flex justify-center gap-3">
              <Link href="/docs" className="ld-btn ld-btn-primary">
                Read the docs
              </Link>
              <Link href="/playground" className="ld-btn ld-btn-ghost">
                Try it live
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* --- Footer ------------------------------------------------------------- */}
      <footer className="border-t border-fd-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-fd-muted-foreground">
          <span className="flex items-center gap-2">
            <BentoMark className="opacity-80" />
            {/* The name, in the characters it comes from. */}
            <span lang="ja" className="ld-display text-fd-foreground">
              弁当
            </span>
            <span className="opacity-50">·</span>
            bento-layout · MIT
          </span>
          <span className="flex gap-6">
            <Link href="/docs" className="transition-colors hover:text-fd-foreground">
              Docs
            </Link>
            <Link href="/playground" className="transition-colors hover:text-fd-foreground">
              Playground
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
