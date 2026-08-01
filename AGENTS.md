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

| Area | Spec |
|---|---|
| Flex base size, hypothetical size, flexible lengths | [css-flexbox-1](https://www.w3.org/TR/css-flexbox-1/) — §9.2 line sizing, §9.7 resolving flexible lengths |
| Automatic minimum size (`min-width: auto`) | [css-flexbox-1 §4.5](https://www.w3.org/TR/css-flexbox-1/#min-size-auto) |
| Intrinsic contributions, cyclic percentages | [css-sizing-3](https://www.w3.org/TR/css-sizing-3/) — §5 intrinsic sizes |
| `aspect-ratio`, transferred min/max sizes | [css-sizing-4 §4–5](https://www.w3.org/TR/css-sizing-4/#aspect-ratio) |
| Track sizing, placement | [css-grid-1](https://www.w3.org/TR/css-grid-1/) — §11 track sizing |
| Alignment, `stretch`, safe/unsafe | [css-align-3](https://www.w3.org/TR/css-align-3/) |
| Margin collapsing, block flow | [CSS2 §8.3.1](https://www.w3.org/TR/CSS22/box.html#collapsing-margins) |

Prefer the **editor's drafts** at `drafts.csswg.org` over `/TR/` snapshots when
the two differ — Chrome tracks the drafts, and the imported WPT fixtures record
draft URLs in their headers.

Fetch the actual section text (WebFetch on the spec URL). Do not reconstruct a
rule from memory: the details that matter are exactly the ones that are easy to
misremember — which axis, whether a constraint *floors* or *caps*, whether it
applies only to an automatic axis.

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

Batches are **git-ignored**: they run to several MB and are regenerable from
their seed (`pnpm fuzz-batch --seed <n>`), so they are a local working target,
not a shared artifact. A finding worth keeping gets promoted to a real fixture
under `tests/fixtures/fuzz-found/` via `pnpm fuzz` + `pnpm gentest`, which is
what actually guards against regressions.

`fuzz-batch-status` clusters open findings by *where* the geometry differs
(node paths, axes, displays). Work top-down, but **do not read cluster size as
fix value**: clusters are heterogeneous, and a 65-finding cluster twice yielded
only two fixes because several unrelated causes shared a node path.
