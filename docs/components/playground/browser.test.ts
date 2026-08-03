// Browser identification and the overlay's agreement check.
//
// The UA cases matter because the tokens overlap: every Chromium UA contains
// "Chrome" AND "Safari", Edge and Opera contain "Chrome" too, so a naive test
// order silently reports the wrong browser — and the browser's identity decides
// whether a mismatch is reported as an engine bug.

import { describe, expect, it } from 'vitest';
import { AGREEMENT_EPSILON, detectBrowser, issueUrl, maxDelta } from './browser.js';

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  opera:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  // What Puppeteer/CI reports. Note it has no bare "Chrome/" token, so a naive
  // check misidentifies it as Safari — which this caught in practice.
  headless:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
} as const;

describe('detectBrowser', () => {
  it.each([
    ['chrome', UA.chrome, 'Chrome', '131'],
    ['edge', UA.edge, 'Edge', '131'],
    ['opera', UA.opera, 'Opera', '115'],
    ['safari', UA.safari, 'Safari', '18'],
    ['firefox', UA.firefox, 'Firefox', '133'],
    ['chrome', UA.headless, 'Chrome', '151'],
  ])('identifies %s', (id, ua, name, version) => {
    const info = detectBrowser(ua);
    expect(info.id).toBe(id);
    expect(info.name).toBe(name);
    expect(info.version).toBe(version);
  });

  // The oracle is a pinned Chrome, so only Blink-based browsers can witness a
  // conformance bug. Getting this backwards would send false reports.
  it.each([
    [UA.chrome, true],
    [UA.edge, true],
    [UA.opera, true],
    [UA.headless, true],
    [UA.safari, false],
    [UA.firefox, false],
  ])('marks oracle status', (ua, isOracle) => {
    expect(detectBrowser(ua).isOracle).toBe(isOracle);
  });

  it('falls back for an unknown agent', () => {
    const info = detectBrowser('some-crawler/1.0');
    expect(info.id).toBe('browser');
    expect(info.isOracle).toBe(false);
  });
});

describe('maxDelta', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('is zero for identical layouts', () => {
    expect(maxDelta([box(0, 0, 10, 10)], [box(0, 0, 10, 10)])).toBe(0);
  });

  it('reports the largest difference across every edge', () => {
    // Bottom edges: 10 vs 13 — three whole pixels, well past any snap.
    expect(maxDelta([box(0, 0, 10, 10)], [box(1, 0, 10, 13)])).toBe(3);
  });

  it('returns null when the box counts differ', () => {
    expect(maxDelta([box(0, 0, 1, 1)], [])).toBeNull();
  });

  it('returns null for empty input, which nothing can be concluded from', () => {
    expect(maxDelta([], [])).toBeNull();
  });

  // The case that produced a false "you found a bug" on the docs index: a
  // repeat(3, 1fr) grid across 283px. Chrome reports fractional tracks
  // (86.66 / 86.67 / 86.66); the engine snaps each to a whole pixel and
  // redistributes the error so the tracks stay flush. Same layout, two
  // rounding conventions — and the error accumulates along the row, so the
  // last track's edge is over a pixel from Chrome's.
  it('treats whole-pixel snapping of fractional tracks as agreement', () => {
    const chrome = [box(145, 57, 86.66, 69), box(244.16, 57, 86.67, 69), box(342.83, 57, 86.66, 69)];
    const engine = [box(145, 57, 87, 69), box(245, 57, 86, 69), box(343, 57, 87, 69)];
    const delta = maxDelta(engine, chrome);
    expect(delta).not.toBeNull();
    expect(delta ?? 0).toBeLessThanOrEqual(AGREEMENT_EPSILON);
  });

  // An edge is scored 0 when the engine's integer is a whole pixel the
  // browser's fractional value could snap to — in EITHER direction, since
  // cumulative rounding redistributes error along a row.
  it.each([
    ['snapped down', 86],
    ['snapped up', 87],
  ])('accepts an edge %s from a fractional browser value', (_label, edge) => {
    expect(maxDelta([box(0, 0, edge, 10)], [box(0, 0, 86.66, 10)])).toBe(0);
  });

  // A box whose left AND right edge each snapped a different way differs in
  // WIDTH by more than a pixel while each edge is still a legitimate snap.
  it('accepts a box whose edges snapped opposite ways', () => {
    const chrome = [box(10.6, 0, 100.8, 10)]; // edges at 10.6 and 111.4
    const engine = [box(10, 0, 102, 10)]; //     edges at 10   and 112
    expect(maxDelta(engine, chrome)).toBe(0);
    // Comparing widths instead would have called this a 1.2px disagreement.
    expect(Math.abs(102 - 100.8)).toBeGreaterThan(AGREEMENT_EPSILON);
  });

  // Anything past the two candidate integers is real, and the number reported
  // is the size of the genuine gap rather than the rounding.
  it('reports how far an edge lies beyond the nearest snap', () => {
    expect(maxDelta([box(0, 0, 88.5, 10)], [box(0, 0, 86.66, 10)]) ?? 0).toBeCloseTo(1.5);
  });

  // The check still has to catch a box in the wrong place — a misplaced flex
  // item or a dropped gap moves an edge far past any rounding.
  it('still reports a placement error above the threshold', () => {
    const delta = maxDelta([box(0, 0, 100, 100)], [box(12, 0, 100, 100)]);
    expect(delta ?? 0).toBeGreaterThan(AGREEMENT_EPSILON);
  });

  // Integers on both sides: there is no fractional value to snap, so a whole
  // pixel of difference is unambiguously real.
  it('reports a full-pixel difference between integer edges', () => {
    const delta = maxDelta([box(0, 0, 100, 10)], [box(0, 0, 101, 10)]);
    expect(delta ?? 0).toBeGreaterThan(AGREEMENT_EPSILON);
  });
});

describe('issueUrl', () => {
  const browser = detectBrowser(UA.chrome);

  it('carries the source, browser, and delta needed to reproduce', () => {
    const url = issueUrl({ source: '<Layout />', browser, viewport: 640, delta: 2.5 });
    const body = decodeURIComponent(new URL(url).searchParams.get('body') ?? '');
    expect(body).toContain('<Layout />');
    expect(body).toContain('Chrome 131');
    expect(body).toContain('640px');
    expect(body).toContain('2.50px');
  });

  it('describes a structural mismatch when there is no single delta', () => {
    const url = issueUrl({ source: '', browser, viewport: 100, delta: null });
    const body = decodeURIComponent(new URL(url).searchParams.get('body') ?? '');
    expect(body).toContain('differing box counts');
  });
});
