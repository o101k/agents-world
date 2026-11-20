import type { Agent } from './agent.ts';
import type { WorldState } from './world.ts';

/**
 * One person per tile outdoors. People indoors are inside their building (their x,y is just the
 * door tile) and the dead take no room, so neither counts as an occupant.
 */
export const occupies = (a: Agent): boolean => a.alive && !a.indoorsId;

interface OccupancyIndex {
  tick: number;
  agents: number;
  width: number;
  height: number;
  /** Living outdoor agents indexed by tile key `y * width + x`. */
  byTile: Map<number, Agent[]>;
  /** Last recorded tile key for each indexed agent, for O(1) incremental updates. */
  pos: Map<Agent, number>;
}

const indexes = new WeakMap<WorldState, OccupancyIndex>();

function getIndex(state: WorldState): OccupancyIndex {
  const { width, height } = state.map;
  let idx = indexes.get(state);
  if (
    !idx ||
    idx.tick !== state.tick ||
    idx.agents !== state.agents.length ||
    idx.width !== width ||
    idx.height !== height
  ) {
    const byTile = new Map<number, Agent[]>();
    const pos = new Map<Agent, number>();
    for (const a of state.agents) {
      if (!occupies(a)) continue;
      if (a.x < 0 || a.y < 0 || a.x >= width || a.y >= height) continue;
      const key = a.y * width + a.x;
      const list = byTile.get(key);
      if (list) list.push(a);
      else byTile.set(key, [a]);
      pos.set(a, key);
    }
    idx = { tick: state.tick, agents: state.agents.length, width, height, byTile, pos };
    indexes.set(state, idx);
  }
  return idx;
}

/** Drop the cached occupancy index (call at the start of a tick if external edits occurred). */
export function invalidateOccupancy(state: WorldState): void {
  indexes.delete(state);
}

/** Keep the tick-scoped occupancy index in sync after an agent moves, enters/leaves indoors, or dies. */
export function syncOccupant(state: WorldState, agent: Agent): void {
  const idx = indexes.get(state);
  if (!idx || idx.tick !== state.tick) return;
  const oldKey = idx.pos.get(agent);
  const newKey =
    occupies(agent) && agent.x >= 0 && agent.y >= 0 && agent.x < idx.width && agent.y < idx.height
      ? agent.y * idx.width + agent.x
      : -1;
  if (oldKey === newKey || (oldKey === undefined && newKey < 0)) return;
  if (oldKey !== undefined) {
    const list = idx.byTile.get(oldKey);
    if (list) {
      const i = list.indexOf(agent);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) idx.byTile.delete(oldKey);
    }
    idx.pos.delete(agent);
  }
  if (newKey >= 0) {
    const list = idx.byTile.get(newKey);
    if (list) list.push(agent);
    else idx.byTile.set(newKey, [agent]);
    idx.pos.set(agent, newKey);
  }
}

/** The living outdoor person standing on a tile, if any (`except` is ignored). */
export function occupantAt(
  state: WorldState,
  x: number,
  y: number,
  except?: Agent,
): Agent | undefined {
  const { width, height } = state.map;
  if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
  const list = getIndex(state).byTile.get(y * width + x);
  if (!list) return undefined;
  for (const a of list) {
    if (a !== except && occupies(a)) return a;
  }
  return undefined;
}

/** What a person planning a route sees of the crowd (their own tile counts as free). */
export interface Crowd {
  /** Someone else is on this tile. */
  taken(x: number, y: number): boolean;
  /** Someone else is on this tile and not walking (so they won't move off soon). */
  standing(x: number, y: number): boolean;
}

/**
 * The live crowd for planning: backed by the tick-scoped occupancy index, kept up to date as
 * people move within the tick so nobody ever collides with their own ghost.
 */
export function crowd(state: WorldState, self: Agent): Crowd {
  const idx = getIndex(state);
  const { width, height } = state.map;
  return {
    taken: (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const list = idx.byTile.get(y * width + x);
      if (!list) return false;
      for (const a of list) {
        if (a !== self && occupies(a)) return true;
      }
      return false;
    },
    standing: (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const list = idx.byTile.get(y * width + x);
      if (!list) return false;
      for (const a of list) {
        if (a !== self && occupies(a) && a.action?.type !== 'walk') return true;
      }
      return false;
    },
  };
}
