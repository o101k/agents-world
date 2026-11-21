/** One tick is one in-game minute. */
export const MINUTES_PER_TICK = 1;
export const TICKS_PER_HOUR = 60;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

/** Default aging speed: how many in-game days make one year of age. Adjustable per world. */
export const DEFAULT_DAYS_PER_YEAR = 4;
export const MIN_DAYS_PER_YEAR = 1;
export const MAX_DAYS_PER_YEAR = 60;

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** Where a world is in its year (a year lasts as long as a year of age). */
export interface CalendarView {
  year: number;
  season: Season;
  /** 0–1 through the year. */
  progress: number;
}

export interface GameClock {
  day: number;
  hour: number;
  minute: number;
}

export function tickToClock(tick: number): GameClock {
  const safe = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const day = Math.floor(safe / TICKS_PER_DAY);
  const minuteOfDay = (safe - day * TICKS_PER_DAY) * MINUTES_PER_TICK;
  return { day: day + 1, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
}

export function formatClock(tick: number): string {
  const { day, hour, minute } = tickToClock(tick);
  return `Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
