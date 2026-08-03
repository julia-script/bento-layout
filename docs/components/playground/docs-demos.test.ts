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
//
// Those two rules pull against each other: no annotations, yet the demo is
// shown in an editor that typechecks under `strict`, so an untyped helper
// parameter is an implicit `any` a reader sees as a red squiggle. The
// typecheck assertion below is what keeps both true at once — the way to
// satisfy it is a default value (`(width = 32) =>`) or inline the callback
// where its type is contextual, never an annotation.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@mdx-js/mdx';
import * as bento from 'bento-layout';
import { describe, expect, it } from 'vitest';
import { unreachable } from '../../../src/assert.js';
import { EXAMPLES } from './examples.js';
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

const files = mdxFiles(CONTENT_ROOT);
const demos = [
  ...(await Promise.all(files.map(compiledDemoSources))).flatMap((sources, fileIndex) =>
    sources.map((source, i) => ({
      name: `${(files[fileIndex] ?? unreachable()).slice(CONTENT_ROOT.length + 1)} #${i + 1}`,
      source,
    })),
  ),
  // The playground's example gallery, which is also what the page seeds with.
  // Plain TS strings rather than MDX, so no dedent applies — but they are demo
  // sources in every other respect, and a broken one is an error panel the
  // moment a reader picks that tab.
  ...EXAMPLES.map((example) => ({ name: `example: ${example.name}`, source: example.source })),
];

/** Raw file text, for the assertions that are about how the .mdx is written. */
const rawDemos = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(DEMO_RE)].map((m, i) => ({
    name: `${file.slice(CONTENT_ROOT.length + 1)} #${i + 1}`,
    indent: m[1] ?? unreachable(),
    source: m[2] ?? unreachable(),
  })),
);

/**
 * Type errors a demo would show in the editor, using Monaco's own settings.
 *
 * The demo is compiled as a real module against the library's source, with the
 * same `renderPlayground` declaration Editor.tsx feeds Monaco — so an error
 * here is an error a reader would see, and nothing else is.
 */
async function demoTypeErrors(source: string): Promise<string[]> {
  const ts = (await import('typescript')).default;
  const demoPath = join(DOCS_ROOT, '__demo__.ts');
  const text = `${GLOBALS}\n${source}`;

  const host = ts.createCompilerHost({}, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (name === demoPath ? text : readFile(name));
  host.fileExists = (name) => name === demoPath || ts.sys.fileExists(name);
  host.getSourceFile = (name, lang, onError, shouldCreate) =>
    name === demoPath ? ts.createSourceFile(name, text, lang, true) : getSourceFile(name, lang, onError, shouldCreate);

  const program = ts.createProgram(
    [demoPath],
    {
      strict: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      // `bento-layout` resolves to the library source, exactly as
      // next.config.mjs and vitest.config.ts alias it elsewhere.
      baseUrl: DOCS_ROOT,
      paths: { 'bento-layout': [join(DOCS_ROOT, '..', 'src', 'index.ts')] },
    },
    host,
  );

  const file = program.getSourceFile(demoPath);
  return [...program.getSemanticDiagnostics(file), ...program.getSyntacticDiagnostics(file)].map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, ' '),
  );
}

/** Ambient declarations the playground provides; mirrors Editor.tsx's extraLib. */
const GLOBALS = `declare function renderPlayground(root: unknown): void;`;

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

  // Demos are shown in an editor that typechecks them, so a demo carrying a
  // type error greets the reader with red squiggles on code the docs are
  // presenting as correct. Running is not enough to catch this: an untyped
  // helper parameter executes fine and still errors under `strict`, which is
  // how three of the playground examples shipped with implicit-`any` warnings.
  //
  // Compiled with Monaco's own options (see configureTypeScript in Editor.tsx)
  // so this test and the editor agree about what counts as an error.
  it.each(demos)('$name typechecks under strict', async ({ source }) => {
    expect(await demoTypeErrors(source)).toEqual([]);
  });
});
