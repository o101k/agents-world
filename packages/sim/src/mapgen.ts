import { Tile, type MapObject, type MapObjectKind, type Point, type WorldMap } from '@aw/shared';
import { fbm } from './noise.ts';
import { findPath } from './pathfinding.ts';
import { Rng, hashSeed } from './rng.ts';

export interface MapGenOptions {
  width: number;
  height: number;
  /** Number of family houses. Defaults to scale with map size. */
  houses?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Generates a pre-industrial village from a seed: a river with a bridge, a plaza with the
 * town market and well, houses, a bakery and workshop, fields, a fishing dock, paths and forest.
 * Pure and deterministic: same seed + options → identical map.
 */
export function generateVillageMap(seed: string, options: MapGenOptions): WorldMap {
  const { width: w, height: h } = options;
  if (w < 32 || h < 32) throw new Error('Map must be at least 32×32');
  const rng = Rng.fromSeed(`${seed}:map`);
  const noiseSeed = hashSeed(`${seed}:noise`)[0] | 0;

  const tiles = new Uint8Array(w * h).fill(Tile.Grass);
  // Tiles reserved for buildings, margins and doorsteps — nothing else may be placed there.
  const reserved = new Uint8Array(w * h);
  // Footprints people and paths cannot pass through (buildings, market, well).
  const solid = new Uint8Array(w * h);
  const objects: MapObject[] = [];
  const counters = new Map<MapObjectKind, number>();
  const idx = (x: number, y: number) => y * w + x;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  const addObject = (kind: MapObjectKind, rect: Rect, extra: Partial<MapObject> = {}) => {
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const obj: MapObject = { id: `${kind}-${n}`, kind, ...rect, ...extra };
    objects.push(obj);
    return obj;
  };

  const reserve = (rect: Rect, margin: number) => {
    for (let y = rect.y - margin; y < rect.y + rect.h + margin; y++) {
      for (let x = rect.x - margin; x < rect.x + rect.w + margin; x++) {
        if (inBounds(x, y)) reserved[idx(x, y)] = 1;
      }
    }
  };

  const markSolid = (rect: Rect) => {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) solid[idx(x, y)] = 1;
    }
  };

  const isFreeLand = (rect: Rect, margin: number, edge = 2) => {
    if (
      rect.x < edge ||
      rect.y < edge ||
      rect.x + rect.w > w - edge ||
      rect.y + rect.h > h - edge
    ) {
      return false;
    }
    for (let y = rect.y - margin; y < rect.y + rect.h + margin; y++) {
      for (let x = rect.x - margin; x < rect.x + rect.w + margin; x++) {
        if (!inBounds(x, y)) return false;
        const t = tiles[idx(x, y)];
        if (reserved[idx(x, y)] || t === Tile.Water || t === Tile.Sand || t === Tile.Bridge) {
          return false;
        }
      }
    }
    return true;
  };

  // --- River: meanders top to bottom in the western third. ---
  const riverBase = w * rng.range(0.2, 0.3);
  const riverLeft: number[] = [];
  for (let y = 0; y < h; y++) {
    const meander = (fbm(y * 0.045, 7.3, noiseSeed, 3) - 0.5) * w * 0.28;
    const width = 2 + (fbm(y * 0.1, 91.1, noiseSeed, 2) > 0.55 ? 1 : 0);
    const left = Math.max(1, Math.min(w - 4, Math.round(riverBase + meander)));
    riverLeft.push(left);
    for (let x = left; x < left + width; x++) tiles[idx(x, y)] = Tile.Water;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[idx(x, y)] === Tile.Water) continue;
      const nearWater =
        tiles[idx(Math.max(0, x - 1), y)] === Tile.Water ||
        tiles[idx(Math.min(w - 1, x + 1), y)] === Tile.Water;
      if (nearWater && fbm(x * 0.3, y * 0.3, noiseSeed + 5, 2) > 0.42) tiles[idx(x, y)] = Tile.Sand;
    }
  }
  const riverRightAt = (y: number) => {
    let x = riverLeft[y] as number;
    while (x < w && tiles[idx(x, y)] === Tile.Water) x++;
    return x; // first non-water tile east of the river
  };

  // --- Village centre and plaza. ---
  let cx = Math.round(w * rng.range(0.6, 0.66));
  const cy = Math.round(h * rng.range(0.44, 0.56));
  cx = Math.max(cx, riverRightAt(cy) + 12);
  cx = Math.min(cx, w - 10);
  const plaza: Rect = { x: cx - 4, y: cy - 3, w: 9, h: 7 };
  for (let y = plaza.y; y < plaza.y + plaza.h; y++) {
    for (let x = plaza.x; x < plaza.x + plaza.w; x++) tiles[idx(x, y)] = Tile.Path;
  }
  reserve(plaza, 0);
  const market = addObject('market', { x: cx - 3, y: cy - 2, w: 3, h: 2 }, { name: 'Town market' });
  const well = addObject('well', { x: cx + 2, y: cy - 1, w: 1, h: 1 }, { name: 'Village well' });
  markSolid(market);
  markSolid(well);

  // --- Buildings around the plaza. ---
  const houseCount = options.houses ?? Math.max(6, Math.round((w * h) / 512));
  const buildings: { kind: MapObjectKind; w: number; h: number; name: string }[] = [
    { kind: 'bakery', w: 4, h: 3, name: 'Bakery' },
    { kind: 'workshop', w: 4, h: 3, name: 'Workshop' },
  ];
  for (let i = 1; i <= houseCount; i++)
    buildings.push({ kind: 'house', w: 3, h: 3, name: `House ${i}` });

  const doorsteps: Point[] = [];
  for (const b of buildings) {
    for (let attempt = 0; attempt < 600; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const radius = 7 + attempt / 25 + rng.range(0, 3);
      const x = Math.round(cx + Math.cos(angle) * radius - b.w / 2);
      const y = Math.round(cy + Math.sin(angle) * radius * 0.85 - b.h / 2);
      const rect = { x, y, w: b.w, h: b.h };
      const door = { x: x + Math.floor(b.w / 2), y: y + b.h - 1 };
      const step = { x: door.x, y: door.y + 1 };
      // The margin of 1 guarantees the doorstep (just below the door) is free land too.
      if (!isFreeLand(rect, 1)) continue;
      addObject(b.kind, rect, { name: b.name, door });
      reserve(rect, 1);
      markSolid(rect);
      doorsteps.push(step);
      break;
    }
  }

  // --- Fields: farmland plots a little further out. ---
  const fieldCount = w >= 80 ? 5 : 3;
  const fieldTargets: Point[] = [];
  for (let f = 1; f <= fieldCount; f++) {
    const fw = rng.int(5, 7);
    const fh = rng.int(3, 5);
    for (let attempt = 0; attempt < 600; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const radius = 13 + attempt / 30 + rng.range(0, 4);
      const x = Math.round(cx + Math.cos(angle) * radius - fw / 2);
      const y = Math.round(cy + Math.sin(angle) * radius - fh / 2);
      const rect = { x, y, w: fw, h: fh };
      if (!isFreeLand(rect, 1, 3)) continue;
      for (let yy = y; yy < y + fh; yy++) {
        for (let xx = x; xx < x + fw; xx++) tiles[idx(xx, yy)] = Tile.Farmland;
      }
      addObject('field', rect, { name: `Field ${f}` });
      reserve(rect, 1);
      fieldTargets.push({ x: x + Math.floor(fw / 2), y: y + fh }); // path reaches the field's south edge
      break;
    }
  }

  // --- Fishing dock on the east bank, level with the village. ---
  let dock: Point | null = null;
  for (let d = 0; d < h && !dock; d++) {
    for (const y of [cy + d, cy - d]) {
      if (y < 2 || y >= h - 2) continue;
      const x = riverRightAt(y);
      if (x < w && !reserved[idx(x, y)]) {
        dock = { x, y };
        break;
      }
    }
  }
  if (dock) {
    tiles[idx(dock.x, dock.y)] = Tile.Sand;
    addObject('dock', { x: dock.x, y: dock.y, w: 1, h: 1 }, { name: 'Fishing dock' });
    reserve({ x: dock.x, y: dock.y, w: 1, h: 1 }, 0);
  }

  // --- Paths: connect everything to the plaza; a road crosses the map west↔east. ---
  const plazaTarget = { x: market.x + 1, y: cy + 1 };
  const pathCost = (x: number, y: number) => {
    const t = tiles[idx(x, y)];
    if (solid[idx(x, y)] || t === Tile.Farmland) return Infinity;
    if (t === Tile.Path || t === Tile.Bridge) return 1;
    if (t === Tile.Water) return 30;
    return 4;
  };
  const carve = (from: Point, to: Point) => {
    const path = findPath(w, h, from, to, pathCost);
    if (!path) return;
    for (const p of path) {
      const t = tiles[idx(p.x, p.y)];
      if (t === Tile.Water) tiles[idx(p.x, p.y)] = Tile.Bridge;
      else if (t !== Tile.Bridge) tiles[idx(p.x, p.y)] = Tile.Path;
    }
  };
  carve({ x: 0, y: cy }, plazaTarget);
  carve({ x: w - 1, y: cy + rng.int(-4, 4) }, plazaTarget);
  for (const step of doorsteps) carve(step, plazaTarget);
  for (const target of fieldTargets) carve(target, plazaTarget);
  if (dock) carve(dock, plazaTarget);

  // --- Nature: forest thickens away from the village; scattered trees, bushes and rocks. ---
  const radius = Math.min(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (tiles[i] !== Tile.Grass || reserved[i]) continue;
      const dist = Math.hypot(x - cx, (y - cy) * 1.1);
      if (dist < 9) continue;
      const forest = fbm(x * 0.07, y * 0.07, noiseSeed + 17);
      const edgeFactor = Math.min(1, Math.max(0, (dist - 12) / (radius * 0.35)));
      const density = forest + edgeFactor * 0.3;
      const rect = { x, y, w: 1, h: 1 };
      if (density > 0.72 || (dist > 12 && rng.chance(0.025))) {
        addObject('tree', rect);
      } else if (density > 0.6 && rng.chance(0.07)) {
        addObject('berry_bush', rect);
      } else if (dist > 10 && rng.chance(0.006)) {
        addObject('rock', rect);
      }
    }
  }

  return { width: w, height: h, tiles, objects };
}
