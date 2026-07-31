// WPT conformance scoreboard: runs the engine against every imported WPT
// fixture (quarantined ones included) and reports pass/fail per suite and per
// spec section, plus newly-passing (promotable) and newly-failing (regression)
// lists relative to tests/fixtures/wpt-quarantine.json.
//
// Usage: pnpm wpt-score [--write-quarantine] [--verbose]
//
// Output is deterministic: sorted, no timestamps, no durations — two runs over
// unchanged inputs print identical text.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout } from '../src/index.js';
import type { Node } from '../src/index.js';
import { parseFixture } from '../tests/harness/fixture.js';
import type { ExpectedNode } from '../tests/harness/fixture.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(ROOT, 'tests', 'fixtures', 'wpt');
const HTML_ROOT = join(ROOT, 'tests', 'html', 'wpt');
const QUARANTINE = join(ROOT, 'tests', 'fixtures', 'wpt-quarantine.json');
const TOLERANCE = 0.1;

const SUITES = ['css-flexbox', 'css-grid', 'css-sizing', 'css-align'] as const;

/** `Math.abs(NaN - x) >= t` is false, so a NaN would silently *pass* a
 *  difference test and inflate the score. Compare positively instead. */
const close = (actual: number, expected: number): boolean =>
  Number.isFinite(actual) && Math.abs(actual - expected) < TOLERANCE;

function matches(node: Node, expected: ExpectedNode): boolean {
  const { location, size } = node.layout;
  if (
    !close(location.x, expected.x) ||
    !close(location.y, expected.y) ||
    !close(size.width, expected.width) ||
    !close(size.height, expected.height)
  ) {
    return false;
  }
  if (node.children.length !== expected.children.length) return false;
  return node.children.every((c, i) => matches(c, expected.children[i] as ExpectedNode));
}

/** Spec-section URLs recorded in the emitted page header at import time. */
function helpUrls(suite: string, fixtureName: string): string[] {
  const page = join(HTML_ROOT, suite, `${fixtureName.replace(/__(border|content)_box_(ltr|rtl)$/, '')}.html`);
  if (!existsSync(page)) return [];
  return [...readFileSync(page, 'utf8').matchAll(/^\s*help:\s*(\S+)$/gm)].map((m) => m[1] as string);
}

/** drafts.csswg.org/css-grid-1/#track-sizing -> css-grid-1/#track-sizing */
function sectionKey(url: string): string {
  const m = /(?:drafts\.csswg\.org|www\.w3\.org\/TR)\/([^/]+)\/?(#[^/?]*)?/.exec(url);
  if (m === null) return url;
  return `${m[1]}${m[2] ?? ''}`;
}

interface Result {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

function run(): void {
  const results: Result[] = [];
  for (const suite of SUITES) {
    const dir = join(FIXTURES_ROOT, suite);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
      const name = file.replace(/\.xml$/, '');
      let passed = false;
      let error: string | undefined;
      try {
        const fixture = parseFixture(readFileSync(join(dir, file), 'utf8'));
        computeLayout(fixture.root, fixture.viewport, { rounding: fixture.useRounding });
        passed = matches(fixture.root, fixture.expected);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      results.push({ suite, name, passed, ...(error !== undefined ? { error } : {}) });
    }
  }

  const quarantine: string[] = existsSync(QUARANTINE)
    ? (JSON.parse(readFileSync(QUARANTINE, 'utf8')) as { quarantined: string[] }).quarantined
    : [];
  const quarantined = new Set(quarantine);

  const failing = results.filter((r) => !r.passed).map((r) => r.name);
  const failingSet = new Set(failing);
  const newlyFailing = failing.filter((n) => !quarantined.has(n)).sort();
  const newlyPassing = [...quarantined].filter((n) => !failingSet.has(n)).sort();

  // --- Report ---
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  console.log(`wpt-score: ${passed}/${total} passing (${((passed / total) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('by suite:');
  for (const suite of SUITES) {
    const rows = results.filter((r) => r.suite === suite);
    if (rows.length === 0) continue;
    const p = rows.filter((r) => r.passed).length;
    console.log(`  ${suite.padEnd(14)} ${String(p).padStart(4)}/${String(rows.length).padEnd(5)} ${((p / rows.length) * 100).toFixed(0).padStart(3)}%`);
  }

  reportCorpusCoverage();

  const bySection = new Map<string, { pass: number; fail: number }>();
  for (const r of results) {
    const keys = helpUrls(r.suite, r.name).map(sectionKey);
    for (const key of keys.length > 0 ? keys : ['(no spec link)']) {
      const cur = bySection.get(key) ?? { pass: 0, fail: 0 };
      if (r.passed) cur.pass++;
      else cur.fail++;
      bySection.set(key, cur);
    }
  }
  const failingSections = [...bySection.entries()]
    .filter(([, v]) => v.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail || a[0].localeCompare(b[0]));
  console.log('');
  console.log(`failing by spec section (${failingSections.length} sections):`);
  for (const [section, v] of failingSections.slice(0, 25)) {
    console.log(`  ${String(v.fail).padStart(4)} fail  ${String(v.pass).padStart(4)} pass  ${section}`);
  }

  const crashes = results.filter((r) => r.error !== undefined);
  if (crashes.length > 0) {
    console.log('');
    console.log(`crashes (${crashes.length}):`);
    for (const c of crashes.slice(0, 10)) console.log(`  ${c.name}: ${c.error}`);
  }

  if (newlyFailing.length > 0) {
    console.log('');
    console.log(`NEWLY FAILING (${newlyFailing.length}) — regressions vs quarantine:`);
    for (const n of newlyFailing.slice(0, 20)) console.log(`  ${n}`);
  }
  if (newlyPassing.length > 0) {
    console.log('');
    console.log(`newly passing (${newlyPassing.length}) — remove from quarantine to promote:`);
    for (const n of newlyPassing.slice(0, 20)) console.log(`  ${n}`);
  }

  if (process.argv.includes('--write-quarantine')) {
    writeFileSync(QUARANTINE, `${JSON.stringify({ quarantined: failing.sort() }, null, 1)}\n`);
    console.log('');
    console.log(`wrote ${failing.length} entries to tests/fixtures/wpt-quarantine.json`);
    return;
  }
  // Regressions are the only failure mode: a quarantined failure is expected.
  if (newlyFailing.length > 0) process.exit(1);
}

run();

/**
 * Corpus coverage, so `wpt-score`'s headline ratio cannot be mistaken for a
 * coverage claim. The score's denominator is only the tests we can *express*;
 * this reports how much of the scanned corpus that is, and — more usefully —
 * how much of the rest is out of scope by design versus still reachable.
 *
 * "Out of scope" is derived from the skip reason recorded at import time, not
 * from a hand-maintained list, so it cannot drift away from what the importer
 * actually does. Anything not matching a known non-goal counts as reachable,
 * which deliberately errs toward overstating the gap rather than hiding it.
 */
function reportCorpusCoverage(): void {
  const manifestPath = join(ROOT, 'tests', 'html', 'wpt', 'manifest.json');
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    files: Record<string, { class: string; reason?: string; kind?: string }>;
  };

  // Engine non-goals: no inline formatting context, no replaced elements, no
  // floats, no writing modes, and no tests whose assertions are computed in JS.
  const OUT_OF_SCOPE_EXACT = new Set([
    'kind:no-assertions',
    'no-body',
    'no-divs',
    'css-parse',
    'rewrite-failed',
    'harness-conflict',
    'degenerate',
  ]);
  // Whole feature trees this engine does not implement. These must be matched
  // by path, not by skip reason: a masonry test is rejected for whatever it
  // happens to trip first (`element:item`, `element:grid`, ...), so counting by
  // reason scattered ~1000 non-goal pages across the "reachable" bucket and
  // made the importer gap look far larger than it is.
  const OUT_OF_SCOPE_PATH = /(?:^|\/)(?:grid-lanes|masonry|subgrid)(?:\/|-)/;

  const OUT_OF_SCOPE_PREFIX = [
    'script:',
    // The pinned Chrome contradicts the spec, so no derivable fixture is both
    // correct and passable. Not an importer gap; see CHROME_DIVERGENT.
    'chrome-divergent:',
    // `display: grid-lanes` is a distinct (masonry-style) layout mode this
    // engine does not implement; not an importer gap.
    'value:display:grid-lanes',
    'value:display:inline grid-lanes',
    'element:grid-lanes',
    'property:writing-mode',
    'property:float',
    'property:clear',
    'property:vertical-align',
    'element:span',
    'element:strong',
    'element:b',
    'element:i',
    'element:img',
    'element:canvas',
    'element:svg',
    'element:table',
    'element:pre',
    'element:hr',
    'element:input',
    'element:iframe',
    'element:video',
    'value:display:inline',
    'value:align-items:last baseline',
    'value:align-self:last baseline',
  ];

  let imported = 0;
  let outOfScope = 0;
  let reachable = 0;
  const reachableReasons = new Map<string, number>();
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (entry.class === 'import') {
      imported += 1;
      continue;
    }
    const reason = entry.reason ?? '';
    const out =
      OUT_OF_SCOPE_PATH.test(path) ||
      OUT_OF_SCOPE_EXACT.has(reason) ||
      OUT_OF_SCOPE_PREFIX.some((prefix) => reason.startsWith(prefix));
    if (out) outOfScope += 1;
    else {
      reachable += 1;
      reachableReasons.set(reason, (reachableReasons.get(reason) ?? 0) + 1);
    }
  }

  const scanned = imported + outOfScope + reachable;
  const expressible = imported + reachable;
  console.log('');
  console.log('corpus coverage (pages, not fixtures):');
  console.log(`  scanned            ${String(scanned).padStart(5)}`);
  console.log(
    `  out of scope       ${String(outOfScope).padStart(5)}   JS-computed assertions, crash tests, and engine non-goals`,
  );
  console.log(
    `  imported           ${String(imported).padStart(5)}   ${((imported / Math.max(expressible, 1)) * 100).toFixed(0)}% of the ${expressible} pages this engine could express`,
  );
  console.log(`  reachable, not yet ${String(reachable).padStart(5)}   importer gaps, not engine limits`);
  if (reachable > 0) {
    const top = [...reachableReasons].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  largest gaps: ${top.map(([r, n]) => `${r || '(none)'} x${n}`).join(', ')}`);
  }
}
