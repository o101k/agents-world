import {
  DEFAULT_DAYS_PER_YEAR,
  MAP_SIZES,
  decodeMap,
  encodeMap,
  type MapSize,
  type WireMap,
  type WorldMap,
  type WorldSettings,
} from '@aw/shared';
import { generateVillageMap } from './mapgen.ts';
import { Rng, type RngState } from './rng.ts';

export const WORLD_STATE_VERSION = 1;

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
}

/** JSON-safe form of WorldState, used for snapshots. */
export interface SerializedWorldState {
  version: number;
  seed: string;
  tick: number;
  rng: RngState;
  settings: WorldSettings;
  map: WireMap;
}

export interface CreateWorldOptions {
  seed: string;
  mapSize?: MapSize;
}

export function createWorldState({ seed, mapSize = 'medium' }: CreateWorldOptions): WorldState {
  const size = MAP_SIZES[mapSize];
  return {
    version: WORLD_STATE_VERSION,
    seed,
    tick: 0,
    rng: Rng.fromSeed(`${seed}:world`).state(),
    settings: { daysPerYear: DEFAULT_DAYS_PER_YEAR },
    map: generateVillageMap(seed, { width: size, height: size }),
  };
}

export function serializeWorldState(state: WorldState): SerializedWorldState {
  return { ...state, map: encodeMap(state.map) };
}

export function deserializeWorldState(data: SerializedWorldState): WorldState {
  if (data.version !== WORLD_STATE_VERSION) {
    throw new Error(`Unsupported world state version ${data.version}`);
  }
  return { ...data, map: decodeMap(data.map) };
}
