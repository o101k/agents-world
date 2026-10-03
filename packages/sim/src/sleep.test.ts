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
});
