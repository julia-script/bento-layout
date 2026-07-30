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
