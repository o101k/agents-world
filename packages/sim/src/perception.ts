import {
  OBJECT_LABELS,
  Tile,
  stageOf,
  tickToClock,
  type KnownPlace,
  type Perception,
} from '@aw/shared';
import { ABILITIES } from './life.ts';
import type { Agent, Memory } from './agent.ts';
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

const COLOR_NAMES: [string, [number, number, number]][] = [
  ['red', [192, 80, 77]],
  ['blue', [79, 129, 189]],
  ['green', [110, 160, 90]],
  ['purple', [128, 100, 162]],
  ['orange', [247, 150, 70]],
  ['teal', [75, 172, 198]],
  ['beige', [216, 200, 160]],
  ['pink', [160, 90, 138]],
  ['grey-blue', [90, 106, 138]],
  ['mustard', [200, 160, 64]],
  ['brown', [138, 74, 58]],
];

function colorName(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255];
  let best = 'plain';
  let bestD = Infinity;
  for (const [name, c] of COLOR_NAMES) {
    const d = (c[0] - rgb[0]!) ** 2 + (c[1] - rgb[1]!) ** 2 + (c[2] - rgb[2]!) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** How someone looks to a stranger. */
export function describeStranger(a: Agent): string {
  const age =
    a.age < 2
      ? 'a baby'
      : a.age < 13
        ? `a ${a.sex === 'female' ? 'girl' : 'boy'}`
        : a.age < 20
          ? `a young ${a.sex === 'female' ? 'woman' : 'man'}`
          : a.age < 55
            ? `a ${a.sex === 'female' ? 'woman' : 'man'}`
            : `an old ${a.sex === 'female' ? 'woman' : 'man'}`;
  return `a stranger — ${age} in a ${colorName(a.appearance.shirt)} shirt`;
}

/** What a person is called from `viewer`'s point of view. */
export function nameAsKnown(viewer: Agent, other: Agent): string {
  return viewer.people[other.id]?.name ?? describeStranger(other);
}

const RECALL: Record<string, number> = { frugal: 6, standard: 12, deep: 20 };

/**
 * Memories that come to mind: importance, recency (fading over a few in-game days) and relevance
 * to who is around, who is talking and the current goal. The newest few (already in working
 * memory) are skipped.
 */
export function recall(
  state: WorldState,
  agent: Agent,
  present: string[],
  limit: number,
): Memory[] {
  const recentTicks = new Set(agent.recent.map((r) => r.tick));
  const goalWords = new Set(
    agent.goal
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3),
  );
  const presentSet = new Set(present);
  const scored = agent.memories
    .filter((m) => !recentTicks.has(m.tick))
    .map((m) => {
      const hoursAgo = (state.tick - m.tick) / 60;
      let score = m.importance / 10 + Math.pow(0.99, hoursAgo);
      if (m.people.some((p) => presentSet.has(p))) score += 1;
      if (
        goalWords.size &&
        m.text
          .toLowerCase()
          .split(/[^a-z]+/)
          .some((w) => goalWords.has(w))
      )
        score += 0.5;
      return { m, score };
    });
  scored.sort((a, b) => b.score - a.score || b.m.tick - a.m.tick);
  return scored.slice(0, limit).map((s) => s.m);
}

function stamp(tick: number): string {
  const c = tickToClock(tick);
  return `[Day ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}]`;
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
      ...(state.resources[id]?.item ? { produce: state.resources[id]!.item } : {}),
      ...(ownerLabel(state, agent, id) ? { owner: ownerLabel(state, agent, id)! } : {}),
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
          name: nameAsKnown(agent, o),
          x: o.x,
          y: o.y,
          distance: d,
          activity: activityOf(o),
        }))
    : [];
  const trigger = agent.awaiting ?? { kind: 'check_in' as const };
  const present = visibleAgents.map((v) => v.id);
  if (trigger.kind === 'spoken_to') present.push(trigger.fromId);
  const memories = recall(state, agent, present, RECALL[agent.brain.effort] ?? 8).map(
    (m) => `${stamp(m.tick)} ${m.text}`,
  );
  const knownPeople = Object.entries(agent.people)
    .filter(([id, p]) => p.name && state.agents.find((a) => a.id === id)?.alive)
    .map(([id, p]) => ({
      id,
      name: p.name!,
      familiarity: Math.round(p.familiarity),
      affection: Math.round(p.affection ?? 0),
      trust: Math.round(p.trust ?? 0),
      romance: Math.round(p.romance ?? 0),
      ...(p.role ? { role: p.role } : {}),
      lastSeenTick: p.lastSeenTick,
    }))
    .sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || b.familiarity - a.familiarity)
    .slice(0, 30);
  const find = (id: string | null) => (id ? state.agents.find((a) => a.id === id) : undefined);
  const partner = find(agent.partnerId);
  const sees = (o: Agent) =>
    senses &&
    (Math.max(Math.abs(o.x - agent.x), Math.abs(o.y - agent.y)) <= radius ||
      (o.indoorsId !== null && o.x === agent.x && o.y === agent.y));
  const family = {
    partner: partner?.alive ? { id: partner.id, name: nameAsKnown(agent, partner) } : null,
    children: agent.childrenIds
      .map(find)
      .filter((c): c is Agent => Boolean(c?.alive))
      .map((c) => ({
        id: c.id,
        name: nameAsKnown(agent, c),
        age: Math.floor(c.age),
        nearby: sees(c),
        ...(sees(c) ? { needs: { ...c.needs } } : {}),
      })),
    parents: [find(agent.motherId), find(agent.fatherId)]
      .filter((p): p is Agent => Boolean(p))
      .map((p) => ({ id: p.id, name: nameAsKnown(agent, p), alive: p.alive })),
  };
  const requests = state.requests
    .filter((r) => r.to === agent.id)
    .map((r) => ({ kind: r.kind, fromId: r.from, fromName: nameAsKnown(agent, find(r.from)!) }));

  return {
    agentId: agent.id,
    tick: state.tick,
    clock: { ...clock, isNight },
    trigger,
    self: {
      name: agent.familyName ? `${agent.name} ${agent.familyName}` : agent.name,
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
    recent: agent.recent.map((r) => `${stamp(r.tick)} ${r.text}`),
    memories,
    knownPeople,
    personality: { ...agent.personality },
    effort: agent.brain.effort,
    remainingPlan: [...agent.plan],
    marketPrices: agent.priceKnowledge
      ? { tick: agent.priceKnowledge.tick, prices: { ...agent.priceKnowledge.prices } }
      : null,
    offers: state.offers
      .filter((o) => o.to === agent.id || o.from === agent.id)
      .map((o) => {
        const from = state.agents.find((a) => a.id === o.from)!;
        const to = state.agents.find((a) => a.id === o.to)!;
        return {
          id: o.id,
          fromId: o.from,
          fromName: o.from === agent.id ? 'you' : nameAsKnown(agent, from),
          toId: o.to,
          toName: o.to === agent.id ? 'you' : nameAsKnown(agent, to),
          give: o.give,
          ask: o.ask,
          expiresTick: o.expiresTick,
        };
      }),
    treesNearby: senses ? countTrees(state, agent, isNight ? 4 : 8) : 0,
    stage: stageOf(agent.age),
    canDo: ABILITIES[stageOf(agent.age)],
    family,
    pregnant: Boolean(agent.pregnancy?.known),
    language: Math.round(agent.skills.language ?? 100),
    requests,
  };
}

function countTrees(state: WorldState, agent: Agent, radius: number): number {
  let n = 0;
  for (const o of state.map.objects) {
    if (o.kind === 'tree' && Math.abs(o.x - agent.x) <= radius && Math.abs(o.y - agent.y) <= radius)
      n++;
  }
  return n;
}

/** Who owns a building, as this agent would name them. */
function ownerLabel(state: WorldState, agent: Agent, objectId: string): string | null {
  const owners = state.owners[objectId];
  if (!owners?.length) return null;
  if (owners.includes(agent.id)) return 'you';
  const names = owners
    .map((id) => state.agents.find((a) => a.id === id))
    .filter((a): a is Agent => Boolean(a))
    .map((a) => agent.people[a.id]?.name ?? null)
    .filter(Boolean);
  return names.length ? names.join(' & ') : 'someone you don’t know';
}
