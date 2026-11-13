import { describe, expect, it } from 'vitest';
import { createRng, fnv1a32, streamRng, type Rng } from '../../src/domain/rng.js';

function draw(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(rng.nextUint32());
  return out;
}

describe('seeded RNG', () => {
  it('is reproducible from the same stream key', () => {
    const a = draw(streamRng('seed', 7, 'produce', 3, 'wage'), 12);
    const b = draw(streamRng('seed', 7, 'produce', 3, 'wage'), 12);
    expect(a).toEqual(b);
    expect(a.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)).toBe(true);
  });

  it('separates streams by day, phase, entity, and action', () => {
    const base = draw(streamRng('seed', 7, 'produce', 3, 'wage'), 6);
    expect(draw(streamRng('seed', 8, 'produce', 3, 'wage'), 6)).not.toEqual(base);
    expect(draw(streamRng('seed', 7, 'market', 3, 'wage'), 6)).not.toEqual(base);
    expect(draw(streamRng('seed', 7, 'produce', 4, 'wage'), 6)).not.toEqual(base);
    expect(draw(streamRng('seed', 7, 'produce', 3, 'theft'), 6)).not.toEqual(base);
  });

  it('does not shift existing streams when a new consumer is added elsewhere', () => {
    const before = draw(streamRng('seed', 3, 'produce', 1, 'mortality'), 8);
    // Simulate another subsystem consuming unrelated randomness.
    draw(streamRng('seed', 3, 'market', 1, 'something-new'), 500);
    const after = draw(streamRng('seed', 3, 'produce', 1, 'mortality'), 8);
    expect(after).toEqual(before);
  });

  it('produces integers inside inclusive bounds', () => {
    const rng = createRng('bounds');
    for (let i = 0; i < 2_000; i += 1) {
      const value = rng.int(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(rng.int(5, 5)).toBe(5);
  });

  it('honours probability boundaries and approximates ppm rates', () => {
    const rng = createRng('chance');
    expect(rng.chancePpm(0)).toBe(false);
    expect(rng.chancePpm(1_000_000)).toBe(true);
    expect(rng.chanceBps(0)).toBe(false);
    expect(rng.chanceBps(10_000)).toBe(true);

    const rng2 = createRng('rate');
    let hits = 0;
    const trials = 20_000;
    for (let i = 0; i < trials; i += 1) if (rng2.chancePpm(100_000)) hits += 1;
    // 10% expected; allow a wide band so the test is not flaky.
    expect(hits).toBeGreaterThan(trials * 0.08);
    expect(hits).toBeLessThan(trials * 0.12);
  });

  it('shuffles deterministically without losing elements', () => {
    const rng = createRng('shuffle');
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = rng.shuffle(input);
    const second = createRng('shuffle').shuffle(input);
    expect(first).toEqual(second);
    expect(first.slice().sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('forks independent child streams', () => {
    const parent = createRng('parent');
    const childA = parent.fork('a');
    const childB = parent.fork('b');
    expect(draw(childA, 4)).not.toEqual(draw(childB, 4));
    expect(draw(createRng('parent').fork('a'), 4)).toEqual(draw(createRng('parent').fork('a'), 4));
  });

  it('has a stable string hash', () => {
    expect(fnv1a32('tidehaven')).toBe(fnv1a32('tidehaven'));
    expect(fnv1a32('tidehaven')).not.toBe(fnv1a32('tidehaveN'));
  });
});
