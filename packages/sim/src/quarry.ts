import type { Intent, MapObject, Point, WorldMap } from '@aw/shared';
import { fullName, remember, type Agent, type TaskAction } from './agent.ts';
import { emit, facingTo, fail, objName, useTools, type Ctx } from './engine.ts';
import { observeWork, train } from './life.ts';
import { interactionTiles, isAt, mapCache } from './spatial.ts';
import type { WorldState } from './world.ts';

/**
 * Quarrying stone from rocks (feature 3 of docs/plans/growing-the-village.md).
 */

/** Stone in a rock when it is first quarried. */
const ROCK_STONE = 6;
const ROCK_REGEN_PER_DAY = 0.5;
/** Rocks are 1×1; a grid of rocks bucketed by 8×8 cells, cached per objects array. */
const CELL = 8;
const rockGrids = new WeakMap<MapObject[], { cols: number; cells: Map<number, MapObject[]> }>();

function rockGrid(map: WorldMap): { cols: number; cells: Map<number, MapObject[]> } {
  let g = rockGrids.get(map.objects);
  if (!g) {
    const cols = Math.ceil(map.width / CELL);
    const cells = new Map<number, MapObject[]>();
    for (const o of mapCache(map).byKind.get('rock') ?? []) {
      const key = Math.floor(o.y / CELL) * cols + Math.floor(o.x / CELL);
      const list = cells.get(key);
      if (list) list.push(o);
      else cells.set(key, [o]);
    }
    g = { cols, cells };
    rockGrids.set(map.objects, g);
  }
  return g;
}

/** Rocks whose tile is within `radius` (Chebyshev) of a point. */
export function rocksNear(map: WorldMap, p: Point, radius: number): MapObject[] {
  const { cols, cells } = rockGrid(map);
  const rows = Math.ceil(map.height / CELL);
  const out: MapObject[] = [];
  const r0 = Math.max(0, Math.floor((p.y - radius) / CELL));
  const r1 = Math.min(rows - 1, Math.floor((p.y + radius) / CELL));
  const c0 = Math.max(0, Math.floor((p.x - radius) / CELL));
  const c1 = Math.min(cols - 1, Math.floor((p.x + radius) / CELL));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const o of cells.get(r * cols + c) ?? []) {
        if (Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) <= radius) out.push(o);
      }
    }
  }
  return out;
}

/** Stone left in a rock: tracked amount, or the full rock if never touched. */
function stoneLeft(state: WorldState, rockId: string): number {
  return state.resources[rockId]?.amount ?? ROCK_STONE;
}

export function startQuarry(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'quarry' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const { map } = state;
  let rock = intent.objectId ? mapCache(map).byId.get(intent.objectId) : undefined;
  if (rock && rock.kind !== 'rock') rock = undefined;
  if (!rock) {
    let best: { o: MapObject; d: number } | null = null;
    for (const o of rocksNear(map, agent, 25)) {
      const d = Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y);
      if (stoneLeft(state, o.id) < 1 || (best && d >= best.d)) continue;
      if (interactionTiles(map, o).length === 0) continue;
      best = { o, d };
    }
    rock = best?.o;
  }
  if (!rock) return fail(ctx, agent, "I couldn't find a rock to quarry nearby.");
  if (stoneLeft(state, rock.id) < 1) return fail(ctx, agent, 'That rock is worked out for now.');
  const tiles = interactionTiles(map, rock);
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, { type: 'quarry', objectId: rock.id }, objName(state, rock.id));
    return;
  }
  if (!isAt(agent, tiles)) return fail(ctx, agent, `I couldn't reach ${objName(state, rock.id)}.`);
  agent.facing = facingTo(agent, rock);
  agent.action = { type: 'task', task: 'quarry', objectId: rock.id, until: state.tick + 45 };
}

export function finishQuarry(ctx: Ctx, agent: Agent, action: TaskAction): void {
  const { state } = ctx;
  agent.action = null;
  const rock = mapCache(state.map).byId.get(action.objectId);
  if (!rock || rock.kind !== 'rock') return fail(ctx, agent, 'The rock I was cutting is gone.');
  const r = (state.resources[rock.id] ??= {
    amount: ROCK_STONE,
    max: ROCK_STONE,
    regenPerDay: ROCK_REGEN_PER_DAY,
    item: 'stone',
  });
  const tools = useTools(ctx, agent);
  const got = Math.min(2 + (tools ? 1 : 0), Math.floor(r.amount));
  if (got <= 0) return fail(ctx, agent, 'That rock is worked out for now.');
  r.amount -= got;
  agent.inventory.stone = (agent.inventory.stone ?? 0) + got;
  ctx.changed.add(rock.id);
  train(agent, 'building', 0.15);
  observeWork(state, agent, 'building');
  emit(ctx, 'quarried', [agent.id], `${fullName(agent)} cut ${got} stone.`, 1, [rock.id]);
  remember(agent, state.tick, `I cut ${got} stone.`, 2);
}
