Vendored from [Taffy](https://github.com/DioxusLabs/taffy) (`scripts/gentest/`),
MIT licensed. `test_helper.js` extracts element styles and browser-computed
layout for all box-sizing/direction variants; `test_base_style.css` embeds the
Ahem font (10px square glyphs) for deterministic text measurement.

The HTML fixture corpus in `tests/html/{flex,block,blockflex,blockgrid,grid,gridflex}`
was vendored from Taffy's `test_fixtures/` at commit
`57c230de4342c1cd367d79df9bb67feb05b6fe47` and evolves independently from here.
Fixture XML provenance (the generating Chrome build) lives in
`tests/fixtures/CHROME_VERSION`, written by `pnpm gentest` on full runs.
