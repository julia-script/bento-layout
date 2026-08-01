# Vendored CSS specifications

Bikeshed sources of the specs this engine implements, vendored so the exact
prose the engine was verified against travels with the code — and so the
algorithm sections are actually readable.

**Why vendored rather than fetched on demand:** the CSS drafts are long enough
that HTTP fetching tools routinely truncate them, and they truncate *before* the
algorithm sections, which are the only parts worth reading during a fix. Reading
§9.2 step 3 or §4.1 from the live URL failed repeatedly; grepping these files
returns them instantly.

| File | Spec | Upstream |
|---|---|---|
| `css-flexbox-1.bs` | CSS Flexible Box Layout Level 1 | <https://drafts.csswg.org/css-flexbox/> |
| `css-sizing-3.bs` | CSS Box Sizing Level 3 — intrinsic sizes, percentage sizing | <https://drafts.csswg.org/css-sizing-3/> |
| `css-sizing-4.bs` | CSS Box Sizing Level 4 — `aspect-ratio`, min/max transfers | <https://drafts.csswg.org/css-sizing-4/> |
| `css-grid-1.bs` | CSS Grid Layout Level 1 — placement, track sizing | <https://drafts.csswg.org/css-grid-1/> |
| `css-align-3.bs` | CSS Box Alignment Level 3 — `align-*`, safe/unsafe | <https://drafts.csswg.org/css-align-3/> |

All are editor's drafts, fetched 2026-08-01.

Add another — the Bikeshed sources live in the CSSWG repo, one `Overview.bs`
per shortname:

```bash
curl -sL https://raw.githubusercontent.com/w3c/csswg-drafts/main/css-sizing-3/Overview.bs -o spec/css-sizing-3.bs
```

Worth having next: `css-sizing-3`, `css-sizing-4`, `css-grid-1`, `css-align-3`.

## Navigating

Grep by **anchor id**, not by prose. Quoting differs per file — css-flexbox
uses single quotes, css-sizing uses double — so match either way:

```bash
grep -nE "id=['\"]algo-main-item"  spec/css-flexbox-1.bs   # §9.2 step 3: flex base size
grep -nE "<h[234] id="             spec/css-sizing-4.bs    # list every section
```

`AGENTS.md` carries the anchor map for the sections that come up most (line
sizing, cross alignment, intrinsic contributions, abspos children, auto
margins).

## Keeping them honest

These are editor's drafts and they move. They are a reading aid, not a pinned
dependency: when a fix turns on a subtle clause, cite the section in the code
comment (as the layout code already does) rather than relying on the vendored
copy staying current. Chrome — pinned in `tests/fixtures/CHROME_VERSION` — is
the executable oracle; the spec explains *why* Chrome does what it does.
