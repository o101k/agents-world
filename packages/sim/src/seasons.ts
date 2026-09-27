import { SEASONS, TICKS_PER_DAY, type CalendarView, type Season } from '@aw/shared';
import { emit, type Ctx } from './engine.ts';
import type { WorldState } from './world.ts';

/** Where the world is in its year. A year lasts as long as a year of age (the aging slider). */
export interface Calendar {
  year: number;
  /** 0–1 through the year: spring, summer, autumn, winter in turn. */
  progress: number;
}

/** Worlds begin in early spring of year 1. */
export const START_CALENDAR: Calendar = { year: 1, progress: 0.02 };

export function seasonOf(calendar: Calendar): Season {
  return SEASONS[Math.min(3, Math.floor(calendar.progress * 4))]!;
}

/** How each season changes the world. */
export const SEASON_EFFECTS: Record<
  Season,
  { growth: number; woodGrowth: number; nightCold: number; dayWarmth: number; heat: number }
> = {
  spring: { growth: 1.1, woodGrowth: 1.2, nightCold: 1, dayWarmth: 1, heat: 0 },
  summer: { growth: 1.3, woodGrowth: 1, nightCold: 0.5, dayWarmth: 1, heat: 0.15 },
  autumn: { growth: 0.9, woodGrowth: 0.8, nightCold: 1.25, dayWarmth: 0.8, heat: 0 },
  winter: { growth: 0.15, woodGrowth: 0.3, nightCold: 1.8, dayWarmth: 0.4, heat: 0 },
};

export function calendarView(state: WorldState): CalendarView {
  return {
    year: state.calendar.year,
    season: seasonOf(state.calendar),
    progress: Math.round(state.calendar.progress * 1000) / 1000,
  };
}

export function seasonEffects(state: WorldState) {
  return SEASON_EFFECTS[seasonOf(state.calendar)];
}

const ANNOUNCE: Record<Season, string> = {
  spring: 'Spring has come: the days are milder and things begin to grow again.',
  summer: 'Summer is here: warm nights, long days and fast-growing crops.',
  autumn: 'Autumn: the nights are drawing in cold, and growth is slowing.',
  winter: 'Winter has come: bitter nights, and almost nothing grows until spring.',
};

/** Advance the calendar by one tick (in step with aging), announcing new seasons and years. */
export function calendarTick(ctx: Ctx, ageStep: number): void {
  const c = ctx.state.calendar;
  const before = seasonOf(c);
  c.progress += ageStep;
  if (c.progress >= 1) {
    c.progress -= 1;
    c.year += 1;
    emit(ctx, 'season', [], `Year ${c.year} begins.`, 3);
  }
  const now = seasonOf(c);
  if (now !== before) emit(ctx, 'season', [], ANNOUNCE[now], 3);
}

/** What someone can tell about the season (for the prompt). */
export function describeSeason(state: WorldState): string {
  const s = seasonOf(state.calendar);
  const within = (state.calendar.progress * 4) % 1;
  const when = within < 0.25 ? 'early' : within > 0.75 ? 'late' : 'mid';
  const feel: Record<Season, string> = {
    spring: 'mild days, cool nights; plants are growing again',
    summer: 'warm days and nights; crops and berries grow fast',
    autumn: 'cold nights; growth is slowing — winter is coming',
    winter: 'bitterly cold nights; almost nothing grows until spring',
  };
  return `It is ${when} ${s} of year ${state.calendar.year}: ${feel[s]}.`;
}

/** For old saves: a calendar consistent with how long the world has run. */
export function calendarFromTick(tick: number, daysPerYear: number): Calendar {
  const years = tick / TICKS_PER_DAY / daysPerYear + START_CALENDAR.progress;
  return { year: 1 + Math.floor(years), progress: years % 1 };
}
