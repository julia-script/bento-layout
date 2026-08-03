// The demo formatter: Prettier, at a width chosen for the demo pane.
//
// Not Monaco's built-in TypeScript formatter, which only normalizes
// whitespace and never re-wraps long lines — a narrow print width is the
// point here, because a side-by-side demo pane is ~340px wide and code that
// scrolls horizontally on a phone reads as broken.
//
// This module is the single source of truth for how demo code is formatted:
// the editor's format action calls it in the browser, and docs-demos.test.ts
// calls it in Node to assert every pristine demo is already a fixpoint — so
// pressing "format" on an unedited demo changes nothing.

/**
 * Options shared by the format action and the pristine-source test.
 *
 * `printWidth` is deliberately below Prettier's default 80: it has to read
 * well in a half-width docs pane and on phones, not on a wide editor.
 */
export const PRETTIER_OPTIONS = {
  parser: 'typescript',
  printWidth: 60,
  singleQuote: true,
} as const;

/**
 * Format demo source, loading Prettier on demand.
 *
 * @throws Prettier's syntax error when the source does not parse — callers
 * decide whether that aborts (tests) or is ignored (mid-edit format).
 */
export async function formatDemoSource(source: string): Promise<string> {
  const [prettier, estree, typescript] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
  ]);
  return prettier.format(source, {
    ...PRETTIER_OPTIONS,
    plugins: [estree.default, typescript.default],
  });
}
