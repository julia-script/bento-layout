import Link from 'next/link';
import type { Metadata } from 'next';
import { highlight } from 'fumadocs-core/highlight';
import { BentoHero } from '@/components/landing/BentoHero';
import { CopyCommand } from '@/components/landing/CopyCommand';
import { MiniLayout, type MiniSpec } from '@/components/landing/MiniLayout';
import { Reveal } from '@/components/landing/Reveal';
import { BentoMark, SiteNav } from '@/components/landing/SiteNav';

export const metadata: Metadata = {
  title: 'bento-layout — flexbox, grid & block layout in plain TypeScript',
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

const FACTS: { n: string; label: string }[] = [
  { n: '5,304', label: 'conformance fixtures, asserted at 0.1px against headless Chrome' },
  { n: '0', label: 'runtime dependencies, WASM binaries, and async loaders' },
  { n: '3', label: 'layout modes — flexbox, grid, block — composing in one tree' },
  { n: '4', label: 'variants per fixture: both box-sizing modes × LTR and RTL' },
];

export default async function HomePage() {
  const code = await highlight(SNIPPET, {
    lang: 'typescript',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });

  return (
    <main className="relative overflow-x-clip">
      <SiteNav />

      {/* --- Hero --------------------------------------------------------- */}
      <section className="relative">
        <div className="ld-hero-bg" />
        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:pt-16">
          <div>
            <p className="ld-rise text-sm tracking-widest text-fd-primary" style={{ ['--rise' as string]: 0 }}>
              層 · A LAYOUT ENGINE FOR TYPESCRIPT
            </p>
            <h1
              className="ld-display ld-rise mt-4 text-balance text-4xl leading-tight text-fd-foreground sm:text-5xl"
              style={{ ['--rise' as string]: 1 }}
            >
              Every box,
              <br />
              neatly in its place.
            </h1>
            <p className="ld-rise mt-5 max-w-md text-pretty text-fd-muted-foreground" style={{ ['--rise' as string]: 2 }}>
              Flexbox, CSS Grid, and block layout in plain TypeScript. Style data goes in, pixel
              positions come out — no WASM to load, no async init, no node lifecycles to manage.
              Verified against Chrome.
            </p>
            <div className="ld-rise mt-8 flex flex-wrap items-center gap-4" style={{ ['--rise' as string]: 3 }}>
              <Link
                href="/docs"
                className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Get started
              </Link>
              <Link
                href="/playground"
                className="rounded-lg border border-fd-border px-5 py-2.5 text-sm text-fd-foreground transition-colors hover:border-fd-primary/50"
              >
                Open the playground
              </Link>
            </div>
            <div className="ld-rise mt-6" style={{ ['--rise' as string]: 4 }}>
              <CopyCommand command="npm install bento-layout" />
            </div>
          </div>

          <div className="ld-rise" style={{ ['--rise' as string]: 2 }}>
            <BentoHero />
          </div>
        </div>
      </section>

      {/* --- Three modes ---------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <Reveal>
          <div className="ld-divider mx-auto max-w-3xl">
            <span className="ld-divider-mark" />
          </div>
          <h2 className="ld-display mt-10 text-center text-3xl text-fd-foreground">
            Three modes, one tree
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-fd-muted-foreground">
            A grid inside a flex row inside a block page is the normal case, not a special one.
            Each preview below is computed by the engine on the server, as this page renders.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {MODES.map((mode, i) => (
            <Reveal key={mode.title} delay={i * 120}>
              <div className="ld-card h-full p-6">
                <div className="rounded-lg border border-fd-border bg-fd-background p-4">
                  <MiniLayout spec={mode.spec} />
                </div>
                <h3 className="ld-display mt-5 text-xl text-fd-foreground">{mode.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{mode.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --- API ------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <h2 className="ld-display text-3xl text-fd-foreground">
              The whole setup, ten lines
            </h2>
            <p className="mt-4 text-fd-muted-foreground">
              Nodes are ordinary JavaScript objects with ordinary lifetimes — an unreferenced
              subtree is just garbage collected. No engine instance to register with, no{' '}
              <code className="text-fd-foreground">free()</code> to remember, and it runs the same
              in Node, a browser, a worker, or an edge runtime.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-fd-muted-foreground">
              {[
                ['Styles are data', 'flat camelCase properties, the same spelling as element.style.'],
                ['Content-driven sizing', 'leaf nodes take a measure callback for text and images.'],
                ['Browser-faithful rounding', 'pixels snap cumulatively, so adjacent boxes never gap or overlap.'],
              ].map(([term, rest]) => (
                <li key={term} className="flex gap-3">
                  <span className="mt-1 size-1.5 shrink-0 rotate-45 bg-fd-primary" />
                  <span>
                    <strong className="font-medium text-fd-foreground">{term}</strong> — {rest}
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
            <div className="ld-code ld-card overflow-hidden">{code}</div>
          </Reveal>
        </div>
      </section>

      {/* --- Numbers ---------------------------------------------------------- */}
      <section className="border-y border-fd-border bg-fd-card/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.n + fact.label} delay={i * 100}>
              <p className="ld-display text-4xl text-fd-primary">{fact.n}</p>
              <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{fact.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --- Correctness ------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Reveal>
            <h2 className="ld-display text-3xl text-fd-foreground">Chrome is the oracle</h2>
            <p className="mt-4 text-fd-muted-foreground">
              Correctness is defined as agreement with a pinned Chrome. An in-repo pipeline
              extracts geometry from the real browser into replayable fixtures, and a
              differential fuzzer generates random trees, compares the engine against Chrome,
              and shrinks every disagreement to a minimal reproduction. When this engine says a
              box is at <code className="text-fd-foreground">x: 137</code>, that is where Chrome
              puts it too.
            </p>
            <p className="mt-4 text-fd-muted-foreground">
              The job of a layout engine is to be <em>correct and invisible</em> — a small,
              boring dependency that installs with the ceremony of <code>lodash</code>.
            </p>
            <p className="mt-6 text-sm">
              <Link
                href="/docs/explanation/correctness"
                className="text-fd-primary underline underline-offset-4"
              >
                How conformance is measured →
              </Link>
            </p>
          </Reveal>
          <Reveal delay={150}>
            {/* Generated illustration; decorative, so empty alt. */}
            <img
              src="/bento-illustration.png"
              alt=""
              className="mx-auto w-full max-w-sm rounded-2xl"
            />
          </Reveal>
        </div>
      </section>

      {/* --- Closing CTA -------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-4 text-center">
        <Reveal>
          <div className="ld-divider mx-auto max-w-3xl">
            <span className="ld-divider-mark" />
          </div>
          <h2 className="ld-display mt-12 text-3xl text-fd-foreground">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-fd-muted-foreground">
            One import, zero dependencies, layout on the next line.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Read the docs
            </Link>
            <Link
              href="/playground"
              className="rounded-lg border border-fd-border px-6 py-3 text-sm text-fd-foreground transition-colors hover:border-fd-primary/50"
            >
              Try it live
            </Link>
          </div>
        </Reveal>
      </section>

      {/* --- Footer ------------------------------------------------------------- */}
      <footer className="border-t border-fd-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-fd-muted-foreground">
          <span className="flex items-center gap-2">
            <BentoMark className="opacity-70" />
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
