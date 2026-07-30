## Why

Hand-written fixtures — Taffy's corpus and our own — only cover cases someone thought to write. Differential fuzzing closes the gap: generate random style trees, lay them out with both our engine and pinned Chrome, and every disagreement is a real conformance bug found automatically. This is something Taffy itself never built, and it directly serves the project's new priority (browser parity over Taffy parity): the fuzzer *is* a browser-conformance search engine. It builds on the `browser-conformance-gentest` pipeline (Puppeteer, in-page extraction, pinned Chrome), which must land first.

## What Changes

- New `scripts/fuzz.ts` (`pnpm fuzz --seed <n> --iterations <m> [--mode flex|grid|block|mixed]`): a seeded, reproducible fuzzer that
  1. generates random node trees from the supported style space (sizes/min/max, percentages, margins/padding/border incl. auto margins, aspect-ratio, insets, flex properties, grid templates/placements/auto-flow, gaps, alignment incl. safe variants, direction, box-sizing, Ahem text leaves),
  2. computes layout with our engine,
  3. serializes the same tree to HTML with inline styles, renders it in pinned Chrome via the gentest machinery, and extracts Chrome's geometry,
  4. compares within the harness tolerance and reports mismatches with their seed.
- Automatic **shrinking**: on mismatch, greedily minimize the tree (drop nodes, reset style properties) while the disagreement persists, so failures are reported at near-minimal reproductions.
- **Failure-to-fixture loop**: each minimized mismatch is written as an HTML fixture into the fixture-source tree (fuzz-found directory), flowing through `pnpm gentest` into a committed XML regression test — fuzz findings become permanent conformance tests.
- A style→inline-CSS serializer for engine styles (the inverse of the harness's attribute parser), reusable by any future tooling.
- Out of scope: running the fuzzer in CI as a gate (it stays an on-demand/dev tool; a tiny smoke run may be added to CI later), fuzzing style features the engine deliberately doesn't implement (floats, calc(), named grid lines), multi-browser fuzzing, performance fuzzing.

## Capabilities

### New Capabilities

- `differential-fuzzing`: Generating reproducible random layout trees, comparing the engine's output against pinned Chrome's, shrinking mismatches to minimal reproductions, and persisting them as permanent conformance fixtures.

### Modified Capabilities

(none — the conformance harness consumes fuzz-found fixtures exactly like any other fixture)

## Impact

- New: `scripts/fuzz.ts`, tree generator + style serializer + shrinker modules under `scripts/`, `tests/html/fuzz-found/` fixture directory (checked in as minimized HTML + generated XML regression tests).
- Depends on: `browser-conformance-gentest` (Puppeteer setup, in-page extraction helper, XML generation, pinned Chrome provenance).
- No runtime-package impact; all dev-time. Known engine-vs-Chrome divergences documented in `KNOWN_DIVERGENCES.md` are excluded from fuzz assertions so the fuzzer only reports *new* disagreements.
