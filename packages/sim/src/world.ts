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
  stageOf,
} from '@aw/shared';
import type { Condition } from './conditions.ts';
import { START_CALENDAR, calendarFromTick, type Calendar } from './seasons.ts';
import { initialMarket, type MarketState } from './market.ts';
import type { Agent } from './agent.ts';
import { SAMPLE_CAST, type AgentSpec } from './cast.ts';
import type { Agent as AgentT } from './agent.ts';
import { DEFAULT_BRAIN, languageBaseline } from './cast.ts';
import { addAgent, introduceResidents, linkFamilies } from './population.ts';
import { generateVillageMap } from './mapgen.ts';
import { Rng, type RngState } from './rng.ts';

export const WORLD_STATE_VERSION = 7;

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
  /** Partnership proposals and requests to try for a child, awaiting an answer. */
  requests: { kind: 'proposal' | 'child_request'; from: string; to: string; tick: number }[];
  /** Bumped whenever the map changes (e.g. a new house), so viewers reload it. */
  mapVersion: number;
  /** World events in progress (drought, storm, disease, fires, plenty). */
  conditions: Condition[];
  nextConditionNum: number;
  /** Year and season (advances with the aging slider). */
  calendar: Calendar;
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
  // Enough houses for every household in the cast.
  const households = new Set(cast.map((c) => c.household).filter((h) => h !== undefined)).size;
  const defaultHouses = Math.max(6, Math.round((size * size) / 512));
  const map = generateVillageMap(seed, {
    width: size,
    height: size,
    houses: Math.max(defaultHouses, households + 1),
    // Enough farmland to feed a big village (bigger fields, about one per six people).
    fields: cast.length > 40 ? Math.ceil(cast.length / 6) : size >= 80 ? 5 : 3,
    bigFields: cast.length > 40,
  });
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
    requests: [],
    mapVersion: 0,
    conditions: [],
    nextConditionNum: 1,
    calendar: { ...START_CALENDAR },
  };
  withRng(state, (r) => {
    state.resources = initialResources(map, r);
    for (const spec of cast) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  introduceResidents(state);
  linkFamilies(state, cast);
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

const agentIndexes = new WeakMap<Agent[], { size: number; byId: Map<string, Agent> }>();

/** Look a person up by id (fast; people are only ever added, never removed). */
export function findAgent(state: WorldState, id: string | null | undefined): Agent | undefined {
  if (!id) return undefined;
  let index = agentIndexes.get(state.agents);
  if (!index || index.size !== state.agents.length) {
    index = { size: state.agents.length, byId: new Map(state.agents.map((a) => [a.id, a])) };
    agentIndexes.set(state.agents, index);
  }
  return index.byId.get(id);
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
  if (data.version < 1 || data.version > WORLD_STATE_VERSION) {
    throw new Error(`Unsupported world state version ${data.version}`);
  }
  let state: WorldState = { ...(data as SerializedWorldState), map: decodeMap(data.map) };
  const from = data.version;
  if (from <= 2) state = upgradeV2(state);
  if (from <= 3) state = upgradeV3(state);
  if (from <= 4) state = upgradeV4(state);
  if (from <= 5) state = upgradeV6(state);
  if (from <= 6) {
    // Phase 6 (state v7): seasons.
    state.version = WORLD_STATE_VERSION;
    state.calendar ??= calendarFromTick(state.tick, state.settings.daysPerYear);
  }
  return state;
}

/** Phase 4 → 5 (state v6): memory strength, forgetting, reflection, sickness and world events. */
function upgradeV6(state: WorldState): WorldState {
  state.version = WORLD_STATE_VERSION;
  state.conditions ??= [];
  state.nextConditionNum ??= 1;
  for (const a of state.agents as Partial<AgentT>[]) {
    a.forgotten ??= [];
    a.lastReflectDay ??= -1;
    a.lastChapterAge ??= Math.floor(a.age ?? 0);
    a.sickness ??= null;
    a.immuneUntil ??= 0;
    for (const m of a.memories ?? []) m.strength ??= m.importance;
  }
  return state;
}

/** Phase 3 → 4: families, relationships, aptitude and life-cycle fields. */
function upgradeV4(state: WorldState): WorldState {
  state.version = WORLD_STATE_VERSION;
  state.requests ??= [];
  state.mapVersion ??= 0;
  const rng = new Rng(state.rng);
  for (const a of state.agents as Partial<AgentT>[]) {
    a.motherId ??= null;
    a.fatherId ??= null;
    a.childrenIds ??= [];
    a.partnerId ??= null;
    a.aptitude ??= { physical: 1, craft: 1, social: 1, intellectual: 1 };
    a.constitution ??= 1;
    a.pregnancy ??= null;
    a.will ??= null;
    a.named ??= true;
    a.lastStage ??= stageOf(a.age ?? 30);
    a.lastChildTry ??= -1e9;
    if (a.skills && a.skills.language === undefined)
      a.skills.language = languageBaseline(a.age ?? 30);
    for (const p of Object.values(a.people ?? {})) {
      p.affection ??= 10;
      p.trust ??= 10;
      p.romance ??= 0;
    }
  }
  state.rng = rng.state();
  linkFamilies(state, SAMPLE_CAST);
  return state;
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
    requests: [],
    mapVersion: 0,
    conditions: [],
    nextConditionNum: 1,
    calendar: { ...START_CALENDAR },
  };
  withRng(state, (r) => {
    state.resources = initialResources(state.map, r);
    for (const spec of SAMPLE_CAST) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  introduceResidents(state);
  assignOwnership(state);
  return state;
}
