/**
 * Seeded, deterministic random numbers for domain rules.
 *
 * Every stream is derived from (world seed, day, phase, entity, action) so that:
 *  - the same inputs replay to the same outcomes,
 *  - adding a new consumer does not shift an existing stream,
 *  - provider completion order cannot influence results.
 *
 * No wall-clock or Math.random is used anywhere in here.
 */

export interface Rng {
  /** Raw 32-bit unsigned draw. */
  nextUint32(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** True with probability ppm/1_000_000 (ppm clamped to [0, 1_000_000]). */
  chancePpm(ppm: number): boolean;
  /** True with probability bps/10_000. */
  chanceBps(bps: number): boolean;
  /** Uniform integer in [0, boundExclusive); boundExclusive > 0. */
  below(boundExclusive: number): number;
  pick<T>(items: readonly T[]): T | undefined;
  /** Fisher–Yates shuffle on a copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** Deterministic fork for a sub-stream, e.g. one per conversation round. */
  fork(label: string): Rng;
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** sfc32: small, fast, good enough for game rules, fully deterministic on uint32 math. */
export function createRng(seedText: string): Rng {
  let a = fnv1a32(`${seedText}#a`) >>> 0;
  let b = fnv1a32(`${seedText}#b`) >>> 0;
  let c = fnv1a32(`${seedText}#c`) >>> 0;
  let d = fnv1a32(`${seedText}#d`) >>> 0;

  function nextUint32(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c >>>= 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    return t >>> 0;
  }

  // Warm up: the first few draws of sfc32 are weakly mixed.
  for (let i = 0; i < 8; i += 1) nextUint32();

  function int(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new Error('Rng.int requires integer bounds');
    }
    if (maxInclusive < minInclusive) return minInclusive;
    const span = maxInclusive - minInclusive + 1;
    if (!Number.isSafeInteger(span)) throw new Error('Rng.int span exceeds safe integer range');
    return minInclusive + Math.floor((nextUint32() / 0x100000000) * span);
  }

  const rng: Rng = {
    nextUint32,
    int,
    chancePpm(ppm: number): boolean {
      const clamped = Math.max(0, Math.min(1_000_000, Math.trunc(ppm)));
      if (clamped === 0) return false;
      if (clamped >= 1_000_000) return true;
      return nextUint32() % 1_000_000 < clamped;
    },
    chanceBps(bps: number): boolean {
      const clamped = Math.max(0, Math.min(10_000, Math.trunc(bps)));
      if (clamped === 0) return false;
      if (clamped >= 10_000) return true;
      return nextUint32() % 10_000 < clamped;
    },
    below(boundExclusive: number): number {
      if (boundExclusive <= 0) return 0;
      return nextUint32() % boundExclusive;
    },
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined;
      return items[nextUint32() % items.length];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = nextUint32() % (i + 1);
        const tmp = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = tmp;
      }
      return copy;
    },
    fork(label: string): Rng {
      return createRng(`${seedText}\u001f${label}`);
    },
  };

  return rng;
}

/**
 * Canonical stream derivation. Changing this formula changes every historical outcome, so it is part
 * of the rules version: bump RULES_VERSION if you ever alter it.
 */
export function streamRng(
  worldSeed: string,
  day: number,
  phase: string,
  entity: string | number,
  action: string,
): Rng {
  return createRng(`${worldSeed}|${day}|${phase}|${entity}|${action}`);
}

/** Stable non-negative 31-bit salt for a resident, so per-entity streams stay independent. */
export function entitySalt(worldSeed: string, entityId: number): number {
  return fnv1a32(`${worldSeed}#entity#${entityId}`) & 0x7fffffff;
}

export { fnv1a32 };
