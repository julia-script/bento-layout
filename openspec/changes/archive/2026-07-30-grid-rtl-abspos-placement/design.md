# Design: grid-rtl-abspos-placement

## Context

The current abspos pipeline in `computeGridLayout` is:

```
oz placement → mirror line index (`explicit - line`) → slot (2*(line+negImpl))
             → swap start/end indexes → gridArea offsets with per-edge fallbacks
```

against a track vector that `reverseNonGutterTracks` has **already reversed in
place**. Five attempts to adjust this failed; each is documented with the
control that killed it in `tests/probes/grid-abspos-rtl/README.md`. The core
finding: after in-place reversal, line→slot is *not a pure function of the line
number* — it also depends on which ends of the placement are open. Any fix that
keeps the mirror/swap/fallback trio therefore chases shape-specific cases.

## Goals / Non-Goals

- Goals: all 18 probes green; `positioned-grid-items-022/026` and
  `grid-flexible-track-free-space-distribution` promoted from quarantine; LTR
  behavior byte-identical; the placement code readable enough that the next
  RTL question is answerable by reading.
- Non-goals: touching in-flow item placement (works, including RTL); the
  viewport/prose quarantine family; writing modes.

## Decisions

### D1. Resolve in logical space; convert to physical once

Restructure the abspos branch to compute **logical offsets** — distances from
the flow's start edge — for both ends of the placement, with `null` meaning
"the open end extends to the flow's end edge":

```
logicalStart = line defined ? logicalOffsetOf(startLine) : 0 (flow start edge)
logicalEnd   = line defined ? logicalOffsetOf(endLine)   : innerWidth (flow end)
physical (ltr): left = logicalStart,            right = logicalEnd
physical (rtl): left = width - logicalEnd,      right = width - logicalStart
```

One mirror, applied to *offsets* at the very end — no index mirroring, no
start/end swapping, no direction-dependent edge fallbacks. Sizes are preserved
by construction (`logicalEnd - logicalStart` is direction-independent), which
is exactly the property Chrome exhibits and the current code violates.

### D2. Obtain logical offsets without un-reversing the world

The track vector is reversed in place before this code runs, and in-flow
placement depends on that. Three options:

1. **Derive**: `logicalOffsetOf(slot) = innerWidth - reversedOffsetOf(mirrorSlot)`
   — keeps one vector but reintroduces slot arithmetic, the thing that failed.
2. **Snapshot**: capture the *pre-reversal* offsets (or compute a logical
   offset table right after track sizing) and let abspos read that table by
   plain `2*(line+negImplicit)` indexing — the same indexing in-flow items use,
   with no direction term.
3. Move `reverseNonGutterTracks` after abspos — rejected: abspos runs last and
   in-flow layout needs the reversal earlier.

**Choose 2.** A logical offset table is O(tracks) memory, computed once, and
makes the abspos code direction-free until the final conversion. It also gives
the fr-remainder fix a natural home: the remainder is assigned in logical track
order, so the visual assignment in RTL falls out of the same final mirror.

### D3. Probe-gated implementation

Every intermediate state must run the full 18-probe matrix plus
`negative-indices-003`'s fixture before proceeding. The five failed attempts
each looked plausible until one specific control ran; the matrix is cheap
(~30s) and is the acceptance test. On green, `pnpm gentest` converts the probe
JSONs into committed HTML/XML fixtures and the probe directory is retired.

### D4. fr rounding remainder

`grid-flexible-track-free-space-distribution` is 3 mismatched nodes out of 99
in RTL only: the ±1px remainder tracks differ. Diagnose *after* D1–D2 land —
the same logical-order model may fix it outright; if not, it is a contained
change in the rounding pass (`roundLayout`/track offsets), gated by the same
fixture.

## Risks / Trade-offs

- The logical-offset table must agree exactly with what in-flow items see, or
  abspos children will misalign with in-flow siblings by half a gutter.
  Mitigation: build the table from the same offsets in-flow resolution uses,
  and add a mixed in-flow + abspos probe to the matrix.
- `reverseNonGutterTracks` has two branches (explicit ≤ 1 vs > 1) with
  different slot behavior; the snapshot approach deliberately bypasses both,
  which is the point — but any *other* consumer of reversed slots stays
  untouched.

## Open Questions

- Whether rows (which never mirror) can share the logical-path code with a
  no-op conversion — likely yes, and it would delete the row/column asymmetry
  in the current branch.
