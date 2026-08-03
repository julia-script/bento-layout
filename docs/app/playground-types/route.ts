// The library's declaration files, emitted from ../src for the demo editor.
//
// Monaco's TypeScript service needs bento-layout's types to give demos real
// hover docs and completions. dist/ is gitignored and not built where the docs
// build runs, so the declarations are emitted here, from the same src/ the
// site's webpack alias serves — the types can never lag the engine the demos
// actually run.
//
// Static: the emit runs once at build (or on first request in dev) and the
// JSON is served as a plain asset from then on.

import { join } from 'node:path';
import ts from 'typescript';

export const dynamic = 'force-static';

let cached: Record<string, string> | null = null;

function emitDeclarations(): Record<string, string> {
  const srcDir = join(process.cwd(), '..', 'src');
  const options: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
  };

  const out: Record<string, string> = {};
  const host = ts.createCompilerHost(options);
  host.writeFile = (fileName, text) => {
    const rel = fileName.startsWith(srcDir) ? fileName.slice(srcDir.length + 1) : fileName;
    // src/ is NodeNext, so its declarations import './tree.js'. Monaco's
    // in-browser service resolves with the older node algorithm, which is
    // surest with extensionless specifiers — strip them here once rather than
    // teaching every consumer the rewrite.
    out[rel] = text
      .replace(/(from\s*['"][^'"]*)\.js(['"])/g, '$1$2')
      .replace(/(import\(['"][^'"]*)\.js(['"])/g, '$1$2');
  };

  const program = ts.createProgram([join(srcDir, 'index.ts')], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const fatal = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatal.length > 0) {
    const first = fatal[0];
    const message = first ? ts.flattenDiagnosticMessageText(first.messageText, '\n') : 'unknown';
    throw new Error(`bento-layout declaration emit failed (${fatal.length} errors), first: ${message}`);
  }
  program.emit();
  return out;
}

export function GET() {
  cached ??= emitDeclarations();
  return Response.json(cached);
}
