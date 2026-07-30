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

All 4,384 fixtures pass, none skipped (0.1px tolerance, both `box-sizing`
modes, ltr and rtl). The corpus began as Taffy's fixture suite and grows with
locally authored cases.

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
