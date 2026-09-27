import { describe, expect, it } from 'vitest';
import { generateCast } from './generate.ts';
import { buildPerception } from './perception.ts';
import { treesNear } from './spatial.ts';
import { createWorldState, findAgent } from './world.ts';

describe('a big village', () => {
  const cast = generateCast('big', { adults: 120, children: 60 });
  const state = createWorldState({ seed: 'big', mapSize: 'huge', cast });

  it('generates 180 people with unique full names and families kept together', () => {
    expect(state.agents).toHaveLength(180);
    const names = new Set(state.agents.map((a) => `${a.name} ${a.familyName}`));
    expect(names.size).toBe(180);
    for (const a of state.agents) {
      const partner = findAgent(state, a.partnerId);
      if (partner) expect(partner.homeId).toBe(a.homeId);
      for (const parent of [findAgent(state, a.motherId), findAgent(state, a.fatherId)])
        if (parent) expect(parent.homeId).toBe(a.homeId);
    }
  });

  it('has enough houses and farmland for everyone', () => {
    const houses = state.map.objects.filter((o) => o.kind === 'house');
    expect(state.agents.every((a) => a.homeId && houses.some((h) => h.id === a.homeId))).toBe(true);
    expect(state.map.objects.filter((o) => o.kind === 'field').length).toBeGreaterThanOrEqual(25);
  });

  it('always tells people where home and the landmarks are', () => {
    for (const a of state.agents.slice(0, 40)) {
      const p = buildPerception(state, a);
      const kinds = new Set(p.knownPlaces.map((k) => k.kind));
      expect(p.knownPlaces.some((k) => k.id === a.homeId)).toBe(true);
      for (const k of ['market', 'well', 'bakery', 'workshop'])
        expect(kinds.has(k as never)).toBe(true);
    }
  });

  it('finds trees and people quickly', () => {
    const a = state.agents[0]!;
    const brute = state.map.objects.filter(
      (o) => o.kind === 'tree' && Math.abs(o.x - a.x) <= 8 && Math.abs(o.y - a.y) <= 8,
    );
    expect(
      treesNear(state.map, a, 8)
        .map((o) => o.id)
        .sort(),
    ).toEqual(brute.map((o) => o.id).sort());
    expect(findAgent(state, 'a100')?.id).toBe('a100');
    expect(findAgent(state, 'nobody')).toBeUndefined();
  });
});
