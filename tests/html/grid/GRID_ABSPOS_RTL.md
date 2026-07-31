# grid abspos RTL — `grid_abspos_rtl_*` fixtures

Ten shapes x two tree directions (`*_ltr` / `*_rtl`), each generating four
box-sizing/direction variants: **80 fixtures**. They cover absolutely-positioned
grid children under `direction: rtl`, a bug that took six attempts to fix.

These began as a probe matrix (`tests/probes/grid-abspos-rtl/`, retired once
all 80 passed). This file preserves what that matrix established, because the
failed approaches are the useful part.

| shape | placement | tracks |
|---|---|---|
| a | line 1 -> auto | none at all |
| b | line 1 -> auto | 1 positive-implicit (one in-flow child) |
| c | line 2 -> auto | 3 explicit |
| d | auto -> line 3 | 3 explicit |
| e | line 2 -> line 4 | 3 explicit |
| f | line -2 -> auto | 3 explicit |
| g | line 2 -> span 2 | 3 explicit |
| h | line -2 -> span 1 | 3 explicit + implicit |
| i | line -3 -> span 6 | 8 negative-implicit, 0 explicit |
| j | line 2 -> line 3, plus an in-flow sibling | 3 explicit |

`i` is WPT `positioned-grid-items-negative-indices-003` and is the control that
invalidated five attempts. `a`/`b` are the shape of
`positioned-grid-items-022`/`-026`. `j` checks an abspos child aligns with an
in-flow sibling's tracks.

## What five failed attempts established

Against the track vector that `reverseNonGutterTracks` reverses **in place**:

- Removing the RTL mirror entirely: 7/9 shapes fail. Some mirror is required.
- The mirror across `explicit` is *correct* for `i` even though `explicit == 0`.
  Widening the reflect axis to include implicit tracks breaks it.
- The **swap** of start/end is what breaks the open-end shapes `a`/`b`, but
  skipping it conditionally breaks `c`/`d`/`f`, which need it.
- No single `slot = f(line)` formula fits both the open-end and the
  two-definite-line cases.

Conclusion: after in-place reversal, line->slot is not a pure function of the
line number — it also depends on which ends are open.

## What actually worked (change `grid-rtl-abspos-placement`, archived)

Resolve the placement against a **flow-ordered offset table**, then convert to
a physical rect exactly once:

- Build the table by reversing the **whole** track sequence (not just the
  explicit range `reverseNonGutterTracks` touches) and accumulating from the
  flow's start edge. Lines index it with the plain `2*(line + negImplicit)`
  in-flow items use — no mirror, no swap, no per-edge fallback.
- Mirror the *implicit track counts* under RTL — **except** when the axis has
  no explicit tracks and no negative-implicit ones. There, positive line
  numbers address the implicit tracks directly from the flow start and
  mirroring shifts every line one track past the grid (shape `b`). An
  all-negative-implicit axis (`i`) still needs the mirror. Getting this
  condition wrong is what regressed `i` twice.
- Open ends are not a physical fallback: per css-grid-1 §9.1 an `auto` or
  out-of-grid line contributes a line at the container edge on the side the
  *flow* leaves open.

Reading css-grid-1 §9.1 is what broke the deadlock — it states grid placement
is flow-relative while the offset properties are physical, which is exactly the
resolve-then-convert split, and that an out-of-grid line is "treated as
specifying auto".

## Cautions

- **The reflection axis is the content box, not the border box.** They coincide
  under symmetric padding, and every probe used `padding: 10px`, so all 80
  variants passed either way. The committed `grid_absolute_column_start/end`
  fixtures (padding 40/20) are what caught it. Probes agreeing is not
  sufficient evidence — run the full suite.
- Each fixture's own `direction` composes with the harness's four variants, so
  `X_ltr` and `X_rtl` are **not** duplicates.
- Rows never mirror and share the same code path with an identity conversion.

Upstream Taffy has the same defect (`grid/mod.rs:571-619`); see
UPSTREAM_TAFFY.md entry #26.
