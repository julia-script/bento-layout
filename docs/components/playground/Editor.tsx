'use client';

// The demo editor: Monaco, wired for this site's one language.
//
// Monaco rather than the old textarea-over-Shiki because demos are real
// TypeScript now, and the whole point of that change is that editing feels
// like editing real code: hover docs and completions against the engine's own
// declarations, the TS formatter, line numbers, and an optional vim mode. All
// of it comes from Monaco's built-in TypeScript service, so the only extra
// dependency is monaco-vim.
//
// Everything is served same-origin: postinstall copies monaco's AMD build and
// monaco-vim's UMD bundle into public/monaco (see package.json), so the docs
// site keeps working without a CDN. monaco-vim is loaded through monaco's own
// AMD loader — its npm entry imports monaco's ESM build, which webpack would
// bundle as a *second* monaco instance alongside the AMD one.

import MonacoEditor, { loader, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatDemoSource } from './format.js';

loader.config({ paths: { vs: '/monaco/vs' } });

/** Compiled demo code alongside the source it came from. */
export interface DemoCode {
  source: string;
  /** CommonJS emit of `source`, ready for the run worker. */
  js: string;
}

// --- Vim preference ---------------------------------------------------------
// One localStorage flag for the whole site: turning vim on in any demo turns
// it on in all of them, now and on the next visit. The `storage` event keeps
// other tabs in step; the local listener set keeps other demos on this page.

const VIM_KEY = 'bento-demo-vim';
const vimListeners = new Set<() => void>();

function vimEnabled(): boolean {
  try {
    return localStorage.getItem(VIM_KEY) === '1';
  } catch {
    return false;
  }
}

function setVimEnabled(on: boolean): void {
  try {
    localStorage.setItem(VIM_KEY, on ? '1' : '0');
  } catch {
    // Private mode without storage: the toggle still works for this page view.
  }
  for (const listener of vimListeners) listener();
}

function subscribeVim(listener: () => void): () => void {
  vimListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    vimListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

interface VimMode {
  dispose(): void;
}
interface VimLib {
  initVimMode(editorInstance: editor.IStandaloneCodeEditor, statusBar: HTMLElement): VimMode;
}

let vimLib: Promise<VimLib> | null = null;

function loadVimLib(monaco: Monaco): Promise<VimLib> {
  vimLib ??= new Promise((resolve, reject) => {
    const amd = window as unknown as {
      define: ((id: string, deps: string[], factory: () => unknown) => void) & { amd?: unknown };
      require: ((deps: string[], onLoad: (lib: VimLib) => void, onError: (err: unknown) => void) => void) & {
        config: (options: { paths: Record<string, string> }) => void;
      };
    };
    // monaco-vim's UMD build declares a dependency on monaco's ESM entry;
    // satisfy it with the instance the AMD loader already produced.
    amd.define('monaco-editor/esm/vs/editor/editor.api', [], () => monaco);
    amd.require.config({ paths: { 'monaco-vim': '/monaco/monaco-vim.umd' } });
    amd.require(['monaco-vim'], resolve, reject);
  });
  return vimLib;
}

// --- TypeScript service setup (once per page) -------------------------------

let tsConfigured = false;

function configureTypeScript(monaco: Monaco): void {
  if (tsConfigured) return;
  tsConfigured = true;

  const defaults = monaco.languages.typescript.typescriptDefaults;
  const tsLang = monaco.languages.typescript;
  defaults.setCompilerOptions({
    target: tsLang.ScriptTarget.ES2020,
    // CommonJS so the emit's `require` calls line up with the run worker's shim.
    module: tsLang.ModuleKind.CommonJS,
    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    strict: true,
    allowNonTsExtensions: true,
  });

  defaults.addExtraLib(
    [
      '/**',
      ' * Display a layout tree in this playground.',
      ' *',
      ' * The playground lays `root` out against its viewport (drag the handle or',
      ' * change the zoom to re-run it at other widths) and draws the result. In',
      ' * your own code, replace this with `computeLayout(root, …)` and read each',
      " * node's `layout`.",
      ' */',
      "declare function renderPlayground(root: import('bento-layout').LayoutNode): void;",
    ].join('\n'),
    'file:///playground-globals.d.ts',
  );

  // Formatting is Prettier's (see format.ts for why), so the TS service's
  // whitespace-only formatters are switched off and a Prettier-backed provider
  // takes their place — the format button, Shift+Alt+F, and the context menu
  // all route through `editor.action.formatDocument` to this one provider.
  defaults.setModeConfiguration({
    completionItems: true,
    hovers: true,
    documentSymbols: true,
    definitions: true,
    references: true,
    documentHighlights: true,
    rename: true,
    diagnostics: true,
    signatureHelp: true,
    codeActions: true,
    inlayHints: true,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
  });
  monaco.languages.registerDocumentFormattingEditProvider('typescript', {
    async provideDocumentFormattingEdits(model: editor.ITextModel) {
      try {
        // Trailing-newline convention is for files on disk; in a demo pane it
        // reads as a stray blank line, and the pristine sources ship without
        // one — keeping this trimmed is what makes format a true no-op there.
        const formatted = (await formatDemoSource(model.getValue())).trimEnd();
        if (formatted === model.getValue()) return [];
        return [{ range: model.getFullModelRange(), text: formatted }];
      } catch {
        // Mid-edit syntax errors: formatting is simply unavailable.
        return [];
      }
    },
  });

  // The engine's declarations, emitted from src/ at build time. Loaded async;
  // Monaco re-checks open models when the libs land, so early keystrokes just
  // see a brief "cannot find module" that resolves itself.
  fetch('/playground-types')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`playground-types: ${res.status}`))))
    .then((files: Record<string, string>) => {
      for (const [rel, text] of Object.entries(files)) {
        defaults.addExtraLib(text, `file:///node_modules/bento-layout/${rel}`);
      }
    })
    .catch(() => {
      // Tooltips degrade; the demos still run — the worker has the real engine.
    });
}

/** Match Monaco's theme to the site's, which fumadocs toggles via a class. */
function useSiteTheme(): 'vs' | 'vs-dark' {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark ? 'vs-dark' : 'vs';
}

/** Keystrokes settle for this long before the demo re-compiles and re-runs. */
const COMPILE_DEBOUNCE_MS = 250;

/** Space Monaco gets below the last line, so the cursor never hugs the edge. */
const CONTENT_PAD = 12;

export interface EditorProps {
  /** Unique model path for this demo, e.g. `demo-r1.ts`. */
  path: string;
  initialSource: string;
  /** Fires with fresh compiled code after each settled edit. */
  onCode: (code: DemoCode) => void;
  /** Editor pane minimum height, in px. */
  minHeight?: number;
  /** Shown until Monaco is ready — the Shiki-highlighted source. */
  fallback?: ReactNode;
}

export function Editor({ path, initialSource, onCode, minHeight = 160, fallback }: EditorProps) {
  const theme = useSiteTheme();
  const vim = useSyncExternalStore(subscribeVim, vimEnabled, () => false);
  const [height, setHeight] = useState(minHeight);
  const [copied, setCopied] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const vimModeRef = useRef<VimMode | null>(null);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Attach or detach vim when the preference changes — from this demo's
  // button or any other editor's.
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    const statusBar = statusBarRef.current;
    if (!vim || !editorInstance || !monaco || !statusBar) {
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      return;
    }
    let cancelled = false;
    loadVimLib(monaco).then((lib) => {
      if (cancelled || vimModeRef.current) return;
      vimModeRef.current = lib.initVimMode(editorInstance, statusBar);
    });
    return () => {
      cancelled = true;
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
    };
  }, [vim]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const compile = async () => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    const model = editorInstance?.getModel();
    if (!editorInstance || !monaco || !model) return;
    const source = model.getValue();
    try {
      const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
      const worker = await getWorker(model.uri);
      const output = await worker.getEmitOutput(model.uri.toString());
      const js = output.outputFiles[0]?.text;
      if (js !== undefined && model.getValue() === source) onCode({ source, js });
    } catch {
      // Worker not ready yet; the next keystroke tries again.
    }
  };

  const onMount = (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;

    const fitHeight = () => setHeight(Math.max(minHeight, editorInstance.getContentHeight() + CONTENT_PAD));
    editorInstance.onDidContentSizeChange(fitHeight);
    fitHeight();

    editorInstance.onDidChangeModelContent(() => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(compile, COMPILE_DEBOUNCE_MS);
    });

    // Re-attach vim if the preference was already on when this editor mounted.
    if (vimEnabled() && statusBarRef.current) {
      loadVimLib(monaco).then((lib) => {
        if (vimModeRef.current || !vimEnabled() || !statusBarRef.current) return;
        vimModeRef.current = lib.initVimMode(editorInstance, statusBarRef.current);
      });
    }
  };

  const copy = async () => {
    const value = editorRef.current?.getModel()?.getValue();
    if (value === undefined) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const format = () => {
    editorRef.current?.getAction('editor.action.formatDocument')?.run();
  };

  return (
    <div className="fd-demo-editor">
      <div className="fd-demo-edbar">
        <button type="button" className="fd-demo-edbtn" onClick={copy}>
          {copied ? 'copied' : 'copy'}
        </button>
        <button type="button" className="fd-demo-edbtn" onClick={format} title="Format (Shift+Alt+F)">
          format
        </button>
        <button
          type="button"
          className="fd-demo-edbtn"
          data-active={vim ? '' : undefined}
          aria-pressed={vim}
          onClick={() => setVimEnabled(!vim)}
        >
          vim
        </button>
      </div>
      <div style={{ height }}>
        <MonacoEditor
          height="100%"
          language="typescript"
          theme={theme}
          path={path}
          defaultValue={initialSource}
          beforeMount={configureTypeScript}
          onMount={onMount}
          loading={fallback ?? null}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            folding: false,
            glyphMargin: false,
            fontSize: 13,
            tabSize: 2,
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            // Hover cards and completion lists must escape the demo card's
            // overflow:hidden border box.
            fixedOverflowWidgets: true,
            automaticLayout: true,
            wordWrap: 'off',
            padding: { top: 10, bottom: 2 },
          }}
        />
      </div>
      <div ref={statusBarRef} className="fd-demo-vimbar" data-visible={vim ? '' : undefined} />
    </div>
  );
}
