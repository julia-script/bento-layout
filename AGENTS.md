# Working on this engine

A CSS layout engine is not a normal codebase: the correct answer is *written
down* in a public specification, and a second implementation (Chrome) is
sitting right there to check against. Guessing is never the cheapest path here
— it only feels like it.

## Read the spec before changing layout code

**When a fixture or fuzz finding disagrees with Chrome, find the spec text
before you edit anything.** The CSS specs describe these cases far more
precisely than the failure does, and most "mysterious" divergences turn out to
be a rule stated plainly in a numbered step.

The specs that govern this engine:

| Area | Spec | Local |
|---|---|---|
| Flex base size, hypothetical size, flexible lengths | css-flexbox-1 §9.2, §9.7 | `spec/css-flexbox-1.bs` |
| Automatic minimum size (`min-width: auto`) | css-flexbox-1 §4.5 | `spec/css-flexbox-1.bs` |
| Intrinsic contributions, cyclic percentages | css-sizing-3 §5 | `spec/css-sizing-3.bs` |
| `aspect-ratio`, transferred min/max sizes | css-sizing-4 §4–5 | `spec/css-sizing-4.bs` |
| Track sizing, placement | css-grid-1 §8, §11 | `spec/css-grid-1.bs` |
| Alignment, `stretch`, safe/unsafe | css-align-3 | `spec/css-align-3.bs` |
| Margin collapsing, block flow | [CSS2 §8.3.1](https://www.w3.org/TR/CSS22/box.html#collapsing-margins) | — (not vendored) |

Prefer the **editor's drafts** at `drafts.csswg.org` over `/TR/` snapshots when
the two differ — Chrome tracks the drafts, and the imported WPT fixtures record
draft URLs in their headers.

Do not reconstruct a rule from memory: the details that matter are exactly the
ones that are easy to misremember — which axis, whether a constraint *floors* or
*caps*, whether it applies only to an automatic axis.

**Read the vendored specs in `spec/`, not the live URLs.** WebFetch silently
truncates the long CSS drafts, and it truncates *before* the algorithm sections
— every attempt to read css-flexbox §9.2 step 3, §4.1, and css-sizing-4 §5 came
back with exactly the useful part missing. `spec/` holds the Bikeshed sources of
css-flexbox-1, css-sizing-3/4, css-grid-1 and css-align-3; grep them by **anchor
id** (quoting differs per file, so match either):

```bash
grep -nE "id=['\"]algo-main-item"        spec/css-flexbox-1.bs  # §9.2 step 3
grep -nE "id=['\"]aspect-ratio-size-transfers" spec/css-sizing-4.bs  # min/max transfers
```

| Area | Anchors |
|---|---|
| §9.2 line sizing | `line-sizing`, `algo-available`, `algo-main-item`, `algo-main-container` |
| §9.3 main sizing | `main-sizing`, `algo-line-break`, `algo-flex` |
| §9.4 cross sizing | `cross-sizing`, `algo-cross-item`, `algo-cross-line`, `algo-line-stretch`, `algo-stretch` |
| §9.5 / §9.6 alignment | `algo-main-align`, `algo-cross-margins`, `algo-cross-align`, `algo-cross-container`, `algo-line-align` |
| §9.7 flexible lengths | `resolve-flexible-lengths` |
| §9.9 intrinsic sizing | `intrinsic-sizes`, `intrinsic-main-sizes`, `intrinsic-cross-sizes`, `intrinsic-item-contributions` |
| §4.1 abspos children | `abspos-items` |
| §8.1 auto margins | `auto-margins`, `item-margins` |
| Properties | `flex-basis-property`, `flex-grow-property`, `flex-direction-property`, `align-items-property`, … (`grep "id='"` for the full list) |

See `spec/README.md` for the full list and how to add another module.

When the spec genuinely underdetermines the case (css-sizing-3 §5.2 cyclic
percentages is the standing example), say so explicitly and record it in
`KNOWN_DIVERGENCES.md` rather than tuning constants until fixtures pass.

## Then confirm the rule against Chrome, and only then edit

The order that works:

1. **Read the spec section.** Write down the rule in one sentence.
2. **Probe Chrome.** Build a small matrix under `scripts/probe-matrix.ts` that
   varies one property at a time around the failure — `min-` vs `max-` vs plain
   size, row vs column, block vs flex vs grid. The matrix tells you the *shape*
   of the rule; a single failing tree never does.
3. **Locate the real path.** Isolate whether the bug is in `leaf.ts`,
   `block.ts`, `flexbox.ts`, or `grid/`, by building the same tree at different
   nesting depths. A wrong container size with a correct child size means the
   *contribution* is wrong, not the child.
4. **Edit once, at the root cause**, and cite the spec section in the comment.
5. **Re-run the probe matrix, then the full suite.** 5000+ fixtures pass today;
   any drop is a regression, not an acceptable trade.

## When spec and Chrome disagree, read the engine source

The oracle is pinned Chrome, i.e. **Blink** — match it even where it diverges
from the spec's literal wording. When a probe matrix contradicts your best
spec reading, stop guessing arithmetic and read the implementation:

- **Blink** (authoritative): fetch from gitiles at the *pinned Chrome's branch*,
  not `main` — behavior can move between releases. For Chrome 151:
  `curl -s "https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/<file>.cc?format=TEXT" | base64 -d`
  (flex lives under `layout/flex/`, grid under `layout/grid/`).
- **WebKit** (readable reference): full checkout at
  `~/Documents/dev.nosync/WebKit`, grid code in
  `Source/WebCore/rendering/RenderGrid.cpp` / `Grid.cpp`. Clearest of the
  engines to read, but it is NOT the oracle — WebKit and Blink split in 2013
  and do differ. Example: for negative grid lines in a template-less axis,
  WebKit materializes the literal contiguous tracks while Chrome materializes
  only tracks spanned by the explicit grid or a placed item; simulating
  WebKit's `populateExplicitGridAndOrderIterator` by hand predicted Chrome on
  0 of the coalescing cases.
- Hand-simulate the engine's algorithm against the probe matrix *before*
  editing. A model that predicts 20/20 measured cases is an implementation
  plan; anything less is another guess. When engine source and rendered
  behavior still disagree, the mechanism usually lives in a stage you haven't
  read yet (that grid bug was in track *materialization*, two stages after the
  line resolver everyone reads first).

## Comments carry the evidence

Non-obvious layout code in this repo explains *why* with a concrete Chrome
observation and/or a spec citation — often the exact numbers from the probe
that motivated it. Keep that convention. A comment saying what the code does is
noise; one saying "Chrome, a row item with `width: 120; flex-basis: 17`, gives
17 not 120 (css-flexbox §9.2.3)" is what stops the next person from
"simplifying" it back into a bug.

## The fuzz batch workflow

```bash
pnpm fuzz-batch --target 1000   # collect shrunk, deduped findings once
pnpm fuzz-batch-status          # re-judge the batch; no browser, ~2s
pnpm fuzz-triage '<tree-json>'  # per-node chrome-vs-engine geometry
```

Chrome's verdict is frozen into each finding at collection time, so a batch
stays a fixed target while you fix against it — and `fuzz-batch-status` needs no
browser, which is what makes it usable in a tight loop.

Batch *files* are git-ignored — several MB each. What is tracked is
`tests/fuzz-seeds.json`, a ~45 KB manifest of the `(seed, index, mode)` triples
the findings derive from:

```bash
pnpm fuzz-batch-manifest save        # batch -> tracked seed manifest
pnpm fuzz-batch-manifest rehydrate   # manifest -> batch, on any machine
```

Rehydrating replays each seed, re-shrinks, and re-freezes Chrome's verdict, so
the same target follows the repo without the payload. It deliberately does not
store shrunk trees: shrinking asks the *current* engine which candidates still
fail, so a tree minimized before a fix is not minimal after it. Findings a fix
already resolved are reported as "already fixed" and drop out — that is the
progress signal, not an error.

A finding worth keeping permanently gets promoted to a real fixture under
`tests/fixtures/fuzz-found/` via `pnpm fuzz` + `pnpm gentest`. Those are what
actually guard against regressions; the batch is only a work queue.

`fuzz-batch-status` clusters open findings by *where* the geometry differs
(node paths, axes, displays). Work top-down, but **do not read cluster size as
fix value**: clusters are heterogeneous, and a 65-finding cluster twice yielded
only two fixes because several unrelated causes shared a node path.
