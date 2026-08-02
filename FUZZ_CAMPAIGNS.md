# Fuzz campaign ledger

This file records campaign identity and oracle lineage. It does not duplicate
the live fixed/open count: run `pnpm fuzz-batch-status` for that.

## Completed: `20260731-mixed-viewport-v2`

- Source: `tests/fuzz-seeds.json`
- Source records: 1,007 unique `(seed, index, mode)` entries
- Seed/mode: `20260731`, `mixed`
- Browser: Chrome/151.0.7922.47
- Oracle contract: explicit 1280x800 page viewport
- Payload: `tests/fuzz-batches/archive/20260731-mixed-viewport-v2-complete.json`
  (ignored, reconstructible)
- Corrected adjudication created: 2026-08-02
- Initial corrected payload: 117 shrunk, deduplicated findings
- Snapshot after commit `d8adb789`: 4 fixed, 113 open
- Completed after commit `580a5331`: 117 fixed, 0 open

This is the corrected continuation of the original seed campaign, not a new
random seed set. The 1,007 source records replayed as 494 passing and 513 raw
failing trees; shrinking and signature deduplication reduced the failures to
117 work-queue entries.

The frozen queue is complete and archived. There is currently no active
campaign; collect or rehydrate the next one before running active-queue tools.

## Retired: `20260731-mixed-legacy-oracle`

- Payload: `tests/fuzz-batches/archive/legacy-20260731-mislabeled-max-content.json`
- Derived entries: 917
- Status: retired; do not use for engine progress
- Reason: Chrome rendered all variants in a 1280x800 Puppeteer page, while all
  3,668 frozen XML variants declared `max-content x max-content` available
  space. The remaining 19 mismatches therefore compare different layout
  questions.

The payload is retained locally for archaeology. Its source records are not
discarded: all 1,007 were replayed into the active corrected adjudication.

## Lifecycle

1. `pnpm fuzz-batch-status` and the dossier/matrix/provenance tools use
   `tests/fuzz-batches/active.json` unless a file is explicitly supplied.
2. Promote valuable findings to regression fixtures as they are fixed.
3. When the active queue is clear, move it under
   `tests/fuzz-batches/archive/` and update this ledger.
4. Collect a new seed campaign or rehydrate a tracked manifest. The default
   output is a new `active.json`; commands refuse to overwrite an existing
   active queue accidentally.
5. Save any genuinely new seed lineage with `pnpm fuzz-batch-manifest save`.

Payload counts are not execution counts. A rehydrated payload contains only
currently failing, shrunk, deduplicated representatives; already passing seeds
and duplicate signatures do not appear.
