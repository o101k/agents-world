import { describe, expect, it } from 'vitest';
import type { Intent } from '@aw/shared';
import { interactionTiles } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { quote } from './market.ts';
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
  const s = createWorldState({ seed: 'econ', mapSize: 'small' });
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

describe('economy', () => {
  it('buys and sells at the market at quoted prices', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.money = 100;
    const q = quote(s.market, 'bread');
    run(s, 'a1', [{ type: 'buy', item: 'bread', quantity: 2 }]);
    expect(a.inventory.bread).toBe(1 + 2); // Maren starts with 1 bread
    expect(a.money).toBe(100 - 2 * q.buy);
    const stockBefore = s.market.stock.fish;
    a.inventory.fish = 3;
    const sq = quote(s.market, 'fish');
    const money = a.money;
    run(s, 'a1', [{ type: 'sell', item: 'fish', quantity: 3 }]);
    expect(a.inventory.fish).toBeUndefined();
    expect(a.money).toBe(money + 3 * sq.sell);
    expect(s.market.stock.fish).toBe(stockBefore + 3);
    expect(a.priceKnowledge).not.toBeNull();
  });

  it('crafts bread at the bakery from wheat', () => {
    const s = fresh();
    const a = placeAt(s, 'a3', 'bakery'); // Elsbeth, cooking 70 → bonus loaf
    a.inventory = { wheat: 3 };
    run(s, 'a3', [{ type: 'craft', recipe: 'bread' }]);
    expect(a.inventory.wheat).toBeUndefined();
    expect(a.inventory.bread).toBe(3);
  });

  it('chops wood from a nearby tree', () => {
    const s = fresh();
    const a = s.agents.find((x) => x.id === 'a5')!;
    run(s, 'a5', [{ type: 'chop_wood' }], 600);
    expect(a.inventory.wood ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('gives gifts and completes an accepted trade offer', () => {
    const s = fresh();
    const giver = s.agents.find((x) => x.id === 'a1')!;
    const taker = s.agents.find((x) => x.id === 'a2')!;
    taker.x = giver.x + 1;
    taker.y = giver.y;
    giver.money = 20;
    run(s, 'a1', [{ type: 'give', agentId: 'a2', gift: { coins: 5 } }]);
    expect(giver.money).toBe(15);
    expect(taker.money).toBe(12 + 5);

    giver.inventory = { vegetables: 4 };
    taker.inventory = { fish: 2 };
    run(s, 'a1', [
      {
        type: 'offer_trade',
        agentId: 'a2',
        give: { item: 'vegetables', quantity: 2 },
        ask: { item: 'fish', quantity: 1 },
      },
    ]);
    expect(s.offers).toHaveLength(1);
    expect(taker.memories.some((m) => m.text.includes('offered me'))).toBe(true);
    const offerId = s.offers[0]!.id;
    run(s, 'a2', [{ type: 'respond_offer', offerId, accept: true }]);
    expect(giver.inventory).toEqual({ vegetables: 2, fish: 1 });
    expect(taker.inventory).toEqual({ fish: 1, vegetables: 2 });
    expect(s.offers).toHaveLength(0);
    expect(giver.memories.some((m) => m.text.includes('accepted my offer'))).toBe(true);
  });

  it('theft moves goods, never creates them', () => {
    const s = fresh();
    const thief = s.agents.find((x) => x.id === 'a7')!;
    const victim = s.agents.find((x) => x.id === 'a3')!;
    thief.x = victim.x + 1;
    thief.y = victim.y;
    const total = thief.money + victim.money;
    run(s, 'a7', [{ type: 'steal', agentId: 'a3' }]);
    expect(thief.money + victim.money).toBe(total);
    expect(thief.memories.some((m) => /steal|stole/.test(m.text))).toBe(true);
  });

  it('violence can kill, and the cause is recorded', () => {
    const s = fresh();
    const attacker = s.agents.find((x) => x.id === 'a5')!;
    const victim = s.agents.find((x) => x.id === 'a8')!;
    victim.x = attacker.x + 1;
    victim.y = attacker.y;
    victim.health = 20;
    for (let i = 0; i < 4 && victim.alive; i++) run(s, 'a5', [{ type: 'attack', agentId: 'a8' }]);
    expect(victim.alive).toBe(false);
    expect(victim.death?.cause).toContain('violence');
    expect(attacker.memories.some((m) => m.text.startsWith('I killed'))).toBe(true);
  });
});
