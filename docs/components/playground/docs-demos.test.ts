// Every <Demo> block in the docs content must run and lay out.
//
// The docs promise that demos are live; a demo whose source fails to execute
// renders as an error panel instead. This walks the real MDX content, so a
// demo edited in a doc page is covered without registration.
//
// Demos run here exactly the way the site runs them before Monaco loads:
// through rewriteImports and plain evaluation. That path cannot handle
// TypeScript-only syntax (annotations, `as const`, interfaces), so this suite
// also enforces the rule that pristine demo source is annotation-free JS —
// a demo that needs the TS compiler would break the site's first render too.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@mdx-js/mdx';
import * as bento from 'bento-layout';
import { describe, expect, it } from 'vitest';
import { unreachable } from '../../../src/assert.js';
import { formatDemoSource } from './format.js';
import { rewriteImports } from './runner.js';

const DOCS_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CONTENT_ROOT = join(DOCS_ROOT, 'content', 'docs');

/** Mirrors AVAILABLE_WIDTH in Demo.tsx — demos lay out at this width. */
const AVAILABLE_WIDTH = 600;

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(full);
    return entry.name.endsWith('.mdx') ? [full] : [];
  });
}

const DEMO_RE = /^([ \t]*)<Demo(?:\s[^>]*)?>\s*\{`([\s\S]*?)`\}\s*<\/Demo>/gm;

/**
 * The demo strings `<Demo>` actually receives, taken from compiled MDX.
 *
 * NOT read straight out of the .mdx file. MDX removes two spaces (markdown's
 * continuation indent, clamped at zero) from every line but the first of a
 * template literal inside a JSX expression, so demo blocks in the .mdx carry
 * two spaces of compensation and look over-indented on purpose — that is what
 * makes them arrive correctly formatted. Reading the file directly hid this
 * for a whole release: the file text looked right, the browser got it
 * dedented, and pressing format reindented code the reader never touched.
 * Compiling here is what makes these assertions test the real input.
 */
async function compiledDemoSources(file: string): Promise<string[]> {
  const body = readFileSync(file, 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
  const compiled = String(await compile(body, { jsx: true }));
  // Each demo compiles to `<Demo …>{`…`}</Demo>`; the backticked run is the
  // string the component gets, with MDX's own escaping already applied.
  return [...compiled.matchAll(/<Demo[^>]*>\{`([\s\S]*?)`\}<\/Demo>/g)].map((m) => m[1] ?? unreachable());
}

// The standalone playground's seed is a demo in every way that matters here,
// so it rides along under the same assertions. It is a plain TS template
// literal, so no MDX dedent applies.
const seedMatch = /const SEED = `([\s\S]*?)`;/.exec(
  readFileSync(join(DOCS_ROOT, 'app', 'playground', 'page.tsx'), 'utf8'),
);

const files = mdxFiles(CONTENT_ROOT);
const demos = [
  ...(await Promise.all(files.map(compiledDemoSources))).flatMap((sources, fileIndex) =>
    sources.map((source, i) => ({
      name: `${(files[fileIndex] ?? unreachable()).slice(CONTENT_ROOT.length + 1)} #${i + 1}`,
      source,
    })),
  ),
  { name: 'playground seed', source: seedMatch?.[1] ?? unreachable() },
];

/** Raw file text, for the assertions that are about how the .mdx is written. */
const rawDemos = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(DEMO_RE)].map((m, i) => ({
    name: `${file.slice(CONTENT_ROOT.length + 1)} #${i + 1}`,
    indent: m[1] ?? unreachable(),
    source: m[2] ?? unreachable(),
  })),
);

/** The worker's execution model, minus the worker. */
function runDemo(source: string): bento.LayoutNode {
  const rendered: bento.LayoutNode[] = [];
  const requireShim = (specifier: string) => {
    if (specifier === 'bento-layout') return bento;
    throw new Error(`demos can only import 'bento-layout', got '${specifier}'`);
  };
  const run = new Function('require', 'exports', 'module', 'renderPlayground', rewriteImports(source));
  const moduleShim = { exports: {} };
  run(requireShim, moduleShim.exports, moduleShim, (root: bento.LayoutNode) => rendered.push(root));
  return rendered.at(-1) ?? unreachable();
}

describe('docs demos', () => {
  it('found demos in the content', () => {
    expect(demos.length).toBeGreaterThan(0);
  });

  it.each(demos)('$name runs and lays out', ({ source }) => {
    const root = runDemo(source);
    bento.computeLayout(root, { width: AVAILABLE_WIDTH, height: 'max-content' });
    expect(Number.isFinite(root.layout.size.width)).toBe(true);
    expect(Number.isFinite(root.layout.size.height)).toBe(true);
    expect(root.layout.size.height).toBeGreaterThan(0);
  });

  // The format action must be a no-op on a demo the reader has not touched.
  // `source` here is post-MDX — the exact string <Demo> is handed — because
  // MDX's dedent is precisely what used to make a well-formatted .mdx file
  // reach the browser misindented.
  it.each(demos)('$name is a formatter fixpoint', async ({ source }) => {
    const formatted = await formatDemoSource(source);
    expect(source.trimEnd()).toBe(formatted.trimEnd());
  });

  // A <Demo> indented into a list item needs every line of its template
  // literal indented too, or MDX rejects the page ("unexpected lazy line in
  // expression in container"). The layout assertion above passes either way,
  // so without this the failure only shows up at `pnpm build`.
  it.each(rawDemos)('$name sits at a column MDX accepts', ({ indent, source }) => {
    if (indent === '') return;
    const lazy = source.split('\n').filter((l) => l.trim() !== '' && !l.startsWith(indent));
    expect(lazy, `lines must be indented to at least ${indent.length} spaces`).toEqual([]);
  });
});
