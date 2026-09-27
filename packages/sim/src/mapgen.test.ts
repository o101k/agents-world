import { Tile, objectContains, type MapObject, type WorldMap } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash.ts';
import { generateVillageMap } from './mapgen.ts';
import { findPath } from './pathfinding.ts';
import { buildWalkability } from './walkability.ts';

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', '12345', 'village'];
const hashMap = (m: WorldMap) => fnv1a(JSON.stringify({ t: Array.from(m.tiles), o: m.objects }));

function entrance(obj: MapObject) {
  return { x: obj.door!.x, y: obj.door!.y + 1 };
}

describe('generateVillageMap', () => {
  it('is deterministic for a seed', () => {
    const a = generateVillageMap('same', { width: 64, height: 64 });
    const b = generateVillageMap('same', { width: 64, height: 64 });
    expect(hashMap(a)).toBe(hashMap(b));
  });

  it('produces different maps for different seeds', () => {
    const a = generateVillageMap('one', { width: 64, height: 64 });
    const b = generateVillageMap('two', { width: 64, height: 64 });
    expect(hashMap(a)).not.toBe(hashMap(b));
  });

  for (const size of [48, 64, 96]) {
    describe(`${size}×${size}`, () => {
      for (const seed of SEEDS) {
        it(`seed "${seed}" has a complete, connected village`, () => {
          const map = generateVillageMap(seed, { width: size, height: size });
          const count = (kind: string) => map.objects.filter((o) => o.kind === kind).length;

          expect(count('market')).toBe(1);
          expect(count('well')).toBe(1);
          expect(count('bakery')).toBe(1);
          expect(count('workshop')).toBe(1);
          expect(count('house')).toBeGreaterThanOrEqual(6);
          expect(count('field')).toBeGreaterThanOrEqual(3);
          expect(count('dock')).toBe(1);
          expect(count('tree')).toBeGreaterThan(50);
          expect(map.tiles.includes(Tile.Water)).toBe(true);
          expect(map.tiles.includes(Tile.Bridge)).toBe(true);

          // Buildings never overlap water or each other.
          const solids = map.objects.filter((o) => o.w > 1 || o.h > 1);
          for (const o of solids) {
            for (let y = o.y; y < o.y + o.h; y++) {
              for (let x = o.x; x < o.x + o.w; x++) {
                expect(map.tiles[y * size + x]).not.toBe(Tile.Water);
                const others = solids.filter((p) => p !== o && objectContains(p, x, y));
                expect(others).toEqual([]);
              }
            }
          }

          // Every building door, field and the dock can be walked to from the well.
          const walk = buildWalkability(map);
          const well = map.objects.find((o) => o.kind === 'well')!;
          const start = { x: well.x, y: well.y + 1 };
          const cost = (x: number, y: number) => (walk[y * size + x] ? 1 : Infinity);
          const targets = [
            ...map.objects.filter((o) => o.door).map(entrance),
            ...map.objects
              .filter((o) => o.kind === 'field' || o.kind === 'dock')
              .map((o) => ({ x: o.x, y: o.y })),
          ];
          for (const t of targets) {
            expect(
              findPath(size, size, start, t, cost),
              `unreachable ${t.x},${t.y}`,
            ).not.toBeNull();
          }
        });
      }
    });
  }
});
