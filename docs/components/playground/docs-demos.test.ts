// Every <Demo> block in the docs content must parse and lay out.
//
// The docs promise that demos are live; a demo whose source fails the dialect
// or the engine renders as an error panel instead. This walks the real MDX
// content, so a demo edited in a doc page is covered without registration.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLayout } from 'bento-layout';
import { demoToTree } from './parse.js';

const CONTENT_ROOT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', '..', 'content', 'docs',
);

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

const demos = mdxFiles(CONTENT_ROOT).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(DEMO_RE)].map((m, i) => ({
    name: `${file.slice(CONTENT_ROOT.length + 1)} #${i + 1}`,
    indent: m[1]!,
    source: m[2]!,
  })),
);

describe('docs demos', () => {
  it('found demos in the content', () => {
    expect(demos.length).toBeGreaterThan(0);
  });

  it.each(demos)('$name parses and lays out', ({ source }) => {
    const root = demoToTree(source);
    computeLayout(root, { width: AVAILABLE_WIDTH, height: 'max-content' });
    expect(Number.isFinite(root.layout.size.width)).toBe(true);
    expect(Number.isFinite(root.layout.size.height)).toBe(true);
    expect(root.layout.size.height).toBeGreaterThan(0);
  });

  // A <Demo> indented into a list item needs every line of its template
  // literal indented too, or MDX rejects the page ("unexpected lazy line in
  // expression in container"). The layout assertion above passes either way,
  // so without this the failure only shows up at `pnpm build`.
  it.each(demos)('$name sits at a column MDX accepts', ({ indent, source }) => {
    if (indent === '') return;
    const lazy = source.split('\n').filter((l) => l.trim() !== '' && !l.startsWith(indent));
    expect(lazy, `lines must be indented to at least ${indent.length} spaces`).toEqual([]);
  });
});
