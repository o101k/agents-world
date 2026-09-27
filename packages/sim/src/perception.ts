import { OBJECT_LABELS, Tile, tickToClock, type KnownPlace, type Perception } from '@aw/shared';
import { fullName, type Agent } from './agent.ts';
import { distanceToObject, mapCache, objectsNear } from './spatial.ts';
import type { WorldState } from './world.ts';

const MAX_PLACES = 40;
const HEARING_RADIUS = 8;

function activityOf(a: Agent): string {
  if (a.asleep) return 'sleeping';
  switch (a.action?.type) {
    case 'walk':
      return 'walking';
    case 'gather':
      return 'gathering food';
    case 'eat':
      return 'eating';
    case 'drink':
      return 'drinking';
    case 'rest':
      return 'resting';
    default:
      return 'standing around';
  }
}

/** A few words about where the agent is standing. */
export function describeLocation(state: WorldState, agent: Agent): string {
  const cache = mapCache(state.map);
  if (agent.indoorsId) return `inside ${cache.byId.get(agent.indoorsId)?.name ?? 'a building'}`;
  const near = objectsNear(state.map, agent, 2)
    .filter((o) => o.kind !== 'berry_bush')
    .sort((a, b) => distanceToObject(a, agent) - distanceToObject(b, agent))[0];
  if (near) {
    const name = near.name ?? OBJECT_LABELS[near.kind].toLowerCase();
    if (agent.homeId === near.id) return 'at home (outside the door)';
    return `${distanceToObject(near, agent) === 0 ? 'at' : 'near'} ${name}`;
  }
  const t = state.map.tiles[agent.y * state.map.width + agent.x];
  if (t === Tile.Path) return 'on a path';
  if (t === Tile.Bridge) return 'on the bridge';
  if (t === Tile.Sand) return 'on the riverbank';
  if (t === Tile.Farmland) return 'in a field';
  let trees = 0;
  for (const o of state.map.objects) {
    if (o.kind === 'tree' && Math.abs(o.x - agent.x) <= 2 && Math.abs(o.y - agent.y) <= 2) trees++;
  }
  return trees >= 5 ? 'in the forest' : 'in a meadow';
}

/** Everything one agent senses and knows right now — and nothing else. */
export function buildPerception(state: WorldState, agent: Agent): Perception {
  const clock = tickToClock(state.tick);
  const isNight = clock.hour < 6 || clock.hour >= 21;
  const cache = mapCache(state.map);

  const knownPlaces: KnownPlace[] = [];
  for (const [id, k] of Object.entries(agent.knowledge)) {
    const o = cache.byId.get(id);
    if (!o) continue;
    knownPlaces.push({
      id,
      kind: o.kind,
      name: o.name ?? OBJECT_LABELS[o.kind],
      x: o.x,
      y: o.y,
      distance: distanceToObject(o, agent),
      lastSeenAmount: k.lastSeenAmount,
      lastSeenTick: k.lastSeenTick,
    });
  }
  knownPlaces.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  const senses = agent.alive && !agent.asleep;
  const radius = agent.indoorsId ? 0 : isNight ? 4 : HEARING_RADIUS;
  const visibleAgents = senses
    ? state.agents
        .filter((o) => o !== agent && o.alive && !o.indoorsId)
        .map((o) => ({ o, d: Math.max(Math.abs(o.x - agent.x), Math.abs(o.y - agent.y)) }))
        .filter(({ d }) => d <= radius)
        .sort((a, b) => a.d - b.d)
        .map(({ o, d }) => ({
          id: o.id,
          name: fullName(o),
          x: o.x,
          y: o.y,
          distance: d,
          activity: activityOf(o),
        }))
    : [];

  return {
    agentId: agent.id,
    tick: state.tick,
    clock: { ...clock, isNight },
    trigger: agent.awaiting ?? { kind: 'check_in' },
    self: {
      name: fullName(agent),
      age: Math.floor(agent.age),
      sex: agent.sex,
      occupation: agent.occupation,
      traits: agent.traits,
      background: agent.background,
      needs: { ...agent.needs },
      health: agent.health,
      inventory: { ...agent.inventory },
      money: agent.money,
      position: { x: agent.x, y: agent.y },
      homeId: agent.homeId,
      asleep: agent.asleep,
      indoors: agent.indoorsId !== null,
    },
    location: describeLocation(state, agent),
    visibleAgents,
    knownPlaces: knownPlaces.slice(0, MAX_PLACES),
    recent: agent.recent.map((r) => {
      const c = tickToClock(r.tick);
      return `[Day ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}] ${r.text}`;
    }),
    remainingPlan: [...agent.plan],
  };
}
