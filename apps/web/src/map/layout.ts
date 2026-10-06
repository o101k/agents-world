/**
 * Pure layout helpers for the map: where people stand inside a building, and where speech
 * bubbles go so they never overlap. No PixiJS here, so everything is unit-tested.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
  door?: Point;
}

const TILE = 16;
/** Gap kept from the side walls, and from the back wall to the first row of feet. */
const SIDE = 9;
const BACK = 22;
const FRONT = 3;

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  );
}

/**
 * Feet positions (world pixels) for `count` people standing inside a building's footprint.
 * Spots are on an even grid inside the room, never on the doorway column of the bottom row,
 * and distinct even when the room is crowded (the grid just gets tighter). The result is
 * ordered, so the caller assigns spots by sorted person id and nobody jumps around.
 */
export function interiorSpots(o: Footprint, count: number): Point[] {
  if (count <= 0) return [];
  const left = o.x * TILE + SIDE;
  const right = (o.x + o.w) * TILE - SIDE;
  const top = o.y * TILE + Math.min(BACK, o.h * TILE - 20);
  const bottom = (o.y + o.h) * TILE - FRONT;
  const door = o.door ?? { x: o.x + Math.floor(o.w / 2), y: o.y + o.h - 1 };
  const doorLeft = door.x * TILE - 3;
  const doorRight = (door.x + 1) * TILE + 3;
  const doorTop = door.y * TILE + 4;

  const grid = (cols: number, rows: number): Point[] => {
    const out: Point[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        // Spread cells over the whole room (edges included) when there are several.
        const x = cols === 1 ? (left + right) / 2 : left + ((right - left) * c) / (cols - 1);
        const y = rows === 1 ? (top + bottom) / 2 : top + ((bottom - top) * r) / (rows - 1);
        if (y >= doorTop && x >= doorLeft && x <= doorRight) continue;
        out.push({ x: Math.round(x), y: Math.round(y) });
      }
    return out;
  };

  // Pick the grid whose tightest spacing is largest (people lying down are wider than tall).
  let best: { cols: number; rows: number; score: number; cells: number } | null = null;
  const maxDim = Math.max(2, Math.ceil(Math.sqrt(count)) * 3);
  for (let cols = 1; cols <= maxDim; cols++) {
    for (let rows = 1; rows <= maxDim; rows++) {
      if (cols * rows < count) continue;
      if (grid(cols, rows).length < count) continue;
      const sx = cols === 1 ? 99 : (right - left) / (cols - 1);
      const sy = rows === 1 ? 99 : (bottom - top) / (rows - 1);
      const score = Math.min(sx / 1.4, sy);
      if (
        !best ||
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) < 1e-9 && cols * rows < best.cells)
      )
        best = { cols, rows, score, cells: cols * rows };
    }
  }
  const b = best ?? { cols: maxDim, rows: maxDim };
  const cells = grid(b.cols, b.rows);
  // Few people: use the cells spread out rather than the first ones (row-major would crowd the top).
  if (cells.length <= count) return cells.slice(0, count);
  const picked: Point[] = [];
  for (let i = 0; i < count; i++)
    picked.push(cells[Math.floor(((i + 0.5) * cells.length) / count)] as Point);
  return picked;
}

// ---------------------------------------------------------------- speech bubbles

export interface BubbleRequest {
  id: string;
  /** Point the bubble's tail should reach (just above the speaker's name label), screen px. */
  anchor: Point;
  w: number;
  h: number;
}

export interface BubbleObstacle {
  /** The speaker this belongs to (a bubble may sit over its own owner's label). */
  owner: string;
  rect: Rect;
}

export const BUBBLE_TAIL = 6;
const BUBBLE_GAP = 3;

/**
 * Places speech bubbles (screen space) so that no two overlap. Greedy and deterministic:
 * speakers are handled left to right (ties by id). Each bubble prefers to sit centred above its
 * speaker; if that is taken it slides left or right (still close to the speaker), then moves up
 * a level, and so on. Name labels of other people are avoided when a free spot exists. Returns
 * the top-left corner of every bubble.
 */
export function layoutBubbles(
  items: BubbleRequest[],
  obstacles: BubbleObstacle[] = [],
): Map<string, Point> {
  const order = [...items].sort((a, b) => a.anchor.x - b.anchor.x || (a.id < b.id ? -1 : 1));
  const placed: Rect[] = [];
  const out = new Map<string, Point>();
  const MAX_LEVELS = 10;
  for (const it of order) {
    const baseY = it.anchor.y - BUBBLE_TAIL - it.h;
    const shifts = [
      0,
      -(it.w / 2) + 12, // right edge near the head
      it.w / 2 - 12, // left edge near the head
      -(it.w / 2) - 4,
      it.w / 2 + 4,
    ];
    const foreign = obstacles.filter((o) => o.owner !== it.id);
    const free = (r: Rect, withObstacles: boolean) =>
      !placed.some((p) => rectsOverlap(r, p, 2)) &&
      (!withObstacles || !foreign.some((o) => rectsOverlap(r, o.rect)));
    let spot: Point | null = null;
    for (const withObstacles of [true, false]) {
      for (let level = 0; level < MAX_LEVELS && !spot; level++) {
        for (const s of shifts) {
          const r = {
            x: Math.round(it.anchor.x - it.w / 2 + s),
            y: Math.round(baseY - level * (it.h + BUBBLE_GAP)),
            w: it.w,
            h: it.h,
          };
          if (free(r, withObstacles)) {
            spot = { x: r.x, y: r.y };
            break;
          }
        }
      }
      if (spot) break;
    }
    if (!spot) {
      // Always terminates with a free spot: above everything placed so far.
      const topMost = placed.reduce((m, p) => Math.min(m, p.y), baseY + it.h);
      spot = { x: Math.round(it.anchor.x - it.w / 2), y: topMost - it.h - BUBBLE_GAP };
    }
    placed.push({ x: spot.x, y: spot.y, w: it.w, h: it.h });
    out.set(it.id, spot);
  }
  return out;
}
