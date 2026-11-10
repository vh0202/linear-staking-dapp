/**
 * Small deterministic pseudo-random generator (mulberry32) for the property-style tests.
 * Deterministic on purpose: a failing run is reproduced by re-running with the same seed.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform bigint in [min, max] (128 random bits, so the modulo bias is negligible). */
  bigint(min: bigint, max: bigint): bigint {
    let bits = 0n;
    for (let i = 0; i < 4; i++) bits = (bits << 32n) | BigInt(Math.floor(this.next() * 4294967296));
    return min + (bits % (max - min + 1n));
  }

  /**
   * Bigint in [1, max] whose order of magnitude is uniform, so tiny amounts (a few wei)
   * are as likely as huge ones.
   */
  magnitude(max: bigint): bigint {
    const digits = max.toString().length;
    const cap = 10n ** BigInt(this.int(1, digits));
    return this.bigint(1n, cap < max ? cap : max);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}
