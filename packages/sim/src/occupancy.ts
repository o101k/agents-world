import type { Agent } from './agent.ts';
import type { WorldState } from './world.ts';

/**
 * One person per tile outdoors. People indoors are inside their building (their x,y is just the
 * door tile) and the dead take no room, so neither counts as an occupant.
 */
export const occupies = (a: Agent): boolean => a.alive && !a.indoorsId;

/** The living outdoor person standing on a tile, if any (`except` is ignored). */
export function occupantAt(
  state: WorldState,
  x: number,
  y: number,
  except?: Agent,
): Agent | undefined {
  for (const a of state.agents) {
    if (a !== except && a.x === x && a.y === y && occupies(a)) return a;
  }
  return undefined;
}

/** Who stands where, for planning: 0 = free, 1 = someone standing, 2 = someone walking. */
interface Grid {
  tick: number;
  agents: number;
  width: number;
  cells: Uint8Array;
}
const grids = new WeakMap<WorldState, Grid>();

/** What a person planning a route sees of the crowd (their own tile counts as free). */
export interface Crowd {
  /** Someone else is on this tile. */
  taken(x: number, y: number): boolean;
  /** Someone else is on this tile and not walking (so they won't move off soon). */
  standing(x: number, y: number): boolean;
}

/**
 * The crowd as of the start of this tick's planning (built once per tick: people move a tile at
 * most per tick, and walking itself always checks the real tile). Only for path costs and goals.
 */
export function crowd(state: WorldState, self: Agent): Crowd {
  const { width, height } = state.map;
  let g = grids.get(state);
  if (!g || g.tick !== state.tick || g.agents !== state.agents.length || g.width !== width) {
    const cells = new Uint8Array(width * height);
    for (const a of state.agents) {
      if (occupies(a)) cells[a.y * width + a.x] = a.action?.type === 'walk' ? 2 : 1;
    }
    g = { tick: state.tick, agents: state.agents.length, width, cells };
    grids.set(state, g);
  }
  const cells = g.cells;
  const own = self.y * width + self.x;
  return {
    taken: (x, y) => {
      const i = y * width + x;
      return i !== own && cells[i] !== 0;
    },
    standing: (x, y) => {
      const i = y * width + x;
      return i !== own && cells[i] === 1;
    },
  };
}
