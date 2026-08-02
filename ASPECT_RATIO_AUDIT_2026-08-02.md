# Aspect-ratio sizing audit — 2026-08-02

## Purpose and authority

This is the source-of-truth checklist for auditing `bento-layout`'s aspect-ratio behavior. It separates the general CSS Sizing rules from the extra rules imposed by flex, grid, alignment, and out-of-flow layout.

The normative sources are the vendored Bikeshed drafts in `spec/`. The behavioral oracle is Blink at Chrome 151's pinned branch, `refs/branch-heads/7922`. When a probe disagrees with the literal spec, the audit must record and match the pinned Blink behavior rather than silently changing the general rule.

This first pass does **not** claim that every row is currently implemented. It defines the decisions that the implementation map and probe matrix must cover.

## Compact decision model

For each box and each sizing phase, answer these questions in order:

1. Does the box have a usable preferred aspect ratio, and which box edge does it govern?
2. Is at least one preferred axis automatic? If so, which axis is ratio-determining and which is ratio-dependent?
3. Is the determining size definite in this formatting context and phase?
4. Before applying native constraints in the dependent axis, which definite min/max constraints transfer from the determining axis?
5. Does this context install a content-based automatic minimum?
6. Is this an intrinsic-contribution calculation, where percentages and definiteness change meaning?
7. Does alignment select stretch, fit-content, or a definite used size?
8. Does the formatting context require another sizing pass because the opposite axis changed?

## General Sizing 3/4 decision table

| Decision | Required behavior | Ordering and guards | Primary spec evidence | Pinned Blink 7922 evidence | Audit assertion |
|---|---|---|---|---|---|
| Usable preferred ratio | `aspect-ratio: auto` uses a replaced element's natural ratio, otherwise no ratio. A bare `<ratio>` installs the specified width/height ratio. `auto <ratio>` uses the natural ratio on a replaced element when available, otherwise the specified ratio. Degenerate ratios behave as `auto`. | A preferred ratio does not make a non-replaced box replaced. Replaced-only sizing and alignment rules must remain gated on replacedness. | `spec/css-sizing-4.bs:513-560`, anchor `#aspect-ratio` | [`StyleAspectRatio::GetType`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/style/style_aspect_ratio.h#27) maps an empty/degenerate layout ratio to auto; [`BlockNode::GetReplacedAspectRatio`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/block_node.cc#1329) selects explicit versus natural replaced ratios. | Do not use `aspectRatio != null` as a proxy for replaced layout behavior. Include degenerate ratio cases if the public style model can express them. |
| Ratio box edge / `box-sizing` | A bare specified ratio operates on the dimensions selected by `box-sizing`. `auto` and `auto <ratio>` ratio calculations operate on content-box dimensions. | Convert to/from the chosen ratio box exactly once. Border-box conversion must not produce a border box smaller than border+padding; content-box conversion subtracts determining-axis border+padding, transfers the content size, then adds dependent-axis border+padding. | `spec/css-sizing-4.bs:513-541`; general `box-sizing` rules at `spec/css-sizing-3.bs:763-855`, anchor `#box-sizing` | [`ComputedStyle::BoxSizingForAspectRatio`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/style/computed_style.h#2623) uses author `box-sizing` only for a bare ratio; [`InlineSizeFromAspectRatio` and `BlockSizeFromAspectRatio`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#281) implement the border/padding conversion and flooring. | Probe asymmetric border/padding, both `content-box` and `border-box`, in both transfer directions. A shared ratio helper should accept the ratio box explicitly rather than infer it from call-site arithmetic. |
| Preferred-size transfer | Automatic sizes are calculated like a replaced element with a natural ratio and no natural size in that axis. The preferred size resolved in one axis can determine the automatic preferred size in the other. | The axis that receives the transferred size is ratio-dependent; the source is ratio-determining. The dependent result is definite only when its inputs are definite. A ratio cannot change preferred sizes when neither width nor height is automatic. | `spec/css-sizing-4.bs:623-655`, anchor `#aspect-ratio-automatic` | [`ComputeInlineSizeForFragmentInternal`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#527) only selects ratio-driven fit-content when block size can resolve; [`ComputeBlockSizeForFragmentInternal`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#805) requires a known inline size before deriving block size. | Never transfer from an unresolved/indefinite axis. Record the determining axis and definiteness in the probe result; a numeric fallback must not accidentally become a definite source. |
| Min/max transfer: eligibility | A definite minimum, maximum, or preferred constraint in one axis can transfer to an **indefinite** minimum, maximum, or preferred size in the other axis. | Definite destination sizes are unaffected. Transfer constraints only into indefinite destination slots, then let the destination's native constraints win as described below. | `spec/css-sizing-4.bs:784-809`, anchor `#aspect-ratio-size-transfers` | [`ComputeMinMaxInlineSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#758) applies transfers only for a ratio, automatic logical width, and non-explicit stretch. [`ComputeMinMaxInlineSizesFromAspectRatio`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#737) relies on applying transferred constraints before explicit destination constraints. | Test `auto` versus definite destination min/max/preferred independently. A transferred value must not override a definite value in the destination axis. |
| Min/max transfer: ordering | Transfer the origin minimum first. Cap it by any definite destination preferred size or maximum. Transfer the origin maximum second. Floor it by any definite destination preferred size or minimum and by the transferred minimum. | Minimum wins over maximum after conversion. Finally apply each axis's constraints independently; do not try to restore the ratio after a native destination constraint wins. | `spec/css-sizing-4.bs:793-809`, anchor `#aspect-ratio-size-transfers` | [`ComputeTransferredMinMaxInlineSizes` and `ComputeTransferredMinMaxBlockSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#695) convert both constraints and force transferred maximum ≥ transferred minimum. `ComputeMinMaxInlineSizes` composes transferred and explicit constraints in the required precedence order. | Matrix must include contradictory constraints: origin min > origin max, destination preferred below transferred min, and destination minimum above transferred max. Verify the final box may violate its ratio when explicit destination constraints require it. |
| General automatic minimum | For a non-replaced box with a preferred ratio, the automatic minimum in the ratio-dependent axis is min-content capped by the maximum size, unless it is a scroll container in that axis. | This is separate from min/max transfer. It applies when ratio participation makes the automatic/content-sized dependent axis vulnerable to content overflow. An explicit `min-*` replaces the auto minimum. | `spec/css-sizing-4.bs:668-760`, anchor `#aspect-ratio-minimum` | `ComputeInlineSizeForFragmentInternal` and `ComputeBlockSizeForFragmentInternal` separately gate `Length::MinIntrinsic()` on ratio applicability, non-scrollable overflow, and an auto/content-like dependent size; see [`length_utils.cc#573`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#573) and [`length_utils.cc#846`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#846). | Probe `overflow: visible/hidden/auto/scroll` per axis and `min-*: auto/0/length`. Do not reuse flex/grid item auto-min predicates for ordinary block sizing. |
| Intrinsic sizes and contributions | Opposite-axis constraints can transfer through the ratio and affect an auto size used for min/max-content. CSS Sizing 3 does not fully define ordinary non-replaced float-derived intrinsic sizes; the applicable display spec and observed implementation complete the rule. | Intrinsic size and intrinsic **contribution** are distinct. Constraints, margins, border, and padding enter at different stages. Replaced elements without natural sizes have additional fallback rules. | `spec/css-sizing-3.bs:1106-1184`, anchor `#intrinsic-sizes`; `spec/css-sizing-3.bs:1311-1342`, anchor `#intrinsic-contribution` | [`ComputeMinAndMaxContentContributionInternal`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#357) tracks whether a ratio was actually applied, installs the ratio auto minimum, and clamps min/max contributions. [`BlockNode::ComputeMinMaxSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/block_node.cc#1029) derives inline contribution from a definite block geometry and reports the dependency upstream. | Keep used-size, intrinsic-size, and contribution APIs distinguishable. A correct child used size with a wrong parent track/flex size is a contribution bug, not necessarily a used-size bug. |
| Definite/indefinite percentages | A percentage is definite only when it resolves solely against definite sizes. Intrinsic keywords remain indefinite. During cyclic intrinsic contribution calculation, non-replaced preferred/max percentage expressions behave as their initial values; cyclic min/margin/padding percentages resolve against zero. | During final sizing, a cyclic block-axis percentage generally behaves as auto when the dependency came from content, except that flex and grid items permit resolution in that case. Grid adds further intrinsic auto-min rules below. | Definite terms: `spec/css-sizing-3.bs:152-176`; percentage sizing: `spec/css-sizing-3.bs:1036-1067`; cyclic contributions and final sizing: `spec/css-sizing-3.bs:1335-1480`, anchor `#cyclic-percentage-contribution` | Blink carries percentage dependence through `MinMaxSizesResult::depends_on_block_constraints`; `BlockNode::ComputeMinMaxSizes` propagates it when a ratio couples axes. Grid's [`ComputeMinMaxSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_algorithm.cc#257) performs row/column passes when block-dependent items are present. | Never collapse “unresolved percentage,” “auto,” “zero for intrinsic contribution,” and “indefinite available space” into one sentinel. Probe percentages separately in intrinsic and final layout phases. |

## Formatting-context hooks

| Context | Extra rule layered over the general table | Primary spec evidence | Pinned Blink 7922 evidence | Required audit coverage |
|---|---|---|---|---|
| Ordinary block / leaf / root | General automatic sizing, transfer, auto minimum, and intrinsic-contribution rules apply. The vendored modules define no separate root aspect-ratio algorithm; root-specific implementation policy should therefore be explainable by containing-block available space, definiteness, and ordinary sizing—not by a new ratio rule. | `spec/css-sizing-4.bs:623-809`; `spec/css-sizing-3.bs:1036-1067` | Generic sizing is centralized in [`length_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc) and intrinsic propagation in [`BlockNode::ComputeMinMaxSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/block_node.cc#1007). | Run the same auto/definite and min/max matrix as root, nested block, and measured leaf. Any difference needs a containing-block or measurement explanation. |
| Flex base size | If flex basis is content, the item has a ratio, and its cross size is definite, derive the flex base size from the used cross size through the ratio. Otherwise content sizing can require a fit-content cross size. Min/max main sizes are ignored for the base size, then applied to the hypothetical main size. | `spec/css-flexbox-1.bs:3730-3810`, anchor `#algo-main-item`; `flex-basis: content` summary at `spec/css-flexbox-1.bs:2423-2434` | [`FlexLayoutAlgorithm::ConstructAndAppendFlexItems`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc#806) has a ratio-aware block-size callback, transferred min/max clamping, and the `AspectRatioProvidesBlockMainSize` definiteness guard. | Cross row/column direction with definite/auto cross size and `flex-basis: auto/content/length`. Verify base size separately from hypothetical and final post-flex size. |
| Flex automatic minimum | Main-axis auto minimum is content-based only for non-scrollable overflow. Replaced items use the smaller of content and transferred suggestions; non-replaced items use the larger; both are capped by a definite specified suggestion and maximum main size. Transferred suggestion requires a definite preferred cross size, clamped by definite cross min/max before conversion. | `spec/css-flexbox-1.bs:1292-1364`, anchor `#min-size-auto` | `ConstructAndAppendFlexItems` calculates the content suggestion and ensures a non-replaced ratio-derived size encompasses min-intrinsic content; see [`flex_layout_algorithm.cc#1080`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc#1080). | Treat flex auto-min as its own decision table, not a call to the ordinary block auto-min rule. Include replaced/non-replaced and scrollable/non-scrollable cases. |
| Flex stretch and definiteness | A stretched used cross size can become definite for descendants, but changing the cross size in the stretch step does **not** change the item's main size even when it has a ratio. Flex also defines post-flex main sizes and certain stretched cross sizes as definite. | Stretch step: `spec/css-flexbox-1.bs:3988-4012`, anchor `#algo-stretch`; definiteness: `spec/css-flexbox-1.bs:4225-4278`, anchor `#definite-sizes` | Flex builds constraint spaces with phase-specific definite sizes; its `AspectRatioProvidesBlockMainSize` guard distinguishes when a ratio prevents an initial column main size from being considered indefinite. | Probe `align-items: stretch/start/center`, then verify both the item's final axes and percentage descendants. Do not re-transfer a stretched cross size back into the already-resolved main axis. |
| Flex intrinsic contribution | Main-axis min/max-content contributions start from outer intrinsic/preferred sizes, then are capped/floored by growability/shrinkability and clamped by min/max main size. Ratio behavior enters through the underlying intrinsic size and flex base size calculations. | `spec/css-flexbox-1.bs:4629-4650`, anchor `#intrinsic-item-contributions` | [`FlexLayoutAlgorithm::ComputeMinMaxSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc#2934) reuses flex item construction during intrinsic sizing. | Compare child used geometry with container min/max-content geometry. Include grow/shrink zero and content basis. |
| Grid item automatic preferred size | With `normal`, a grid item that has a preferred ratio uses block-level automatic sizing instead of implicit stretch. Explicit `stretch` uses stretch-fit and may distort the ratio. Other self-alignment values use fit-content. | `spec/css-grid-1.bs:1106-1150`, anchor `#grid-item-sizing`; generic stretch/fit-content behavior at `spec/css-align-3.bs:1410-1440` | Grid passes alignment-derived auto-size behaviors into generic sizing. The generic [`ComputeInlineSizeForFragmentInternal`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc#527) gives explicit stretch precedence over ratio and lets a ratio turn implicit stretch into fit-content. | Cross `justify-self` and `align-self` values with auto/definite width and height. Distinguish implicit `normal` from explicit `stretch`; they are not equivalent for a ratio item. |
| Grid automatic minimum | Auto minimum is content-based in an axis only when overflow is non-scrollable, at least one spanned min track is `auto`, and a multi-track span has no flexible track. Grid's transferred size suggestion is used for a **replaced** item; a non-replaced ratio item instead reaches the ratio through its content suggestion and general sizing. Fixed max tracks can additionally clamp suggestions to the grid area's stretch-fit maximum. | `spec/css-grid-1.bs:1293-1380`, anchor `#min-size-auto` | [`GridLayoutAlgorithm::ContributionSizeForGridItem`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_algorithm.cc#577) computes contribution paths. [`grid_layout_utils.cc#535`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_utils.cc#535) contains a pinned TODO noting that one special min-contribution branch does not uniformly respect ratio transfers. | Match probes before “correcting” this branch: pinned Blink's TODO is oracle behavior. Matrix track span (`auto`/fixed/`fr`), overflow, replacedness, and opposite-axis definite constraints. |
| Grid cyclic dependency / reruns | Size columns, then rows; if item contributions change because the other axis becomes known, rerun columns and then rows once as specified. Ratio items and descendants with ratios are explicit examples requiring these passes. | `spec/css-grid-1.bs:3850-3945`, grid sizing algorithm steps 1–4 | [`GridLayoutAlgorithm::ComputeMinMaxSizes`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_algorithm.cc#257) marks block-dependent items and performs additional passes; [`grid_layout_algorithm.cc#322`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_algorithm.cc#322) explicitly encompasses min/max after ratio-triggered passes. | The probe oracle must compare final contributions after all passes, not only initial track sizes. Include a ratio child one nesting level below the grid item. |
| Absolute positioning | Aspect ratio does not change replacedness. `justify-self/align-self: normal` can therefore mean stretch for a non-replaced ratio box and start for a typical replaced box. Non-stretch alignment turns auto sizing into fit-content. Insets define the available alignment container; when only one inset is auto, CSS2 sizing determines the axis and self-alignment has no effect. | Non-replaced note: `spec/css-sizing-4.bs:554-560`; abspos alignment: `spec/css-align-3.bs:1500-1550` and `spec/css-align-3.bs:1680-1720`; available-space adjustment: `spec/css-align-3.bs:1855-1923` | [`ComputeOofInlineDimensions`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/absolute_utils.cc#619) derives auto behavior from alignment/insets, applies ratio only if block size can resolve, installs the ratio auto minimum for visible overflow, then applies general transferred min/max sizes. | Cross both-insets-auto / one-auto / none-auto with normal/stretch/start/center, replacedness, and auto/definite opposite axis. Keep static-position geometry separate from used-size transfer. |

## Important non-equivalences

These pairs must remain separate in code and probes:

- A preferred-size transfer is not a min/max transfer.
- A transferred constraint is not a flex/grid “transferred size suggestion.”
- A used size is not an intrinsic size, and an intrinsic size is not an intrinsic contribution.
- An unresolved percentage is not always zero and is not always `auto`; the phase and cyclic dependency determine which rule applies.
- Implicit stretch (`normal`) is not explicit `stretch` for grid ratio items.
- A definite post-flex or stretched size can be definite for descendants without authoring a definite CSS length.
- `aspect-ratio` does not imply replaced-element behavior.
- Content-box ratio arithmetic and border-box ratio arithmetic are not interchangeable adjustments around one formula.

## Current implementation map

The engine has useful shared arithmetic, but formatting-context policy is still
distributed across several sizing phases. This is the main reason a ratio fix
in one path does not automatically repair equivalent-looking trees elsewhere.

| Layer | Current owners | Audit observation |
|---|---|---|
| Shared ratio arithmetic | `src/geometry.ts::maybeApplyAspectRatio`, `applyAspectRatioClamped`; `src/compute/aspectRatio.ts::maybeApplyAspectRatioUsed`, `toUsedBorderBoxSize` | The content-box/border-box conversion seam exists and should remain the arithmetic authority. |
| Shared min/max transfer | `transferUsedConstraintToStretchedAxis`, `transferMinSizeThroughAspectRatio`, `transferMaxSizeThroughAspectRatio` | Block, grid final layout, and abspos use these selectively; ordinary flex and grid contributions still reconstruct parts of the policy locally. |
| Root / block root | `src/index.ts::computeRootLayout`, `blockRootKnownDimensions` | Root-specific reruns and floors currently form a separate ratio policy even though the specification defines no separate root ratio algorithm. |
| Measured leaf | `src/compute/leaf.ts::computeLeafLayout` | Correctly owns measurement-specific behavior, but callers must not add a second intrinsic floor after the measured used size is known. |
| Normal-flow block | `src/compute/block.ts::computeInner`, `generateItemList`, `performFinalLayoutOnInFlowChildren` | Inline and block automatic-minimum logic is duplicated and currently has different gating from the shared overflow/min-size model. |
| Absolute positioning | `performAbsoluteLayoutOnAbsoluteChildren` is independently implemented in both `block.ts` and `flexbox.ts` | Both implementations can lose the ratio-determining axis after inset resolution and reapply the ratio in the reverse direction. |
| Regular flex | `generateAnonymousFlexItems`, `determineFlexBaseSize`, `determineHypotheticalCrossSize`, `determineUsedCrossSize`, container main/cross sizing | Source selection, transfer, automatic minimum, stretch definiteness, and intrinsic contribution are interleaved. `transferThroughRatio` duplicates shared used-box conversion. |
| Grid contribution sizing | `newGridItem`, `itemKnownDimensions`, `itemContributionKnownDimensions`, `itemRatioAutomaticInlineMinimum`, `itemMinimumContribution` | Contribution sizing has its own ratio/min/max/alignment implementation and loses some authored alignment provenance. |
| Grid final sizing | `alignAndPositionItem` | Re-reads raw nullable alignment styles and therefore can make a different implicit/explicit stretch decision from contribution sizing. |

Graph tracing found 162 production `aspectRatio` references across 53 containing
symbols. `maybeApplyAspectRatioUsed` has direct callers in root, leaf, block,
both abspos paths, grid contribution sizing, grid final alignment, and grid
container sizing. The problem is therefore not missing shared multiplication;
it is duplicated **phase policy and provenance** around that multiplication.

## Empirical campaign classification

The fresh 2026-08-02 campaign initially contained 117 minimized findings; 73
contained `aspectRatio`. On the original unminimized trees, however,
`aspectRatio` enrichment was only about 1.11x (501 open versus 436 fixed). This
means the property is common and often amplifies a one-axis defect, but is not
the cause of every minimized tree that retains it.

Fresh shrinking confirmed this directly: two of four samples in the first
ratio-filtered cluster minimized further to a plain `display:block` viewport
mismatch with no ratio. Ratio occurrence is therefore a triage signal, not a
root-cause label.

| Family / representative | Matrix shape | Current interpretation |
|---|---|---|
| Flex measured cross size, `1091d20b` | `H` measures 10px wide; Chrome uses 10x7 at ratio 1.5 and 10x5 at ratio 2; engine used 10x10 | Confirmed duplicate intrinsic floor in the flex hypothetical cross-size phase. Fixed by `d8adb789`; 4/117 findings cleared. |
| Grid zero inline area with known row, `02bdccd7` | In a 0x1 grid, ratio 1/2/3/20 makes Chrome use the 1px row as source while the engine stays 0x0; flex and block controls pass | Grid track/contribution dependency issue, not shared ratio arithmetic. It needs row-known column rerun and alignment-provenance probes. |
| Root automatic inline minimum, `21866b02` | `height:0`, ratio present, text `H\u200bH`: Chrome width remains the 10px min-content width for every tested ratio; engine uses 20px max-content | Root automatic-minimum contribution chooses the wrong content measure. Ratio value is irrelevant once the path is selected. |
| Flex intrinsic contribution, `dc82cad5` | Empty ratio item with `flex-basis:1`: Chrome intrinsic root is 0x0; engine contributes 1x1 | Flex-basis/intrinsic-contribution ordering, separate from final item sizing. |
| Definite grid percentage, `e9daebc4` | A percentage width resolving to 0 plus definite height must remain 0-wide; engine re-derives width through the ratio | Grid intrinsic known dimensions are leaking into final sizing or losing the fact that the percentage became definite. |
| Abspos grid with explicit row, `c4a36896` | Empty absolute grid with a 1px template row is 1px tall in Chrome and 0 in the engine; ratio value is immaterial but removing it bypasses the path | Abspos grid intrinsic block-size/contribution issue; ratio is a path selector rather than the arithmetic cause. |

## Confirmed implementation gaps

| Priority | Gap | Evidence and expected direction |
|---|---|---|
| High | Normal-flow block ratio automatic minima are insufficiently gated. | `computeInner` and `performFinalLayoutOnInFlowChildren` apply content floors without consistently requiring raw destination `min-* : auto` and the computed non-scrollable overflow pair. With a 10px ratio source and 50px content, Chrome drops to 10px for `min-*:0` or hidden overflow while the engine stays 50px. Use the same destination-axis auto-min predicate in both directions. |
| High | Block and flex abspos lose determining-axis provenance after inset resolution. | With a content-box abspos box, `left/right:10`, 20px inline and 4px block padding, ratio 2, Chrome is 80x34 while both engine paths produce 80x40. The reverse top/bottom case also re-derives the already inset-established block size. Track which inset-resolved axis is determining and use `maybeApplyAspectRatioUsed` once in that direction. |
| High | Grid contribution sizing erases implicit versus explicit stretch. | `computeGridLayout` resolves absent `align/justify-items` to stretch before `newGridItem`; `itemKnownDimensions` cannot distinguish CSS `normal` from authored `stretch`, while `alignAndPositionItem` can. Blink preserves `kStretchImplicit` versus `kStretchExplicit`; Grid section 6.6 requires the distinction for ratio preservation versus distortion. Store auto-size behavior/provenance on `GridItem`. |
| High | Root border-box ratio transfer can use a source smaller than its own insets. | A block root with `height:3`, 72px block border, ratio 3 is 216x72 in Chrome and 9x72 in the engine; the content-box control passes. Floor/convert the determining used border box before ratio transfer, as the leaf path already does. |
| Medium | Grid minimum contributions transfer raw constraints differently from final grid sizing. | `itemMinimumContribution` uses raw resolved sizes where final sizing uses inset-aware helpers. Probe before changing: pinned Blink contains a TODO/legacy branch in this exact area, so literal spec unification may move away from Chrome 151. |
| Medium | Regular flex reconstructs ratio policy in several phases. | Keep the phases separate, but replace ad-hoc arithmetic with a shared decision result carrying determining axis, definiteness, ratio box, and source provenance. Do this only after the nowrap/wrap and flex-basis matrices are green. |

## Verified audit fix

Commit `d8adb789` (`fix(flex): preserve measured ratio cross size`) excludes
measurement-backed leaves from the extra intrinsic cross-size floor in
`determineHypotheticalCrossSize`. This matches Blink's hypothetical cross-size
pass and the existing grid treatment of measured leaves.

- Before the change, the dedicated fixture failed in all four box-sizing and
  direction variants: 10px actual height versus 7px expected.
- The focused audit matrix improved from 28/48 to 36/48 variants.
- The fresh campaign improved from 0/117 to 4/117 fixed.
- The full suite passes: 6,081/6,081 tests.

The remaining 12 matrix failures are deliberately not grouped with this fix:
eight are root block/abspos viewport behavior and four are the independent grid
zero-area contribution case.

## Recommended implementation sequence

1. Add grid alignment provenance (`implicit-stretch`, `explicit-stretch`, or
   `fit-content`) and take the normal-versus-explicit G1/G2 matrix to zero.
2. Fix the two normal-flow block automatic-min predicates together, because
   they are the same rule applied in opposite axes.
3. Introduce determining-axis provenance in the shared block/flex abspos sizing
   flow before changing its content-box arithmetic.
4. Floor the root border-box determining source before ratio transfer.
5. Address root min-content versus max-content and flex intrinsic contributions
   as separate contribution bugs.
6. Only then consider a broader ratio resolver refactor. Its output should be a
   decision record, not merely a width/height pair: determining axis,
   definiteness, ratio box, transferred interval, automatic-minimum owner, and
   intrinsic/final phase.

## Initial probe matrix

The audit should start with a shared leaf whose content has a known min-content width and measured baseline, then place the same leaf in block, root, flex row, flex column, grid item, and absolutely positioned contexts. Vary one dimension at a time:

| Dimension | Values |
|---|---|
| Ratio | none, `1 / 1`, `2 / 1`, `1 / 2` |
| Preferred axes | both auto; width definite; height definite; both definite |
| Ratio box | content-box; border-box, with asymmetric padding/border |
| Minimum | auto; 0; definite on determining axis; definite on dependent axis |
| Maximum | none; definite on determining axis; definite on dependent axis; contradiction with min |
| Percentage source | resolved against definite parent; unresolved/indefinite; cyclic intrinsic contribution |
| Overflow | visible; hidden; auto; scroll, varied in only the relevant axis |
| Alignment | normal; stretch; start; center |
| Flex-only | row/column; basis auto/content/definite; grow/shrink zero/nonzero |
| Grid-only | auto/fixed/`fr` min track; one/multiple track span; fixed max track |
| Abspos-only | both insets auto; one auto; neither auto |

Each row should record: determining axis, input definiteness, ratio box, preferred transfer result, transferred min/max interval, automatic-minimum source, intrinsic/final phase, expected Blink value, and actual engine value. A proposed implementation rule is ready only when it predicts the whole relevant matrix.

## Audit priorities suggested by the source structure

1. **Shared ratio-box conversion.** Verify every call uses the ratio's content/border box semantics exactly once.
2. **Transfer ordering.** Verify origin min, origin max, and destination native constraints compose in Sizing 4 order.
3. **Automatic-minimum ownership.** Separate ordinary ratio auto-min from flex main-axis auto-min and grid track-conditional auto-min.
4. **Intrinsic contribution phase.** Check whether ratio applicability and block-size dependency propagate to parents instead of being lost after child layout.
5. **Alignment-generated definiteness.** Audit implicit versus explicit stretch and ensure a late stretched cross size does not incorrectly resize an already-resolved flex main size.
6. **Percentage states.** Preserve the distinction among indefinite, behaves-as-auto, zero-for-contribution, and resolved numeric values.

## Known source-level caution

The pinned Blink grid implementation explicitly carries a TODO in the min-contribution path stating that the branch should eventually unify ratio and transferred min/max handling. Therefore the spec table alone is insufficient for that branch. Preserve the mismatch as a named Chrome-151 behavior if the probe matrix confirms it; do not refactor toward the draft and away from the frozen oracle.

## Primary-source index

### Vendored specifications

- CSS Sizing 4: `spec/css-sizing-4.bs`, especially `#aspect-ratio`, `#aspect-ratio-automatic`, `#aspect-ratio-minimum`, and `#aspect-ratio-size-transfers`.
- CSS Sizing 3: `spec/css-sizing-3.bs`, especially `#definite`, `#box-sizing`, `#percentage-sizing`, `#intrinsic-sizes`, `#intrinsic-contribution`, and `#cyclic-percentage-contribution`.
- Flexbox: `spec/css-flexbox-1.bs`, especially `#min-size-auto`, `#algo-main-item`, `#algo-stretch`, `#definite-sizes`, and `#intrinsic-item-contributions`.
- Grid: `spec/css-grid-1.bs`, especially `#grid-item-sizing`, `#min-size-auto`, and the grid sizing algorithm around lines 3850–3945.
- Alignment: `spec/css-align-3.bs`, especially `#justify-self-property`, `#justify-abspos`, `#align-flex`, `#align-grid`, and the abspos available-space rules around lines 1855–1923.

### Blink 151 / branch-heads/7922

- [`core/style/computed_style.h`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/style/computed_style.h#2618): logical ratio and ratio box selection.
- [`core/layout/length_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/length_utils.cc): ratio arithmetic, automatic sizes, automatic minimum, min/max transfers, and intrinsic contributions.
- [`core/layout/block_node.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/block_node.cc#1007): intrinsic-size dependency propagation and replaced-ratio selection.
- [`core/layout/flex/flex_layout_algorithm.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc#806): flex item base size, auto minimum, and definiteness hooks.
- [`core/layout/grid/grid_layout_algorithm.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_algorithm.cc#257): contribution dependencies and additional grid sizing passes.
- [`core/layout/grid/grid_layout_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/grid/grid_layout_utils.cc#535): grid auto-min contribution branches and pinned limitations.
- [`core/layout/absolute_utils.cc`](https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7922/third_party/blink/renderer/core/layout/absolute_utils.cc#619): abspos alignment-derived auto sizing, ratio application, auto minimum, and transfers.
