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

  it('starts at tick 0 with default settings', () => {
    const state = createWorldState({ seed: 'x' });
    expect(state.tick).toBe(0);
    expect(state.map.width).toBe(64);
    expect(state.settings.daysPerYear).toBe(4);
  });
});
