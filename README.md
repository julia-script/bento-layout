# flexboxjs

A TypeScript-only port of [Taffy](https://github.com/DioxusLabs/taffy)'s CSS
flexbox, CSS Grid, and block layout algorithms. Zero runtime dependencies, no
WASM — plain objects in, pixel positions out.

Verified against **4,368 Chrome-derived conformance fixtures** from Taffy's test
suite — every fixture Taffy ships for these layout modes, none skipped (see
[Conformance](#conformance)).

## Usage

```ts
import { computeLayout, createNode } from 'flexboxjs';

const child1 = createNode({ style: { flexGrow: 1 } });
const child2 = createNode({ style: { flexGrow: 1 } });
const root = createNode({
  style: { size: { width: 400, height: 300 }, gap: { width: 10, height: 0 } },
  children: [child1, child2],
});

computeLayout(root, { width: 'max-content', height: 'max-content' });

child1.layout; // { location: { x: 0, y: 0 }, size: { width: 195, height: 300 }, ... }
child2.layout; // { location: { x: 205, y: 0 }, size: { width: 195, height: 300 }, ... }
```

### Styles

Styles mirror CSS, as plain data:

- Lengths: `100` (px), `{ percent: 0.5 }` (fraction, not 0–100), `'auto'`
- `display` (`'flex'`, `'grid'`, or `'block'`), `position` (`relative`/`absolute` with `inset`), `boxSizing`, `direction` (`ltr`/`rtl`)
- `size` / `minSize` / `maxSize`, `aspectRatio`
- `margin` (supports `'auto'`; vertical block margins collapse per CSS 2.2), `padding`, `border`, `gap`
- `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`
- `gridTemplateRows` / `gridTemplateColumns` — arrays of track sizes: `40`,
  `{ percent: 0.1 }`, `'auto'`, `'min-content'`, `'max-content'`, `{ fr: 1 }`,
  `{ fitContent: 30 }`, `{ min, max }` (minmax), and
  `{ repeat: 3 | 'auto-fill' | 'auto-fit', tracks: [...] }`
- `gridAutoRows` / `gridAutoColumns`, `gridAutoFlow` (`'row'`/`'column'`, `-dense`),
  `gridRow` / `gridColumn` placements (`{ line: n }` incl. negative, `{ span: n }`, `'auto'`)
- `alignItems` / `alignSelf` / `alignContent` / `justifyContent` / `justifyItems` / `justifySelf`
  (e.g. `{ keyword: 'center', safe: true }`, or parse from CSS strings with
  `parseAlignItems('safe center')`)
- `textAlign` for block containers (`legacy-left`/`legacy-right`/`legacy-center`)
- `overflow` + `scrollbarWidth` (scrollbar gutters and automatic-min-size behavior)

### Text and other leaf content

Leaf nodes take a `measure` callback so content (text, images) can report its size:

```ts
const text = createNode({
  measure: (knownDimensions, availableSpace) => measureMyText(knownDimensions, availableSpace),
});
```

### Rounding

Layouts are computed in floats and snapped to whole pixels the way browsers do
(cumulative rounding, so adjacent boxes never gap or overlap). Pass
`{ rounding: false }` to `computeLayout` for the raw values; both are available
as `node.layout` and `node.unroundedLayout`.

## Conformance

Conformance fixtures are generated **directly from a real, pinned Chrome** by
the in-repo pipeline: HTML fixture sources live in `tests/html/`, and
`pnpm gentest` renders each one headless (Ahem font, deterministic viewport),
extracting expectations for all four box-sizing/direction variants into the
committed XML under `tests/fixtures/`. The generating Chrome build is recorded
in `tests/fixtures/CHROME_VERSION`; `pnpm test` never needs a browser.

All 4,904 conformance fixtures pass (0.1px tolerance, both `box-sizing` modes,
ltr and rtl). The corpus began as Taffy's fixture suite and grew three ways:
locally authored cases, fuzz-found regressions, and an imported subset of
web-platform-tests. Ten WPT fixtures are quarantined — see *Conformance
scoreboard* below.

### Authoring a new conformance test

1. Write a small HTML page in `tests/html/<category>/my_case.html` (copy an
   existing fixture; styles go inline on elements under `#test-root`).
2. `pnpm gentest my_case` — renders it in the pinned Chrome and writes the XML
   fixtures.
3. `pnpm test` — the engine must match the browser.

**Divergence policy: the browser wins.** If the engine disagrees with the
generated expectations, the engine gets fixed; deliberate exceptions require an
entry in `KNOWN_DIVERGENCES.md` with a spec citation. (This policy has already
paid off: the first authored fixture exposed an aspect-ratio constraint bug
inherited from Taffy, now fixed to match Chrome.)

**If a fixed bug also exists upstream, log it.** This engine is a port of
[Taffy](https://github.com/DioxusLabs/taffy), so a bug found here is often a bug
there. Whenever a fix lands for a defect that Taffy also has, add an entry to
`UPSTREAM_TAFFY.md` in the same commit — with the Taffy source location, the
minimized reproduction, engine-vs-Chrome numbers, the spec citation, and an
explicit `Verified in Taffy: confirmed | suspected`. Reading Taffy's source
makes a finding *suspected*; only running Taffy makes it *confirmed*, and
nothing should be filed upstream while still suspected. That file is kept
standalone so the upstreaming effort does not depend on this repo's history.

### Differential fuzzing

`pnpm fuzz` generates random layout trees, renders each in the pinned Chrome,
and compares against the engine — the same oracle as the fixtures, over inputs
nobody thought to write.

```bash
pnpm fuzz --mode grid --iterations 25 --seed 20260731
pnpm fuzz-triage '<minimized-tree-json>'   # or a path to a .json file
```

Modes are `flex`, `grid`, `block`, `mixed`. A finding is shrunk automatically
and printed as a `minimized:` line; feed that to `pnpm fuzz-triage` to see
chrome-vs-engine geometry for every node in all four variants. Findings are
persisted to `tests/html/fuzz-found/` unless `--no-write` is passed.

Budget: throughput is roughly 0.2–4.4 trees/s depending on mode and tree size
(grid is slowest), so 25 trees per mode is a few minutes and is the default
campaign size. Raise `--max-findings` (default 5) to see a whole run.

Two traps are worth knowing. **A crash in one tree hides every tree after it** —
always check the `checked N trees` line matches what you asked for. And **the
tree-level finding count is a poor progress metric**: one bug flags an entire
tree, so it barely moves across real fixes. Track the feature histogram over the
minimized findings instead.

### Conformance scoreboard

A subset of [web-platform-tests](https://github.com/web-platform-tests/wpt) is
imported through the same Chrome oracle, giving a finite, spec-organized
denominator that fuzzing cannot provide.

```bash
pnpm wpt-import          # classify + rewrite (needs a WPT checkout)
pnpm wpt-score           # pass/fail per suite and per spec section
pnpm wpt-score --write-quarantine
```

WPT supplies *inputs* only: its own expectations and reference pages are never
consumed, so reftests import too. Classification is a conservative allowlist —
a false skip only costs corpus, while a false import would poison the score.
Tests the harness structurally cannot express (`order`, anonymous flex/grid
items, self-set `box-sizing`) are excluded at import rather than left failing.

Currently **418/428 (97.7%)**: css-flexbox, css-sizing and css-align at 100%,
css-grid at 96%. Failing fixtures live in `tests/fixtures/wpt-quarantine.json`
so `pnpm test` stays green; the scoreboard owns the red. Promote a fixture by
deleting its quarantine entry in the same commit as the fix.

Never shrink the denominator to raise the number — dropping tests that pass
inflates the score, which is the one thing this metric exists to prevent.

## Scope

Flexbox, CSS Grid, CSS block layout, and the full box model. Not implemented:
named grid lines / `grid-template-areas`, floats, `calc()`, inline layout,
subgrid. The port follows Taffy's algorithm structure closely
(`src/compute/flexbox.ts`, `src/compute/block.ts`, and `src/compute/grid/*` map
module-by-module to Taffy's `compute/`), so future upstream fixes are easy to
carry over.

## Development

```bash
pnpm install
pnpm test        # vitest: conformance fixtures + unit tests
pnpm build       # emit ESM + .d.ts to dist/
```
