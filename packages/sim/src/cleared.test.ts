import { describe, expect, it } from 'vitest';
import { step } from './engine.ts';
import { clearPlot } from './land.ts';
import { createWorldState, type WorldState } from './world.ts';

function fresh(): WorldState {
  const s = createWorldState({ seed: 'cleared', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
    a.action = { type: 'rest', until: s.tick + 600 };
  }
  return s;
}

/** Someone is mid-way through working at `kind` when a building plot clears it away. */
function clearedMidWork(kind: 'berry_bush' | 'tree', action: 'gather' | 'chop') {
  const s = fresh();
  const o = s.map.objects.find((x) => x.kind === kind)!;
  const a = s.agents[0]!;
  a.inventory = {};
  a.action = { type: action, objectId: o.id, until: s.tick + 1 };
  clearPlot(s, { x: o.x, y: o.y }, 1, 1);
  expect(s.map.objects.some((x) => x.id === o.id)).toBe(false);
  step(s, []);
  step(s, []);
  return a;
}

describe('work at something that was cleared away', () => {
  it('gathering at a bush that was cleared fails instead of crashing', () => {
    const a = clearedMidWork('berry_bush', 'gather');
    expect(a.inventory.berries ?? 0).toBe(0);
    expect(a.recent.map((r) => r.text)).toContain('What I was gathering from is gone.');
  });

  it('chopping a tree that was cleared gives no wood', () => {
    const a = clearedMidWork('tree', 'chop');
    expect(a.inventory.wood ?? 0).toBe(0);
    expect(a.recent.map((r) => r.text)).toContain('The tree I was chopping is gone.');
  });
});
