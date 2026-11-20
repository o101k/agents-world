import { describe, expect, it } from 'vitest';
import { step, type TickInput } from './engine.ts';
import { createWorldState } from './world.ts';

describe('sleep', () => {
  it('a rested person who lies down by day naps for an hour instead of waking every minute', () => {
    const s = createWorldState({ seed: 'sleep-test', mapSize: 'small' });
    for (const a of s.agents) {
      a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
      a.awaiting = null;
    }
    const tobias = s.agents.find((a) => a.name === 'Tobias')!;
    // Two in-game hours from 07:00 in which Tobias goes back to sleep whenever asked;
    // everyone else rests.
    let decisions = 0;
    for (let i = 0; i < 120; i++) {
      const inputs: TickInput[] = [];
      for (const a of s.agents) {
        if (!a.alive || (!a.awaiting && (a !== tobias || i > 0))) continue;
        if (a === tobias) decisions++;
        const plan =
          a === tobias ? [{ type: 'sleep' as const }] : [{ type: 'rest' as const, minutes: 600 }];
        inputs.push({ kind: 'decision', agentId: a.id, decision: { thought: '', goal: '', plan } });
      }
      step(s, inputs);
      if (i === 30) expect(tobias.asleep).toBe(true);
    }
    // Asleep at once, then up and back down about once an hour (it used to be every 2 minutes).
    expect(decisions).toBeLessThanOrEqual(3);
  });

  it('exempts infants from desperate wake and enforces a 30-tick cooldown before desperate auto-wake', () => {
    const s = createWorldState({ seed: 'sleep-desp', mapSize: 'small' });
    for (const a of s.agents) {
      a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
      a.awaiting = null;
    }
    const baby = s.agents.find((a) => a.age < 1)!;
    baby.asleep = true;
    baby.action = { type: 'sleep', since: s.tick - 60 };
    baby.needs.food = 2;
    baby.needs.energy = 20;
    const adult = s.agents.find((a) => a.age >= 18)!;
    adult.asleep = true;
    adult.action = { type: 'sleep', since: s.tick };
    adult.needs.food = 2;
    adult.needs.energy = 0;

    // For the first 29 ticks, neither wakes desperately and adult doesn't get a premature energy floor.
    for (let i = 0; i < 29; i++) step(s, []);
    expect(baby.asleep).toBe(true);
    expect(adult.asleep).toBe(true);
    // On tick 30, adult wakes desperately with energy >= 12 while infant remains asleep.
    step(s, []);
    expect(baby.asleep).toBe(true);
    expect(adult.asleep).toBe(false);
    expect(adult.needs.energy).toBeGreaterThanOrEqual(12);
  });

  it('allows indoor sleep when standing within cheb 1 of home.door and snaps to the door', () => {
    const s = createWorldState({ seed: 'sleep-door', mapSize: 'small' });
    for (const a of s.agents) {
      a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
      a.awaiting = null;
    }
    const a = s.agents.find((x) => x.age >= 18 && x.homeId)!;
    const home = s.map.objects.find((o) => o.id === a.homeId)!;
    a.indoorsId = null;
    a.x = home.door!.x + 1;
    a.y = home.door!.y;
    step(s, [
      {
        kind: 'decision',
        agentId: a.id,
        decision: { thought: '', goal: '', plan: [{ type: 'sleep' }] },
      },
    ]);
    expect(a.asleep).toBe(true);
    expect(a.indoorsId).toBe(home.id);
    expect({ x: a.x, y: a.y }).toEqual(home.door);
  });
});
