import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash.ts';
import { createWorldState, deserializeWorldState, serializeWorldState } from './world.ts';

describe('world state', () => {
  it('round-trips through serialization', () => {
    const state = createWorldState({ seed: 'roundtrip', mapSize: 'small' });
    const json = JSON.stringify(serializeWorldState(state));
    const back = deserializeWorldState(JSON.parse(json));
    expect(fnv1a(JSON.stringify(serializeWorldState(back)))).toBe(fnv1a(json));
    expect(back.map.tiles).toEqual(state.map.tiles);
  });

  it('starts at 07:00 on day 1 with the sample cast and default settings', () => {
    const state = createWorldState({ seed: 'x' });
    expect(state.tick).toBe(7 * 60);
    expect(state.agents.length).toBe(8);
    expect(state.agents.every((a) => a.homeId)).toBe(true);
    expect(state.map.width).toBe(64);
    expect(state.settings.daysPerYear).toBe(4);
  });
});
