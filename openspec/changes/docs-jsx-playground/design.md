## Context

See proposal.md — Why.

The docs site is a Fumadocs/Next app in `docs/`, a sibling package to the library. `next.config.mjs` aliases `bento-layout` to `../src/index.ts` and pins webpack (not Turbopack) because `src/` is NodeNext TypeScript importing `./tree.js` to mean `tree.ts`; only webpack's `extensionAlias` performs that rewrite. The engine therefore already runs client-side against live source, with no build step in the loop.

`components/smoke-test.tsx` renders one hardcoded two-box layout to prove the alias resolves. It is scaffolding this change replaces.

The reference point is Yoga's playground, whose implementation is four files totalling ~450 lines: `react-live` supplies the editor and evaluation, `<Node>` is an empty `PureComponent` used purely as a marker, a `React.Children` walk turns the element tree into plain style data, and a recursive component paints absolutely-positioned divs. Notably it has no tree widget, no property inspector, and no code-generation pane, and its docs pages embed the identical component used by the standalone playground.

## Goals / Non-Goals

**Goals**

- One demo component serving both inline docs demos and the standalone playground.
- Demo source that reads like CSS, not like engine internals.
- No execution of reader-supplied source, so share links can later be added safely.
- No cost to the library: no source edits, no new exports, no new runtime dependency.

**Non-Goals**

- Sandboxing an execution environment. The design removes execution rather than containing it.
- A general CSS parser. Only the value forms demos need are accepted.
- Matching Yoga feature-for-feature. Its `useWebDefaults` config toggle has no analogue here.
- Deciding the `/playground` route's editor. Deferred; see Open Questions.

## Decisions

### Parse the demo dialect instead of evaluating it

Yoga uses `react-live`, which transforms JSX with sucrase and evaluates the result with a scope object. That works because the values being evaluated are literals — but the mechanism is general-purpose evaluation, which is why typing a bare word into their playground produces `ReferenceError: margin is not defined`: the buffer is running as JavaScript.

Our demo dialect has no expressions, no loops, and no component semantics. What looks like JSX is a nested literal wearing angle brackets. So the untrusted surface is a data format, not a program, and it can be parsed: accept `JSXElement`, `ObjectExpression`, `Literal`, `ArrayExpression`, and negation on numbers; reject every other AST node type as a syntax error.

*Alternatives considered.* `react-live` — ~75KB gzip, of which the largest component is `prism-react-renderer`, a second syntax highlighter alongside the one the docs site already has; frozen since November 2024 (React 19 is supported via a `>=18` peer range); and it makes any future share-link feature an XSS vector on the docs origin. Evaluating with sucrase directly — ~30 lines and drops the frozen dependency, but keeps the execution semantics we do not want. Sandboxing evaluation in a WASM JS runtime — sandboxes the wrong layer, since the engine and renderer must run in the page anyway, and costs orders of magnitude more than the problem warrants.

*Trade-off accepted.* Computed values in demos become impossible: a demo wanting twenty wrapped items writes them out longhand. Judged acceptable because demos illustrate single properties.

### CSS value strings are coerced in the docs package, not the library

`StyleInput` is deliberately structured-only: `10` not `'10px'`, `{ percent: 0.5 }` not `'50%'`, `{ keyword: 'center', safe: false }` not `'center'`. Written literally, demo source stops looking like CSS and starts looking like a config file, which is the opposite of what a teaching demo needs.

Widening `StyleInput` to accept CSS strings was considered at length and rejected: it puts a parser in the library's published surface, with the documentation, stability, and hostile-input obligations that implies, in a library that states it has no CSS parser. The playground's needs do not justify that, and a playground can be far less careful than a library.

Coercion therefore lives in the docs package. The library is untouched, and `tests/api.test.ts`'s export snapshot does not move.

*Consequence to accept.* Docs code samples showing library usage must show structured values, while demo source shows CSS strings. These are two dialects on one site and the distinction must be made explicit in prose, or readers will copy a demo string into their own project and hit a type error.

### Build coercion on a value tokenizer rather than the fixture parser or CSSOM

`tests/harness/fixture.ts` already parses CSS strings into engine types — `parseTrackList`, `parseTrackSizingFunction`, `parseGridPlacement` — with paren-depth-aware splitting, `fit-content()` support, and a test file, validated indirectly by 4417 fixtures. Copying it was the leading option and was rejected on input assumptions: it was written for the trusted dialect `gentest` emits, and its shortcuts are silent on hostile input. `parseGridPlacement('abc')` yields `{ line: NaN }`; `repeat(3)` with no comma yields garbage from a `-1` index. A `NaN` reaching the engine is the one failure mode that is not a visible error — `parseLength`'s own comment records a hang in `findSizeOfFr` caused by exactly that — and a playground receives half-typed input on every keystroke.

`postcss-value-parser` (~1.8KB gzip, zero dependencies) tokenizes values into a nested node tree, verified to handle `repeat(auto-fill, minmax(100px, 1fr))`, space-separated track lists, and `vp.unit()` splitting number from unit for whitelist checks. Malformed input fails at tokenization instead of becoming a number, and a dependency cannot drift from a test helper the way a copied file would.

The *semantics* carry over from the fixture parser, which is the part with validation behind it: a bare `fr` track takes an `auto` minimum, `fit-content()` likewise, percentages divide by 100, `minmax()` maps to `{ min, max }`.

*Alternatives considered.* `CSSStyleDeclaration` — free and spec-correct, but returns normalized strings rather than structure, so the mapper is still needed; silently drops values Chrome does not support, an odd oracle for a library with documented Chrome divergences. `css-tree` — genuinely grammar-aware and confirmed to validate `grid-template-columns` against the real spec production, but returns a grammar match tree rather than resolved tracks, so the mapper remains, at roughly 120KB. No library resolves CSS track lists into layout-engine types, because that representation belongs to layout engines; this project is one of the few things that produces it.

### Editing is a textarea over highlighted output

Demos are planned for most docs pages, so the editor's cost is effectively baseline. CodeMirror (~119KB gzip) is heavy for a five-line snippet and buys multi-cursor and bracket matching that editing `flexDirection: 'column'` does not need. A `<textarea>` overlaid on syntax-highlighted output — the same trick `use-editable` performs inside `react-live` — adds no editor bundle where the site already highlights code.

### The preview is SVG, not positioned divs

Yoga's renderer paints absolutely-positioned divs, and the first version here did the same. SVG is a better fit for the same job: a `<rect>`'s `x`/`y`/`width`/`height` are exact user-space numbers with no box model between them and the engine's output, so subpixel geometry survives and `unroundedLayout` could be rendered faithfully if that is ever wanted.

The concrete win is that the border compensation disappears. A div preview draws a 1px border the engine knows nothing about, so every level has to subtract the parent's border or the drift compounds with depth. In SVG the whole correction is a constant half-stroke inset per rect, because nesting is expressed as `<g transform="translate(x y)">` — which is exactly what `location` means, being parent-relative.

*What it costs.* SVG renders nothing at all for a rect with zero width or height. A node collapsed on one axis still has extent on the other and would vanish misleadingly, so it draws a `<line>` instead. A node collapsed on *both* axes draws nothing, deliberately: it occupies no space, and the source that produced it is on screen beside the preview. An earlier version marked that case with a dot, which cost a nested branch, an extra element, and a CSS rule to convey less than the code already does.

### Errors overlay rather than replace the preview

Mid-edit invalid states are the common case, not the exception. Rendering the error over the last good preview (as Yoga does) keeps the demo legible while typing. Layout is recomputed per edit with no incremental machinery: `computeLayout` clears all caches per call by design, which is irrelevant at demo tree sizes.

## Risks / Trade-offs

- **Two style dialects on one site** (demo strings vs. structured `StyleInput` in code samples) → Make the split explicit in prose where demos first appear; keep code samples consistently structured so the canonical library form is unambiguous.
- **`NaN` or an out-of-range value reaching `computeLayout` hangs the browser tab**, per the `findSizeOfFr` incident recorded in `tests/harness/fixture.ts` → Reject non-finite numbers at coercion, before any value reaches the engine; cover with a test asserting rejection rather than layout.
- **The demo dialect looks like React and is not** → `<Node>` accepting only `style` and children, and erroring clearly on anything else, makes the boundary visible at first contact.
- **Fumadocs may expose its highlighter only at build time**, weakening the "no extra editor bundle" claim → Verify before building the editor; falling back to a client-side highlighter is contained, and the textarea approach holds either way.
- **A demo that renders wrongly is an engine bug on a public page** → Acceptable and arguably useful: demos exercise the same public API as any consumer, so the docs act as continuous conformance surface.

## Migration Plan

`smoke-test.tsx` and its use in `content/docs/index.mdx` are removed once the first real demo renders. No library, package, or published-surface change, so there is nothing to roll back beyond the docs package itself.

## Open Questions

- Which editor the `/playground` route uses. It is one lazy-loaded route, so CodeMirror is defensible there while docs pages stay on the textarea; deferrable because both consume the same parse-and-render core and the specs do not distinguish them.
- Whether share links are worth adding. The no-eval design makes them inert and they are valuable for bug reports, but nothing here depends on the decision.
- Whether any planned demo needs `fit-content()` or grid placement strings on day one. The coercion layer can grow value forms without changing its shape, so the initial set can be driven by the demos actually written.
