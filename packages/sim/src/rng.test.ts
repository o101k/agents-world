import { describe, expect, it } from 'vitest';
import { Rng } from './rng.ts';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = Rng.fromSeed('hello');
    const b = Rng.fromSeed('hello');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    expect(Rng.fromSeed('a').next()).not.toBe(Rng.fromSeed('b').next());
  });

  it('resumes exactly from a saved state', () => {
    const a = Rng.fromSeed('resume');
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(a.state());
    for (let i = 0; i < 50; i++) expect(b.nextUint32()).toBe(a.nextUint32());
  });

  it('int() stays within inclusive bounds', () => {
    const r = Rng.fromSeed('bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });
});
