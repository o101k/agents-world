import {
  DEFAULT_DAYS_PER_YEAR,
  MAP_SIZES,
  TICKS_PER_HOUR,
  decodeMap,
  encodeMap,
  type MapSize,
  type WireMap,
  type WorldMap,
  type Bundle,
  type ItemName,
  type WorldSettings,
} from '@aw/shared';
import { initialMarket, type MarketState } from './market.ts';
import type { Agent } from './agent.ts';
import { SAMPLE_CAST, type AgentSpec } from './cast.ts';
import type { Agent as AgentT } from './agent.ts';
import { DEFAULT_BRAIN } from './cast.ts';
import { addAgent, introduceResidents } from './population.ts';
import { generateVillageMap } from './mapgen.ts';
import { Rng, type RngState } from './rng.ts';

export const WORLD_STATE_VERSION = 4;

/** Regrowing resource on a map object (berries on a bush, crops in a field). */
export interface ResourceState {
  amount: number;
  max: number;
  /** Units regrown per in-game day. */
  regenPerDay: number;
  /** What it yields (fields: wheat or vegetables; trees: wood). */
  item?: ItemName;
}

/** A trade proposal waiting for an answer. */
export interface Offer {
  id: string;
  from: string;
  to: string;
  give: Bundle;
  ask: Bundle;
  createdTick: number;
  expiresTick: number;
}

/**
 * The complete, authoritative state of a world. Everything needed to continue the simulation
 * lives here, so a snapshot of it plus the logged inputs since reproduces the world exactly.
 */
export interface WorldState {
  version: number;
  seed: string;
  tick: number;
  rng: RngState;
  settings: WorldSettings;
  map: WorldMap;
  /** Everyone who has ever lived here, in creation order (the dead stay for history). */
  agents: Agent[];
  resources: Record<string, ResourceState>;
  nextAgentNum: number;
  market: MarketState;
  offers: Offer[];
  nextOfferNum: number;
  /** Owners of buildings by object id (houses: the household; bakery/workshop: their keepers). */
  owners: Record<string, string[]>;
}

/** JSON-safe form of WorldState, used for snapshots. */
export type SerializedWorldState = Omit<WorldState, 'map'> & { map: WireMap };

export interface CreateWorldOptions {
  seed: string;
  mapSize?: MapSize;
  /** Starting people. Defaults to the sample cast. */
  cast?: AgentSpec[];
  /** In-game hour the world starts at. */
  startHour?: number;
}

export function initialResources(map: WorldMap, rng: Rng): Record<string, ResourceState> {
  const resources: Record<string, ResourceState> = {};
  for (const o of map.objects) {
    if (o.kind === 'berry_bush')
      resources[o.id] = { amount: rng.int(2, 5), max: 5, regenPerDay: 3 };
    if (o.kind === 'field') {
      const size = o.w * o.h;
      resources[o.id] = {
        amount: Math.round(size * 0.8),
        max: size * 1.2,
        regenPerDay: size * 0.5,
      };
    }
  }
  return resources;
}

export function createWorldState({
  seed,
  mapSize = 'medium',
  cast = SAMPLE_CAST,
  startHour = 7,
}: CreateWorldOptions): WorldState {
  const size = MAP_SIZES[mapSize];
  const rng = Rng.fromSeed(`${seed}:world`);
  const map = generateVillageMap(seed, { width: size, height: size });
  const state: WorldState = {
    version: WORLD_STATE_VERSION,
    seed,
    tick: startHour * TICKS_PER_HOUR,
    rng: rng.state(),
    settings: { daysPerYear: DEFAULT_DAYS_PER_YEAR, defaultBrain: { ...DEFAULT_BRAIN } },
    map,
    agents: [],
    resources: {},
    nextAgentNum: 1,
    market: initialMarket(),
    offers: [],
    nextOfferNum: 1,
    owners: {},
  };
  withRng(state, (r) => {
    state.resources = initialResources(map, r);
    for (const spec of cast) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  introduceResidents(state);
  assignOwnership(state);
  return state;
}

/** Households own their houses; the baker keeps the bakery and the carpenter the workshop. */
export function assignOwnership(state: WorldState): void {
  for (const a of state.agents) {
    if (!a.alive) continue;
    if (a.homeId) {
      const list = (state.owners[a.homeId] ??= []);
      if (!list.includes(a.id)) list.push(a.id);
    }
    const occ = a.occupation.toLowerCase();
    for (const [kind, word] of [
      ['bakery', 'baker'],
      ['workshop', 'carpenter'],
    ] as const) {
      if (!occ.startsWith(word)) continue;
      const b = state.map.objects.find((o) => o.kind === kind);
      if (b && !state.owners[b.id]?.length) state.owners[b.id] = [a.id];
    }
  }
}

/** Run `fn` with the world's RNG and store the advanced RNG state back. */
export function withRng<T>(state: WorldState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng);
  const out = fn(rng);
  state.rng = rng.state();
  return out;
}

export function serializeWorldState(state: WorldState): SerializedWorldState {
  return { ...state, map: encodeMap(state.map) };
}

export function deserializeWorldState(data: SerializedWorldState | LegacyV1State): WorldState {
  if (data.version === 1) return upgradeV1(data as LegacyV1State);
  if (data.version === 2) {
    return upgradeV3(upgradeV2({ ...(data as SerializedWorldState), map: decodeMap(data.map) }));
  }
  if (data.version === 3)
    return upgradeV3({ ...(data as SerializedWorldState), map: decodeMap(data.map) });
  if (data.version !== WORLD_STATE_VERSION) {
    throw new Error(`Unsupported world state version ${data.version}`);
  }
  return { ...(data as SerializedWorldState), map: decodeMap(data.map) };
}

/** Phase 2 → 3: add the market, trade offers, ownership, field crops and price knowledge. */
function upgradeV3(state: WorldState): WorldState {
  state.version = WORLD_STATE_VERSION;
  state.market ??= initialMarket();
  state.offers ??= [];
  state.nextOfferNum ??= 1;
  state.owners ??= {};
  for (const o of state.map.objects) {
    const r = state.resources[o.id];
    if (o.kind === 'field' && r && !r.item)
      r.item = Number(o.id.split('-')[1] ?? 1) % 2 === 1 ? 'wheat' : 'vegetables';
  }
  for (const a of state.agents as Partial<AgentT>[]) {
    a.priceKnowledge ??= null;
    a.failStreak ??= 0;
  }
  assignOwnership(state);
  return state;
}

/** Phase 1 → 2: add memories, people, speech, spending and the world's default brain. */
function upgradeV2(state: WorldState): WorldState {
  state.version = WORLD_STATE_VERSION;
  state.settings = {
    ...state.settings,
    defaultBrain: state.settings.defaultBrain ?? { ...DEFAULT_BRAIN },
  };
  for (const a of state.agents as Partial<AgentT>[]) {
    a.memories ??= [];
    a.people ??= {};
    a.speech ??= null;
    a.convo ??= {};
    a.spentUsd ??= 0;
    a.decisions ??= 0;
  }
  introduceResidents(state);
  return state;
}

interface LegacyV1State {
  version: 1;
  seed: string;
  tick: number;
  rng: RngState;
  settings: WorldSettings;
  map: WireMap;
}

/** Phase 0 worlds had a map but no people: move in the sample cast. */
function upgradeV1(old: LegacyV1State): WorldState {
  const state: WorldState = {
    version: WORLD_STATE_VERSION,
    seed: old.seed,
    tick: Math.max(old.tick, 7 * TICKS_PER_HOUR),
    rng: old.rng,
    settings: { ...old.settings, defaultBrain: { ...DEFAULT_BRAIN } },
    map: decodeMap(old.map),
    agents: [],
    resources: {},
    nextAgentNum: 1,
    market: initialMarket(),
    offers: [],
    nextOfferNum: 1,
    owners: {},
  };
  withRng(state, (r) => {
    state.resources = initialResources(state.map, r);
    for (const spec of SAMPLE_CAST) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  introduceResidents(state);
  assignOwnership(state);
  return state;
}
