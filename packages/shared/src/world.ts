import type { BrainConfig } from './agent.ts';

export interface WorldSettings {
  /** In-game days per year of age (the aging slider). */
  daysPerYear: number;
  /** Brain given to newborns and spawned people. */
  defaultBrain: BrainConfig;
}

/** Summary of a saved world, shown on the worlds screen. */
export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  createdAt: string;
  updatedAt: string;
  tick: number;
  mapWidth: number;
  mapHeight: number;
  /** Living villagers. */
  population: number;
  /** Whether time is running (it keeps running with no browser open). */
  running: boolean;
  /** Target speed in ticks per second (0 = as fast as possible). */
  speed: number;
  /** AI spending so far in this world (USD), Claude-plan calls at their API-price value. */
  spentUsd: number;
  /** The part of `spentUsd` made on the owner's Claude subscription (not billed, but capped). */
  planUsd: number;
  /** Spending cap; the world pauses when it's reached (USD). */
  capUsd: number;
}

export const DEFAULT_CAP_USD = 1;

/** Speed presets in ticks (in-game minutes) per real second. 0 = as fast as possible. */
export const SPEED_PRESETS = [1, 5, 20, 60, 200, 0] as const;
export const DEFAULT_SPEED = 5;

export function speedLabel(speed: number): string {
  if (speed === 0) return 'Max';
  return `${speed}×`;
}
