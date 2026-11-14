// Deterministic pseudo-random numbers from a 32-bit integer seed (mulberry32).
// Not cryptographic. Used only so the same seed produces the same synthetic data.

export interface SeededRandom {
  /** Integer in [min, max], both inclusive. */
  integer(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Returns a new array in a Fisher-Yates shuffled order. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRandom(seed: number): SeededRandom {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError('seed must be an integer from 0 to 4294967295');
  }
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function integer(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(items: readonly T[]): T {
    return items[integer(0, items.length - 1)] as T;
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = integer(0, i);
      [result[i], result[j]] = [result[j] as T, result[i] as T];
    }
    return result;
  }

  return { integer, pick, shuffle };
}
