// Deterministic PRNG for the fuzzer (design decision 1: Math.random is banned
// in the generator — every value must reproduce from the run seed).

/** mulberry32: tiny 32-bit generator, plenty for style fuzzing. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Independent seed for tree `index` of a run (splitmix-style avalanche), so a
 * single failing tree reproduces in isolation via `--seed X --only N`.
 */
export function deriveSeed(runSeed: number, index: number): number {
  let h = (runSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  private gen: () => number;

  constructor(seed: number) {
    this.gen = mulberry32(seed);
  }

  float(): number {
    return this.gen();
  }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.gen() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.gen() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  /** Pick from a [weight, value] table. */
  weighted<T>(table: ReadonlyArray<readonly [number, T]>): T {
    const total = table.reduce((sum, [w]) => sum + w, 0);
    let r = this.gen() * total;
    for (const [w, v] of table) {
      r -= w;
      if (r < 0) return v;
    }
    return table[table.length - 1]![1];
  }
}
