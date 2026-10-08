import { describe, expect, it } from 'vitest';
import { Tile, type Intent, type MapObject } from '@aw/shared';
import { interactionTiles, invalidateMapCaches } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { clearPlot, findFreePlot, nextObjectId } from './land.ts';
import { createWorldState, type WorldState } from './world.ts';

/**
 * Give one agent a plan and keep giving it the same plan whenever it asks again, answering
 * everyone else with a rest, until `done()` or `max` ticks pass.
 */
function runUntil(
  state: WorldState,
  agentId: string,
  plan: Intent[],
  done: () => boolean,
  max = 3000,
): void {
  let first = true;
  for (let i = 0; i < max && !done(); i++) {
    const inputs: TickInput[] = [];
    for (const a of state.agents) {
      if (!a.alive) continue;
      if (a.id === agentId && (first || a.awaiting)) {
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
  }
}

/** Let the whole village rest for a number of ticks (crops grow, nobody is needed). */
function idle(state: WorldState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = [];
    for (const a of state.agents) {
      if (a.alive && a.awaiting) {
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
        });
      }
    }
    step(state, inputs);
  }
}

function fresh(): WorldState {
  const s = createWorldState({ seed: 'farm', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

/** Put an agent on a free patch of grass near the market, out of the way of buildings. */
function placeNearMarket(state: WorldState, id: string): void {
  const market = state.map.objects.find((o) => o.kind === 'market')!;
  const a = state.agents.find((x) => x.id === id)!;
  a.x = market.x;
  a.y = market.y + market.h + 2;
  a.indoorsId = null;
  a.asleep = false;
}

/** Add a finished or unfinished field owned by someone, on free land near the agent. */
function addField(state: WorldState, ownerId: string, progress?: number): MapObject {
  const owner = state.agents.find((x) => x.id === ownerId)!;
  const spot = findFreePlot(state, { x: owner.x, y: owner.y }, 4, 3, false)!;
  clearPlot(state, spot, 4, 3);
  const id = nextObjectId(state, 'field');
  const field: MapObject = {
    id,
    kind: 'field',
    x: spot.x,
    y: spot.y,
    w: 4,
    h: 3,
    name: `Field ${id.split('-')[1]}`,
  };
  if (progress !== undefined) field.progress = progress;
  state.map.objects.push(field);
  state.owners[id] = [ownerId];
  invalidateMapCaches(state.map);
  state.mapVersion += 1;
  return field;
}

function ownedFields(state: WorldState, ownerId: string): MapObject[] {
  return state.map.objects.filter(
    (o) => o.kind === 'field' && state.owners[o.id]?.includes(ownerId),
  );
}

describe('farming', () => {
  it('clears a field of one’s own into farmland', () => {
    const s = fresh();
    placeNearMarket(s, 'a1');
    runUntil(s, 'a1', [{ type: 'clear_field' }], () =>
      ownedFields(s, 'a1').some((f) => f.progress === undefined),
    );
    const field = ownedFields(s, 'a1')[0]!;
    expect(field.progress).toBeUndefined();
    expect(s.owners[field.id]).toContain('a1');
    for (const t of interactionTiles(s.map, field)) {
      expect(s.map.tiles[t.y * s.map.width + t.x]).toBe(Tile.Farmland);
    }
    const a = s.agents.find((x) => x.id === 'a1')!;
    expect(a.recent.some((m) => m.text.includes('cleared a field of my own'))).toBe(true);
  });

  it('will not own a third field', () => {
    const s = fresh();
    placeNearMarket(s, 'a1');
    addField(s, 'a1');
    addField(s, 'a1', 0.5);
    runUntil(s, 'a1', [{ type: 'clear_field' }], () => false, 200);
    expect(ownedFields(s, 'a1')).toHaveLength(2);
    const a = s.agents.find((x) => x.id === 'a1')!;
    expect(a.recent.some((m) => m.text.includes('two fields'))).toBe(true);
  });

  it('sowing needs 2 seed and makes the field grow that crop', () => {
    const s = fresh();
    placeNearMarket(s, 'a1');
    const field = addField(s, 'a1');
    const a = s.agents.find((x) => x.id === 'a1')!;
    a.inventory = { wheat: 1 };
    runUntil(s, 'a1', [{ type: 'sow', item: 'wheat' }], () => false, 150);
    expect(s.resources[field.id]).toBeUndefined();
    expect(a.inventory.wheat).toBe(1);

    a.inventory = { wheat: 3 };
    runUntil(s, 'a1', [{ type: 'sow', item: 'wheat' }], () => s.resources[field.id] !== undefined);
    expect(s.resources[field.id]?.item).toBe('wheat');
    expect(s.resources[field.id]?.amount).toBe(0);
    expect(a.inventory.wheat).toBe(1);

    idle(s, 24 * 60);
    expect(s.resources[field.id]!.amount).toBeGreaterThan(0);
  });

  it('an owner nearby notices a stranger taking from the field', () => {
    const s = fresh();
    placeNearMarket(s, 'a1');
    const field = addField(s, 'a1');
    s.resources[field.id] = { amount: 10, max: 14, regenPerDay: 6, item: 'wheat' };
    const owner = s.agents.find((x) => x.id === 'a1')!;
    const thief = s.agents.find((x) => x.id === 'a2')!;
    thief.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    thief.x = owner.x + 1;
    thief.y = owner.y;
    thief.indoorsId = null;
    thief.asleep = false;
    const before = owner.people[thief.id]?.trust ?? 0;
    runUntil(
      s,
      'a2',
      [{ type: 'gather', objectId: field.id }],
      () => thief.recent.some((m) => m.text.includes('from')),
      400,
    );
    expect(
      owner.recent.some((m) => m.text.includes('take') && m.text.includes('from my field')),
    ).toBe(true);
    expect(owner.people[thief.id]!.trust).toBeLessThan(before);
    expect(thief.recent.some((m) => m.text.includes('field'))).toBe(true);
  });

  it('a child cannot clear land', () => {
    const s = fresh();
    placeNearMarket(s, 'a1');
    const a = s.agents.find((x) => x.id === 'a1')!;
    a.age = 8;
    runUntil(s, 'a1', [{ type: 'clear_field' }], () => false, 200);
    expect(ownedFields(s, 'a1')).toHaveLength(0);
  });
});
