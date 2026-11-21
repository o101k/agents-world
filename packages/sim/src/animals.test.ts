import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR, type Intent } from '@aw/shared';
import { findFreePlot } from './land.ts';
import { clothingWarmth, penAnimals } from './animals.ts';
import { interactionTiles, invalidateMapCaches } from './spatial.ts';
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
  const s = createWorldState({ seed: 'animals', mapSize: 'small' });
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

/** A finished pen of its own, next to the market, owned by `ownerId`. */
function addPen(state: WorldState, ownerId: string): string {
  const market = state.map.objects.find((o) => o.kind === 'market')!;
  const plot = findFreePlot(state, { x: market.x, y: market.y }, 3, 3, true)!;
  const id = `pen-${state.map.objects.filter((o) => o.kind === 'pen').length + 1}`;
  state.map.objects.push({
    id,
    kind: 'pen',
    x: plot.x,
    y: plot.y,
    w: 3,
    h: 3,
    door: { x: plot.x + 1, y: plot.y + 2 },
  });
  state.owners[id] = [ownerId];
  invalidateMapCaches(state.map);
  return id;
}

/** Jump to just before the next 06:00 and step over it, so the daily upkeep runs once. */
function nextMorning(state: WorldState): void {
  const day = Math.floor(state.tick / TICKS_PER_DAY);
  state.tick = day * TICKS_PER_DAY + 6 * TICKS_PER_HOUR - 1;
  step(state, []);
}

describe('animals', () => {
  it('buying a hen and tending puts it in the pen', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.money = 100;
    const penId = addPen(s, 'a1');
    run(s, 'a1', [{ type: 'buy', item: 'hen', quantity: 1 }, { type: 'tend_animals' }], 800);
    expect(a.inventory.hen).toBeUndefined();
    expect(penAnimals(s, penId)).toEqual({ hens: 1, sheep: 0 });
  });

  it('refuses to tend without a pen, or a pen that is not theirs', () => {
    const s = fresh();
    run(s, 'a1', [{ type: 'tend_animals' }], 50);
    expect(
      s.agents.find((x) => x.id === 'a1')!.memories.some((m) => m.text === 'I have no animal pen.'),
    ).toBe(true);
    // Someone who doesn't live with a1 owns it.
    const me = s.agents.find((x) => x.id === 'a1')!;
    const stranger = s.agents.find((x) => x.alive && x.id !== 'a1' && x.homeId !== me.homeId)!;
    const penId = addPen(s, stranger.id);
    run(s, 'a1', [{ type: 'tend_animals', objectId: penId }], 50);
    expect(
      s.agents
        .find((x) => x.id === 'a1')!
        .memories.some((m) => m.text === "That pen isn't mine to tend."),
    ).toBe(true);
  });

  it('tending with fodder after 6 hours gives eggs; a second tend within 6 hours gives nothing', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    const penId = addPen(s, 'a1');
    s.pens[penId] = { hens: 8, sheep: 0, wool: 0, lastTendedTick: s.tick - 7 * TICKS_PER_HOUR };
    a.inventory = { vegetables: 2 };
    run(s, 'a1', [{ type: 'tend_animals', objectId: penId }], 800);
    const eggs = a.inventory.eggs ?? 0;
    expect(eggs).toBeGreaterThan(0);
    expect(a.inventory.vegetables).toBe(1);

    run(s, 'a1', [{ type: 'tend_animals', objectId: penId }], 800);
    expect(a.inventory.eggs ?? 0).toBe(eggs);
    expect(a.inventory.vegetables).toBe(1);
  });

  it('a pen neglected for three days loses an animal', () => {
    const s = fresh();
    const penId = addPen(s, 'a1');
    s.pens[penId] = { hens: 2, sheep: 0, wool: 0, lastTendedTick: s.tick - 3 * TICKS_PER_DAY };
    nextMorning(s);
    expect(penAnimals(s, penId)).toEqual({ hens: 1, sheep: 0 });
  });

  it('a tended pen breeds over a few days', () => {
    const s = fresh();
    const penId = addPen(s, 'a1');
    s.pens[penId] = { hens: 2, sheep: 2, wool: 0, lastTendedTick: s.tick };
    for (let day = 0; day < 10; day++) {
      s.pens[penId]!.lastTendedTick = s.tick;
      nextMorning(s);
    }
    const now = penAnimals(s, penId);
    expect(now.hens + now.sheep).toBeGreaterThan(4);
  });

  it('warm clothes lower the cold', () => {
    const s = fresh();
    const a = s.agents.find((x) => x.id === 'a1')!;
    expect(clothingWarmth(a)).toBe(1);
    a.inventory.clothes = 1;
    expect(clothingWarmth(a)).toBeLessThan(1);
  });

  it('craft clothes at the workshop turns 3 wool into 1 clothes', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'workshop');
    a.inventory = { wool: 3 };
    run(s, 'a1', [{ type: 'craft', recipe: 'clothes' }]);
    expect(a.inventory.wool).toBeUndefined();
    expect(a.inventory.clothes).toBe(1);
  });

  it('frequent re-tending does not reset lastTendedTick or grant farming XP', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    const penId = addPen(s, 'a1');
    const initialTick = s.tick - 2 * TICKS_PER_HOUR;
    s.pens[penId] = { hens: 8, sheep: 0, wool: 0, lastTendedTick: initialTick };
    const skillBefore = a.skills.farming;
    run(s, 'a1', [{ type: 'tend_animals', objectId: penId }], 800);
    expect(s.pens[penId]!.lastTendedTick).toBe(initialTick);
    expect(a.skills.farming).toBe(skillBefore);
    // Advance past 6 hours since initialTick: now tending produces eggs and updates lastTendedTick.
    s.tick = initialTick + 6 * TICKS_PER_HOUR + 1;
    a.inventory = { vegetables: 1 };
    run(s, 'a1', [{ type: 'tend_animals', objectId: penId }], 800);
    expect(s.pens[penId]!.lastTendedTick).toBeGreaterThan(initialTick);
    expect(a.inventory.eggs ?? 0).toBeGreaterThan(0);
    expect(a.skills.farming).toBeGreaterThan(skillBefore);
  });

  it('animalsTick skips burnt or unfinished pens', () => {
    const s = fresh();
    const penId = addPen(s, 'a1');
    const penObj = s.map.objects.find((o) => o.id === penId)!;
    penObj.progress = 0.3;
    penObj.burntTick = s.tick;
    s.pens[penId] = { hens: 2, sheep: 0, wool: 0, lastTendedTick: s.tick - 5 * TICKS_PER_DAY };
    nextMorning(s);
    expect(penAnimals(s, penId)).toEqual({ hens: 2, sheep: 0 });
  });
});
