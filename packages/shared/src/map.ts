import { base64ToBytes, bytesToBase64 } from './bytes.ts';

/** Ground tile types. Stored one byte per tile, row-major. */
export const Tile = {
  Grass: 0,
  Water: 1,
  Sand: 2,
  Path: 3,
  Farmland: 4,
  Bridge: 5,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_NAMES: Record<Tile, string> = {
  [Tile.Grass]: 'Grass',
  [Tile.Water]: 'River',
  [Tile.Sand]: 'Riverbank',
  [Tile.Path]: 'Path',
  [Tile.Farmland]: 'Farmland',
  [Tile.Bridge]: 'Bridge',
};

export type MapObjectKind =
  | 'tree'
  | 'berry_bush'
  | 'rock'
  | 'house'
  | 'bakery'
  | 'workshop'
  | 'market'
  | 'well'
  | 'field'
  | 'dock';

export const OBJECT_LABELS: Record<MapObjectKind, string> = {
  tree: 'Tree',
  berry_bush: 'Berry bush',
  rock: 'Rock',
  house: 'House',
  bakery: 'Bakery',
  workshop: 'Workshop',
  market: 'Town market',
  well: 'Well',
  field: 'Field',
  dock: 'Fishing dock',
};

export interface Point {
  x: number;
  y: number;
}

/** Anything placed on the map. Buildings span w×h tiles from (x, y) = top-left. */
export interface MapObject {
  id: string;
  kind: MapObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  /** Doorway tile (inside the footprint) for buildings. */
  door?: Point;
  /** Construction progress 0–1 for buildings being built or repaired (absent = finished). */
  progress?: number;
  /** Tick it burnt down, while it is being rebuilt (unusable until progress reaches 1 again). */
  burntTick?: number;
}

export interface WorldMap {
  width: number;
  height: number;
  tiles: Uint8Array;
  objects: MapObject[];
}

/** JSON-safe form of a WorldMap (tiles as base64). */
export interface WireMap {
  width: number;
  height: number;
  tiles: string;
  objects: MapObject[];
}

export function encodeMap(map: WorldMap): WireMap {
  return {
    width: map.width,
    height: map.height,
    tiles: bytesToBase64(map.tiles),
    objects: map.objects,
  };
}

export function decodeMap(wire: WireMap): WorldMap {
  const tiles = base64ToBytes(wire.tiles);
  if (tiles.length !== wire.width * wire.height) {
    throw new Error(
      `Map tile data has ${tiles.length} bytes, expected ${wire.width * wire.height}`,
    );
  }
  return { width: wire.width, height: wire.height, tiles, objects: wire.objects };
}

export function tileAt(
  map: Pick<WorldMap, 'width' | 'height' | 'tiles'>,
  x: number,
  y: number,
): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x] as Tile;
}

export function objectContains(obj: MapObject, x: number, y: number): boolean {
  return x >= obj.x && y >= obj.y && x < obj.x + obj.w && y < obj.y + obj.h;
}

export const MAP_SIZES = {
  small: 48,
  medium: 64,
  large: 96,
  huge: 128,
} as const;
export type MapSize = keyof typeof MAP_SIZES;
