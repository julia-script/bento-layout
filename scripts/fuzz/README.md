# Fuzz diagnosis loop

The frozen batch is a work queue, not a promise to fix every number in it. Use
these commands to select coherent, high-payoff causes and to recognize when the
remaining findings are only a heterogeneous long tail.

```bash
# Fast, browser-free progress count.
pnpm fuzz-batch-status

# Browser-free property enrichment, cluster coherence, payoff, and stop report.
pnpm exec tsx scripts/fuzz-dossier.ts

# Restrict the ranking, then independently minimize and ablate several samples.
pnpm exec tsx scripts/fuzz-dossier.ts --property alignItems --live --samples 3

# Minimize one finding and vary one property occurrence at a time.
pnpm exec tsx scripts/fuzz-matrix.ts <finding-id> --properties aspectRatio,alignItems

# Explain which sizing sources produced the wrong geometry. Batch IDs are
# browser-free because their Chrome fixture XML is already frozen.
pnpm exec tsx scripts/fuzz-provenance.ts <finding-id> --path root/0
```

The dossier's `payoff` is a triage score, not evidence that a fix is correct.
It favors volume, similar property sets, properties enriched among open
findings, and small trees. Its causal confidence becomes useful after `--live`
has minimized independent representatives and removed whole properties.

The matrix always includes the minimized baseline, then changes or removes one
top-level style property occurrence per probe. A proposed layout rule should
predict the entire matrix before engine code changes. Read the relevant
vendored specification in `spec/` first, and inspect pinned Blink when Chrome
and the literal spec reading disagree.

The stop report says `consider-stopping` only when no large coherent cluster or
high-payoff cluster remains and at least 70% of open findings sit in clusters of
one or two. That is a review point: promote valuable remaining cases to normal
fixtures, document genuine divergences, or collect a new batch when coverage
needs to move elsewhere. `batch-clear` means every frozen finding now passes.
