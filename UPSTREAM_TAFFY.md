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

## Not yet triaged

Open fuzz findings, not yet attributed to Taffy or to this port. Listed so they
are not lost; each needs the same treatment before it can move up:

- _(none currently — the aspect-ratio/content-box class was triaged and became
  entry 6 above.)_
