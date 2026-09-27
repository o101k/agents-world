import { Tile, type MapObject, type Point } from '@aw/shared';
import type { Agent } from './agent.ts';
import { createAgent, type AgentSpec } from './cast.ts';
import type { Rng } from './rng.ts';
import { distanceToObject, isWalkable, nearestWalkable } from './spatial.ts';
import type { WorldState } from './world.ts';

const VILLAGE_KINDS = new Set(['house', 'bakery', 'workshop', 'market', 'well', 'field', 'dock']);

export function houses(state: WorldState): MapObject[] {
  return state.map.objects.filter((o) => o.kind === 'house');
}

/** Where newcomers arrive: the road at the east edge of the map. */
export function arrivalPoint(state: WorldState): Point {
  const { map } = state;
  const x = map.width - 1;
  for (let d = 0; d < map.height; d++) {
    for (const y of [Math.floor(map.height / 2) + d, Math.floor(map.height / 2) - d]) {
      if (y >= 0 && y < map.height && map.tiles[y * map.width + x] === Tile.Path) return { x, y };
    }
  }
  return nearestWalkable(map, { x, y: Math.floor(map.height / 2) }, () => true) ?? { x: 0, y: 0 };
}

/** Adds a person to the world. Deterministic given the RNG. */
export function addAgent(state: WorldState, spec: AgentSpec, rng: Rng): Agent {
  const id = `a${state.nextAgentNum++}`;
  const homes = houses(state);
  let homeId = spec.homeId ?? null;
  if (homeId === null && spec.household !== undefined)
    homeId = homes[spec.household % Math.max(1, homes.length)]?.id ?? null;
  const home = homeId ? state.map.objects.find((o) => o.id === homeId) : undefined;

  let position = spec.position ?? home?.door ?? arrivalPoint(state);
  if (!isWalkable(state.map, position.x, position.y)) {
    position =
      nearestWalkable(state.map, position, (p) => isWalkable(state.map, p.x, p.y)) ?? position;
  }
  const agent = createAgent(spec, {
    id,
    tick: state.tick,
    rng,
    position,
    homeId: home?.id ?? null,
  });

  if (spec.knowsVillage) {
    for (const o of state.map.objects) {
      const nearHome =
        home && o.kind === 'berry_bush' && distanceToObject(o, home.door ?? home) <= 12;
      if (VILLAGE_KINDS.has(o.kind) || nearHome) {
        agent.knowledge[o.id] = {
          lastSeenTick: state.tick,
          lastSeenAmount: state.resources[o.id]
            ? Math.floor(state.resources[o.id]!.amount)
            : undefined,
        };
      }
    }
  }
  agent.awaiting = { kind: 'spawned' };
  state.agents.push(agent);
  return agent;
}
