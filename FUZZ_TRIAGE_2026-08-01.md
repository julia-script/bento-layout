# Fuzz batch triage — 2026-08-01

This is a read-only handoff for the batch in
`tests/fuzz-batches/batch-rehydrated-20260731.json`. No engine changes were
made as part of this investigation.

## Snapshot and caveat

- Chrome oracle: 151.0.7922.47, matching Blink branch
  `refs/branch-heads/7922`.
- Snapshot taken at commit `52681ec7` at 2026-08-01 22:54 -03.
- `fuzz-batch-status` reported **500/917 fixed and 417 open**, in 118 geometry
  clusters.
- This was a moving target: it began at 441/917 fixed and reached 500/917
  while this triage was in progress. Cluster counts below are therefore only
  prioritization hints. The minimized repros were rerun directly against
  pinned Chrome at the snapshot above.
- The dossier's property enrichment at an earlier 459-fixed snapshot was led
  by `gridTemplateRows` (1.62x), `aspectRatio` (1.61x), `maxSize` (1.54x),
  `flexGrow`/`flexWrap` (1.50x), and `gridRow` (1.45x). `aspectRatio` is not a
  single bug family; the cases below show at least four different mechanisms.

## Recommended queue

| Priority | Finding / current cluster | Likely mechanism | Confidence |
|---|---|---|---|
| 1 | `096884ec`, 18x `root/0 [height] {flex}` | Abspos max constraint is transferred through the ratio onto an already-definite preferred height | High |
| 2 | `eca72355`, 13x `root [height] {block,flex}` | Parent-supplied known size bypasses the padding/border floor in a nested flex container | High |
| 3 | `d4fc9943`, 10x `root/0 [width,x] {block,flex}` | Border-box max constraint must be floored by padding/border before ratio transfer | High |
| 4 | `0c6a2b5e`, 13x `root/0 [width,x] {flex,grid}` | One-sided abspos inset is not subtracted from shrink-to-fit available width in all layout modes | Medium-high |
| 5 | `80f393af`, 25x `root [width,x] {flex,grid}` | Grid max-content contribution is retained as the outer flex item's used width instead of shrinking and rerunning tracks | Medium-high |
| 6 | `54ba1bb5`, 24x `root [height] {flex,grid}` | Grid intrinsic block contribution wins over a ratio-derived automatic size; Chrome chooses the ratio result | Medium |
| 7 | `e4b66ad8`, 23x `root [width,x] {flex}` | Chrome's automatic minimum/intrinsic contribution for an aspect-ratio flex item | Medium; Blink-specific behavior |
| 8 | `1d76c2b8`, 32x `root/0 [width,x] {flex}` | Cross-axis margin + ratio + scroll-container auto-min interaction | Medium; cluster is heterogeneous |

Two additional independently failing repros are worth retaining even though
their original batch clusters moved below the printed top list:

- percentage block-axis flex-item margin is resolved during intrinsic sizing
  but not rerun after the containing inline size becomes definite;
- relative-position percentage `top`/`bottom` in block layout is resolved
  against zero instead of the definite containing-block height.

## 1. Abspos transferred max constraint (`096884ec`)

Minimal repro:

```json
{"root":{"style":{},"children":[{"style":{"size":{"width":"auto","height":1},"maxSize":{"width":0,"height":"auto"},"aspectRatio":1,"position":"absolute"},"children":[]}]}}
```

All four box/direction variants agree on the mismatch:

```text
Chrome child: 0x1
engine child: 0x0
```

The direct suspect is the absolute-child preparation in
`src/compute/flexbox.ts`: it applies `maybeApplyAspectRatio` independently to
the preferred, minimum, and maximum size pairs, then clamps the preferred
size. This turns `max-width: 0` into a transferred `max-height: 0` and clamps
the definite `height: 1` to zero.

CSS Sizing 4, `#aspect-ratio-size-transfers`, says that a transferred maximum
only constrains an **indefinite** destination size, and is floored by any
definite preferred/minimum destination constraint. The definite preferred
height must therefore survive. Blink implements this centrally in
`length_utils.cc` (`ComputeTransferredMinMaxInlineSizes`,
`ComputeTransferredMinMaxBlockSizes`, then destination-axis min/max
application); it does not ratio-expand a max-size pair in isolation.

Likely fix shape: compute preferred sizes first, derive only an indefinite
axis, calculate transferred min/max constraints with the source/destination
rules, and then apply the destination's explicit constraints. Check both flex
and block OOF paths: `src/compute/block.ts` has the same isolated
`maybeApplyAspectRatio(maxSize, ratio)` pattern.

## 2. Known dimensions bypass the inset floor (`eca72355`)

The current 3-node sample minimizes to:

```json
{"root":{"style":{"display":"block"},"children":[{"style":{"size":{"width":"auto","height":0},"border":{"left":0,"right":0,"top":0,"bottom":1},"flexDirection":"column"},"children":[{"style":{},"children":[]}]}]}}
```

```text
border-box Chrome root/child height: 1 / 1
border-box engine root/child height: 0 / 0
content-box: both root/child heights are 1 / 1
```

The nested flex box's used border-box height cannot be smaller than its 1px
border. In `computeFlexboxLayout`, `styledBasedKnownDimensions` floors the
style-derived branch by `paddingBorderSum`, but an incoming
`knownDimensions.height` wins the nullish coalescing before that floor. The
block parent has already passed the child's declared zero height as known, so
the nested flex container never applies its own inset floor.

This is probably the cleanest current high-confidence fix because the repro
contains no percentages, intrinsic text, ratio, grid, or OOF positioning. It
also suggests auditing which layer owns the invariant: either callers must
never pass a known border-box size below the child's padding/border, or every
layout entry point must floor incoming known dimensions consistently. Blink's
`ResolveBlockLengthInternal` in `length_utils.cc` floors border-box lengths by
border+padding centrally.

## 3. Border-box max floor before transfer (`d4fc9943`)

Minimal repro:

```json
{"root":{"style":{"display":"block"},"children":[{"style":{"maxSize":{"width":"auto","height":0},"aspectRatio":1,"padding":{"left":0,"right":0,"top":1,"bottom":0}},"children":[]}]}}
```

```text
border-box: Chrome child 1x1, engine child 0x1
content-box: both 0x1
```

This box-sizing split is diagnostic. Under `border-box`, the used
`max-height: 0` is floored by the 1px block-axis padding before it transfers
through the 1:1 ratio, so Chrome's transferred inline maximum is 1. The engine
keeps the raw zero and transfers an inline maximum of zero.

Blink has two relevant safeguards in `length_utils.cc`:

- `ResolveBlockLengthInternal` floors border-box lengths by border+padding;
- `InlineSizeFromAspectRatio` / `BlockSizeFromAspectRatio` strip and add the
  correct source/target insets and floor the destination by its insets.

This is related to item 2 through the same invariant, but not necessarily the
same call site. A shared “resolve used min/max border-box constraints” helper
would have a better semantic boundary than adding another clamp in a ratio
helper.

## 4. One-sided OOF inset and shrink-to-fit (`0c6a2b5e` family)

Independent minimal repro:

```json
{"root":{"style":{"display":"block","size":{"width":12,"height":"auto"}},"children":[{"style":{"position":"absolute","inset":{"left":"auto","right":{"percent":1},"top":"auto","bottom":"auto"}},"children":[],"text":"H​H"}]}}
```

```text
Chrome child: x=-10, width=10
engine child: x=-12, width=12
```

The text's max-content width is 20, but only 10px of the 12px containing block
remain after `right: 100%` resolves to 12px and CSS2 shrink-to-fit is applied;
Chrome therefore chooses the 10px min-content width. The engine measures
against the full 12px and positions that box at -12.

The flex OOF path now explicitly subtracts the one non-auto inset before
measurement (`insetReservedWidth`), but the block OOF path still passes the
full `clampedAvailableSpace` to `measureChildSizeBoth`. Grid has its own OOF
alignment/sizing route. The persistent flex/grid cluster is evidence that the
three routes have drifted around a rule Blink centralizes in
`absolute_utils.cc`: `ComputeUnclampedIMCBInOneAxis` establishes the
inset-modified containing block and `ComputeOofInlineDimensions` uses that
space for fit-content sizing.

Suggested matrix before editing: parent display block/flex/grid; left-only vs
right-only; fixed vs percentage inset; LTR/RTL; text widths below min-content,
between min/max-content, and above max-content.

## 5. Grid contribution versus outer flex shrink (`80f393af`)

Minimal repro:

```json
{"root":{"style":{"display":"grid","gridTemplateColumns":[{"min":"auto","max":{"fr":2}},{"min":"auto","max":{"fr":1}}]},"children":[{"style":{"padding":{"left":320,"right":55,"top":0,"bottom":0},"border":{"left":55,"right":0,"top":0,"bottom":0},"gridColumn":{"start":"auto","end":{"line":-1}}},"children":[]}]}}
```

```text
Chrome root/child: 1280 / 430; LTR child x=850
engine root/child: 1290 / 430; LTR child x=860
```

The item's contribution makes one fraction 430px, so the intrinsic grid is
`860 + 430 = 1290`. Chrome nevertheless shrinks the outer flex item to the
1280px viewport and reruns/finalizes the tracks as `850 + 430`; the engine
retains 1290 as the used root width. RTL is especially revealing: the child's
width and x are already correct while only the root width differs.

This points to the seam between grid min/max-content contribution and the
outer flex item's automatic minimum/final used size, not to negative grid-line
resolution. `-1` merely places the item in the last explicit track. Blink's
negative-line resolver counts backward from the explicit-grid end in
`grid_line_resolver.cc`; track materialization then adds any leading offset in
`grid_placement.cc`. The sizing distinction is in the flex contribution path
(`FlexLayoutAlgorithm::ComputeMinMaxSizes`) and grid track sizing, not line
parsing.

Suggested matrix: replace `-1` with the equivalent positive line; change
`2fr 1fr` to fixed tracks; set explicit `min-width: 0`; make viewport 1280,
1290, and 1300; run the grid as a block rather than a flex item. The hypothesis
predicts the negative/positive line variants match and `min-width: 0` permits
the 1280 used size.

## 6. Ratio-derived flex size versus grid intrinsic block size (`54ba1bb5`)

Minimal repro:

```json
{"root":{"style":{"aspectRatio":1},"children":[{"style":{"display":"grid","gridTemplateRows":[{"repeat":1,"tracks":[{"min":"auto","max":1}]}]},"children":[]}]}}
```

```text
Chrome root/child: 0x0 / 0x0
engine root/child: 0x1 / 0x1
```

All of `aspectRatio`, `display:grid`, and the fixed row are necessary in the
ablation. This is unlikely to be a generic fixed-row bug: it appears when the
grid is measured as the intrinsic content of an outer flex item/container
whose other axis is ratio-derived. Chrome lets the ratio-derived zero win;
the engine lets the grid's one-pixel intrinsic block contribution grow both
boxes.

Relevant spec seams are Flexbox §9.9 intrinsic item contributions, Grid §11
track sizing, and Sizing 4 §4.2's distinction between ratio-dependent and
ratio-determining axes. Confidence is lower here because a matrix is still
needed to tell whether Blink suppresses the row contribution during a
specific intrinsic query or clamps it later in flex sizing.

Suggested matrix: `1px` grid row vs `1px` block child; row flex vs column flex;
ratio on outer vs inner; definite width 0 vs definite height 0; `overflow:
hidden`; explicit `min-height: 0`.

## 7. Chrome-specific aspect-ratio automatic minimum (`e4b66ad8`)

Minimal repro:

```json
{"root":{"style":{"size":{"width":0,"height":0},"aspectRatio":1},"children":[{"style":{"border":{"left":0,"right":1,"top":0,"bottom":0}},"children":[]}]}}
```

```text
Chrome root: 1x0
engine root: 0x0
child: 1x0 in both
```

Ablation result:

- removing the ratio makes both engines 0x0;
- making width auto and height 0 makes both 1x0;
- making width 0 and height auto makes both 0x0;
- explicit `min-width: 0` makes both 0x0;
- `overflow: hidden` makes both 0x0.

This fingerprint is an automatic-minimum/content-floor path, not ordinary
ratio derivation. The exact Chrome outcome is not an obvious literal reading
of Flexbox §4.5 because the specified width appears capable of capping the
content-based minimum. Treat the pinned Blink result as authoritative and
avoid changing `applyAspectRatioClamped` globally.

Blink entry points to compare are `ShouldApplyAutoMinSize` and the item
construction around the specified/content/transferred size suggestions in
`flex_layout_algorithm.cc`. Its intrinsic flex contribution path reuses much
of item construction and also contains compatibility behavior, which is a
plausible explanation for why this only appears while the root is itself a
flex item in the max-content fixture wrapper.

## 8. Cross margin + ratio + scrolling (`1d76c2b8`)

Stable residual repro:

```json
{"root":{"style":{"size":{"width":0,"height":0}},"children":[{"style":{"minSize":{"width":"auto","height":1},"aspectRatio":1,"margin":{"left":0,"right":0,"top":0,"bottom":1},"overflow":{"x":"visible","y":"hidden"}},"children":[]}]}}
```

```text
Chrome child: 0x1
engine child: 1x1
```

Removing the cross-axis bottom margin makes the repro pass at the current
snapshot. So does removing enough of the original finding's interaction; this
is not merely “overflow-y should zero min-width.” The computed overflow pair
already makes the item a scroll container, and the current
`overflowAutoMinSize` code recognizes either scrolling axis. The likely fault
is later: a cross minimum/margin participates in ratio transfer or stretch and
recreates a 1px main-axis floor after the scroll-container automatic minimum
was set to zero.

Inspect in order:

1. `transferSource = crossKnown ?? crossMin ?? fitContentCross` in flex-base
   sizing;
2. cross stretch after subtracting margins;
3. the freeze/clamp step that should shrink the 1px basis into the 0px line;
4. final ratio reapplication after flexing.

Do not “fix” this by changing the overflow predicate to be axis-local without
a Chrome matrix. CSS computed overflow couples the axes: a scrollable value
on one axis changes `visible`/`clip` on the other, and the repo's current helper
documents a Chrome 151 probe for that behavior.

## Residual: cyclic percentage flex-item margin

```json
{"root":{"style":{},"children":[{"style":{"margin":{"left":0,"right":1,"top":0,"bottom":{"percent":1}}},"children":[]}]}}
```

```text
Chrome root: 1x1
engine root: 1x0
```

CSS percentages on all four margins resolve against the containing block's
inline size. CSS Sizing 3 `#cyclic-percentage-contribution` says cyclic
percentage margins resolve against zero for the intrinsic contribution, but
the percentage is honored during actual layout. Here the child's 1px right
margin establishes a final inline size of 1, after which the 100% bottom margin
is 1px. The engine resolves and caches the margin in
`generateAnonymousFlexItems` while `constants.nodeInnerSize.width` is still
indefinite, producing zero, and never refreshes it. The flex code already has
a second resolution step for percentage gaps after the container main size
becomes definite; margins need an equivalent phase boundary.

This is a good regression fixture even if its original batch finding has been
changed enough to move clusters.

## Residual: relative percentage inset in block layout

```json
{"root":{"style":{"display":"block","size":{"width":"auto","height":1}},"children":[{"style":{"inset":{"left":"auto","right":"auto","top":"auto","bottom":{"percent":1}}},"children":[]}]}}
```

```text
Chrome child y=-1
engine child y=0
```

The cause is explicit in `performFinalLayoutOnInFlowChildren` in
`src/compute/block.ts`: it resolves `top` and `bottom` percentages against
literal zero. The containing block has a definite 1px height, so
`bottom: 100%` is 1px and relative positioning shifts the child upward by 1.
Grid alignment already resolves its vertical relative inset against the grid
area's height. CSS Position is not vendored in this repository, so the best
local evidence is the four-variant Chrome probe plus the inconsistent block
vs grid implementation.

## Common threads and guardrails

### A. Constraint transfer is being modeled as pair expansion

`maybeApplyAspectRatio` is appropriate for filling a missing preferred axis;
it is not the full CSS Sizing 4 transferred-min/max algorithm. Several OOF and
block paths apply it independently to `minSize` and `maxSize`, losing all of
these conditions:

- transfer only into an indefinite preferred axis;
- transferred maximum is floored by a definite destination preferred/minimum;
- transferred minimum is capped by a definite destination preferred/maximum;
- destination minimum wins if transferred min exceeds transferred max;
- border-box constraints are first floored by padding/border.

Do not batch-fix all aspect-ratio findings in `applyAspectRatioClamped`. That
helper has callers in root, leaf, block, flex, and grid layout, while the open
cases require different contribution and constraint semantics.

### B. Parent/child sizing phases lose used-size invariants

The cyclic-margin repro and `eca72355` are complementary:

- a child-side value is resolved too early and never refreshed after the
  parent becomes definite;
- a parent-side known dimension is treated as final and bypasses the child's
  padding/border floor.

A useful audit question for each layout boundary is: is this value a raw
specified size, an intrinsic contribution, or a final used border-box size?
Several current APIs represent all three as `Size<Opt>`.

### C. OOF sizing is duplicated

`resolveAbsoluteAxis` is shared, but preferred/min/max resolution and
shrink-to-fit measurement are separately implemented in block, flex, and grid
paths. Blink instead centralizes the inset-modified containing block and OOF
inline/block dimension computations in `absolute_utils.cc`. The current
one-sided-inset and transferred-max findings are both consequences of work
that occurs before the shared alignment helper.

### D. Geometry clusters are heterogeneous

The large `aspectRatio` enrichment and path-based clusters should not be used
as proof of one root cause. Examples:

- `096884ec`: illegal max transfer onto a definite destination;
- `d4fc9943`: border-box floor before legal transfer;
- `e4b66ad8`: flex automatic minimum / intrinsic contribution;
- `54ba1bb5`: grid contribution under ratio-dependent sizing;
- `1d76c2b8`: cross margin and scroll-container shrink interaction.

Use property ablation and a small Chrome matrix before merging any of these.

## Specs consulted

- `spec/css-flexbox-1.bs`
  - `#min-size-auto` (§4.5 automatic minimum size)
  - `#abspos-items` (§4.1 absolutely positioned flex children)
  - `#intrinsic-item-contributions` (§9.9 intrinsic contributions)
- `spec/css-sizing-3.bs`
  - `#intrinsic-contribution`
  - `#cyclic-percentage-contribution`
- `spec/css-sizing-4.bs`
  - §4 preferred aspect ratio and ratio-dependent axes
  - `#aspect-ratio-size-transfers`
- `spec/css-grid-1.bs`
  - `#min-size-auto`
  - `#track-sizing`
  - negative explicit-grid line placement and implicit-track creation

## Pinned Blink sources consulted

- [`length_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc): aspect-ratio conversion, border/padding floors, transferred min/max constraints.
- [`absolute_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/absolute_utils.cc): inset-modified containing blocks and OOF shrink-to-fit sizing.
- [`flex_layout_algorithm.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc): `ShouldApplyAutoMinSize`, item size suggestions, intrinsic flex contributions.
- [`grid_track_sizing_algorithm.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_track_sizing_algorithm.cc): intrinsic track contributions and flexible track sizing.
- [`grid_line_resolver.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_line_resolver.cc) and [`grid_placement.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_placement.cc): negative lines and explicit/implicit grid offsets.

## Fast handoff commands

Rerun the moving batch first:

```bash
pnpm exec tsx scripts/fuzz-batch-status.ts
```

Then use the JSON blocks above with:

```bash
pnpm fuzz-triage '<tree-json>'
pnpm exec tsx scripts/fuzz-minimize.ts '<tree-json>' --preserve-mismatch
```

For maximum value per edit, I would start with `096884ec`, then the minimal
`eca72355` border-floor case, and run `d4fc9943` immediately afterward to see
whether a shared used-constraint helper fixes both without touching global
ratio derivation.
