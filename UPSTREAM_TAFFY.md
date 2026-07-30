# Upstream candidates for Taffy

Bugs fixed in this engine that appear to exist in upstream
[Taffy](https://github.com/DioxusLabs/taffy) as well, recorded for separate
upstreaming. This file is maintained for Taffy's benefit and stands alone —
it does not assume any knowledge of this port.

Taffy reference: commit `57c230de` (the vendored checkout these line numbers
refer to). Reference browser: `Chrome/151.0.7922.47`, headless, DPR 1.

**Verification levels** — every entry states one:

- **confirmed** — reproduced by *running* Taffy and observing the wrong output.
- **suspected** — the defect was identified by *reading* Taffy's source. The
  logic matches ours pre-fix, but no Rust reproduction has been run, so the
  possibility remains that surrounding code compensates.

Nothing here should be filed upstream while still marked *suspected* — build
the Rust reproduction first. All repros are 2–3 nodes, so this is cheap.

Findings come from differential fuzzing against Chrome (`pnpm fuzz`); none of
these cases exist in Taffy's own fixture corpus, which is why its suite passes.

---

## 1. Leaf aspect-ratio floor overrides a definite height

**Verified in Taffy:** suspected (source read: `src/compute/leaf.rs:147-150`)

**Taffy source:**

```rust
let size = Size {
    width: clamped_size.width,
    height: f32_max(clamped_size.height, aspect_ratio.map(|ratio| clamped_size.width / ratio).unwrap_or(0.0)),
};
```

The aspect-ratio floor is applied unconditionally, with no check that the
height is automatic.

**Reproduction:** a childless leaf with `aspect-ratio` and *both* dimensions
definite, inside any parent:

```html
<div style="display: block">
  <div style="aspect-ratio: 2; width: 120px; height: 10px"></div>
</div>
```

| | width | height |
|---|--:|--:|
| Chrome | 120 | **10** |
| Engine (pre-fix) | 120 | **60** |

**Spec:** css-sizing-4 §5 — `aspect-ratio` supplies the *automatic* size. A
definite height (from the parent or an explicit style height) wins over the
ratio.

**Fix applied here:** gate the floor on the height being automatic —
`knownDimensions.height === null && style height is not definite`. See
`src/compute/leaf.ts`; regression fixture `tests/html/fuzz-found/fuzz_93430f7c.html`.

**Note:** this is a *different* case from the transferred-min/max-constraints
issue in flexbox (css-sizing-4 §5.2.2), which was fixed separately and may also
be worth checking upstream.

---

## 2. Childless grid containers discard their explicit tracks

**Verified in Taffy:** suspected (source read: `src/tree/taffy_tree.rs:373-391`)

**Taffy source:**

```rust
match (display_mode, has_children) {
    (Display::None, _) => compute_hidden_layout(tree, node),
    (Display::Block, true) => compute_block_layout(tree, node, inputs),
    (Display::Flex, true) => compute_flexbox_layout(tree, node, inputs),
    (Display::Grid, true) => compute_grid_layout(tree, node, inputs),
    (_, false) => { /* ... */ compute_leaf_layout(inputs, style, |_, _| 0.0, measure_function) }
}
```

A childless grid falls into the `(_, false)` arm and is laid out as a leaf, so
`grid-template-rows`/`-columns` never contribute to its size.

**Reproduction:**

```html
<div style="display: grid; grid-template-rows: 120px"></div>
```

| | height |
|---|--:|
| Chrome | **120** |
| Engine (pre-fix) | **0** |

Also applies to columns, and to multi-track templates such as
`grid-template-rows: 1fr 120px`.

**Spec:** css-grid-1 §5.1 — the explicit grid is defined by the
`grid-template-*` properties and exists independently of any grid items.

**Fix applied here:** route `display: grid` to grid layout when it has children
*or* has no measure function; text/measure leaves stay on the leaf path. See
`src/compute/dispatch.ts`.

**Note for upstream:** the equivalent fix in Taffy needs care around
`(_, false)` also covering measure-function leaves. Empty *flex* and *block*
containers do correctly size like leaves, so only the grid arm is affected.

---

## 3. Phantom implicit tracks in template-less axes with negative line placement

**Verified in Taffy:** suspected — and weaker than the entries above.
See the caveat at the end of this section.

**Where we found it:** `compute_grid_size_estimate`
(`src/compute/grid/implicit_grid.rs`) has no coalescing rule: negative implicit
tracks are modeled as contiguous from the placement line down to the explicit
grid origin.

**Reproduction:** a grid with *no* explicit tracks in an axis, whose items are
all line-anchored strictly before the origin:

```html
<div style="display: grid; width: 100px; height: 60px">
  <div style="grid-row: -3 / auto"></div>
</div>
```

| | item y | item height |
|---|--:|--:|
| Chrome | 0 | **60** |
| Engine (pre-fix) | 0 | **30** |

Chrome materializes **one** row; the engine materialized two (the occupied row
plus an empty trailing one down to the origin). Also reproduces with
`grid-row: span 2 / -2`, with both items present, and on the column axis.

Controls that already matched Chrome, and which any fix must not regress:
negative lines *with* an explicit track present, and positive lines without
templates (which do keep their leading empty tracks).

**Spec:** css-grid-1 §8.3 (implicit grid line resolution).

**Fix applied here:** a per-axis translation of origin-zero line placements,
active only when the axis has zero explicit tracks and every child is
line-anchored negative, applied at oz-conversion time for in-flow and
absolutely-positioned children alike. See `src/compute/grid/implicit.ts`;
regression fixture `tests/html/fuzz-found/fuzz_80d9ba4b.html`.

**Caveat — read before filing.** Taffy's own header comment on
`compute_grid_size_estimate` says it "is not required for spec compliance, but
is used as a performance optimisation to reduce the number of allocations,"
with final counts coming out of placement and the `CellOccupancyMatrix`. Our
port fixes it *at* the estimate. The Chrome-divergent behavior is likely
present upstream too, but the defect may not live in the same function there.
Trace where Taffy's final track counts actually settle before filing this one.

---

## 4. Auto-placement skips a track for an item anchored behind the flow cursor

**Verified in Taffy:** suspected (source read: `src/compute/grid/placement.rs:243-257`)

**Taffy source:**

```rust
secondary_idx = match auto_flow.is_dense() {
    true => secondary_axis_grid_start_line,
    false => {
        if primary_span.start < primary_idx {
            secondary_idx + 1
        } else {
            secondary_idx
        }
    }
};
```

The `primary_span.start < primary_idx` test means "placement wrapped backwards,
so move to the next secondary track." But it compares against the raw cursor,
which on the *first* item still sits at the grid start line. An item whose
primary start is negative (an axis whose implicit grid extends below zero) is
therefore treated as having wrapped when nothing has been placed yet, and skips
a track.

**Reproduction:**

```html
<div style="display: grid; width: 100px; height: 60px">
  <div style="grid-column: auto / -3"></div>
</div>
```

| | item y | item height |
|---|--:|--:|
| Chrome | 0 | **60** |
| Engine (pre-fix) | 30 | **30** (placed in a second row) |

**Spec:** css-grid-1 §8.5 — the auto-placement cursor starts at the
start-most row; nothing licenses skipping it for the first item.

**Fix applied here:** guard the advance on the cursor having actually moved
(`primaryIdx !== primaryStartPosition`). See `src/compute/grid/placement.ts`;
regression fixtures `tests/html/fuzz-found/fuzz_d3b5d30d.html` and
`fuzz_39abbda7.html`.

**Note:** this one is independent of entry 3 and reproduces regardless of the
coalescing question, so it is the cleaner of the two grid entries to file.

---

## 5. Vertical padding/border percentages resolve against the block size

**Verified in Taffy:** suspected (source read: `src/compute/block.rs:312-313`,
and the equivalent flexbox site)

**Taffy source:**

```rust
let padding = child_style.padding().resolve_or_zero(node_inner_size, |val, basis| tree.calc(val, basis));
let border = child_style.border().resolve_or_zero(node_inner_size, |val, basis| tree.calc(val, basis));
```

`node_inner_size` is a `Size`, so `resolve_or_zero` resolves `top`/`bottom`
against the container's **height**. Elsewhere Taffy correctly passes
`parent_size.width` for the same properties (e.g. `block.rs:74-75`), so the two
paths disagree with each other.

**Reproduction:** a child with a vertical percentage padding in a container that
is taller than it is wide:

```html
<div style="display: block; box-sizing: content-box; width: 55px; height: 320px">
  <div style="width: 5%; height: 50%; padding: 1px 7px 40% 40px"></div>
</div>
```

| | child height |
|---|--:|
| Chrome | **183** (160 content + 1 top + 0.4×55 bottom) |
| Engine (pre-fix) | **289** (160 + 1 + 0.4×**320**) |

Only visible when the container's width and height differ, which is why the
border-box variants of this case happened to pass.

**Spec:** css-box-3 §4 — percentage padding and margin resolve against the
*inline size* of the containing block, on all four sides, vertical included.

**Fix applied here:** resolve child padding/border against
`nodeInnerSize.width` in both block and flexbox item generation. See
`src/compute/block.ts` and `src/compute/flexbox.ts`. The per-axis helper this
replaced (`resolveRectOrZeroPerAxis`) now has no callers.

**Note for upstream:** worth auditing every `resolve_or_zero` call that takes a
`Size` rather than a width for padding/margin/border. Two sites were affected
here (block and flexbox item generation); the equivalent audit of this port's
grid path found it already width-based, so the grid arm may be fine upstream
too.

---

## 6. Leaf aspect-ratio floor ignores `box-sizing`

**Verified in Taffy:** suspected (source read: `src/compute/leaf.rs:147-150`)

Same statement as entry 1, but an independent defect: entry 1 is the missing
*automatic-height* gate, this one is the missing *box-sizing* term. Fixing
either alone leaves the other.

**Taffy source:**

```rust
let size = Size {
    width: clamped_size.width,
    height: f32_max(clamped_size.height, aspect_ratio.map(|ratio| clamped_size.width / ratio).unwrap_or(0.0)),
};
```

`clamped_size.width` is the **border-box** width. Dividing it by the ratio is
correct only under `box-sizing: border-box`. Under `content-box` the ratio
relates the two axes of the *content* box, so the horizontal padding+border
must be subtracted before dividing and the vertical added back after.

**Reproduction:** an auto-height leaf with `aspect-ratio` and horizontal
padding/border, under `box-sizing: content-box`:

```html
<div style="display: block; box-sizing: content-box; width: 300px; height: 400px">
  <div style="aspect-ratio: 1.5; padding: 7px 30px 13px 10px;
              border-width: 5px 4px 9px 2px; border-style: solid"></div>
</div>
```

| | child height |
|---|--:|
| Chrome | **203** ((300−46)/1.5 + 34) |
| Engine (pre-fix) | **200** (300/1.5, border box) |

The starker form is a leaf whose horizontal border dominates: with
`aspect-ratio: 2; border-left: 1px; border-right: 120px` in a 300px-wide
container, Chrome gives height **90** ((300−121)/2) and the engine gave **150**.

**Spec:** css-sizing-4 §5 — `aspect-ratio` applies to the box named by
`box-sizing`; only under `border-box` is the border box the ratio's box.

**Fix applied here:** under `content-box`, strip `pbSum.width` before dividing
and add `pbSum.height` back. See `src/compute/leaf.ts`; regression fixture
`tests/html/fuzz-found/fuzz_ar_contentbox.html` (the `content_box_ltr` and
`content_box_rtl` variants fail without the fix, the border-box pair passes
either way).

**Note:** border-box behaviour is unchanged by the fix, so upstreaming this
cannot regress the common case. Worth checking whether the equivalent
`maybe_apply_aspect_ratio` call sites elsewhere in Taffy (block, flexbox, grid)
share the omission — in this port those sites apply the ratio to *style* sizes
before the box-sizing adjustment is added, which is correct, so only the leaf
floor was affected.

---

## 7. Automatic minimum size ignores the transferred size suggestion

**Verified in Taffy:** suspected (source read: `src/compute/flexbox.rs:812-813`)

**Taffy source:**

```rust
let clamped_min_content_size =
    min_content_main_size.maybe_min(child.size.main(dir)).maybe_min(child.max_size.main(dir));
clamped_min_content_size.maybe_max(padding_border_axes_sums.main(dir))
```

css-flexbox-1 §4.5 defines the content-based minimum size as the *content size
suggestion* capped by the *specified size suggestion*, **or** — when the item
has an aspect ratio and a definite cross size — by the *transferred size
suggestion*, which replaces the content suggestion rather than being min'd
alongside it.

`child.size.main(dir)` has already had the ratio applied, so it carries the
transferred value. Min'ing it against `min_content_main_size` (0 for an empty
item) collapses the automatic minimum to 0, and the item shrinks straight past
its aspect ratio.

**Reproduction:** an empty flex item with a ratio and a definite cross size, in
a container narrower than the transferred main size:

```html
<div style="display: flex; width: 20px">
  <div style="aspect-ratio: 2; height: 320px"></div>
</div>
```

| | item width |
|---|--:|
| Chrome | **640** (320 x 2, overflowing the container) |
| Engine (pre-fix) | **20** (shrunk to the container) |

**Behaviour matrix** (all in a 20px-wide row container), which any fix must
reproduce — the last row is the control showing a specified main size is *not*
a floor on its own, so the ratio is what creates one:

| item style | Chrome width |
|---|--:|
| `aspect-ratio: 2; height: 320px` | 640 (transferred) |
| `aspect-ratio: 2; height: 320px; width: 900px` | 640 (transferred < specified) |
| `aspect-ratio: 2; height: 320px; width: 50px` | 50 (specified < transferred) |
| `aspect-ratio: 2; height: 320px; max-width: 100px` | 100 (max caps it) |
| `aspect-ratio: 2; height: 320px; min-width: 0` | 20 (explicit min defeats it) |
| `width: 50px` (no ratio) | 20 (shrinks; not a floor) |

So the suggestion is `min(transferred, specified)` when a ratio with a definite
cross size exists, and `min(content, specified)` otherwise — in both cases then
capped by the max size and floored by the padding+border sum.

**Fix applied here:** compute the transferred suggestion explicitly from the
used cross size rather than reading it back out of `child.size`. See
`src/compute/flexbox.ts`; regression fixture
`tests/html/fuzz-found/fuzz_dcdf4012.html`.

**Note:** the `min-width: 0` row matters for upstreaming — an explicit minimum
must still win, so the fix belongs in the automatic-minimum branch only, not in
the general min-size resolution.

---

## 8. Flex base size ignores a cross size that is definite by *stretching*

**Verified in Taffy:** suspected (source read: `src/compute/flexbox.rs`, the
flex-base-size determination — its case B likewise reads `child.size`)

Closely related to entry 7 and found immediately after it, but a distinct
defect: entry 7 is about the automatic *minimum*, this one about the flex *base
size*. Both stem from treating "definite cross size" as "cross size written in
the item's own style".

css-flexbox-1 §9.2 step 3B: an item with an aspect ratio and a definite cross
size uses the cross size transferred through the ratio as its flex base size. A
cross size established by **stretching** is definite for this purpose, but the
implementation only consults the style-derived size, so a stretched item falls
through to a content measurement (0 for an empty item).

**Reproduction:** a flex item whose *only* declared property is `aspect-ratio`:

```html
<div style="display: flex; width: 20px; height: 40px">
  <div style="aspect-ratio: 0.5"></div>
</div>
```

| | item width |
|---|--:|
| Chrome | **20** (stretched cross 40, transferred 40 x 0.5) |
| Engine (pre-fix) | **0** (content measurement) |

**Behaviour matrix:**

| setup | Chrome | note |
|---|--:|---|
| row 20x40, `aspect-ratio: .5` | 20x40 | transfers the stretched cross size |
| column 20x40, `aspect-ratio: .5` | 20x40 | same, other axis |
| row 20x40, `align-items: flex-start` | 0x0 | no stretch, so no definite cross: correctly 0 |
| row 20x40, `aspect-ratio: .5; min-width: 0` | 20x40 | unlike entry 7, an explicit min does *not* defeat this — it is the base size, not the minimum |
| row 7x7, `aspect-ratio: 1.5` | 11x7 | transferred 10.5 also floors the shrink |

The `align-items: flex-start` row is the control that keeps the fix honest: the
transfer must apply only when stretching actually made the cross size definite.

The last row shows entries 7 and 8 compose — the stretched cross size has to
reach *both* the base size and the automatic minimum, or the item transfers
correctly and is then shrunk back to the container.

**Fix applied here:** read the used cross size from the already-computed
"known dimensions" (which the stretch branch fills in) at both sites. See
`src/compute/flexbox.ts`; regression fixture
`tests/html/fuzz-found/fuzz_555803f9.html`.

---

## 9. Flexbox aspect-ratio cross size ignores `box-sizing`

**Verified in Taffy:** suspected (source read: `src/compute/flexbox.rs`, the
aspect-ratio cross-size derivation in the cross-size determination step)

The same defect as entry 6, on the flexbox path instead of the leaf. An item's
automatic cross size is derived by applying the ratio to the used main size,
but the used main size is a **border-box** value, so dividing it directly is
correct only under `box-sizing: border-box`. Under `content-box` the ratio
relates the two axes of the content box.

**Reproduction:**

```html
<div style="display: flex; box-sizing: content-box">
  <div style="aspect-ratio: 0.5; border-width: 20px 20px 10px 3px;
              border-style: solid"></div>
</div>
```

Horizontal border 23, vertical border 30, ratio 0.5:

| | item height |
|---|--:|
| Chrome | **30** (content 0 x 0, plus 30 vertical border) |
| Engine (pre-fix) | **46** (23 / 0.5, i.e. the border box) |

**The cross-to-main direction has the same omission**, and in a column
container it is the one that runs:

```html
<div style="display: flex; flex-direction: column; box-sizing: content-box;
            width: 100px; height: 60px">
  <div style="aspect-ratio: 2; border-width: 20px 20px 10px 3px;
              border-style: solid"></div>
</div>
```

| | item height |
|---|--:|
| Chrome | **69** (content width 100−23 = 77, 77/2 = 38.5, plus 30 border) |
| Engine (pre-fix) | **50** (100 / 2, i.e. the border box) |

There are **three** sites in total, and they must be fixed together:

1. the automatic cross size derived from the used main size (main-to-cross),
2. the flex base size transferred from a definite cross size (cross-to-main),
3. the automatic minimum size's transferred suggestion (cross-to-main).

Fixing only 1 and 2 leaves the column case at 60 rather than 50 — the item
transfers correctly and is then shrunk back to the container's main size,
because the automatic minimum that should floor it is still computed on the
border box.

**Fix applied here:** a single `transferThroughRatio(size, item, dir,
direction)` helper that strips the source axis's padding+border, applies the
ratio, and adds the target axis's back when `box-sizing` is `content-box`; all
three sites call it. See `src/compute/flexbox.ts`; regression fixtures
`tests/html/fuzz-found/fuzz_flex_ar_contentbox.html` (main-to-cross) and
`fuzz_flex_ar_contentbox_column.html` (cross-to-main).

**Note:** the three sites had three separate copies of the raw
`size * ratio` / `size / ratio` arithmetic, which is why the omission was
easy to fix in one place and miss in the others. Worth checking whether the
same duplication exists upstream before patching.

---

## 10. Stretched cross size is not floored by the item's padding+border

**Verified in Taffy:** suspected (source read: `src/compute/flexbox.rs:1616-1628`)

**Taffy source:**

```rust
(line_cross_size - child.margin.cross_axis_sum(constants.dir)).maybe_clamp(
    child.min_size.cross(constants.dir),
    max_size_ignoring_aspect_ratio.cross(constants.dir),
)
```

The stretched cross size is clamped by the item's min/max size but never
floored by its own padding+border sum. A border box cannot be smaller than its
borders, so a `max-width` below that sum does not actually shrink the rendered
box — the used size is floored elsewhere. The two then disagree, and the
alignment math runs on the un-floored value.

The visible symptom is a **position**, not a size: every variant renders the
right size, but RTL column placement subtracts the target size when walking the
cross axis backwards, so the item is offset by exactly the difference.

**Reproduction:**

```html
<div style="display: flex; flex-direction: column">
  <div style="max-width: 0; border-width: 17px 120px 17px 3px;
              border-style: solid"></div>
</div>
```

| | item x | item size |
|---|--:|--:|
| Chrome | **0** | 123x34 |
| Engine (pre-fix) | **123** | 123x34 |

**Behaviour matrix** — the bug needs a max-size *below* the padding+border sum;
the last row is the control:

| setup | diverges? |
|---|---|
| column, `max-width: 0` + 123px border | yes (RTL position) |
| column, `max-width: 50px` + 123px border | yes |
| column, `max-width: 0` + 123px *padding* | yes |
| column, border but no `max-width` | no |
| column, `max-width: 0` but no border | no |
| row instead of column | no |
| column, `max-width: 300px` + 123px border | no (max exceeds the sum) |

**Spec:** css-box-3 §4 — the content box floors at zero, so the border box is
never smaller than the padding+border sum, regardless of `max-width`.

**Fix applied here:** floor the stretched cross size by
`padding + border` on the cross axis. See `src/compute/flexbox.ts`; regression
fixture `tests/html/fuzz-found/fuzz_stretch_pb_floor.html`.

**Note:** in *this port* the non-stretch cross-size path already applies this
floor, so the fix here was to make the stretch branch consistent with its
sibling. That asymmetry was not confirmed in Taffy — the `maybe_max` calls
around Taffy's cross-size determination are the container-level and flex-basis
floors, not a per-item padding+border floor on the cross axis. Locate Taffy's
equivalent (if any) before assuming the same one-line fix applies.

---

## 11. Zero-size `repeat(auto-fit)` divides by zero when resolving the repetition count

**Verified in Taffy:** suspected (source read:
`src/compute/grid/explicit_grid.rs:156-160`)

**Taffy source:**

```rust
let per_repetition_gap_used_space = (repetition_definition.len() as f32) * gap_size;
let per_repetition_used_space = per_repetition_track_used_space + per_repetition_gap_used_space;
let num_repetition_that_fit = (inner_container_size - first_repetition_and_non_repeating_tracks_used_space)
    / per_repetition_used_space;
```

`per_repetition_used_space` is not checked against zero. When the repetition's
tracks resolve to zero size and there is no gap, this is `0.0 / 0.0` = `NaN`.

**Reproduction:** an `auto-fit` repetition whose track is a percentage that
cannot resolve, in a zero-size container:

```html
<div>
  <div style="display: grid; grid-template-rows: repeat(auto-fit, 75%)">
    <div></div>
  </div>
</div>
```

**Severity differs by language.** In Rust `NaN as u16` saturates to 0, so Taffy
should get a wrong (zero) explicit track count rather than memory unsafety —
worth confirming, but likely a silently wrong layout, not a panic. In this
TypeScript port the NaN stayed a NaN and propagated into the explicit track
count, and since `x + NaN + y` is NaN rather than a number larger than any
index, the occupancy matrix's `range.end > len` bounds check passed *vacuously*
(every comparison with NaN is false). Placement then wrote past the end of the
matrix: `TypeError: Cannot set properties of undefined`.

The crash aborted the whole fuzz run at that tree, which had been hiding all
grid-mode coverage past it.

**Spec:** css-grid-1 §7.2.3.1 — a repetition that consumes no space would
repeat infinitely, so the auto-repeat count is 1.

**Fix applied here:** treat `perRepetitionUsedSpace <= 0` like the
does-not-fit case and use a single repetition; additionally, make the track-count
helper throw on a non-finite total so a future sizing bug fails where it
originates instead of corrupting the matrix. See
`src/compute/grid/explicit.ts` and `src/compute/grid/types.ts`; regression
fixture `tests/html/fuzz-found/fuzz_grid_autofit_zero.html`.

**Note:** the reproduction is spelling-sensitive. `repeat(auto-fit, 75%)`
crashes; `repeat(auto-fit, minmax(75%, 75%))` does not, and neither does the
same grid with `display: block` on the wrapper. Any upstream test should use the
exact markup above.

---

## 12. Grid minimum contribution is not clamped by the item's min/max size

**Verified in Taffy:** suspected (source read:
`src/compute/grid/types/grid_item.rs:459-520`, `minimum_contribution`)

**Taffy source (abridged):**

```rust
let size = self.size.maybe_resolve(...).maybe_apply_aspect_ratio(...).maybe_add(box_sizing_adjustment)
    .get(axis)
    .or_else(|| self.min_size.maybe_resolve(...)...)
    .or_else(|| self.overflow.get(axis).maybe_into_automatic_min_size())
    .unwrap_or_else(|| /* content-based minimum */);
// ...then clamped only by the spanned fixed-track limit
```

The specified size suggestion is used directly — it is never clamped by the
item's own `max-size` (or floored by `min-size`) in that axis. css-grid-1 §6.6
/ css-sizing-3 §5.2.1: the size suggestions feeding the content-based minimum
are clamped by the min/max size properties, with the usual min-beats-max
precedence.

**Reproduction:** an auto-track grid whose item has a specified width above its
max-width:

```html
<div style="display: grid">
  <div style="width: 40px; height: 20px; max-width: 10px"></div>
</div>
```

| | container width |
|---|--:|
| Chrome | **10** |
| Engine (pre-fix) | **40** |

The *item* renders at the clamped 10px in both engines — only its contribution
to track sizing (and therefore the track and container) diverged.

**Behaviour matrix** (verified against Chrome):

| item style | Chrome track |
|---|--:|
| `width: 40; max-width: 10` | 10 (max clamps) |
| `width: 40; max-width: 10; min-width: 20` | 20 (min beats max) |
| `width: 1; max-width: 0` | 0 |
| Ahem text `HHHH`, `max-width: 10` | 10 (content path was already correct) |
| `width: 40; max-width: 100` | 40 (control) |

**Fix applied here:** clamp the suggestion by the resolved min/max size (with
min-beats-max `vClamp` semantics) before the fixed-track limit. The
content-based branch measures with the clamp already applied, so re-clamping is
a no-op there. See `itemMinimumContribution` in `src/compute/grid/types.ts`;
regression fixture
`tests/html/fuzz-found/fuzz_grid_min_contribution_clamp.html`.

---

## 13. Leaf padding+border floor never transfers through aspect-ratio into the width

**Verified in Taffy:** suspected (source read: `src/compute/leaf.rs:147-150` —
the floor runs in one direction only, and `SizingMode::ContentSize` nulls the
aspect ratio so no floor runs during intrinsic measurement at all)

Third member of the leaf aspect-ratio family (entries 1 and 6), and
independent of both: entry 1 is the missing automatic-height gate, entry 6 the
missing box-sizing term, this one the missing *direction* — the floor only ever
derives height from width, never width from height.

**Reproduction:** a leaf whose vertical border sum exceeds its horizontal one,
with `aspect-ratio` and both axes automatic:

```html
<div style="display: block">
  <div style="aspect-ratio: 1; border-width: 20px 7px 7px 10px;
              border-style: solid"></div>
</div>
```

Border sums: 17 horizontal, 27 vertical.

| | item size |
|---|--:|
| Chrome (border-box) | **27x27** |
| Engine (pre-fix) | **17x27** |

With `aspect-ratio: 2` Chrome gives **54x27**. Under `content-box` both engines
agree on 17x27 — the ratio relates the 0x0 content box there, so the floors are
independent, which is why only the border_box variants diverge (the mirror
image of entry 6's signature).

**Two distinct omissions must both be fixed:**

1. The floor is one-directional. The width needs the symmetric
   `max(width, transfer(flooredHeight))`, gated on the width being automatic.
   The two directions have a closed-form fixed point (substituting one floor
   into the other collapses to a single `max`), so no iteration is needed.
2. The transfer must run during **intrinsic measurement** (content-size mode),
   where the sizing-mode protocol nulls the aspect ratio. The pb floor is a
   property of the box itself, not one of the styles the parent has already
   accounted for, so the floor-transfer has to read the ratio from the style
   directly. Without this the fix is invisible: the parent stretches the child
   to a container width computed from the un-transferred contribution, and by
   final layout the width is a known dimension the floor correctly refuses to
   touch. (The first fix attempt here failed exactly this way — output
   identical to pre-fix.)

In content-size mode only the pb floor itself transfers (style sizes are the
parent's responsibility in that mode); in inherent-size mode the full
pb-floored size of the other axis does.

**Fix applied here:** see `src/compute/leaf.ts`; regression fixture
`tests/html/fuzz-found/fuzz_leaf_ar_pb_transfer.html` (ratio 1 and ratio 2
cases; the border_box variants fail without the fix).

---

## 14. Grid minimum contribution is not floored by the item's padding+border

**Verified in Taffy:** suspected (source read:
`src/compute/grid/types/grid_item.rs`, `minimum_contribution` — it ends at the
fixed-track-limit min with no padding+border floor; Taffy's *flexbox* automatic
minimum does floor by `padding_border_axes_sums`, so the two algorithms are
inconsistent upstream)

The minimum contribution is an **outer** size, and a border box is never
smaller than its own padding+border. When `overflow: scroll` makes the
automatic minimum size 0, the whole contribution short-circuited to 0 —
so an auto track containing only such an item collapsed to the container's
free space instead of the item's pb sum.

**Reproduction:**

```html
<div style="display: grid; width: 7px; height: 10px">
  <div style="overflow-x: scroll; padding: 3px 20px 20px 10%"></div>
</div>
```

| | track | item width |
|---|--:|--:|
| Chrome | 20 | **22** |
| Engine (pre-fix) | 7 | **21** |

**The percentage is the interesting part of the decomposition.** Percentages
drop to 0 *during* the contribution (the grid area's inline size is still null
while that axis is being sized) and re-resolve against the **final** grid area
at layout. Chrome's numbers across the matrix confirm the two-stage model:
track = 20 (pb with percent→0), then item = `p x 20 + 20` — 22 at 10%, 30 at
50%, 40 at 100%. The non-scroll variants already worked in this engine because
the content-based minimum measures the leaf, which floors at pb.

**Do NOT "fix" the percentage drop by resolving against the container's inner
size instead.** That was attempted here (it is also exactly Taffy's parameter
wiring — `inner_node_size` at `grid_item.rs:466` and as the child's
`parent_size` at `:384`) and reverted: it regressed the non-scroll case
`padding-left: 100%; padding-right: 20px` from a correct 40 to 47. The
percent→0-then-re-resolve behavior is what Chrome does; only the floor was
missing.

**Behaviour matrix** (7px grid, values are item width):

| item style | Chrome | note |
|---|--:|---|
| `padding: 10% 20px`, scroll | 22 | track 20, re-resolve |
| `padding: 50% 20px`, scroll | 30 | scales with the percent |
| `padding: 100% 20px`, scroll | 40 | |
| `padding: 100% 20px`, no scroll | 40 | already correct pre-fix (control) |
| `padding: 100% 0`, scroll | 7 | pb (percent→0) is 0, floor is a no-op |

**Fix applied here:** floor the returned contribution by the resolved
padding+border sum in the axis (after the fixed-track-limit min). See
`itemMinimumContribution` in `src/compute/grid/types.ts`; regression fixture
`tests/html/fuzz-found/fuzz_grid_min_contribution_pb_floor.html`.

**Note for upstream:** the matching floor already exists in Taffy's flexbox
automatic-minimum path, so the fix is to make grid consistent with flexbox.

---

## 15. Grid aspect-ratio stretch transfer ignores `box-sizing`

**Verified in Taffy:** suspected (source read:
`src/compute/grid/types/grid_item.rs:289-305` and
`src/compute/grid/alignment.rs:170-194`)

**Taffy source:**

```rust
// Reapply aspect ratio after stretch and absolute position width adjustments
let Size { width, height } =
    Size { width, height: inherent_size.height }.maybe_apply_aspect_ratio(aspect_ratio);
```

The grid twin of entry 9 (the flexbox `transferThroughRatio` family). The
"reapply aspect ratio after stretch adjustments" sites feed **used border-box**
values (the stretched grid-area size) through the raw ratio. Under
`box-sizing: content-box` the ratio relates the content box, so the source
axis's padding+border must be stripped and the target's added back.

There are **four** sites: two in the item known-dimensions derivation and two
in the alignment/absolute-position path — all with the same copy-pasted
pattern.

**Reproduction:**

```html
<div style="display: grid; box-sizing: content-box">
  <div style="aspect-ratio: 1; border-width: 20px 7px 7px 10px;
              border-style: solid"></div>
</div>
```

Border sums 17w/27h; the stretched grid-area height is 27.

| | item size |
|---|--:|
| Chrome | **17x27** (transfer: (27−27)x1 + 17) |
| Engine (pre-fix) | **27x27** (raw: 27x1) |

Border-box agrees at 27x27 in both engines, so only the content_box variants
diverge. Note the style-value AR sites just above these (resolve style size →
apply ratio → add `box_sizing_adjustment`) are already correct — the ratio is
applied to content-box values *before* the adjustment there. Only the
*used-value* re-applies are affected.

**Fix applied here:** a `maybeApplyAspectRatioUsed(size, ratio, boxSizing,
pbSum)` helper used at all four sites. See `src/compute/grid/types.ts` and
`src/compute/grid/alignment.ts`; regression fixture
`tests/html/fuzz-found/fuzz_grid_ar_contentbox.html`.

---

## 16. Aspect-ratio min/max constraints transfer onto the wrong axis

`min-size`/`max-size` are pushed through `aspect_ratio` onto the *other axis's*
constraint unconditionally. Per css-sizing-4 §5.2.2 a transferred minimum or
maximum bounds the **ratio-determined** size — it does not become a bound on the
axis itself. Transferring unconditionally has two visible consequences:

1. it re-derives an axis that has a size of its own, and
2. it caps content that legitimately overflows the ratio.

It is also needed in the one case it *does* apply — an axis that is stretched
and so has no size of its own to hold the constraint — which is why simply
dropping the transfer is not the fix.

Separately, the ratio derives the automatic axis from the **pre-clamp** value of
the specified one, so an axis clamped by its own max-size still yields the
unclamped partner (and, in `leaf.rs`, the ratio floor then un-clamps the axis
itself).

**Behaviour matrix** (Chrome 151.0.7922.47, border-box; `aspect-ratio: 2`):

| # | styles | context | Chrome | Taffy/pre-fix |
|---|--------|---------|--------|---------------|
| a | `height:200; min-width:900` | root | 900x200 | 900x**450** |
| b | `width:200; min-height:900` | root | 200x900 | **1800**x900 |
| c | `height:200; max-width:3` | root | **3**x200 | **400**x200 |
| d | `width:200; max-height:3` | root | 200x**3** | 200x**100** |
| e | `width:200; max-width:3` | root | 3x**2** | 3x**100** |
| f | `max-width:40` + 60px text | block child | 40x**60** | 40x**20** |
| g | `min-width:900` (no size) | root | 900x450 | 900x450 (control) |
| h | `width:80; max-height:20` | stretched child | **80**x20 | 80x20 (control) |
| i | `max-height:20`, empty | stretched child | **40**x20 | 40x20 (control) |

Rows g/h/i are controls: the transfer is correct where the axis really is
ratio-derived (g) or stretched (i), and correctly absent where the axis has a
specified size (h). Row i is what `block_aspect_ratio_fill_max_width` covers —
it fails if the transfer is removed outright rather than narrowed.

Note `leaf.rs:56` already omits the transfer on `max_size` while `:53` keeps it
on `min_size`; that asymmetry fixes one direction of (c/d) but leaves (a/b).

**Taffy source:**
- `src/compute/leaf.rs:49-56` — the ratio is applied to the raw style size, and
  to `min_size`, before any clamp.
- `src/compute/block.rs:322-335` — all three of `size`/`min_size`/`max_size`
  take the transfer for every block child.

**Fix applied here:** the transfer is narrowed to a stretched axis with no size
of its own (`transferConstraintToStretchedAxis`), and the ratio now derives from
the clamped size (`applyAspectRatioClamped`); both live in `src/geometry.ts` and
are used from `src/compute/leaf.ts` and `src/compute/block.ts`. Regression
fixture `tests/html/fuzz-found/fuzz_leaf_ar_minmax_transfer.html` covers all
nine rows above.

Verified in Taffy: suspected (source-read, not executed).

---

## 17. `self-start` / `self-end` are not modelled by `AlignItems`

`AlignItems`/`AlignSelf` (and the justify equivalents) offer Start, End,
FlexStart, FlexEnd, Center, Baseline, Stretch — but not `self-start` /
`self-end`. Both are valid CSS in every layout mode Taffy implements.

With no orthogonal writing modes they coincide with `start` / `end`
(css-align-3 §4.1), so supporting them is a parse-time normalization rather
than new layout code.

**Behaviour** (Chrome 151.0.7922.47; 100x100 grid, `border: 1px`, abspos child
50x50 with no insets, `align-items: self-end`):

| | result |
|---|---|
| Chrome (LTR) | child at (1, 49) |
| Chrome (RTL) | child at (49, 49) |
| Taffy | no way to express the input |

**Severity differs by language.** In Rust an unsupported value cannot be
constructed, so this is a missing feature and callers simply cannot express it.
In this TypeScript port the equivalent parser cast the string
(`parts[0] as AlignItemsKeyword`), so `self-end` became a keyword that matched
no alignment branch and produced a **NaN** offset and size — silently, since
every comparison against NaN is false. That is the third NaN-shaped defect
found in this port (see also #12 and the `min-content` element-size hang), and
the pattern is always the same: a value accepted at the boundary that the
type system claims cannot exist.

**Taffy source:** `src/style/alignment.rs:10-31` (`enum AlignItems`).

**Fix applied here:** `toAlignItemsKeyword()` in `src/style.ts` maps
`self-start`/`self-end` onto `start`/`end`, maps `normal` onto `stretch`
(verified against Chrome for both flex and grid), and **throws** on anything
else rather than casting. Covered by the imported WPT tests
`abspos_grid-abspos-staticpos-align-{items,self}-self-end*`.

Verified in Taffy: suspected (source-read, not executed).

---

## 18. Percentage margins resolve against available space when computing a content-based width

`determine_content_based_container_width` resolves each item's horizontal
margins against `available_space.width` before subtracting them from the space
offered to the child. But the value being computed *is* the container width, so
the percentage basis is indefinite at that point and a percentage margin must
resolve to zero (css-sizing-3 §5.2). Resolving it against the available space
lets a child's `margin-left: -50%` shrink the very box that defines the 50%.

**Behaviour matrix** (Chrome 151.0.7922.47; 100x100 relative parent, abspos
auto-sized child, grandchild 100x100 with the margin below; measuring the
abspos box's width):

| child margin-left | Chrome | Taffy / pre-fix |
|---|---|---|
| `-50%` | **100** | **50** |
| `50%` | **100** | **150** |
| `-50px` | 50 | 50 (control — px margins do contribute) |
| none | 100 | 100 (control) |

The two percentage rows are the tell: Chrome gives the same width for both
signs, because the percentage contributes nothing either way.

**Taffy source:** `src/compute/block.rs:367-370` —
`item.margin.resolve_or_zero(available_space.width.into_option(), ...)`.
Passing `None` as the basis is the fix; `resolve_or_zero` already yields 0 for
an indefinite basis.

**Fix applied here:** `src/compute/block.ts` resolves those margins against
`null`. Regression fixture
`tests/html/block/block_percentage_margin_intrinsic_width.html` covers all four
rows above. Found via the imported WPT corpus (css-sizing
`abspos-auto-sizing-fit-content-percentage-001/002`), which this fix promotes
along with the rest of css-sizing (60% → 100%).

Verified in Taffy: suspected (source-read, not executed).

---

## 19. Flexbox never transfers a parent-supplied size through `aspect-ratio`

`compute_preliminary`'s container-size setup applies `maybe_apply_aspect_ratio`
to `min_size`, `max_size`, and the *style* size — but never to
`known_dimensions`. A flex container whose width is definite only because its
parent resolved it (both style axes `auto`) therefore never gets a
ratio-derived height, and falls back to the content height. The container
collapses to 0 the moment it has any child.

`block.rs` already performs exactly this transfer, so the two layout modes
disagree on the same input — a container that sizes correctly as a block
collapses when switched to flex.

**Behaviour matrix** (Chrome 151.0.7922.47; outer block `width: 200px`,
inner container `aspect-ratio: 4`):

| inner container | Chrome | Taffy / pre-fix |
|---|---|---|
| `display: flex`, no children | 200x50 | 200x50 (early-return path, unaffected) |
| `display: flex`, one flex child | 200x**50** | 200x**0** |
| `display: flex`, one block child with `aspect-ratio: 1` | 200x**50** | 200x**0** |
| `display: flex`, **no** aspect-ratio, child has one | 200x0 | 200x0 (control) |

The empty case passing is what disguises this: the ratio appears to work until
a child exists.

**Taffy source:** `src/compute/flexbox.rs:180-196` — the three
`maybe_apply_aspect_ratio` calls cover min/max/style size only. Compare
`src/compute/block.rs`, which derives from `known_dimensions` and adopts only
the newly-filled axis.

**Fix applied here:** `src/compute/flexbox.ts` derives
`maybeApplyAspectRatio(knownDimensions, aspectRatio)`, clamps it, and uses it
as the last fallback for each axis — matching block layout's rule that an
incoming known size is left as the parent resolved it and only a newly-filled
axis is adopted. Regression fixture
`tests/html/flex/flex_aspect_ratio_from_known_width.html` covers all four rows.

Found via the imported WPT corpus (css-flexbox
`flex-aspect-ratio-cross-size-002`).

Verified in Taffy: suspected (source-read, not executed).

---

## 20. The content size suggestion is measured with the cross size imposed

The *content size suggestion* of css-flexbox-1 §4.5 is measured by passing
`child_known_dimensions` straight through. For an item with an `aspect-ratio`
that struct already carries a definite cross size (from the item's own style or
from stretching), so the measurement derives the main size from the ratio and
never consults the item's content. Content wider than the ratio is therefore
invisible to the automatic minimum, and the item shrinks below its own
content.

The ratio's contribution is a *separate* suggestion (the transferred size
suggestion). §4.5 joins the two; measuring one through the other collapses them
into a single value and loses whichever is larger.

**Behaviour matrix** (Chrome 151.0.7922.47). All rows: 200px block >
`aspect-ratio: 4` flex container (so 200x50) > item with `aspect-ratio: 1`
(its cross of 50 transfers a main of 50) > content of the given width:

| item | Chrome | Taffy / pre-fix |
|---|---|---|
| content 100 (wider than ratio) | **100** | **50** |
| content 20 | 50 | 50 (control) |
| content 50 | 50 | 50 (control) |
| content 100, `min-width: 0` | 50 | 50 (control) |
| content 100, `overflow: hidden` | 50 | 50 (control) |
| content 100, `width: 70` | 70 | 70 (control) |

Rows 4 and 5 are the diagnostic ones: `min-width: 0` and `overflow: hidden`
both remove the automatic minimum, and both collapse the item back to the
ratio-derived 50 — confirming the 100 in row 1 comes from §4.5 and not from
some other floor.

**Taffy source:** `src/compute/flexbox.rs:795-808` — `measure_child_size(...,
child_known_dimensions, ...)` inside the `min_content_main_size` block.

**Fix applied here:** `src/compute/flexbox.ts` clears the cross axis of the
known dimensions for that one measurement when the child has an aspect ratio,
leaving the transferred suggestion to contribute the ratio's own floor
separately. Regression fixture
`tests/html/flex/flex_ar_item_content_exceeds_ratio.html` covers all six rows.

Note this is the same statement family as entry #8 (which established that the
transferred suggestion must not be *erased* by a zero content size); together
they say the two suggestions are independent and neither may override the
other. Entry #8's four-row matrix is retained as a regression control here.

Verified in Taffy: suspected (source-read, not executed).

---

## 21. Auto margins do not reduce the free space handed to `justify-content`

Main-axis `auto` margins absorb the line's positive free space, but the
*original* `free_space` is then passed to both `apply_alignment_fallback` and
`compute_alignment_offset`. The same space is therefore distributed twice —
once into the margins and again by `justify-content` — and items are pushed
past the end of the container.

Per css-flexbox-1 §8.1 auto margins absorb free space *before* alignment, so
once any auto margin has taken it, `justify-content` has nothing left to
distribute.

**Behaviour matrix** (Chrome 151.0.7922.47). Both rows: 200px wrap container,
`justify-content: space-around`, `gap: 10px 20px`, six 30px items (lines of
4 + 2), one item carrying `margin-left: auto`:

| auto margin on | Chrome | Taffy / pre-fix |
|---|---|---|
| item 5 — first of the partial last line | line 2 at **120, 170** | **150, 260** |
| item 2 — middle of the *full* first line | line 1 at **0, 70, 120, 170** | **3, 78, 133, 188** |

The second row is the important one: this is not a partial-line bug. *Any*
line holding an auto margin was mis-positioned, because `justify-content`
re-distributed space the margin had already consumed. Note 260 in row 1 is
past the 200px container.

**Taffy source:** `src/compute/flexbox.rs:1666-1697` — `free_space` is computed
once at the top of the loop, decremented nowhere, and reused at both
`apply_alignment_fallback` and `compute_alignment_offset`.

**Fix applied here:** `src/compute/flexbox.ts` tracks
`freeSpaceAfterAutoMargins`, set to 0 when auto margins consume the space, and
passes that to the alignment fallback and offset. Regression fixture
`tests/html/flex/flex_auto_margins_absorb_free_space.html` covers both rows.

Found via the imported WPT corpus (css-flexbox
`flexbox-column-row-gap-003`).

Verified in Taffy: suspected (source-read, not executed).

---

## 22. A distributed alignment fallback loses flex-relativity on overflow

`apply_alignment_fallback` marks all four distributed fallbacks as `is_safe`,
then rewrites any safe alignment to `Start` when free space is negative.
`Start` is direction-agnostic, so the `FlexStart` produced by the
`Stretch`/`SpaceBetween` branch loses its reversal: in a reversed container the
item is placed at the wrong end.

The `Center` branch (`SpaceAround`/`SpaceEvenly`) is unaffected — `Center` has
no flex-relative meaning, and Chrome does resolve those to `start` on overflow.
The distinction is the **origin** of the safety, not the keyword: an
*explicitly* `safe flex-start` resolves to `start`, while the `flex-start` that
`space-between` falls back to does not.

**Behaviour matrix** (Chrome 151.0.7922.47). All rows: 100x50
`overflow: hidden` flex container, one item 300px tall (two children, 200 + 50),
so free space is negative:

| container | Chrome | Taffy / pre-fix |
|---|---|---|
| `column-reverse` + `space-between` | y = **-200** | y = **0** |
| `column-reverse` + `stretch` | y = **-200** | y = **0** |
| `row-reverse` + `space-between` | x = **-100** | x = **0** |
| `column` + `space-between` | y = 0 | y = 0 (control — not reversed) |
| `column-reverse` + `flex-start` | y = -200 | y = -200 (control) |
| `column-reverse` + `space-around` | y = 0 | y = 0 (control — center fallback) |
| `column-reverse` + `space-evenly` | y = 0 | y = 0 (control — center fallback) |
| `column-reverse` + explicit `safe flex-start` | y = **0** | y = 0 (control) |

The last four rows matter: a fix that exempts `FlexStart` from the safe-start
rule *by keyword* is wrong on two counts — it breaks the explicit `safe
flex-start` row, and (in this port) an over-broad first attempt that dropped
the implicit safety entirely regressed 60 existing fixtures via the
`space-around`/`space-evenly` path. Only the safety introduced by the
distributed→`FlexStart` fallback may be ignored.

**Taffy source:** `src/compute/common/alignment.rs:18-31` — lines 20-21 set
`is_safe = true` alongside `FlexStart`; line 29-30 then collapses it to
`Start`.

**Fix applied here:** `src/compute/alignment.ts` no longer tracks an implicit
safety flag. The `space-around`/`space-evenly` branch resolves to `start`
directly when free space is negative (its own fallback), and the safe-start
rule keys on `alignmentMode.safe` — the *declared* safety — only. Regression
fixture `tests/html/flex/flex_reverse_overflow_alignment_fallback.html` covers
seven of the eight rows.

Verified in Taffy: suspected (source-read, not executed).

---

## Not yet triaged

Open fuzz findings, not yet attributed to Taffy or to this port. Listed so they
are not lost; each needs the same treatment before it can move up:

- **`fuzz_408e514f`** — percentage padding on an aspect-ratio flex item under a
  `height: auto` root, **content-box only**: Chrome collapses the root and item
  to height 8, the engine to 100. Percentage padding against an indefinite
  container plus a ratio; suspect a cyclic-percentage interaction, so check it
  against the KNOWN_DIVERGENCES cyclic-percentage class before treating it as a
  bug.

It is persisted as HTML in the fuzz corpus but its XML fixtures are not
committed yet (they would fail the suite); regenerate with
`pnpm gentest fuzz_408e514f` once fixed.
