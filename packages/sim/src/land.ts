import { Tile, type MapObject, type MapObjectKind, type Point } from '@aw/shared';
import { occupies } from './occupancy.ts';
import { invalidateMapCaches, isWalkable, mapCache } from './spatial.ts';
import type { WorldState } from './world.ts';

/** Nature that is cleared away when work starts on a plot (it doesn't stop a plot being free). */
const CLEARABLE = new Set(['tree', 'berry_bush', 'rock']);

/**
 * A free w×h plot as close as possible to `near` (searching outward from 4 tiles away): grass
 * only, off paths and farmland, clear of buildings and fields with a one-tile margin all round,
 * clear of outdoor living agents on the plot footprint, and away from the map edge. With `door`,
 * the doorstep (just below the middle of the bottom row) must be walkable. Trees, bushes and rocks
 * don't count against a plot: `clearPlot` removes them.
 */
export function findFreePlot(
  state: WorldState,
  near: Point,
  w: number,
  h: number,
  door: boolean,
): Point | null {
  const { map } = state;
  const cache = mapCache(map);
  const occupied = new Uint8Array(map.width * map.height);
  for (const [kind, list] of cache.byKind) {
    if (CLEARABLE.has(kind)) continue;
    for (const o of list) {
      for (let y = o.y - 1; y < o.y + o.h + 1; y++) {
        for (let x = o.x - 1; x < o.x + o.w + 1; x++)
          if (x >= 0 && y >= 0 && x < map.width && y < map.height) occupied[y * map.width + x] = 1;
      }
    }
  }
  const agentOcc = new Uint8Array(map.width * map.height);
  for (const a of state.agents) {
    if (!occupies(a)) continue;
    if (a.x >= 0 && a.y >= 0 && a.x < map.width && a.y < map.height)
      agentOcc[a.y * map.width + a.x] = 1;
  }
  const ok = (x: number, y: number) => {
    if (x < 2 || y < 2 || x + w > map.width - 2 || y + h + 1 > map.height - 2) return false;
    for (let yy = y - 1; yy < y + h + 1; yy++) {
      for (let xx = x - 1; xx < x + w + 1; xx++) {
        const i = yy * map.width + xx;
        if (occupied[i] || map.tiles[i] !== Tile.Grass) return false;
      }
    }
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (agentOcc[yy * map.width + xx]) return false;
      }
    }
    if (!door) return true;
    // The doorstep below the door must be walkable (trees there would block it).
    const sx = x + Math.floor(w / 2);
    const sy = y + h;
    return isWalkable(map, sx, sy) && cache.walk[sy * map.width + sx] === 1;
  };
  const maxR = Math.max(map.width, map.height);
  for (let r = 4; r < maxR; r++) {
    // Top edge: dy = -r, dx = -r..r
    for (let dx = -r; dx <= r; dx++) {
      const x = near.x + dx;
      const y = near.y - r;
      if (ok(x, y)) return { x, y };
    }
    // Middle rows: dy = -r+1..r-1, dx = -r and dx = +r
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const y = near.y + dy;
      if (ok(near.x - r, y)) return { x: near.x - r, y };
      if (ok(near.x + r, y)) return { x: near.x + r, y };
    }
    // Bottom edge: dy = +r, dx = -r..r
    for (let dx = -r; dx <= r; dx++) {
      const x = near.x + dx;
      const y = near.y + r;
      if (ok(x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Remove trees, bushes and rocks from a plot and the one-tile margin round it (their regrowth
 * tracking goes too). Returns what was removed. Invalidates the map caches; the caller bumps
 * `state.mapVersion` once it has placed whatever goes on the plot.
 */
export function clearPlot(state: WorldState, plot: Point, w: number, h: number): MapObject[] {
  const { map } = state;
  const removed: MapObject[] = [];
  const next = map.objects.filter((o) => {
    const inside =
      CLEARABLE.has(o.kind) &&
      o.x >= plot.x - 1 &&
      o.x < plot.x + w + 1 &&
      o.y >= plot.y - 1 &&
      o.y < plot.y + h + 1;
    if (inside) removed.push(o);
    return !inside;
  });
  if (removed.length > 0) {
    map.objects = next;
    for (const o of removed) delete state.resources[o.id];
    invalidateMapCaches(map);
  }
  return removed;
}

/** A fresh object id for a kind: `${kind}-${n}` with n one past the highest in use. */
export function nextObjectId(state: WorldState, kind: string): string {
  let max = 0;
  for (const o of mapCache(state.map).byKind.get(kind as MapObjectKind) ?? []) {
    const n = Number(o.id.slice(kind.length + 1));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `${kind}-${max + 1}`;
}
