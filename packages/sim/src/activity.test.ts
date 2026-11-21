import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '@aw/shared';
import { nearestKnown, step } from './engine.ts';
import { invalidateMapCaches } from './spatial.ts';
import { buildPerception } from './perception.ts';
import { agentDetail, agentView } from './views.ts';
import { TREE_WOOD, createWorldState, resourceAmount } from './world.ts';

function fresh() {
  const s = createWorldState({ seed: 'activity', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

describe('activity of people', () => {
  it('maps building to working and chopping to gathering', () => {
    const s = fresh();
    const a = s.agents[0]!;
    a.asleep = false;
    a.action = { type: 'build', objectId: 'x', until: 10 };
    expect(agentView(a).activity).toBe('working');
    a.action = { type: 'chop', objectId: 'x', until: 10 };
    expect(agentView(a).activity).toBe('gathering');
  });

  it('agentDetail shows each task action accurately instead of Resting', () => {
    const s = fresh();
    const a = s.agents[0]!;
    a.asleep = false;
    for (const [task, prefix] of [
      ['clear_field', 'Clearing '],
      ['sow', 'Sowing '],
      ['quarry', 'Quarrying '],
      ['tend_animals', 'Tending '],
    ] as const) {
      a.action = { type: 'task', task, objectId: 'obj-1', until: s.tick + 10 };
      expect(agentDetail(s, a).currentAction).toBe(`${prefix}obj-1`);
    }
  });

  it('buildPerception skips rocksNearby and treesNearby when indoors (radius === 0)', () => {
    const s = fresh();
    const a = s.agents[0]!;
    const tree = s.map.objects.find((o) => o.kind === 'tree')!;
    a.x = tree.x;
    a.y = tree.y;
    a.asleep = false;
    a.indoorsId = a.homeId ?? 'house-1';
    const p = buildPerception(s, a);
    expect(p.treesNearby).toBe(0);
    expect(p.rocksNearby).toBeUndefined();
  });

  it('nearestKnown breaks distance ties deterministically by ASCII id', () => {
    const s = fresh();
    const a = s.agents[0]!;
    a.x = 10;
    a.y = 10;
    s.map.objects.push(
      { id: 'well-z', kind: 'well', x: 12, y: 10, w: 1, h: 1 },
      { id: 'well-a', kind: 'well', x: 8, y: 10, w: 1, h: 1 },
    );
    invalidateMapCaches(s.map);
    a.knowledge = {
      'well-z': { lastSeenTick: s.tick },
      'well-a': { lastSeenTick: s.tick },
    };
    expect(nearestKnown(s, a, ['well'])).toBe('well-a');
  });

  it('shows a nearby woodcutter as chopping wood to others', () => {
    const s = fresh();
    s.tick = TICKS_PER_DAY * 2 + 12 * TICKS_PER_HOUR;
    const [viewer, cutter] = s.agents as [(typeof s.agents)[0], (typeof s.agents)[0]];
    for (const a of [viewer, cutter]) {
      a.asleep = false;
      a.indoorsId = null;
    }
    cutter.x = viewer.x;
    cutter.y = viewer.y;
    cutter.action = { type: 'chop', objectId: 'x', until: s.tick + 30 };
    const seen = buildPerception(s, viewer).visibleAgents.find((v) => v.id === cutter.id);
    expect(seen?.activity).toBe('chopping wood');
  });
});

describe('regrown trees', () => {
  it('are reported as changed, dropped from tracking, and read as full', () => {
    const s = fresh();
    const tree = s.map.objects.find((o) => o.kind === 'tree')!;
    s.resources[tree.id] = { amount: 3.99, max: 4, regenPerDay: 1, item: 'wood' };
    const changed = new Set<string>();
    for (let i = 0; i < TICKS_PER_HOUR + 1; i++) {
      for (const id of step(s, []).changedResources) changed.add(id);
    }
    expect(changed.has(tree.id)).toBe(true);
    expect(s.resources[tree.id]).toBeUndefined();
    expect(resourceAmount(s, tree.id)).toBe(TREE_WOOD);
  });
});
