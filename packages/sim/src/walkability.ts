import { Tile, type MapObjectKind, type WorldMap } from '@aw/shared';

const BLOCKING: ReadonlySet<MapObjectKind> = new Set([
  'tree',
  'rock',
  'berry_bush',
  'house',
  'bakery',
  'workshop',
  'market',
  'well',
]);

/** 1 = a person can stand here. Buildings are solid except for their doorway tile. */
export function buildWalkability(map: WorldMap): Uint8Array {
  const { width, height, tiles } = map;
  const walk = new Uint8Array(width * height);
  for (let i = 0; i < tiles.length; i++) walk[i] = tiles[i] === Tile.Water ? 0 : 1;
  for (const obj of map.objects) {
    if (!BLOCKING.has(obj.kind)) continue;
    for (let y = obj.y; y < obj.y + obj.h; y++) {
      for (let x = obj.x; x < obj.x + obj.w; x++) walk[y * width + x] = 0;
    }
    if (obj.door) walk[obj.door.y * width + obj.door.x] = 1;
  }
  return walk;
}
