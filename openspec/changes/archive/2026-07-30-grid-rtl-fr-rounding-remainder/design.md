# Design: grid-rtl-fr-rounding-remainder

## Context

Both items are leftovers from `grid-rtl-abspos-placement`, diagnosed there in
detail. This section is the evidence already gathered, so the implementation
does not repeat it.

### fr remainder — what is established

99 `1fr` tracks in a 100px grid; `w = 100/99 = 1.0101...`.

- Widths agree: 98 tracks of 1px and one of 2px in **both** engine and Chrome.
  Only *which* track is 2px differs (ours physical index 49, Chrome's 51).
- Unrounded positions are correct and match Chrome's implied values exactly.
  The divergence is entirely inside `round()`.
- In **LTR**, `round(i*w)` reproduces Chrome at all 99 boundaries. In **RTL**
  it misses at exactly two, `i=49` and `i=50`, where Chrome sits 1px higher.
- Chrome's RTL boundary set is **not** the mirror of its LTR set: they differ
  at one boundary (mirrored-LTR has 48, RTL has 50), and the 2px track spans
  `[49,51]` in LTR vs `[47,49]` in RTL — not mirror images.
- Chrome's remainder lands on logical track 47 in RTL but 49 in LTR, so it is
  not a fixed logical track either.

**Ruled out** (each tested numerically against all 99 boundaries):

| hypothesis | result |
|---|---|
| float accumulation drift | ~7e-15, three orders too small to flip these |
| tie-breaking at `.5` | no boundary is exactly `.5` |
| `floor`/`ceil` of the position | 47 and 51 mismatches |
| `100 - round(k*w)` (round the distance) | misses at i=49,50 |
| mirror of the rounded LTR positions | misses at i=49,50,51 |
| `round(100-(i+1)*w)` (current) | misses at i=49,50 |

Every clean positional model fails at the same 2–3 indices near 49–51, which
is the signature of Chrome's *accumulation order* differing, not its rounding
function.

### Shape `b` — what is established

`colTracks = {start: 0, end: null}`, counts `{neg: 0, explicit: 0, pos: 1}`.
The abspos path mirrors implicit counts under RTL (`absColCounts`), giving
`negativeImplicit: 1`, so oz line 0 indexes slot 2 — the flow *end* (x=10) —
when line 1 in RTL is the flow *start* (x=490).

`explicit === 0` is **not** the discriminator: probe `i` / WPT
`negative-indices-003` also has `explicit === 0` and needs the mirror. Gating
on it was tried and regressed that control. The two differ in implicit
*sign*: `b` has one positive-implicit track, `i` has eight negative-implicit.

## Goals / Non-Goals

- Goals: `grid-flexible-track-free-space-distribution` promoted; shape `b`
  green; `negative-indices-003` and the full suite stay green; LTR
  byte-identical.
- Non-goals: the four viewport/prose quarantine fixtures; `fr` sizing itself
  (already correct); revisiting the abspos restructure.

## Decisions

### D1. Find Chrome's RTL accumulation order empirically, then match it

The remaining unknown is *which sequence of values Chrome rounds*, not how it
rounds them. Rather than guess further models, enumerate: for the 99-track
case, compute Chrome's exact boundary list from the fixture and search for the
accumulation that reproduces it — candidates include accumulating rounded
per-track sizes leftward (each track's size rounded before the next boundary),
and rounding the running sum in logical order then assigning physically.

The distinguishing datum is already in hand: Chrome's LTR and RTL boundary sets
are not mirrors, so whatever Chrome does is genuinely direction-dependent
rather than a mirrored computation. A model must reproduce **both** directions'
99 boundaries, not just RTL's three mismatches.

### D2. Keep the fix in the rounding pass

`roundLayout` uses cumulative absolute-position rounding
(`round(cx+w) - round(cx)`), which is the correct general scheme and must stay
— it is what keeps adjacent boxes gap-free across the whole engine. If RTL
grid tracks need a different accumulation origin, that belongs in how grid
hands positions to rounding (track offsets), not in `round()` itself.

**Resolved — the premise was wrong.** This decision assumed the divergence was
grid-specific and should therefore be confined to grid. It is not: the cause is
`LayoutUnit`, Chrome's 1/64-px fixed-point representation for *every* layout
coordinate. Confining a general quantization to grid would have been the
narrower change but the wrong model, and would have left the same defect latent
in flexbox and block wherever a position lands within 1/64 of a .5 boundary.

The fix therefore went into `roundLayout` itself: snap each coordinate to 1/64
before rounding it. The cumulative scheme this decision wanted preserved is
untouched — only the input to each `round()` changed. All 4957 tests stayed
green, which is the evidence that the broader placement is safe.

### D3. Shape `b`: discriminate on implicit sign, gated by `i`

The mirror exists so an implicit track added past the flow's end lands on the
physical left. When the axis's only tracks are *positive*-implicit and there is
no explicit grid, positive line numbers count from the flow start into those
tracks directly and the mirror shifts them one track too far. Any fix must run
both `b` and `i` — the probe matrix plus the full suite — before it is
believed. One speculative attempt already regressed `i`.

## Risks / Trade-offs

- The fr fix touches rounding, which every layout mode shares. A change to
  `round()` or to the general cumulative scheme would be felt far outside grid;
  scope it to grid track offsets and run the full 4955-test suite.
- Shape `b` and shape `i` pull in opposite directions on the same code path.
  If no clean discriminator emerges, leaving `b` red is acceptable — it blocks
  no fixture, and the probe README already records why.

## Open Questions

- Whether Chrome's RTL track positions come from its own
  right-to-left fragment accumulation (a Blink implementation detail) rather
  than anything css-grid-1 mandates. If so, matching it exactly may not be
  worth unbounded effort — the spec does not dictate remainder placement, and
  the fixture is a Chrome-derived oracle, not a conformance requirement. Decide
  this before spending heavily: a documented KNOWN_DIVERGENCES entry is a
  legitimate outcome for this one.
