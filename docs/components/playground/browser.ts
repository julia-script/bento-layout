// Which browser is rendering the overlay, and what a disagreement with it means.
//
// The overlay compares the engine against whatever browser the reader happens
// to be using, so naming it matters twice over. Calling everything "chrome"
// would be wrong on Safari, and — more importantly — it would misreport what a
// mismatch signifies: this project defines correctness as agreement with a
// pinned Chrome, so a difference in Chrome is a bug in the engine, while a
// difference in Firefox may just be Firefox differing from Chrome.

/** The repository that receives conformance bug reports. */
const ISSUES_URL = 'https://github.com/julia-script/bento-layout/issues/new';

export interface BrowserInfo {
  /** Short lowercase id, used as the overlay's toggle label. */
  id: string;
  /** Display name for prose. */
  name: string;
  /** Version, when the UA string gives one. */
  version: string;
  /**
   * Whether this browser is the engine's conformance oracle.
   *
   * Only Chromium-family browsers are: the fixtures are generated from a
   * pinned headless Chrome, so agreement is defined against Blink. A mismatch
   * here is a defect worth reporting; elsewhere it is a data point.
   */
  isOracle: boolean;
}

/**
 * Identify the current browser from the UA string.
 *
 * Order matters: Edge and Opera both carry "Chrome" in their UA, and Chrome
 * carries "Safari", so the more specific tokens are tested first. This is
 * user-agent sniffing, which is normally a smell — here the browser's identity
 * *is* the datum being reported, so there is no feature to detect instead.
 */
export function detectBrowser(ua: string): BrowserInfo {
  const match = (re: RegExp) => re.exec(ua)?.[1] ?? '';

  // Chromium derivatives, most specific first.
  if (/\bEdg\//.test(ua)) {
    return { id: 'edge', name: 'Edge', version: match(/\bEdg\/(\d+)/), isOracle: true };
  }
  if (/\bOPR\//.test(ua)) {
    return { id: 'opera', name: 'Opera', version: match(/\bOPR\/(\d+)/), isOracle: true };
  }
  if (/\bFirefox\//.test(ua)) {
    return { id: 'firefox', name: 'Firefox', version: match(/\bFirefox\/(\d+)/), isOracle: false };
  }
  // HeadlessChrome is what Puppeteer and CI report, and it is Blink — so it is
  // the oracle. Without this it falls through to the Safari branch below, since
  // its UA carries "Safari/537.36" but never a bare "Chrome/".
  if (/\bHeadlessChrome\//.test(ua)) {
    return { id: 'chrome', name: 'Chrome', version: match(/\bHeadlessChrome\/(\d+)/), isOracle: true };
  }
  if (/\bChrome\//.test(ua)) {
    return { id: 'chrome', name: 'Chrome', version: match(/\bChrome\/(\d+)/), isOracle: true };
  }
  // Safari is the fallback for WebKit: its UA has no token of its own beyond
  // "Version/x Safari/y", and every Chromium UA above has already been caught.
  if (/\bSafari\//.test(ua)) {
    return { id: 'safari', name: 'Safari', version: match(/\bVersion\/(\d+)/), isOracle: false };
  }
  return { id: 'browser', name: 'this browser', version: '', isOracle: false };
}

/** Geometry of one box, in the shared coordinate space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Largest disagreement between two box lists, in px.
 *
 * Compares raw, unrounded values on both sides. Rounding first is tempting —
 * the engine snaps to whole pixels and the browser does not — but it makes the
 * comparison worse in both directions: 86.4 and 86.6 are 0.2px apart yet round
 * to different integers (a false mismatch), while a genuine 0.9px error can
 * round to zero and vanish (a missed bug). The rounding difference is instead
 * absorbed by AGREEMENT_EPSILON, which is derived from how far snapping can
 * legitimately move an edge.
 *
 * Returns null when the lists cannot be compared at all (different lengths —
 * one engine produced boxes the other did not), which is itself a mismatch but
 * not one a single number describes.
 */
export function maxDelta(a: Rect[], b: Rect[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let worst = 0;
  for (const [i, box] of a.entries()) {
    const other = b[i];
    if (!other) return null;
    // Compared against the browser's own value rounded the way the engine
    // rounds — NOT against a re-rounding of both sides, which would fire on
    // neighbours across an integer boundary (86.4 vs 86.6) and would hide a
    // real sub-pixel error by collapsing it to zero.
    //
    // This asks the only question that survives two rounding conventions:
    // "is the engine's integer the one you get by snapping the browser's
    // value?" A layout that agrees answers yes on every edge no matter how
    // many fractional tracks the error accumulates across, while a box in the
    // wrong place lands on a different integer and is still caught.
    worst = Math.max(
      worst,
      snapDelta(box.x, other.x),
      snapDelta(box.y, other.y),
      snapDelta(box.x + box.width, other.x + other.width),
      snapDelta(box.y + box.height, other.y + other.height),
    );
  }
  return worst;
}

/**
 * How far `engine` is from the nearest whole pixel of `browser`.
 *
 * Zero when the engine's edge is exactly what snapping the browser's edge
 * produces (either direction — `86.66` may legitimately snap to 86 or 87 once
 * cumulative rounding is redistributing error across a row). Otherwise the
 * distance to the closer of the two candidates, so the number reported is the
 * size of the genuine disagreement rather than the rounding.
 */
function snapDelta(engine: number, browser: number): number {
  const low = Math.floor(browser);
  const high = Math.ceil(browser);
  if (engine >= low && engine <= high) return 0;
  return engine < low ? low - engine : engine - high;
}

/**
 * Agreement threshold, in px.
 *
 * NOT the project's 0.1px conformance bar, and deliberately so — the two
 * measure different things. The fixture harness compares the engine against
 * geometry Chrome reports for the *same* rounding model. Here, the engine has
 * already snapped every edge to a whole pixel (its cumulative rounding, the
 * behaviour that keeps adjacent boxes flush) while `getBoundingClientRect`
 * hands back Chrome's raw subpixel geometry, because Chrome rounds at paint
 * time where no API can observe it.
 *
 * So on any track that does not divide evenly the two disagree by construction:
 * a `repeat(3, 1fr)` grid over 283px gives Chrome 86.66 / 86.67 / 86.66 and the
 * engine 86 / 85 / 86. That is agreement, expressed in two rounding
 * conventions — and at 0.5px it was reported as "you found a bug" on a
 * perfectly correct grid, which is the failure mode this constant exists to
 * prevent. False reports cost a maintainer more than a missed 1px does.
 *
 * `maxDelta` already absorbs the rounding difference: it scores an edge as 0
 * when the engine's integer is one of the two whole pixels the browser's value
 * could snap to. So what is left here is genuine disagreement, and the
 * tolerance only needs to cover float noise from reading geometry back through
 * a CSS transform — anything approaching a pixel is a real difference.
 */
export const AGREEMENT_EPSILON = 0.1;

/**
 * A prefilled GitHub issue for a layout the engine and the oracle disagree on.
 *
 * The reader is the one who found it, so the link carries everything needed to
 * reproduce — source, browser, viewport, and the measured delta — rather than
 * asking them to reassemble it by hand.
 */
export function issueUrl(opts: {
  source: string;
  browser: BrowserInfo;
  viewport: number;
  delta: number | null;
}): string {
  const { source, browser, viewport, delta } = opts;
  const title = `Layout differs from ${browser.name} at ${Math.round(viewport)}px`;
  const body = [
    'Found with the playground overlay.',
    '',
    '## Demo source',
    '',
    '```jsx',
    source,
    '```',
    '',
    '## Environment',
    '',
    `- Browser: ${browser.name} ${browser.version}`.trimEnd(),
    `- Viewport width: ${Math.round(viewport)}px`,
    `- Largest difference: ${delta === null ? 'differing box counts' : `${delta.toFixed(2)}px`}`,
    '',
    '## Expected',
    '',
    `The engine's boxes should match ${browser.name}'s within 0.1px.`,
  ].join('\n');

  return `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
