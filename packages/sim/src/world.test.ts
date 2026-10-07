import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash.ts';
import { step } from './engine.ts';
import {
  WORLD_STATE_VERSION,
  createWorldState,
  deserializeWorldState,
  serializeWorldState,
} from './world.ts';

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
    expect(state.agents.length).toBe(11);
    expect(state.agents.every((a) => a.homeId)).toBe(true);
    const maren = state.agents.find((a) => a.name === 'Maren')!;
    const tobias = state.agents.find((a) => a.name === 'Tobias')!;
    const lise = state.agents.find((a) => a.name === 'Lise')!;
    expect(maren.partnerId).toBe(tobias.id);
    expect(lise.motherId).toBe(maren.id);
    expect(lise.fatherId).toBe(tobias.id);
    expect(maren.people[lise.id]?.role).toBe('child');
    expect(lise.people[maren.id]?.role).toBe('mother');
    expect(state.map.width).toBe(64);
    expect(state.settings.daysPerYear).toBe(4);
  });

  it('upgrades a v8 save to the growing village (v9)', () => {
    const data = JSON.parse(
      JSON.stringify(serializeWorldState(createWorldState({ seed: 'v8', mapSize: 'small' }))),
    );
    data.version = 8;
    for (const k of [
      'stalls',
      'pens',
      'contracts',
      'nextContractNum',
      'meetings',
      'nextMeetingNum',
      'nextProposalNum',
      'rules',
      'nextRuleNum',
      'leaderId',
      'treasury',
    ])
      delete data[k];
    for (const item of ['stone', 'eggs', 'wool', 'clothes', 'hen', 'sheep'])
      delete data.market.stock[item];
    for (const a of data.agents) {
      delete a.knownMeetings;
      delete a.noticeBoard;
    }
    const state = deserializeWorldState(data);
    expect(state.version).toBe(WORLD_STATE_VERSION);
    expect(state.stalls).toEqual({});
    expect(state.contracts).toEqual([]);
    expect(state.leaderId).toBeNull();
    expect(state.treasury).toBe(0);
    expect(state.market.stock.hen).toBeGreaterThan(0);
    expect(state.agents.every((a) => Array.isArray(a.knownMeetings))).toBe(true);
    for (let i = 0; i < 30; i++) step(state);
  });
});
