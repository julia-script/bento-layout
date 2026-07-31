# Design: grid-auto-margins-text-wrapping

## Context

The four quarantined `auto-margins-ignored-during-track-sizing-001` variants
were diagnosed before this change was proposed. The evidence is below so the
implementation does not repeat it.

The fixture is a 3-column `1fr 1fr 1fr` grid holding three prose paragraphs
plus a fourth item with `margin-left/right: auto` (the actual subject of the
WPT test — auto margins must not feed track sizing).

Engine vs Chrome, `border_box_ltr`:

| node | engine | chrome |
|---|---|---|
| root | 3030x30 | 1280x50 |
| col 1 | 0,0 1010x10 | 0,0 427x30 |
| col 2 | 1010,0 1010x10 | 427,0 426x30 |
| col 3 | 2020,0 1010x10 | 853,0 427x30 |
| auto-margin item | 455,20 100x10 | 163,40 100x10 |

Two independent causes, confirmed separately:

### C1. The recorded viewport is `max-content`, not 1280

`parseViewportConstraint` (`tests/html/support/test_helper.js:93`) reads a real
size only from a `.viewport` ancestor; with none it returns `max-content` on
both axes. The imported page has no wrapper, so the fixture claims max-content
while Chrome measured in a 1280px viewport. The engine then correctly
stretch-fits the block root to its max-content width of 3030.

None of the 107 imported WPT pages has a `.viewport` wrapper.

### C2. `measureAhem` breaks only on U+200B

`tests/harness/measure.ts:33` is `textContent.split(ZWS)`; there is no
whitespace handling. Taffy's fixtures place explicit `&ZeroWidthSpace;` break
opportunities, so this was sufficient upstream. WPT prose uses spaces, so a
whole paragraph is one atomic line.

### The experiment that separates them

Wrapping the test root in `.viewport {width: 1280px}` and regenerating gave:

```
root:  1280x30   (was 3030x30; chrome 1280x50)   <- C1 fixed
col 1: 1010x10   (chrome 427x30)                 <- C2 still present
```

So C1 is necessary but not sufficient, and C2 is independent of it. Both must
land for the fixture to pass. The file was restored afterwards; the tree is
clean.

## Goals / Non-Goals

- Goals: the four variants pass and leave quarantine; no currently-passing
  fixture changes; no `src/` change.
- Non-goals: general CSS line-breaking (this is a fixed-width Ahem measure, not
  a text shaper); bidi text; hyphenation; `word-break`/`overflow-wrap`.

## Decisions

### D1. Fix the viewport at import/rewrite, not in the extractor's default

Changing `parseViewportConstraint`'s fallback from `max-content` to the real
layout viewport would alter what *every* page records, including the 107 WPT
pages and the hand-written corpus that currently rely on the max-content
default. Prefer wrapping WPT test roots in an explicit `.viewport` element
during the import rewrite: it is opt-in per page, uses a mechanism the corpus
already has (`tests/html/grid/grid_available_space_*.html`), and leaves every
existing page's recorded viewport byte-identical.

Open sub-question for the implementer: which width to record. The WPT page was
authored against whatever viewport the harness used (1280 here, matching
`gentest`'s `page.setViewport`). Hard-coding 1280 in the rewrite is honest and
reproducible; deriving it from the browser at generation time is more faithful
but couples fixtures to the runner's window size. Prefer the explicit constant,
and state it in the generated page so a future reader sees why it is there.

### D2. Break on whitespace *in addition to* U+200B, never instead of it

127 committed pages use the ZWS entity and depend on the current rule. Adding
whitespace as an additional break opportunity is behaviour-preserving for any
text without spaces, which is what those pages rely on. Removing or replacing
the ZWS rule is not.

Note the interaction: `measureAhem` derives min-content from the longest
"line". Once spaces break, the longest line becomes the longest *word*, not the
whole string, so min-content contributions shrink for any multi-word text. That
is the correct behaviour and is precisely what makes the columns wrap — but it
is also why this cannot be assumed local. 12 fixtures contain space-separated
text.

### D3. Regeneration is a gate, not a step

`pnpm gentest` re-derives expectations from Chrome. A fixture that "starts
passing" after regeneration may simply have had its expectations rewritten to
match the engine. After regenerating, diff the fixture XML: any expectation
change in a *currently-passing* fixture must be explained before it is
accepted, and the four target fixtures must be shown to fail on the parent
commit for the same reason the abspos fixtures were.

## Risks / Trade-offs

- The whitespace change touches the measure function every fixture shares. If
  it disturbs currently-passing fixtures in ways D2's reasoning does not
  predict, stop: the four fixtures are worth far less than the corpus.
- Recording a viewport for WPT pages makes those fixtures depend on a constant
  that must match what `gentest` renders at. If the two ever drift, expectations
  silently stop matching the recorded input — the same class of defect being
  fixed here. Assert them equal at generation time if that is cheap.

## Open Questions

- Whether Chrome's `1fr` columns at 427/426/427 imply a rounding-remainder
  interaction with the LayoutUnit quantization added in
  `grid-rtl-fr-rounding-remainder` (1280/3 is not integral). Check the three
  column widths sum to 1280 before assuming the text measure alone explains
  them.
- Whether any *other* quarantined-then-promoted fixture was passing only
  because prose measured as one line. Worth a spot-check of the 8 WPT fixtures
  containing multi-word text once whitespace breaking lands.
