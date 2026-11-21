import { describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR, type Intent } from '@aw/shared';
import { interactionTiles } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
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
  const s = createWorldState({ seed: 'construction', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

function placeAt(state: WorldState, id: string, kind: string) {
  const o = state.map.objects.find((x) => x.kind === kind)!;
  const t = interactionTiles(state.map, o)[0]!;
  const a = state.agents.find((x) => x.id === id)!;
  a.x = t.x;
  a.y = t.y;
  return a;
}

/** Keep one builder at it until the building is finished (or give up after `max` stretches). */
function buildUntilDone(state: WorldState, id: string, plan: Intent[], max = 40): void {
  for (let i = 0; i < max; i++) {
    // A long build spans many days; keep the builder fed so the test is about building.
    const me = state.agents.find((a) => a.id === id)!;
    me.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    run(state, id, plan);
    if (!state.map.objects.some((o) => o.progress !== undefined && o.kind !== 'field')) return;
  }
}

/** The newest object of a kind (the one a build just placed). */
function newest(state: WorldState, kind: string) {
  const all = state.map.objects.filter((o) => o.kind === kind);
  return all[all.length - 1]!;
}

function count(state: WorldState, kind: string): number {
  return state.map.objects.filter((o) => o.kind === kind).length;
}

function recalled(state: WorldState, id: string, text: string): boolean {
  return state.agents.find((a) => a.id === id)!.memories.some((m) => m.text.includes(text));
}

describe('construction', () => {
  it('a skilled builder raises a bakery that craft bread can then use', () => {
    const s = fresh();
    const a = placeAt(s, 'a3', 'market'); // Elsbeth, the baker
    a.skills.building = 100;
    a.inventory = { planks: 60, wheat: 3 };
    const before = count(s, 'bakery');
    buildUntilDone(s, 'a3', [{ type: 'build', building: 'bakery' }]);
    expect(count(s, 'bakery')).toBe(before + 1);
    const bakery = newest(s, 'bakery');
    expect(bakery.name).toBe(`Bakery ${bakery.id.slice('bakery-'.length)}`);
    expect(bakery.progress).toBeUndefined();
    expect(s.owners[bakery.id]).toContain('a3');
    run(s, 'a3', [{ type: 'craft', recipe: 'bread' }]);
    expect(a.inventory.bread).toBeGreaterThanOrEqual(2);
  });

  it('low skill cannot start a bakery', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 10;
    a.inventory = { planks: 30 };
    const before = count(s, 'bakery');
    run(s, 'a1', [{ type: 'build', building: 'bakery' }]);
    expect(count(s, 'bakery')).toBe(before);
    expect(recalled(s, 'a1', "I don't know enough about building to start a bakery.")).toBe(true);
  });

  it('a well needs stone', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 30;
    a.inventory = { planks: 10 };
    const before = count(s, 'well');
    run(s, 'a1', [{ type: 'build', building: 'well' }]);
    expect(count(s, 'well')).toBe(before);
    expect(recalled(s, 'a1', 'I need 3 stone to start building.')).toBe(true);

    a.inventory = { stone: 30 };
    buildUntilDone(s, 'a1', [{ type: 'build', building: 'well' }]);
    expect(count(s, 'well')).toBe(before + 1);
    const well = newest(s, 'well');
    expect(well.progress).toBeUndefined();
    expect(well.stone).toBe(true);
  });

  it('stonework makes a house stone-built, and fire cannot take hold of it', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 100;
    a.inventory = { planks: 60, stone: 40 };
    buildUntilDone(s, 'a1', [{ type: 'build', building: 'house' }]);
    const stoneHouse = newest(s, 'house');
    expect(stoneHouse.progress).toBeUndefined();
    expect(stoneHouse.stone).toBe(true);

    // A wooden house, for contrast, does catch fire when targeted.
    const b = placeAt(s, 'a2', 'market');
    b.skills.building = 100;
    b.inventory = { planks: 60 };
    buildUntilDone(s, 'a2', [{ type: 'build', building: 'house' }]);
    const woodHouse = newest(s, 'house');
    expect(woodHouse.stone).toBeUndefined();

    const fire = (targetId: string) =>
      step(s, [
        {
          kind: 'world_event',
          event: { kind: 'fire', intensity: 0.8, hours: 2, targetId },
        },
      ]);
    fire(stoneHouse.id);
    expect(s.conditions.some((c) => c.kind === 'fire' && c.targetId === stoneHouse.id)).toBe(false);
    fire(woodHouse.id);
    expect(s.conditions.some((c) => c.kind === 'fire' && c.targetId === woodHouse.id)).toBe(true);
  });

  it('an animal pen creates its state', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 20;
    a.inventory = { planks: 40 };
    buildUntilDone(s, 'a1', [{ type: 'build', building: 'pen' }]);
    const pen = newest(s, 'pen');
    expect(pen.progress).toBeUndefined();
    expect(s.pens[pen.id]).toEqual({
      hens: 0,
      sheep: 0,
      wool: 0,
      lastTendedTick: s.tick - 6 * TICKS_PER_HOUR,
    });
  });

  it('a market stall creates its state', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 20;
    a.inventory = { planks: 20 };
    buildUntilDone(s, 'a1', [{ type: 'build', building: 'stall' }]);
    const stall = newest(s, 'stall');
    expect(stall.progress).toBeUndefined();
    expect(s.stalls[stall.id]).toEqual({ stock: {} });
  });

  it('build_house still builds a house', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 60;
    a.inventory = { planks: 40 };
    const before = count(s, 'house');
    buildUntilDone(s, 'a1', [{ type: 'build_house' }]);
    expect(count(s, 'house')).toBe(before + 1);
    const house = newest(s, 'house');
    expect(house.name).toBe(`House ${house.id.slice('house-'.length)}`);
    expect(house.progress).toBeUndefined();
    expect(house.door).toEqual({ x: house.x + 1, y: house.y + 2 });
  });

  it('interrupting a build stretch does not destroy materials or increment workDone', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.skills.building = 60;
    a.inventory = { planks: 20, stone: 10 };
    // Start site and walk to it until build action starts.
    let started = false;
    let first = true;
    for (let i = 0; i < 300; i++) {
      const inputs: TickInput[] = [];
      for (const ag of s.agents) {
        if (!ag.alive) continue;
        if (ag.id === 'a1' && first) {
          inputs.push({
            kind: 'decision',
            agentId: 'a1',
            decision: { thought: '', goal: '', plan: [{ type: 'build', building: 'house' }] },
          });
        } else if (ag.awaiting) {
          inputs.push({
            kind: 'decision',
            agentId: ag.id,
            decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
          });
        }
      }
      first = false;
      step(s, inputs);
      if (a.action?.type === 'build') {
        started = true;
        break;
      }
    }
    expect(started).toBe(true);
    const site = newest(s, 'house');
    // Interrupt mid-stretch: materials and workDone must be untouched.
    a.action = null;
    expect(a.inventory.planks).toBe(20);
    expect(a.inventory.stone).toBe(10);
    expect(site.workDone).toBe(0);
    expect(site.stoneWork).toBe(0);
  });

  it('rebuilding a burnt bakery via build_house uses bakery material costs (siteInfo)', () => {
    const s = fresh();
    const bakery = s.map.objects.find((o) => o.kind === 'bakery')!;
    const a = s.agents.find((x) => x.id === 'a3')!;
    s.owners[bakery.id] = [a.id];
    bakery.progress = 0.5;
    bakery.burntTick = s.tick;
    a.x = bakery.door!.x;
    a.y = bakery.door!.y + 1;
    a.indoorsId = null;
    // Bakery requires 3 planks per stretch whereas house requires 2 planks.
    a.inventory = { planks: 2 };
    run(s, a.id, [{ type: 'build_house' }], 20);
    expect(a.recent.some((r) => r.text.includes('3 planks'))).toBe(true);
    expect(a.inventory.planks).toBe(2);
  });
});
