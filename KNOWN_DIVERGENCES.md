# Known divergences from Chrome

Cases where this engine deliberately differs from the reference browser
(pinned Chrome version in `tests/fixtures/CHROME_VERSION`). Each entry needs a
minimized fixture, a spec citation, and the reason the divergence is kept.
Fixtures listed here are excluded from conformance assertions and from
differential-fuzzing reports.

## Divergence classes

### Cyclic percentage resolution (class-level, not fixture-level)

**What:** Percentage sizes/margins/paddings on boxes whose containing block is
sized by its contents (max-content sizing). Example: a flex root with no size
whose child has `width: 320px; padding-top: 75%` — the percentage resolves
against the container's final width (320) in Chrome, making the child's
border-box height 320; the engine resolves percentages against the
still-indefinite width as zero during intrinsic sizing, so the container sizes
to 200 and does not re-resolve.

**Spec:** css-sizing-3 §5.2 leaves cyclic percentage resolution loosely
defined ("behaves as auto" in cyclic cases); Chrome effectively re-resolves
after layout. Matching Chrome would require multi-pass relayout, which the
engine (like Taffy) does not implement.

**Fuzzer handling:** the generator only emits percentages where the containing
block is definite (`GenContext.wDef/hDef` in scripts/fuzz/generate.ts), and the
shrinker rejects candidates that violate the same invariant
(`treeRespectsPercentInvariant`), so this class is deliberately outside the
fuzzed space rather than filtered per-signature. The vendored corpus follows
the same convention.

_No fixture-level divergences — all generated fixtures pass._

Historical note: the engine originally inherited a divergence from Taffy where
aspect-ratio-transferred min/max constraints were applied even to axes with a
definite preferred size (css-sizing-4 §5.2.2 says they only apply to auto
axes). Found by the first authored fixture batch and fixed in the engine to
match Chrome (`aspect_ratio_min_width_max_height_interaction` fixtures).
