// WPT importer: classify web-platform-tests layout tests and rewrite the
// supported subset into gentest-shape pages (Chrome remains the oracle; WPT
// pages are used as curated *inputs* only — their own expectations and
// reference pages are never consumed).
//
// Usage: pnpm wpt-import [--wpt <dir>] [--scan-only] [--suite <name>] [--limit N]
//
// Classification is a conservative ALLOWLIST (see design.md D2): a file is
// imported only when every element is a <div>, every CSS declaration is a
// property we validate with a value its grammar accepts, and no script other
// than the WPT harness is present. Everything else is skipped with a named
// reason recorded in tests/html/wpt/manifest.json. False skips cost corpus;
// false imports would poison the scoreboard.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'tests', 'html', 'wpt');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const SUITES = ['css-flexbox', 'css-grid', 'css-sizing', 'css-align'] as const;

// --- Value grammars ----------------------------------------------------------
// These mirror tests/html/support/test_helper.js parsers — the ground truth for
// what survives the fixture pipeline (parseDimension: px | % | auto |
// min-content | max-content; TrackSizingParser for track lists; parseRatio;
// parseGridPosition: auto | int | span int).

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const LENGTH = String.raw`(?:${NUM}px|${NUM}%|0)`;
const DIM = String.raw`(?:${LENGTH}|auto|min-content|max-content)`;
const rx = (body: string): RegExp => new RegExp(`^(?:${body})$`, 'i');

// `min-content`/`max-content` are valid CSS but NOT in the engine's `Dimension`
// model (px | percent | auto) — the fixture harness would turn them into NaN.
// They remain legal inside track lists, where the engine does model them.
const SIZE_DIM = String.raw`(?:${LENGTH}|auto)`;
const dimension = rx(SIZE_DIM);
const lengthPct = rx(LENGTH);
const lengthPctAuto = rx(`${LENGTH}|auto`);
const number = rx(NUM);
const ratio = rx(String.raw`${NUM}(?:\s*/\s*${NUM})?`);

// Track sizing: what TrackSizingParser accepts. No line names, no subgrid.
const TRACK = String.raw`(?:${LENGTH}|${NUM}fr|auto|min-content|max-content|fit-content\(\s*${LENGTH}\s*\)|minmax\(\s*(?:${LENGTH}|${NUM}fr|auto|min-content|max-content)\s*,\s*(?:${LENGTH}|${NUM}fr|auto|min-content|max-content)\s*\))`;
const TRACK_LIST = String.raw`(?:${TRACK}|repeat\(\s*(?:\d+|auto-fill|auto-fit)\s*,(?:\s*${TRACK})+\s*\))(?:\s+(?:${TRACK}|repeat\(\s*(?:\d+|auto-fill|auto-fit)\s*,(?:\s*${TRACK})+\s*\)))*`;
const trackList = rx(`none|${TRACK_LIST}`);

const gridLine = rx(String.raw`auto|-?\d+|span\s+\d+|-?\d+\s+span|span\s+\d+\s*/\s*.*`);
const gridPlacementPair = rx(String.raw`(?:auto|-?\d+|span\s+\d+)(?:\s*/\s*(?:auto|-?\d+|span\s+\d+))?`);

const ALIGN_KW = String.raw`(?:normal|stretch|baseline|first\s+baseline|center|start|end|flex-start|flex-end|self-start|self-end|left|right|space-between|space-around|space-evenly)`;
const alignValue = rx(String.raw`(?:(?:safe|unsafe)\s+)?${ALIGN_KW}`);

const oneOf = (...vals: string[]): RegExp => rx(vals.join('|'));
const repeated = (unit: string, min: number, max: number): RegExp =>
  rx(`${unit}(?:\\s+${unit}){${Math.max(min - 1, 0)},${max - 1}}`);

// Border shorthand: width + line-style + optional color. `none`/`hidden` style
// zeroes the used width in the browser but not in our extracted longhand, so
// only visible styles pass (see bug-17 fixture notes on the base stylesheet).
const BORDER_STYLE = '(?:solid|dashed|dotted|double|groove|ridge|inset|outset)';
const borderShorthand = rx(String.raw`(?:${LENGTH}\s+)?${BORDER_STYLE}(?:\s+\S+)?|${LENGTH}\s+${BORDER_STYLE}\s+\S+`);

// --- The allowlist -----------------------------------------------------------
// verdict per declaration: 'layout' (validated + kept), 'ignore' (paint-only or
// harness-supplied, kept/dropped without affecting classification), or the
// property/value is unknown -> the whole file is skipped.

type Check = RegExp | 'any';
interface PropRule {
  check: Check;
  /** 'drop': valid but removed at rewrite (harness supplies it). */
  action?: 'keep' | 'drop';
}

export const ALLOWLIST: Record<string, PropRule> = {
  // Box model / layout
  'display': { check: oneOf('block', 'flex', 'grid', 'none') },
  'box-sizing': { check: oneOf('border-box', 'content-box') },
  'direction': { check: oneOf('ltr', 'rtl') },
  'position': { check: oneOf('relative', 'absolute') },
  'overflow': { check: repeated('(?:visible|hidden|clip|scroll)', 1, 2) },
  'overflow-x': { check: oneOf('visible', 'hidden', 'clip', 'scroll') },
  'overflow-y': { check: oneOf('visible', 'hidden', 'clip', 'scroll') },
  'width': { check: dimension },
  'height': { check: dimension },
  'min-width': { check: dimension },
  'min-height': { check: dimension },
  'max-width': { check: rx(`${SIZE_DIM}|none`) },
  'max-height': { check: rx(`${SIZE_DIM}|none`) },
  'aspect-ratio': { check: ratio },
  'top': { check: lengthPctAuto },
  'left': { check: lengthPctAuto },
  'bottom': { check: lengthPctAuto },
  'right': { check: lengthPctAuto },
  'inset': { check: repeated(`(?:${LENGTH}|auto)`, 1, 4) },
  'margin': { check: repeated(`(?:${LENGTH}|auto)`, 1, 4) },
  'margin-top': { check: lengthPctAuto },
  'margin-left': { check: lengthPctAuto },
  'margin-bottom': { check: lengthPctAuto },
  'margin-right': { check: lengthPctAuto },
  'padding': { check: repeated(LENGTH, 1, 4) },
  'padding-top': { check: lengthPct },
  'padding-left': { check: lengthPct },
  'padding-bottom': { check: lengthPct },
  'padding-right': { check: lengthPct },
  'border': { check: borderShorthand },
  'border-top': { check: borderShorthand },
  'border-left': { check: borderShorthand },
  'border-bottom': { check: borderShorthand },
  'border-right': { check: borderShorthand },
  'border-width': { check: repeated(LENGTH, 1, 4) },
  'border-top-width': { check: lengthPct },
  'border-left-width': { check: lengthPct },
  'border-bottom-width': { check: lengthPct },
  'border-right-width': { check: lengthPct },
  'border-style': { check: repeated(BORDER_STYLE, 1, 4) },

  // Flexbox
  'flex-direction': { check: oneOf('row', 'row-reverse', 'column', 'column-reverse') },
  'flex-wrap': { check: oneOf('nowrap', 'wrap', 'wrap-reverse') },
  'flex-flow': {
    check: rx(String.raw`(?:row|row-reverse|column|column-reverse)(?:\s+(?:nowrap|wrap|wrap-reverse))?|(?:nowrap|wrap|wrap-reverse)`),
  },
  'flex-grow': { check: number },
  'flex-shrink': { check: number },
  'flex-basis': { check: dimension },
  'flex': { check: rx(String.raw`none|initial|${NUM}(?:\s+${NUM})?(?:\s+${SIZE_DIM})?|${SIZE_DIM}`) },
  // `order` is NOT modelled: the engine has no such style field and
  // test_helper.js never extracts it, so a test that reorders items records
  // DOM order while Chrome lays out visual order. Unpassable by construction,
  // so it must not enter the corpus (it would sit in quarantine forever and
  // understate the score). `order: 0` is the initial value and harmless.
  'order': { check: rx('0') },

  // Alignment
  'align-items': { check: alignValue },
  'align-self': { check: rx(String.raw`auto|(?:(?:safe|unsafe)\s+)?${ALIGN_KW}`) },
  'align-content': { check: alignValue },
  'justify-content': { check: alignValue },
  'justify-items': { check: alignValue },
  'justify-self': { check: rx(String.raw`auto|(?:(?:safe|unsafe)\s+)?${ALIGN_KW}`) },
  'gap': { check: repeated(LENGTH, 1, 2) },
  'row-gap': { check: lengthPct },
  'column-gap': { check: lengthPct },
  'grid-gap': { check: repeated(LENGTH, 1, 2) },
  'grid-row-gap': { check: lengthPct },
  'grid-column-gap': { check: lengthPct },

  // Grid
  'grid-template-rows': { check: trackList },
  'grid-template-columns': { check: trackList },
  'grid-auto-rows': { check: trackList },
  'grid-auto-columns': { check: trackList },
  'grid-auto-flow': { check: rx(String.raw`row|column|dense|row\s+dense|column\s+dense`) },
  'grid-row': { check: gridPlacementPair },
  'grid-column': { check: gridPlacementPair },
  'grid-row-start': { check: gridLine },
  'grid-row-end': { check: gridLine },
  'grid-column-start': { check: gridLine },
  'grid-column-end': { check: gridLine },
  'grid-area': { check: rx(String.raw`(?:auto|-?\d+|span\s+\d+)(?:\s*/\s*(?:auto|-?\d+|span\s+\d+)){0,3}`) },

  // Harness-supplied typography: valid only in the shapes our Ahem setup
  // already provides; the declaration is dropped at rewrite.
  'font': { check: rx(String.raw`10px\s*/\s*1\s+ahem|10px\s+ahem`), action: 'drop' },
  'font-family': { check: rx(String.raw`ahem(?:\s*,.*)?`), action: 'drop' },
  'font-size': { check: rx('10px'), action: 'drop' },
  'line-height': { check: rx('1|10px'), action: 'drop' },

  // Paint-only: no layout effect, any value accepted, kept as-is (inert).
  'color': { check: 'any' },
  'background': { check: 'any' },
  'background-color': { check: 'any' },
  'border-color': { check: 'any' },
  'border-top-color': { check: 'any' },
  'border-left-color': { check: 'any' },
  'border-bottom-color': { check: 'any' },
  'border-right-color': { check: 'any' },
  'outline': { check: 'any' },
  'outline-color': { check: 'any' },
  'content-visibility': { check: rx('visible') },
};

// --- CSS + HTML micro-scanning ----------------------------------------------
// Deliberately not a real CSS parser: it only has to answer "is every
// declaration allowlisted", and anything it cannot confidently tokenize is a
// skip, never an import.

export interface Declaration {
  prop: string;
  value: string;
}

/** Split a declaration block into declarations (no nested braces expected). */
export function splitDeclarations(block: string): Declaration[] | null {
  const out: Declaration[] = [];
  for (const raw of block.split(';')) {
    const decl = raw.trim();
    if (decl === '') continue;
    const colon = decl.indexOf(':');
    if (colon < 0) return null;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    // `!important` changes cascade order in ways the inliner does not model.
    if (/!important$/i.test(value)) return null;
    if (prop === '' || value === '') return null;
    out.push({ prop, value });
  }
  return out;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function checkDeclaration(d: Declaration): Verdict {
  const rule = ALLOWLIST[d.prop];
  if (rule === undefined) return { ok: false, reason: `property:${d.prop}` };
  if (rule.check !== 'any' && !rule.check.test(d.value)) {
    return { ok: false, reason: `value:${d.prop}:${d.value.slice(0, 40)}` };
  }
  return { ok: true };
}

interface StyleRule {
  selector: string;
  declarations: Declaration[];
}

/** Rewrite vendor-prefixed declarations: drop `-webkit-x` when the unprefixed
 *  `x` also appears in the same rule body (compat fallback pattern), otherwise
 *  strip the prefix. Runs on CSS text so classification, the in-page inliner,
 *  and the emitted file all see the same declarations. */
export function stripVendorPrefixes(css: string): string {
  return css.replace(/\{([^{}]*)\}/g, (_m, body: string) => {
    const decls = body.split(';');
    const unprefixed = new Set(
      decls.map((d) => d.split(':')[0]?.trim().toLowerCase() ?? '').filter((p) => p !== '' && !p.startsWith('-')),
    );
    const kept = decls.filter((d) => d.trim() !== '');
    const out: string[] = [];
    for (const d of kept) {
      const prop = d.split(':')[0]?.trim().toLowerCase() ?? '';
      const m = /^-(?:webkit|moz|ms|o)-(.+)$/.exec(prop);
      if (m === null) {
        out.push(d.trim());
      } else if (!unprefixed.has(m[1] as string)) {
        out.push(d.trim().replace(/^\s*-(?:webkit|moz|ms|o)-/, ''));
      }
    }
    return `{ ${out.join('; ')} }`;
  });
}

/** Parse a <style> block into flat rules. Returns null (=> skip) on any @rule
 *  other than a droppable Ahem @font-face, or on unbalanced input. */
export function parseStyleBlock(css: string): { rules: StyleRule[]; reason?: string } | { rules: null; reason: string } {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: StyleRule[] = [];
  let rest = noComments.trim();
  while (rest.length > 0) {
    const open = rest.indexOf('{');
    if (open < 0) {
      if (rest.trim() !== '') return { rules: null, reason: 'css-parse' };
      break;
    }
    const selector = rest.slice(0, open).trim();
    const close = rest.indexOf('}', open);
    if (close < 0) return { rules: null, reason: 'css-parse' };
    const body = rest.slice(open + 1, close);
    if (selector.startsWith('@')) {
      // @font-face for Ahem is harness-supplied; anything else is out of scope.
      if (/^@font-face/i.test(selector) && /ahem/i.test(body)) {
        rest = rest.slice(close + 1).trim();
        continue;
      }
      return { rules: null, reason: `at-rule:${selector.split(/[\s(]/)[0]}` };
    }
    const declarations = splitDeclarations(body);
    if (declarations === null) return { rules: null, reason: 'css-parse' };
    rules.push({ selector, declarations });
    rest = rest.slice(close + 1).trim();
  }
  return { rules };
}

// --- File classification -----------------------------------------------------

export interface Classified {
  class: 'import' | 'skip';
  reason?: string;
  /** Present for import candidates: raw <style> css and body inner HTML. */
  styleCss?: string;
  bodyHtml?: string;
  helpUrls?: string[];
  title?: string;
}

const HARNESS_SCRIPTS = /(?:testharness(?:report)?|check-layout(?:-th)?)\.js/;

export function classifyFile(html: string, srcDir?: string, wptRootDir?: string): Classified {
  // Scripts: WPT harness includes are fine (they are stripped at rewrite);
  // anything else can mutate the DOM before measurement.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    const body = (m[2] ?? '').trim();
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src !== undefined) {
      if (!HARNESS_SCRIPTS.test(src)) return { class: 'skip', reason: `script:${src.split('/').pop()}` };
    } else if (body !== '' && !/^checkLayout\(/.test(body.replace(/["'`\s]/g, '').slice(0, 40))) {
      return { class: 'skip', reason: 'script:inline' };
    }
  }

  // Elements: divs only inside body (bug-17 lesson: unexpected elements ride
  // on different layout paths). Text nodes are fine.
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyHtml = bodyMatch?.[1] ?? afterHeadFallback(html);
  if (bodyHtml === null) return { class: 'skip', reason: 'no-body' };
  const strippedBody = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const tags = new Set<string>();
  for (const m of strippedBody.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)/g)) tags.add((m[1] as string).toLowerCase());
  // Informational flotsam we can delete outright; everything else must be div.
  const DELETABLE = new Set(['p', 'h1', 'h2', 'h3', 'br', 'noscript']);
  for (const t of tags) {
    if (t === 'div' || DELETABLE.has(t)) continue;
    return { class: 'skip', reason: `element:${t}` };
  }
  if (!tags.has('div')) return { class: 'skip', reason: 'no-divs' };

  // CSS: gather <link rel="stylesheet"> and <style> in document order (linked
  // sheets participate in the cascade at their link position), then require
  // every declaration to be allowlisted.
  let styleCss = '';
  for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1] !== undefined) {
      styleCss += `${m[1]}\n`;
      continue;
    }
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (href === undefined) continue;
    if (/ahem\.css$/i.test(href)) continue; // harness supplies Ahem
    if (/^https?:/i.test(href)) return { class: 'skip', reason: `external-css:${href}` };
    if (srcDir === undefined) return { class: 'skip', reason: `external-css:${href}` };
    // Server-absolute hrefs resolve against the WPT root, not the test's dir.
    const cssPath = href.startsWith('/') ? join(wptRootDir ?? srcDir, href.slice(1)) : join(srcDir, href);
    let css: string;
    try {
      css = readFileSync(cssPath, 'utf8');
    } catch {
      return { class: 'skip', reason: `external-css-missing:${href}` };
    }
    styleCss += `${css}\n`;
  }
  styleCss = stripVendorPrefixes(styleCss);
  const parsed = parseStyleBlock(styleCss);
  if (parsed.rules === null) return { class: 'skip', reason: parsed.reason };
  for (const rule of parsed.rules) {
    for (const d of rule.declarations) {
      const v = checkDeclaration(d);
      if (!v.ok) return { class: 'skip', reason: v.reason };
    }
  }
  for (const m of strippedBody.matchAll(/style\s*=\s*"([^"]*)"/gi)) {
    const decls = splitDeclarations(stripVendorPrefixes(`{${m[1] as string}}`).replace(/^\{|\}$/g, ''));
    if (decls === null) return { class: 'skip', reason: 'css-parse' };
    for (const d of decls) {
      const v = checkDeclaration(d);
      if (!v.ok) return { class: 'skip', reason: v.reason };
    }
  }

  const helpUrls = [...html.matchAll(/<link[^>]+rel\s*=\s*["']help["'][^>]*>/gi)]
    .map((m) => /href\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter((u): u is string => u !== undefined);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().replace(/\s+/g, ' ');

  return { class: 'import', styleCss, bodyHtml: strippedBody, helpUrls, title };
}

function afterHeadFallback(html: string): string | null {
  // Some WPT tests omit <body>; treat everything after the last </style>,
  // </script>, or <link> in the head as body content.
  const idx = Math.max(html.lastIndexOf('</style>'), html.lastIndexOf('</script>'), html.lastIndexOf('rel="help"'));
  if (idx < 0) return null;
  const rest = html.slice(html.indexOf('>', idx) + 1);
  return rest.replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '');
}

// --- Corpus walk -------------------------------------------------------------

function isTestFile(path: string): boolean {
  if (!path.endsWith('.html')) return false;
  const base = path.split('/').pop() as string;
  if (base.endsWith('-ref.html') || base.includes('-expected')) return false;
  if (/\/(?:reference|support|resources)\//.test(path)) return false;
  return true;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

export interface ManifestEntry {
  class: 'import' | 'skip';
  reason?: string;
}

export interface Manifest {
  wptSha: string;
  generated: string;
  files: Record<string, ManifestEntry>;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

export function runScan(wptRoot: string, suiteFilter: string | null): { manifest: Manifest; candidates: Map<string, Classified> } {
  const wptSha = execFileSync('git', ['-C', wptRoot, 'rev-parse', 'HEAD']).toString().trim();
  const files: Record<string, ManifestEntry> = {};
  const candidates = new Map<string, Classified>();
  for (const suite of SUITES) {
    if (suiteFilter !== null && suite !== suiteFilter) continue;
    const dir = join(wptRoot, 'css', suite);
    for (const path of walk(dir)) {
      const rel = relative(wptRoot, path);
      if (!isTestFile(rel)) continue;
      const result = classifyFile(readFileSync(path, 'utf8'), dirname(path), wptRoot);
      files[rel] = result.class === 'import' ? { class: 'import' } : { class: 'skip', reason: result.reason };
      if (result.class === 'import') candidates.set(rel, result);
    }
  }
  return { manifest: { wptSha, generated: 'scan', files }, candidates };
}

// --- Rewrite phase -----------------------------------------------------------
// For each import candidate: render the WPT markup (wrapped in our harness)
// with its <style> block active, capture per-element geometry, inline every
// matched rule into style attributes, remove the style block, and capture
// again in the same DOM. Identical geometry proves the inlining faithful; any
// difference demotes the file to skip:rewrite-failed. A wrong transform can
// only cost corpus, never produce a wrong fixture.

const DROP_PROPS = Object.entries(ALLOWLIST)
  .filter(([, r]) => r.action === 'drop')
  .map(([p]) => p);

interface RewriteResult {
  ok: boolean;
  reason?: string;
  bodyHtml?: string;
}

/** Runs inside the page. Returns geometry before/after inlining + final HTML. */
const IN_PAGE_REWRITE = `(dropProps) => {
  const root = document.getElementById('test-root');
  const els = [root, ...root.querySelectorAll('*')];
  const rects = () => els.map((e) => {
    const r = e.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  const before = rects();

  // Merge sheet rules into inline styles, document order (later rules win),
  // then re-apply the original inline declarations on top (inline wins).
  const wptSheets = [...document.querySelectorAll('style[data-wpt]')];
  const scratch = document.createElement('div');
  for (const el of els) {
    const inlineSnapshot = el.getAttribute('style') ?? '';
    for (const sheetEl of wptSheets) {
      for (const rule of sheetEl.sheet?.cssRules ?? []) {
        if (rule.constructor.name !== 'CSSStyleRule') continue;
        let matches = false;
        try { matches = el.matches(rule.selectorText); } catch { matches = false; }
        if (!matches) continue;
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          if (p.startsWith('-webkit-') || p.startsWith('-moz-') || p.startsWith('-ms-')) continue;
          el.style.setProperty(p, rule.style.getPropertyValue(p));
        }
      }
    }
    scratch.style.cssText = inlineSnapshot;
    for (let i = 0; i < scratch.style.length; i++) {
      const p = scratch.style[i];
      if (p.startsWith('-webkit-') || p.startsWith('-moz-') || p.startsWith('-ms-')) continue;
      el.style.setProperty(p, scratch.style.getPropertyValue(p));
    }
    // Harness-supplied typography is dropped; the emitted page inherits it.
    for (const p of dropProps) el.style.removeProperty(p);
    // Explicit display on every element: the harness base stylesheet defaults
    // div to flex, so an element relying on the block default here would flip
    // when the emitted file is rendered standalone.
    if (el.style.getPropertyValue('display') === '') el.style.setProperty('display', 'block');
  }
  for (const sheetEl of wptSheets) sheetEl.remove();
  const after = rects();

  for (const el of els) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'onload') {
        el.removeAttribute(attr.name);
      }
    }
  }
  return { before, after, html: root.outerHTML };
}`;

function buildRenderPage(supportJs: string, supportCss: string, styleCss: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <script>${supportJs}</script>
  <style>${supportCss}</style>
  <style>div { display: block; }</style>
  <style data-wpt>${styleCss}</style>
</head>
<body>
<div id="test-root" style="display: block;">
${bodyHtml}
</div>
</body>
</html>`;
}

/** Keep only top-level <div> subtrees; drop informational flotsam. */
export function extractDivContent(bodyHtml: string): string {
  let out = bodyHtml;
  out = out.replace(/<(p|h1|h2|h3|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<br\s*\/?>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Drop bare text between top-level tags (instructions); text inside divs
  // stays untouched because we only trim the region before the first <div>
  // and after the last </div>.
  const first = out.indexOf('<div');
  const last = out.lastIndexOf('</div>');
  if (first < 0 || last < 0) return '';
  return out.slice(first, last + '</div>'.length);
}

interface PageHandle {
  setContent(html: string, opts: { waitUntil: string }): Promise<void>;
  evaluate(fn: unknown, ...args: unknown[]): Promise<unknown>;
}

export async function rewriteCandidate(
  page: PageHandle,
  candidate: Classified,
  supportJs: string,
  supportCss: string,
): Promise<RewriteResult> {
  const body = extractDivContent(candidate.bodyHtml ?? '');
  if (body === '') return { ok: false, reason: 'rewrite-failed:no-divs' };
  // The harness generates border-box and content-box variants by forcing
  // box-sizing on every element, so a test that sets box-sizing itself cannot
  // survive both variants — its content-box half would silently become
  // border-box. (Caught by task 1.4: grid-box-sizing-001 read 100 where WPT
  // expects 144, exactly the border sum.)
  if (/box-sizing/i.test(candidate.styleCss ?? '') || /box-sizing/i.test(candidate.bodyHtml ?? '')) {
    return { ok: false, reason: 'harness-conflict:box-sizing' };
  }
  // Bare text between sibling elements becomes an *anonymous* flex/grid item in
  // the browser, but test_helper.js records only element children — so Chrome's
  // geometry accounts for items the fixture cannot express. Unpassable by
  // construction, like `order`.
  if (/<\/div>\s*[^<>\s][^<>]*?\s*<div/.test(body)) {
    return { ok: false, reason: 'harness-conflict:anonymous-item' };
  }
  await page.setContent(buildRenderPage(supportJs, supportCss, candidate.styleCss ?? '', body), {
    waitUntil: 'load',
  });
  await page.evaluate('document.fonts ? document.fonts.ready : 0');
  const result = (await page.evaluate(`(${IN_PAGE_REWRITE})(${JSON.stringify(DROP_PROPS)})`)) as {
    before: number[][];
    after: number[][];
    html: string;
  };
  for (let i = 0; i < result.before.length; i++) {
    const [a, b] = [result.before[i] as number[], result.after[i] as number[]];
    for (let k = 0; k < 4; k++) {
      if (Math.abs((a[k] as number) - (b[k] as number)) > 0.01) {
        return { ok: false, reason: `rewrite-failed:geometry@${i}` };
      }
    }
  }
  const root = result.before[0] as number[];
  if ((root[2] as number) === 0 && (root[3] as number) === 0) return { ok: false, reason: 'degenerate' };
  return { ok: true, bodyHtml: result.html };
}

function emittedFileName(relPath: string): string {
  // css/css-grid/alignment/foo.html -> wpt/css-grid + foo (subdirs flattened).
  const parts = relPath.split('/');
  const suite = parts[1] as string;
  const name = parts
    .slice(2)
    .join('_')
    .replace(/\.html$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return join('wpt', suite, `${name}.html`);
}

function emitFile(outPath: string, relPath: string, wptSha: string, candidate: Classified, bodyHtml: string): void {
  const title = `wpt: ${candidate.title ?? relPath}`;
  const help = (candidate.helpUrls ?? []).map((u) => `  help: ${u}`).join('\n');
  const content = `<!DOCTYPE html>
<!--
  Imported from web-platform-tests by scripts/wpt-import.ts — do not edit.
  source: ${relPath} @ ${wptSha.slice(0, 10)}
${help}
  Styles are inlined (the engine pipeline reads inline styles only) and were
  verified geometry-identical to the original <style>-block rendering.
-->
<html lang="en">
<head>
  <script src="../../support/test_helper.js"></script>
  <link rel="stylesheet" type="text/css" href="../../support/test_base_style.css">
  <title>${title.replace(/</g, '&lt;')}</title>
</head>
<body>

${bodyHtml}

</body>
</html>
`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
}

async function runRewrite(
  manifest: Manifest,
  candidates: Map<string, Classified>,
  limit: number | null,
): Promise<void> {
  const { default: puppeteer } = (await import('puppeteer')) as {
    default: { launch(opts: object): Promise<{ newPage(): Promise<PageHandle>; close(): Promise<void> }> };
  };
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--force-color-profile=srgb', ...(process.env['GENTEST_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
  });
  const page = await browser.newPage();
  const supportDir = join(ROOT, 'tests', 'html', 'support');
  const supportJs = readFileSync(join(supportDir, 'test_helper.js'), 'utf8');
  const supportCss = readFileSync(join(supportDir, 'test_base_style.css'), 'utf8');

  let emitted = 0;
  let failed = 0;
  const entries = [...candidates.entries()].slice(0, limit ?? candidates.size);
  for (const [relPath, candidate] of entries) {
    const result = await rewriteCandidate(page, candidate, supportJs, supportCss);
    if (!result.ok) {
      manifest.files[relPath] = { class: 'skip', reason: result.reason };
      failed++;
      continue;
    }
    emitFile(join(OUT_DIR, '..', emittedFileName(relPath)), relPath, manifest.wptSha, candidate, result.bodyHtml as string);
    emitted++;
  }
  await browser.close();
  console.log(`rewrite: emitted ${emitted}, demoted ${failed} (of ${entries.length} candidates)`);
}

// --- CLI ---------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const wptRoot = argValue('--wpt') ?? join(homedir(), 'Documents', 'dev.nosync', 'wpt');
  const suite = argValue('--suite') ?? null;
  const { manifest, candidates } = runScan(wptRoot, suite);

  const total = Object.keys(manifest.files).length;
  const reasons = new Map<string, number>();
  for (const entry of Object.values(manifest.files)) {
    if (entry.class === 'skip') {
      const key = (entry.reason ?? 'unknown').split(':').slice(0, 2).join(':');
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }
  console.log(`wpt-import: scanned ${total} files, ${candidates.size} import candidates (sha ${manifest.wptSha.slice(0, 10)})`);
  console.log('top skip reasons:');
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(count).padStart(5)}  ${reason}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  if (!process.argv.includes('--scan-only')) {
    const limit = argValue('--limit') !== undefined ? Number(argValue('--limit')) : null;
    await runRewrite(manifest, candidates, limit);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`manifest: ${relative(ROOT, MANIFEST)}`);
}
