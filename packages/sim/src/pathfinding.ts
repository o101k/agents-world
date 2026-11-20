import type { Point } from '@aw/shared';

/** Cost of entering a tile; Infinity means impassable. */
export type CostFn = (x: number, y: number) => number;

class MinHeap {
  private keys: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, prio: number): void {
    const keys = this.keys;
    const prios = this.prios;
    let i = keys.length;
    keys.push(key);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((prios[p] as number) <= prio) break;
      keys[i] = keys[p] as number;
      prios[i] = prios[p] as number;
      i = p;
    }
    keys[i] = key;
    prios[i] = prio;
  }

  pop(): number {
    const keys = this.keys;
    const prios = this.prios;
    const top = keys[0] as number;
    const lastKey = keys.pop() as number;
    const lastPrio = prios.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mPrio = lastPrio;
        if (l < n && (prios[l] as number) < mPrio) {
          m = l;
          mPrio = prios[l] as number;
        }
        if (r < n && (prios[r] as number) < mPrio) m = r;
        if (m === i) break;
        keys[i] = keys[m] as number;
        prios[i] = prios[m] as number;
        i = m;
      }
      keys[i] = lastKey;
      prios[i] = lastPrio;
    }
    return top;
  }
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

let pfCap = 0;
let pfG = new Float64Array(0);
let pfParent = new Int32Array(0);
let pfSeen = new Uint32Array(0);
let pfClosed = new Uint32Array(0);
let pfGen = 0;

function acquireScratch(n: number): number {
  if (pfCap < n) {
    pfCap = n;
    pfG = new Float64Array(n);
    pfParent = new Int32Array(n);
    pfSeen = new Uint32Array(n);
    pfClosed = new Uint32Array(n);
    pfGen = 0;
  }
  pfGen += 1;
  if (pfGen > 0xfffffffe) {
    pfSeen.fill(0);
    pfClosed.fill(0);
    pfGen = 1;
  }
  return pfGen;
}

/**
 * 4-directional A* on a grid. Deterministic: ties are broken by insertion order.
 * Returns the path from start to goal inclusive, or null if unreachable.
 */
export function findPath(
  width: number,
  height: number,
  start: Point,
  goal: Point,
  cost: CostFn,
  minStepCost = 1,
): Point[] | null {
  if (
    start.x < 0 ||
    start.y < 0 ||
    start.x >= width ||
    start.y >= height ||
    goal.x < 0 ||
    goal.y < 0 ||
    goal.x >= width ||
    goal.y >= height
  ) {
    return null;
  }
  const n = width * height;
  const gen = acquireScratch(n);
  const g = pfG;
  const from = pfParent;
  const seen = pfSeen;
  const closed = pfClosed;
  const idx = (x: number, y: number) => y * width + x;
  const h = (x: number, y: number) => (Math.abs(x - goal.x) + Math.abs(y - goal.y)) * minStepCost;

  const s = idx(start.x, start.y);
  const goalIdx = idx(goal.x, goal.y);
  seen[s] = gen;
  g[s] = 0;
  from[s] = -1;
  const open = new MinHeap();
  open.push(s, h(start.x, start.y));

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalIdx) break;
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = idx(nx, ny);
      if (closed[ni] === gen) continue;
      const step = cost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const ng = (g[cur] as number) + step;
      if (seen[ni] !== gen || ng < (g[ni] as number)) {
        seen[ni] = gen;
        g[ni] = ng;
        from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }

  if (seen[goalIdx] !== gen) return null;
  const path: Point[] = [];
  for (let cur = goalIdx; cur !== -1; cur = from[cur] as number) {
    const x = cur % width;
    path.push({ x, y: (cur - x) / width });
  }
  return path.reverse();
}

/**
 * A* to the nearest of several goal tiles (e.g. any tile next to a well).
 * Returns null if none is reachable. If start is a goal, returns [start].
 */
export function findPathToAny(
  width: number,
  height: number,
  start: Point,
  goals: Point[],
  cost: CostFn,
): Point[] | null {
  if (goals.length === 0) return null;
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return null;
  const validGoals = goals.filter((g) => g.x >= 0 && g.y >= 0 && g.x < width && g.y < height);
  if (validGoals.length === 0) return null;
  if (validGoals.some((g) => g.x === start.x && g.y === start.y))
    return [{ x: start.x, y: start.y }];
  const goalSet = new Set(validGoals.map((g) => g.y * width + g.x));
  const n = width * height;
  const gen = acquireScratch(n);
  const g = pfG;
  const from = pfParent;
  const seen = pfSeen;
  const closed = pfClosed;
  const h = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of validGoals)
      best = Math.min(best, Math.abs(x - goal.x) + Math.abs(y - goal.y));
    return best;
  };
  const s = start.y * width + start.x;
  seen[s] = gen;
  g[s] = 0;
  from[s] = -1;
  const open = new MinHeap();
  open.push(s, h(start.x, start.y));
  let found = -1;
  while (open.size > 0) {
    const cur = open.pop();
    if (goalSet.has(cur)) {
      found = cur;
      break;
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni] === gen) continue;
      const step = cost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const ng = (g[cur] as number) + step;
      if (seen[ni] !== gen || ng < (g[ni] as number)) {
        seen[ni] = gen;
        g[ni] = ng;
        from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  if (found < 0) return null;
  const path: Point[] = [];
  for (let cur = found; cur !== -1; cur = from[cur] as number) {
    const x = cur % width;
    path.push({ x, y: (cur - x) / width });
  }
  return path.reverse();
}
