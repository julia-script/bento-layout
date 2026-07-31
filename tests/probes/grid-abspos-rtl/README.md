# grid abspos RTL probe matrix

Nine shapes x two directions, for the unfixed RTL bug in the absolutely-
positioned grid child placement (`src/compute/grid/mod.ts`, the
`position === 'absolute'` branch). Run one with:

    pnpm fuzz-triage tests/probes/grid-abspos-rtl/e_rtl.json

All `*_ltr.json` pass and must keep passing; they are the controls.

| shape | placement | tracks | RTL status |
|---|---|---|---|
| a | line 1 -> auto | none at all | **FAILS** 10 vs 490 |
| b | line 1 -> auto | 1 implicit (one in-flow child) | **FAILS** 10 vs 490 |
| c | line 2 -> auto | 3 explicit | passes |
| d | auto -> line 3 | 3 explicit | passes |
| e | line 2 -> line 4 | 3 explicit | **FAILS** 430@10 vs 130@310 |
| f | line -2 -> auto | 3 explicit | passes |
| g | line 2 -> span 2 | 3 explicit | **FAILS** (same as e) |
| h | line -2 -> span 1 | 3 explicit + negative implicit | passes |
| i | line -3 -> span 6 | 8 negative implicit, 0 explicit | passes |

`i` is the shape of WPT `positioned-grid-items-negative-indices-003` and is the
control that has invalidated every attempt so far. `a`/`b` are the shape of
`positioned-grid-items-022`/`-026`, the two tests still quarantined.

## What is established

The RTL track vector is reversed **in place** by `reverseNonGutterTracks`, so
its slots are physically ordered but hold the reversed tracks. Against that
vector:

- Removing the mirror entirely: 7/9 RTL shapes fail. The mirror is required.
- The mirror across `explicit` is *correct* for `i` (8 negative implicit
  tracks, `explicit = 0`): `0 - 2 = -2` and `0 - 8 = -8` map to slots 12 and 0,
  which is right. Widening the reflect axis to include implicit tracks breaks it.
- The **swap** is what breaks `a`/`b`: `null` means "the container edge", and
  exchanging it with a real line moves the open end to the wrong physical side.
  But conditionally skipping the swap breaks `c`/`d`/`f`, which need it.
- For `e`/`g` no single `slot = f(line)` formula fits: `2*line - 1` and
  `2*(N-line) + 1` each satisfy some rows and fail others, because the cases
  with one end at a container edge and the cases with two definite lines want
  different arithmetic.

## Conclusion

The line -> slot correspondence after in-place reversal is not a pure function
of the line number; it also depends on which ends are open. A correct fix
likely computes the RTL area from *physical* track offsets directly rather than
mirroring line indexes and swapping — i.e. resolve start/end to offsets in
logical order, then convert the pair to a physical rect once, at the end.
