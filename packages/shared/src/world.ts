export interface WorldSettings {
  /** In-game days per year of age (the aging slider). */
  daysPerYear: number;
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
}
