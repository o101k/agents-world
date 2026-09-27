import { Tile, type MapObject, type Point, type WorldMap } from '@aw/shared';
import { buildWalkability } from './walkability.ts';

/**
 * Derived, cached lookups over a map. Never serialized; rebuilt on demand.
 * Call invalidateMapCaches(map) whenever tiles or objects change.
 */
interface MapCache {
  walk: Uint8Array;
  byId: Map<string, MapObject>;
  /** Non-tree objects bucketed by 8×8 cell for fast "what's near me" queries. */
  cells: Map<number, MapObject[]>;
}

const CELL = 8;
const caches = new WeakMap<WorldMap, MapCache>();

export function mapCache(map: WorldMap): MapCache {
  let c = caches.get(map);
  if (!c) {
    const byId = new Map(map.objects.map((o) => [o.id, o]));
    const cells = new Map<number, MapObject[]>();
    const cols = Math.ceil(map.width / CELL);
    for (const o of map.objects) {
      if (o.kind === 'tree' || o.kind === 'rock') continue;
      const key = Math.floor(o.y / CELL) * cols + Math.floor(o.x / CELL);
      const list = cells.get(key);
      if (list) list.push(o);
      else cells.set(key, [o]);
    }
    c = { walk: buildWalkability(map), byId, cells };
    caches.set(map, c);
  }
  return c;
}

export function invalidateMapCaches(map: WorldMap): void {
  caches.delete(map);
}

export function isWalkable(map: WorldMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return mapCache(map).walk[y * map.width + x] === 1;
}

/** Movement cost: paths are preferred over open ground. */
export function moveCost(map: WorldMap): (x: number, y: number) => number {
  const { walk } = mapCache(map);
  const { tiles, width } = map;
  return (x, y) => {
    const i = y * width + x;
    if (!walk[i]) return Infinity;
    const t = tiles[i];
    return t === Tile.Path || t === Tile.Bridge ? 1 : t === Tile.Farmland ? 1.6 : 1.3;
  };
}

/** Non-tree objects whose footprint is within `radius` (Chebyshev) of a point. */
export function objectsNear(map: WorldMap, p: Point, radius: number): MapObject[] {
  const { cells } = mapCache(map);
  const cols = Math.ceil(map.width / CELL);
  const out: MapObject[] = [];
  const c0 = Math.floor((p.x - radius - 4) / CELL);
  const c1 = Math.floor((p.x + radius) / CELL);
  const r0 = Math.floor((p.y - radius - 4) / CELL);
  const r1 = Math.floor((p.y + radius) / CELL);
  for (let r = Math.max(0, r0); r <= r1; r++) {
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      for (const o of cells.get(r * cols + c) ?? []) {
        if (distanceToObject(o, p) <= radius) out.push(o);
      }
    }
  }
  return out;
}

/** Chebyshev distance from a point to the nearest tile of an object's footprint. */
export function distanceToObject(o: MapObject, p: Point): number {
  const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w - 1));
  const dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h - 1));
  return Math.max(dx, dy);
}

/** Tiles from which a person can use an object. */
export function interactionTiles(map: WorldMap, o: MapObject): Point[] {
  if (o.door) return [o.door];
  if (o.kind === 'field' || o.kind === 'dock') {
    const tiles: Point[] = [];
    for (let y = o.y; y < o.y + o.h; y++)
      for (let x = o.x; x < o.x + o.w; x++) tiles.push({ x, y });
    return tiles;
  }
  const out: Point[] = [];
  for (let x = o.x; x < o.x + o.w; x++) {
    out.push({ x, y: o.y - 1 }, { x, y: o.y + o.h });
  }
  for (let y = o.y; y < o.y + o.h; y++) {
    out.push({ x: o.x - 1, y }, { x: o.x + o.w, y });
  }
  return out.filter((t) => isWalkable(map, t.x, t.y));
}

export function isAt(p: Point, tiles: Point[]): boolean {
  return tiles.some((t) => t.x === p.x && t.y === p.y);
}

/** Can someone standing here drink (next to the river or at the well)? */
export function isDrinkSpot(map: WorldMap, p: Point): boolean {
  if (!isWalkable(map, p.x, p.y)) return false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    if (map.tiles[y * map.width + x] === Tile.Water) return true;
  }
  return objectsNear(map, p, 1).some((o) => o.kind === 'well' && distanceToObject(o, p) === 1);
}

/** Breadth-first search for the nearest walkable tile satisfying `test`, within maxDist steps. */
export function nearestWalkable(
  map: WorldMap,
  start: Point,
  test: (p: Point) => boolean,
  maxDist = 80,
): Point | null {
  const { width, height } = map;
  const seen = new Uint8Array(width * height);
  let frontier: Point[] = [start];
  seen[start.y * width + start.x] = 1;
  for (let d = 0; d <= maxDist && frontier.length; d++) {
    const next: Point[] = [];
    for (const p of frontier) {
      if (test(p)) return p;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        if (seen[i] || !isWalkable(map, x, y)) continue;
        seen[i] = 1;
        next.push({ x, y });
      }
    }
    frontier = next;
  }
  return null;
}
