import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '@aw/shared';
import { step } from './engine.ts';
import { buildPerception } from './perception.ts';
import { calendarView, seasonOf } from './seasons.ts';
import { createWorldState, deserializeWorldState, serializeWorldState } from './world.ts';

const fresh = () => {
  const s = createWorldState({ seed: 'seasons', mapSize: 'small' });
  for (const a of s.agents) a.awaiting = null;
  return s;
};

describe('seasons', () => {
  it('turn with the aging slider: a year of seasons per year of age', () => {
    const s = fresh();
    expect(calendarView(s)).toMatchObject({ year: 1, season: 'spring' });
    const seen: string[] = [];
    for (let i = 0; i < s.settings.daysPerYear * TICKS_PER_DAY; i++) {
      const { events } = step(s, []);
      for (const e of events) if (e.kind === 'season') seen.push(e.text.split(/[ :]/)[0]!);
    }
    expect(seen).toEqual(['Summer', 'Autumn', 'Winter', 'Year', 'Spring']);
    expect(s.calendar.year).toBe(2);
    // Twice as many days per year: seasons last twice as long.
    s.settings.daysPerYear *= 2;
    const before = s.calendar.progress;
    for (let i = 0; i < TICKS_PER_DAY; i++) step(s, []);
    expect(s.calendar.progress - before).toBeCloseTo(1 / s.settings.daysPerYear, 5);
  });

  it('winter slows growth and makes nights bitter; people can tell the season', () => {
    const grow = (progress: number) => {
      const s = fresh();
      s.calendar.progress = progress;
      const bush = Object.values(s.resources).find((r) => r.max === 5)!;
      bush.amount = 0;
      const maren = s.agents[0]!;
      maren.x = maren.x + 3; // outside, awake, at night
      s.tick = TICKS_PER_DAY + 22 * TICKS_PER_HOUR;
      maren.needs.warmth = 100;
      for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) {
        step(s, []);
        maren.asleep = false;
        maren.awaiting = null;
        maren.action = { type: 'rest', until: s.tick + 100 };
      }
      return { growth: bush.amount, warmth: maren.needs.warmth, p: buildPerception(s, maren) };
    };
    const spring = grow(0.1);
    const winter = grow(0.85);
    expect(seasonOf({ year: 1, progress: 0.85 })).toBe('winter');
    expect(winter.growth).toBeLessThan(spring.growth / 3);
    expect(100 - winter.warmth).toBeGreaterThan((100 - spring.warmth) * 1.5);
    expect(winter.p.conditions[0]).toMatch(/winter/);
    expect(winter.p.season).toBe('winter');
  });

  it('gives old saves a calendar', () => {
    const s = fresh();
    s.tick = 10 * TICKS_PER_DAY;
    const old = JSON.parse(JSON.stringify(serializeWorldState(s)));
    old.version = 6;
    delete old.calendar;
    const up = deserializeWorldState(old);
    expect(up.version).toBe(7);
    expect(up.calendar.year).toBe(3); // 10 days at 4 days a year
  });
});
