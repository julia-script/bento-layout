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
