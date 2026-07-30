# Known divergences from Chrome

Cases where this engine deliberately differs from the reference browser
(pinned Chrome version in `tests/fixtures/CHROME_VERSION`). Each entry needs a
minimized fixture, a spec citation, and the reason the divergence is kept.
Fixtures listed here are excluded from conformance assertions and from
differential-fuzzing reports.

_Currently empty — all generated fixtures pass._

Historical note: the engine originally inherited a divergence from Taffy where
aspect-ratio-transferred min/max constraints were applied even to axes with a
definite preferred size (css-sizing-4 §5.2.2 says they only apply to auto
axes). Found by the first authored fixture batch and fixed in the engine to
match Chrome (`aspect_ratio_min_width_max_height_interaction` fixtures).
