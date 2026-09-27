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
  const n = width * height;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const idx = (x: number, y: number) => y * width + x;
  const h = (x: number, y: number) => (Math.abs(x - goal.x) + Math.abs(y - goal.y)) * minStepCost;

  const s = idx(start.x, start.y);
  const goalIdx = idx(goal.x, goal.y);
  g[s] = 0;
  const open = new MinHeap();
  open.push(s, h(start.x, start.y));

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalIdx) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const step = cost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const ng = (g[cur] as number) + step;
      if (ng < (g[ni] as number)) {
        g[ni] = ng;
        from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }

  if (!Number.isFinite(g[goalIdx] as number)) return null;
  const path: Point[] = [];
  for (let cur = goalIdx; cur !== -1; cur = from[cur] as number) {
    const x = cur % width;
    path.push({ x, y: (cur - x) / width });
  }
  return path.reverse();
}
