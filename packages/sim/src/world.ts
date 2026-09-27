import {
  DEFAULT_DAYS_PER_YEAR,
  MAP_SIZES,
  TICKS_PER_HOUR,
  decodeMap,
  encodeMap,
  type MapSize,
  type WireMap,
  type WorldMap,
  type WorldSettings,
} from '@aw/shared';
import type { Agent } from './agent.ts';
import { SAMPLE_CAST, type AgentSpec } from './cast.ts';
import { addAgent } from './population.ts';
import { generateVillageMap } from './mapgen.ts';
import { Rng, type RngState } from './rng.ts';

export const WORLD_STATE_VERSION = 2;

/** Regrowing resource on a map object (berries on a bush, crops in a field). */
export interface ResourceState {
  amount: number;
  max: number;
  /** Units regrown per in-game day. */
  regenPerDay: number;
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
    settings: { daysPerYear: DEFAULT_DAYS_PER_YEAR },
    map,
    agents: [],
    resources: {},
    nextAgentNum: 1,
  };
  withRng(state, (r) => {
    state.resources = initialResources(map, r);
    for (const spec of cast) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  return state;
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
  if (data.version !== WORLD_STATE_VERSION) {
    throw new Error(`Unsupported world state version ${data.version}`);
  }
  return { ...(data as SerializedWorldState), map: decodeMap(data.map) };
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
    settings: old.settings,
    map: decodeMap(old.map),
    agents: [],
    resources: {},
    nextAgentNum: 1,
  };
  withRng(state, (r) => {
    state.resources = initialResources(state.map, r);
    for (const spec of SAMPLE_CAST) addAgent(state, { knowsVillage: true, ...spec }, r);
  });
  return state;
}
