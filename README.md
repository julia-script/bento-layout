# flexboxjs

A TypeScript-only port of [Taffy](https://github.com/DioxusLabs/taffy)'s CSS flexbox
and block layout algorithms. Zero runtime dependencies, no WASM — plain objects in,
pixel positions out.

Verified against **3,140 Chrome-derived conformance fixtures** from Taffy's test
suite (see [Conformance](#conformance)).

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
- `display` (`'flex'` or `'block'`), `position` (`relative`/`absolute` with `inset`), `boxSizing`, `direction` (`ltr`/`rtl`)
- `size` / `minSize` / `maxSize`, `aspectRatio`
- `margin` (supports `'auto'`; vertical block margins collapse per CSS 2.2), `padding`, `border`, `gap`
- `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`
- `alignItems` / `alignSelf` / `alignContent` / `justifyContent`
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

`tests/fixtures/` vendors Taffy's language-agnostic XML test fixtures —
input trees plus layout expectations generated from real Chrome renders. The
pinned upstream commit is recorded in `tests/fixtures/TAFFY_COMMIT`.

- 3,140 fixtures pass: 2,244 `flex`, 868 `block`, 28 `blockflex`
  (0.1px tolerance, both `box-sizing` modes, ltr and rtl)
- 8 fixtures are skipped because their trees require CSS Grid, which this
  package deliberately does not implement (see the skip list in
  `tests/fixtures.test.ts`)

## Scope

Flexbox, CSS block layout, and the full box model. Not implemented: CSS Grid,
floats, `calc()`, inline layout. The port follows Taffy's algorithm structure
closely (`src/compute/flexbox.ts` and `src/compute/block.ts` map
section-by-section to Taffy's `compute/flexbox.rs` and `compute/block.rs`), so
future upstream fixes are easy to carry over.

## Development

```bash
pnpm install
pnpm test        # vitest: conformance fixtures + unit tests
pnpm build       # emit ESM + .d.ts to dist/
```
