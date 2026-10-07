import { describe, expect, it } from 'vitest';
import type { Intent, MapObject } from '@aw/shared';
import { interactionTiles, invalidateMapCaches } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { rocksNear } from './quarry.ts';
import { createWorldState, type WorldState } from './world.ts';

/** Give one agent a plan and run until it's done (or `max` ticks), answering others with rest. */
function run(state: WorldState, agentId: string, plan: Intent[], max = 400): void {
  let first = true;
  for (let i = 0; i < max; i++) {
    const inputs: TickInput[] = [];
    for (const a of state.agents) {
      if (!a.alive) continue;
      if (a.id === agentId && first) {
        inputs.push({ kind: 'decision', agentId, decision: { thought: '', goal: '', plan } });
      } else if (a.awaiting) {
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
        });
      }
    }
    first = false;
    step(state, inputs);
    const me = state.agents.find((a) => a.id === agentId)!;
    if (i > 2 && !me.action && me.plan.length === 0) return;
  }
}

function fresh(): WorldState {
  const s = createWorldState({ seed: 'quarry', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

/** Put an agent on one of a rock's interaction tiles, with no stone, tools or other goods. */
function standBy(state: WorldState, id: string, rock: MapObject) {
  const t = interactionTiles(state.map, rock)[0]!;
  const a = state.agents.find((x) => x.id === id)!;
  a.x = t.x;
  a.y = t.y;
  a.inventory = {};
  return a;
}

function firstRock(state: WorldState): MapObject {
  const rock = state.map.objects.find((o) => o.kind === 'rock');
  if (!rock) throw new Error('test map has no rocks');
  return rock;
}

describe('quarry', () => {
  it('rocksNear finds rocks within the radius and no others', () => {
    const s = fresh();
    const rock = firstRock(s);
    const found = rocksNear(s.map, { x: rock.x, y: rock.y }, 0);
    expect(found.map((o) => o.id)).toContain(rock.id);
    for (const o of found) {
      expect(o.kind).toBe('rock');
      expect(Math.max(Math.abs(o.x - rock.x), Math.abs(o.y - rock.y))).toBe(0);
    }
    const wide = rocksNear(s.map, { x: rock.x, y: rock.y }, 40);
    expect(wide.length).toBeGreaterThanOrEqual(found.length);
    for (const o of wide) {
      expect(Math.max(Math.abs(o.x - rock.x), Math.abs(o.y - rock.y))).toBeLessThanOrEqual(40);
    }
  });

  it('cutting stone takes it from the rock and depletes the rock', () => {
    const s = fresh();
    const rock = firstRock(s);
    const a = standBy(s, 'a1', rock);
    run(s, 'a1', [{ type: 'quarry', objectId: rock.id }]);
    expect(a.inventory.stone).toBe(2); // no tools: two stone
    expect(s.resources[rock.id]!.amount).toBe(6 - 2);
    expect(s.resources[rock.id]!.item).toBe('stone');
    expect(a.skills.building ?? 0).toBeGreaterThan(0);
  });

  it('carrying tools cuts one more stone', () => {
    const s = fresh();
    const rock = firstRock(s);
    const a = standBy(s, 'a1', rock);
    a.inventory = { tools: 1 };
    run(s, 'a1', [{ type: 'quarry', objectId: rock.id }]);
    expect(a.inventory.stone).toBe(3);
    expect(s.resources[rock.id]!.amount).toBe(6 - 3);
  });

  it('a nearly empty rock gives what is left, then reports it is worked out', () => {
    const s = fresh();
    const rock = firstRock(s);
    s.resources[rock.id] = { amount: 1, max: 6, regenPerDay: 0.5, item: 'stone' };
    const a = standBy(s, 'a1', rock);
    run(s, 'a1', [{ type: 'quarry', objectId: rock.id }]);
    expect(a.inventory.stone).toBe(1);
    expect(s.resources[rock.id]!.amount).toBe(0);

    run(s, 'a1', [{ type: 'quarry', objectId: rock.id }]);
    expect(a.inventory.stone).toBe(1);
    expect(a.recent.map((r) => r.text)).toContain('That rock is worked out for now.');
  });

  it('fails when there is no rock nearby', () => {
    const s = fresh();
    s.map.objects = s.map.objects.filter((o) => o.kind !== 'rock');
    invalidateMapCaches(s.map);
    const a = s.agents.find((x) => x.id === 'a1')!;
    run(s, 'a1', [{ type: 'quarry' }]);
    expect(a.inventory.stone ?? 0).toBe(0);
    expect(a.recent.map((r) => r.text)).toContain("I couldn't find a rock to quarry nearby.");
  });
});
