// Copy the demo editor's runtime into public/, so it is served same-origin.
//
// @monaco-editor/react loads monaco with its AMD loader at runtime; by default
// that means a CDN. Copying monaco's min build (and monaco-vim's UMD bundle,
// which the editor loads through the same AMD loader) into public/monaco keeps
// the docs site self-contained and version-locked to the installed packages.
// public/monaco is gitignored — this script recreates it on every install.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(docsRoot, 'public', 'monaco');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(docsRoot, 'node_modules', 'monaco-editor', 'min', 'vs'), join(dest, 'vs'), {
  recursive: true,
  dereference: true,
});
cpSync(join(docsRoot, 'node_modules', 'monaco-vim', 'dist', 'monaco-vim.umd.js'), join(dest, 'monaco-vim.umd.js'), {
  dereference: true,
});
