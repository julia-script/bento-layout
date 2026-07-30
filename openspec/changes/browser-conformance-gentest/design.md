## Context

See proposal.md — Why. Taffy's `scripts/gentest` is the blueprint: a Rust driver spawns chromedriver, loads each `test_fixtures/**/*.html`, injects `test_helper.js` (which parses element style attributes, toggles `document.body.className` across the four box-sizing/direction variants, and returns per-variant JSON trees with `getBoundingClientRect` geometry), then serializes JSON → XML (`main.rs`, ~550 lines, half of it style-attribute serialization). Our harness already consumes that XML format end-to-end, and the engine passes all 4,368 fixtures generated from it. Text fixtures depend on the Ahem font (`test_base_style.css` embeds it as a data URI) and zero-width-space break opportunities.

## Goals / Non-Goals

**Goals:**
- One-command regeneration of any subset of fixtures from a pinned real Chrome (`pnpm gentest [pattern]`).
- HTML files as the author-facing test format — write a fixture like a tiny web page, never hand-write XML.
- A reconciliation of the existing 4,368 fixtures against current Chrome, with every divergence triaged (browser wins).
- Suite hermeticity preserved: browser at generation time only.

**Non-Goals:**
- WPT harness integration, multi-browser matrices, screenshot diffing, fuzz generation (all possible later on top of this pipeline).
- Porting Taffy's Rust test-generation for their `#[test]` files — we only need the XML output path.
- Float/leaf fixture directories (algorithms out of scope for the engine).

## Decisions

1. **Puppeteer over raw chromedriver/WebDriver.** Puppeteer pins a "Chrome for Testing" build per puppeteer version (recorded → provenance), installs it per-project, and is the npm-ecosystem default. Alternative (playwright) equivalent; puppeteer chosen for smaller surface. Dev-dependency only.
2. **Reuse `test_helper.js` nearly verbatim** (MIT, attribution comment). It already handles style-attribute parsing (including grid track lists), variant toggling, scrollbar detection, and geometry extraction. Modifications only if bugs surface. The TS driver does what `main.rs` does: iterate files, `page.evaluate` the helper, write XML.
3. **XML writer ported from `main.rs`'s serialization functions** (`generate_node`, `generate_assertions`, attribute eliding of default values) so regenerated XML is byte-comparable with the vendored fixtures wherever Chrome agrees — making the reconciliation diff reviewable.
4. **Fixture-source layout**: `tests/html/{flex,block,blockflex,blockgrid,grid,gridflex}/*.html` + `tests/html/support/{test_helper.js,test_base_style.css}` (Ahem embedded). Generated XML stays in `tests/fixtures/**` where the harness already looks.
5. **Determinism controls**: fixed viewport, `deviceScaleFactor: 1`, headless, classic (non-overlay) scrollbars enforced via Chrome flags — taffy's gentest asserts a non-zero scrollbar width up front; we keep that assertion as a canary. Byte-stable XML output (stable attribute order, fixed float formatting matching the Rust writer).
6. **Reconciliation is a one-time triage, then steady state.** Expected diff classes: (a) Chrome behavior changed since Taffy's snapshot → adopt, fix engine if it now fails, or record in a `KNOWN_DIVERGENCES.md` if we deliberately keep Taffy semantics; (b) generation bug in our port → fix the script (byte-diff vs vendored XML is the debugging tool). `TAFFY_COMMIT` is superseded by `CHROME_VERSION` once all six directories regenerate cleanly.
7. **New-fixture batch to prove the loop**: a handful of HTML fixtures for spec cases absent from Taffy's corpus (chosen during implementation from CSS-spec examples, e.g. nested flex/grid interop and gap/alignment combinations we currently only cover incidentally). Kept small — the point is the workflow, not coverage growth in this change.

## Risks / Trade-offs

- [Current Chrome may disagree with Taffy's snapshot in more places than expected, turning reconciliation into engine work] → That is the feature, not a failure: each divergence is exactly the "browser over Taffy" call the project now prioritizes. Triage one directory at a time (flex first); `KNOWN_DIVERGENCES.md` is the escape valve for deliberate deferrals.
- [macOS overlay scrollbars yield zero-width scrollbars, corrupting `overflow: scroll` fixtures] → Launch Chrome with classic-scrollbar flags; keep gentest's fail-fast scrollbar-width assertion so a silent regression is impossible.
- [Ahem/text rendering differences (subpixel, font loading races)] → Ahem is metrically exact by design (1em square glyphs); wait for `document.fonts.ready` before measuring; the byte-stability requirement catches flakiness immediately.
- [Puppeteer's Chrome download in CI/offline environments] → Generation is dev-time only; `pnpm test` never needs it (spec requirement). CI runs tests, not gentest.
- [Float formatting differences between the Rust writer and TS (e.g. `66.66667` vs `66.66666793823242`)] → Match the Rust writer's formatting during the port; the harness's 0.1px tolerance is the backstop.

## Open Questions

(none blocking — the set of new spec-case fixtures is chosen during implementation)
