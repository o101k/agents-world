import { Tile, type MapObject, type Point } from '@aw/shared';
import type { FamilyRole } from '@aw/shared';
import type { Agent } from './agent.ts';
import { createAgent, type AgentSpec } from './cast.ts';
import { occupies } from './occupancy.ts';
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
  // Outdoors, nobody shares a tile: take the nearest free one (babies are born indoors).
  const indoors = spec.age < 1 && home?.door;
  if (!indoors) {
    const { width } = state.map;
    const taken = new Set<number>();
    for (const a of state.agents) if (occupies(a)) taken.add(a.y * width + a.x);
    if (taken.has(position.y * width + position.x)) {
      position =
        nearestWalkable(state.map, position, (p) => !taken.has(p.y * width + p.x), 30) ?? position;
    }
  }
  // Newborns, spawned people and cast members without a brain of their own use the world's default.
  const brain = spec.brain ?? state.settings.defaultBrain;
  const agent = createAgent(brain ? { ...spec, brain: { ...brain } } : spec, {
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
  // Babies live indoors at home from the start.
  if (spec.age < 1 && home?.door) agent.indoorsId = home.id;
  state.agents.push(agent);
  return agent;
}

/** Villagers who grew up together know each other; housemates know each other well. */
export function introduceResidents(state: WorldState): void {
  const residents = state.agents.filter(
    (a) => a.alive && Object.keys(a.knowledge).length > 0 && a.homeId,
  );
  for (const a of residents) {
    for (const b of residents) {
      if (a === b || a.people[b.id]) continue;
      const housemates = a.homeId === b.homeId;
      a.people[b.id] = {
        name: b.familyName ? `${b.name} ${b.familyName}` : b.name,
        familiarity: housemates ? 90 : 30,
        affection: housemates ? 50 : 5,
        trust: housemates ? 50 : 10,
        romance: 0,
        lastSeenTick: state.tick,
      };
    }
  }
}

/** Starting cast: connect partners and parents named in the specs, with family roles. */
export function linkFamilies(state: WorldState, cast: AgentSpec[]): void {
  // First names can repeat across families: prefer the same household, then the same family.
  const byName = (name: string, near?: Agent) => {
    const all = state.agents.filter((a) => a.name === name && a.alive);
    return (
      (near && all.find((a) => a.homeId !== null && a.homeId === near.homeId)) ??
      (near && all.find((a) => a.familyName === near.familyName)) ??
      all[0]
    );
  };
  const role = (a: Agent, b: Agent, r: FamilyRole, affection: number) => {
    const p = a.people[b.id];
    if (p) {
      p.role = r;
      p.affection = Math.max(p.affection, affection);
      p.trust = Math.max(p.trust, 60);
      p.familiarity = Math.max(p.familiarity, 90);
    }
  };
  for (const [i, spec] of cast.entries()) {
    // A freshly created world has the cast in order; older saves are matched by name.
    const same = state.agents[i];
    const me =
      same && same.name === spec.name && same.familyName === (spec.familyName ?? '')
        ? same
        : state.agents.find(
            (a) => a.alive && a.name === spec.name && a.familyName === (spec.familyName ?? ''),
          );
    if (!me) continue;
    const partner = spec.partner ? byName(spec.partner, me) : undefined;
    if (partner && partner !== me) {
      me.partnerId = partner.id;
      partner.partnerId = me.id;
      role(me, partner, 'partner', 70);
      role(partner, me, 'partner', 70);
      if (me.people[partner.id]) me.people[partner.id]!.romance = 60;
      if (partner.people[me.id]) partner.people[me.id]!.romance = 60;
    }
    for (const parentName of spec.parents ?? []) {
      const parent = byName(parentName, me);
      if (!parent) continue;
      if (parent.sex === 'female') me.motherId = parent.id;
      else me.fatherId = parent.id;
      if (!parent.childrenIds.includes(me.id)) parent.childrenIds.push(me.id);
      role(me, parent, parent.sex === 'female' ? 'mother' : 'father', 70);
      role(parent, me, 'child', 80);
    }
  }
  // Siblings: share a parent.
  for (const a of state.agents) {
    for (const b of state.agents) {
      if (a === b) continue;
      const shared =
        (a.motherId && a.motherId === b.motherId) || (a.fatherId && a.fatherId === b.fatherId);
      if (shared) role(a, b, 'sibling', 45);
    }
  }
}
