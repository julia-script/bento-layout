## 1. Vendoring & setup

- [ ] 1.1 Add `puppeteer` dev-dependency; vendor `test_fixtures/{flex,block,blockflex,blockgrid,grid,gridflex}` HTML into `tests/html/` and `test_helper.js` + `test_base_style.css` (Ahem embedded) into `tests/html/support/`, with MIT attribution
- [ ] 1.2 Verify the fixture HTML loads standalone in Puppeteer (helper injectable, Ahem renders, classic scrollbars enforced, scrollbar-width canary assertion passes)

## 2. Gentest pipeline

- [ ] 2.1 Write `scripts/gentest.ts`: iterate HTML fixtures (optional name filter), drive headless Chrome via Puppeteer, `page.evaluate` the helper, collect the four per-variant JSON descriptions
- [ ] 2.2 Port the XML writer from taffy `gentest/src/main.rs` (node serialization, default-eliding, assertion geometry, float formatting) targeting byte-parity with vendored XML; wire `pnpm gentest`
- [ ] 2.3 Prove byte-parity on a sample: regenerate a subset of `flex` fixtures and diff against vendored XML; fix writer/driver discrepancies until diffs are only genuine Chrome-behavior differences

## 3. Regenerate & reconcile (browser wins)

- [ ] 3.1 Regenerate `flex` + `blockflex`; triage every diff vs vendored XML (adopt browser values; fix engine failures or record in `KNOWN_DIVERGENCES.md`); suite green
- [ ] 3.2 Regenerate `block` + `blockgrid`; same triage; suite green
- [ ] 3.3 Regenerate `grid` + `gridflex`; same triage; suite green
- [ ] 3.4 Record `tests/fixtures/CHROME_VERSION`; retire `TAFFY_COMMIT` as fixture provenance (keep a note that `src/compute/` still tracks the taffy algorithm sources)

## 4. Authoring loop & docs

- [ ] 4.1 Author a small batch of new HTML fixtures for spec cases absent from the taffy corpus; generate and make them pass
- [ ] 4.2 Document the workflow in the README (write HTML → `pnpm gentest` → commit XML → `pnpm test`; divergence policy); `pnpm build` + `pnpm test` green from clean checkout without a browser
