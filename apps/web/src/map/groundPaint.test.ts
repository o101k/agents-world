import { describe, expect, it } from 'vitest';
import { Tile, type MapObject, type WorldMap } from '@aw/shared';
import { hash } from './hash.ts';
import { CHUNK, changedChunks, chunkRect, fieldTiles, tileLayers } from './groundPaint.ts';

/** An all-grass map (tile 0) with the given objects. Chunks are CHUNK = 32 tiles square. */
function makeMap(width: number, height: number, objects: MapObject[] = []): WorldMap {
  return { width, height, tiles: new Uint8Array(width * height), objects };
}

/** A copy of `map` with the listed [x, y, tile] changes. */
function withTiles(map: WorldMap, changes: [number, number, number][]): WorldMap {
  const tiles = map.tiles.slice();
  for (const [x, y, t] of changes) tiles[y * map.width + x] = t;
  return { ...map, tiles };
}

/** A field object covering x..x+w-1, y..y+h-1. */
function field(x: number, y: number, w: number, h: number): MapObject {
  return { id: `field-${x}-${y}`, kind: 'field', x, y, w, h };
}

const noFields = new Set<number>();

describe('fieldTiles', () => {
  it('covers the tiles of field objects and ignores other objects', () => {
    const map = makeMap(8, 8, [
      field(1, 2, 2, 1),
      { id: 'house-1', kind: 'house', x: 5, y: 5, w: 2, h: 2 },
    ]);
    expect([...fieldTiles(map)].sort((a, b) => a - b)).toEqual([2 * 8 + 1, 2 * 8 + 2]);
  });
});

describe('chunkRect', () => {
  it('gives edge chunks their clipped size', () => {
    const map = makeMap(40, 70);
    expect(chunkRect(map, 0)).toEqual({ x0: 0, y0: 0, w: CHUNK, h: CHUNK });
    expect(chunkRect(map, 1)).toEqual({ x0: CHUNK, y0: 0, w: 8, h: CHUNK });
    expect(chunkRect(map, 5)).toEqual({ x0: CHUNK, y0: 2 * CHUNK, w: 8, h: 6 });
  });
});

describe('changedChunks', () => {
  // 64×64 is 2×2 chunks: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
  const map = makeMap(64, 64);

  it('returns nothing for identical content', () => {
    const copy = { ...map, tiles: map.tiles.slice() };
    expect(changedChunks(map, noFields, copy, noFields)).toEqual([]);
    expect(changedChunks(map, noFields, map, noFields)).toEqual([]);
  });

  it('repaints only the chunk holding a changed tile', () => {
    const next = withTiles(map, [[10, 10, Tile.Sand]]);
    expect(changedChunks(map, noFields, next, noFields)).toEqual([0]);
    expect(changedChunks(map, noFields, withTiles(map, [[40, 40, Tile.Path]]), noFields)).toEqual([
      3,
    ]);
  });

  it('a tile just outside a chunk edge also repaints the chunk beside it', () => {
    // (32, 10) is in chunk 1, and its left neighbour (31, 10) is in chunk 0: shore foam reads that.
    const next = withTiles(map, [[32, 10, Tile.Water]]);
    expect(changedChunks(map, noFields, next, noFields)).toEqual([0, 1]);
    // (31, 40) is in chunk 2, and its right neighbour (32, 40) is in chunk 3.
    const other = withTiles(map, [[31, 40, Tile.Water]]);
    expect(changedChunks(map, noFields, other, noFields)).toEqual([2, 3]);
  });

  it('a new field repaints every chunk it covers', () => {
    const inside = makeMap(64, 64, [field(2, 2, 3, 3)]);
    expect(changedChunks(map, noFields, inside, fieldTiles(inside))).toEqual([0]);
    // A field straddling x = 31/32 covers chunks 0 and 1.
    const straddling = makeMap(64, 64, [field(30, 2, 4, 2)]);
    expect(changedChunks(map, noFields, straddling, fieldTiles(straddling))).toEqual([0, 1]);
  });

  it('a field that is removed repaints the chunk it was in', () => {
    const before = makeMap(64, 64, [field(40, 40, 2, 2)]);
    expect(changedChunks(before, fieldTiles(before), map, noFields)).toEqual([3]);
  });

  it('a different size repaints every chunk', () => {
    expect(changedChunks(map, noFields, makeMap(64, 65), noFields)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('handles the partly filled chunks at the edge of a map that is not a multiple of CHUNK', () => {
    const odd = makeMap(40, 40);
    expect(changedChunks(odd, noFields, withTiles(odd, [[39, 39, Tile.Water]]), noFields)).toEqual([
      3,
    ]);
  });
});

describe('tileLayers', () => {
  it('gives water foam on the sides that face dry land', () => {
    // Water at (10, 10) with water to the east and west, and dry land to the north and south.
    const map = withTiles(makeMap(64, 64), [
      [10, 10, Tile.Water],
      [9, 10, Tile.Water],
      [11, 10, Tile.Water],
    ]);
    const base = hash(10, 10) % 2 ? 'water0' : 'water1';
    expect(tileLayers(map, noFields, 10, 10)).toEqual([base, 'foam_n', 'foam_s']);
  });

  it('gives an isolated water tile foam on all four sides', () => {
    const map = withTiles(makeMap(64, 64), [[10, 10, Tile.Water]]);
    const base = hash(10, 10) % 2 ? 'water0' : 'water1';
    expect(tileLayers(map, noFields, 10, 10)).toEqual([
      base,
      'foam_n',
      'foam_e',
      'foam_s',
      'foam_w',
    ]);
  });

  it('counts the edge of the map and bridges as wet, so they get no foam', () => {
    // Corner water: north and west are off the map, so only east and south get foam.
    const corner = withTiles(makeMap(64, 64), [[0, 0, Tile.Water]]);
    const base = hash(0, 0) % 2 ? 'water0' : 'water1';
    expect(tileLayers(corner, noFields, 0, 0)).toEqual([base, 'foam_e', 'foam_s']);
    // A bridge over the river: the bridge side is not foam.
    const bridged = withTiles(makeMap(64, 64), [
      [10, 10, Tile.Water],
      [11, 10, Tile.Bridge],
      [10, 9, Tile.Water],
      [9, 10, Tile.Water],
      [10, 11, Tile.Water],
    ]);
    const bridgedBase = hash(10, 10) % 2 ? 'water0' : 'water1';
    expect(tileLayers(bridged, noFields, 10, 10)).toEqual([bridgedBase]);
  });

  it('picks one of the four grass sprites for each grass tile', () => {
    const names = new Set<string>();
    const map = makeMap(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const layers = tileLayers(map, noFields, x, y);
        expect(layers).toHaveLength(1);
        names.add(layers[0]!);
      }
    expect([...names].sort()).toEqual(['grass0', 'grass1', 'grass2', 'grass3']);
  });

  it('draws sand, paths and bridges', () => {
    const map = withTiles(makeMap(64, 64), [
      [1, 1, Tile.Sand],
      [2, 1, Tile.Path],
      [3, 1, Tile.Bridge],
    ]);
    expect(tileLayers(map, noFields, 1, 1)).toEqual([hash(1, 1) % 2 ? 'sand0' : 'sand1']);
    expect(tileLayers(map, noFields, 2, 1)).toEqual([hash(2, 1) % 2 ? 'path0' : 'path1']);
    expect(tileLayers(map, noFields, 3, 1)).toEqual(['bridge']);
  });

  it('draws crops on farmland only inside a field', () => {
    const map = withTiles(makeMap(64, 64), [[5, 5, Tile.Farmland]]);
    expect(tileLayers(map, noFields, 5, 5)).toEqual(['farmland']);
    const fields = fieldTiles(makeMap(64, 64, [field(4, 4, 3, 3)]));
    expect(tileLayers(map, fields, 5, 5)).toEqual(['farmland', 'crops']);
  });

  it('has no sprites off the map', () => {
    expect(tileLayers(makeMap(64, 64), noFields, -1, 0)).toEqual([]);
    expect(tileLayers(makeMap(64, 64), noFields, 64, 0)).toEqual([]);
  });
});
