import { Tile, tileAt, type WorldMap } from '@aw/shared';
import { hash } from './hash.ts';
import type { SpriteName } from './pixelArt.ts';

/** Ground is painted and drawn in CHUNK×CHUNK-tile pieces. */
export const CHUNK = 32;

/** Chunks across a map this wide (the last column may be partly past the edge). */
export function chunksAcross(width: number): number {
  return Math.ceil(width / CHUNK);
}

/** Chunks down a map this tall. */
export function chunksDown(height: number): number {
  return Math.ceil(height / CHUNK);
}

/** Index of the chunk holding tile (x, y). Chunks are numbered row by row. */
export function chunkIndexAt(width: number, x: number, y: number): number {
  return Math.floor(y / CHUNK) * chunksAcross(width) + Math.floor(x / CHUNK);
}

/** The tiles a chunk covers, clipped to the map: first tile and size in tiles. */
export function chunkRect(
  map: Pick<WorldMap, 'width' | 'height'>,
  index: number,
): { x0: number; y0: number; w: number; h: number } {
  const across = chunksAcross(map.width);
  const x0 = (index % across) * CHUNK;
  const y0 = Math.floor(index / across) * CHUNK;
  return { x0, y0, w: Math.min(CHUNK, map.width - x0), h: Math.min(CHUNK, map.height - y0) };
}

/** Tile indices (y * width + x) covered by farm fields. */
export function fieldTiles(map: WorldMap): Set<number> {
  const fields = new Set<number>();
  for (const o of map.objects) {
    if (o.kind !== 'field') continue;
    for (let y = o.y; y < o.y + o.h; y++)
      for (let x = o.x; x < o.x + o.w; x++) fields.add(y * map.width + x);
  }
  return fields;
}

/** Shore foam is drawn only on sides facing dry land. Off the map counts as water. */
function isWet(map: WorldMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t === undefined || t === Tile.Water || t === Tile.Bridge;
}

/** The sprites drawn on tile (x, y), bottom first. Empty for tiles off the map. */
export function tileLayers(map: WorldMap, fields: Set<number>, x: number, y: number): SpriteName[] {
  const h = hash(x, y);
  switch (tileAt(map, x, y)) {
    case Tile.Grass: {
      const r = h % 100;
      return [r < 45 ? 'grass0' : r < 80 ? 'grass1' : r < 92 ? 'grass2' : 'grass3'];
    }
    case Tile.Water: {
      const layers: SpriteName[] = [h % 2 ? 'water0' : 'water1'];
      if (!isWet(map, x, y - 1)) layers.push('foam_n');
      if (!isWet(map, x + 1, y)) layers.push('foam_e');
      if (!isWet(map, x, y + 1)) layers.push('foam_s');
      if (!isWet(map, x - 1, y)) layers.push('foam_w');
      return layers;
    }
    case Tile.Sand:
      return [h % 2 ? 'sand0' : 'sand1'];
    case Tile.Path:
      return [h % 2 ? 'path0' : 'path1'];
    case Tile.Farmland:
      return fields.has(y * map.width + x) ? ['farmland', 'crops'] : ['farmland'];
    case Tile.Bridge:
      return ['bridge'];
    default:
      return [];
  }
}

/**
 * The chunks to paint again when the map goes from `prev` to `next`, in ascending order: chunks
 * holding a tile that changed, chunks with a changed tile in their one-tile ring (shore foam
 * reads neighbours), and chunks holding a tile that entered or left a field. A different size
 * means every chunk. Identical content gives [].
 */
export function changedChunks(
  prev: WorldMap,
  prevFields: Set<number>,
  next: WorldMap,
  nextFields: Set<number>,
): number[] {
  const count = chunksAcross(next.width) * chunksDown(next.height);
  if (prev.width !== next.width || prev.height !== next.height) {
    return Array.from({ length: count }, (_, i) => i);
  }
  const dirty = new Uint8Array(count);
  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      const i = y * next.width + x;
      const tileChanged = prev.tiles[i] !== next.tiles[i];
      const fieldChanged = prevFields.has(i) !== nextFields.has(i);
      if (!tileChanged && !fieldChanged) continue;
      if (!tileChanged) {
        // Crops depend only on their own tile, so only its chunk needs painting.
        dirty[chunkIndexAt(next.width, x, y)] = 1;
        continue;
      }
      // The tile and its eight neighbours: a tile on a chunk's edge also changes the chunk beside it.
      const x1 = Math.min(next.width - 1, x + 1);
      const y1 = Math.min(next.height - 1, y + 1);
      for (let ny = Math.max(0, y - 1); ny <= y1; ny++)
        for (let nx = Math.max(0, x - 1); nx <= x1; nx++)
          dirty[chunkIndexAt(next.width, nx, ny)] = 1;
    }
  }
  const out: number[] = [];
  for (let c = 0; c < count; c++) if (dirty[c]) out.push(c);
  return out;
}
