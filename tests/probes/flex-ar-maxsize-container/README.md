# flex: a transferred max-size inflates the container's intrinsic size

Open finding from the fuzz campaign (seed 20260731). Run one with:

    pnpm fuzz-triage tests/probes/flex-ar-maxsize-container/w.json

A flex item whose only styles are `aspect-ratio` and a max-size makes the
*container* size to that max, where Chrome collapses both to 0x0.

| probe | item styles | Chrome | engine |
|---|---|---|---|
| `both` | `aspect-ratio: 1; max-width: 10; max-height: 20` | 0x0 | **10x10** |
| `w` | `aspect-ratio: 1; max-width: 10` | 0x0 | **10x10** |
| `h` | `aspect-ratio: 1; max-height: 20` | 0x0 | **20x20** |
| `none` | `aspect-ratio: 1` | 0x0 | 0x0 (control) |
| `min` | `aspect-ratio: 1; min-width: 10` | 10x10 | 10x10 (control — a *min* legitimately floors) |
| `pinned` | same as `w`, container fixed 50x50 | 10x50 | 10x50 (control) |
| `nomax_ar` | `max-width: 10`, **no** aspect-ratio | 0x0 | 0x0 (control) |

## What is established

Both ingredients are required: `nomax_ar` shows a max alone is fine, and `none`
shows a ratio alone is fine. `pinned` is the important one — with the container
size fixed the item lays out correctly, so **the item logic is not the bug**;
the container's intrinsic size is computed too large and the item then stretches
into it.

Traced as far as `generateAnonymousFlexItems` → the item's `flexBasis`:

    BASIS {flexBasis: null, mainSize: null, transferredMain: 10,
           crossKnown: 10, childKnownDimensions: {width: null, height: 10}}

`childKnownDimensions.height` is 10, filled by the `alignSelf: stretch` branch
in `computeFlexBasis` from `crossAxisAvailableSpace = 10` — which is already the
inflated container size. So the 10 is a *symptom* at that point, not the source.

The source is upstream, where the container's intrinsic content size is
computed from its items. Suspect the `transferredMaxSize` uses around
`src/compute/flexbox.ts:604-615` and `:789/:799` — a max transferred through the
ratio is a ceiling, and must not act as a content-size contribution. Confirm by
instrumenting the container's content-size path (NOT the item path, which
`pinned` already exonerates) before changing anything.
