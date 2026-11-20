import { describe, expect, it } from 'vitest';
import { ITEM_NAMES, type Intent } from '@aw/shared';
import { interactionTiles } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { MARKET_TARGET, quote } from './market.ts';
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
  it('buys and sells at the market at marginal quoted prices', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    a.money = 100;
    // Compute expected unit-by-unit buy total for 2 bread.
    const breadSim = { stock: { ...s.market.stock } };
    let expectedBuy = 0;
    for (let i = 0; i < 2; i++) {
      expectedBuy += quote(breadSim, 'bread').buy;
      breadSim.stock.bread -= 1;
    }
    run(s, 'a1', [{ type: 'buy', item: 'bread', quantity: 2 }]);
    expect(a.inventory.bread).toBe(1 + 2); // Maren starts with 1 bread
    expect(a.money).toBe(100 - expectedBuy);
    const stockBefore = s.market.stock.fish;
    a.inventory.fish = 3;
    const fishSim = { stock: { ...s.market.stock } };
    let expectedSell = 0;
    for (let i = 0; i < 3; i++) {
      expectedSell += quote(fishSim, 'fish').sell;
      fishSim.stock.fish += 1;
    }
    const money = a.money;
    run(s, 'a1', [{ type: 'sell', item: 'fish', quantity: 3 }]);
    expect(a.inventory.fish).toBeUndefined();
    expect(a.money).toBe(money + expectedSell);
    expect(s.market.stock.fish).toBe(stockBefore + 3);
    expect(a.priceKnowledge).not.toBeNull();
  });

  it('buying N units and selling N units back never yields net profit for any item or stock', () => {
    for (const item of ITEM_NAMES) {
      const target = MARKET_TARGET[item];
      for (const startStock of [1, target, target * 2, target * 3]) {
        for (const qty of [1, 3, target, target * 2]) {
          const s = fresh();
          const a = placeAt(s, 'a1', 'market');
          s.market.stock[item] = startStock;
          a.money = 10_000;
          a.inventory = {};
          run(s, 'a1', [{ type: 'buy', item, quantity: qty }]);
          const bought = a.inventory[item] ?? 0;
          if (bought === 0) continue;
          run(s, 'a1', [{ type: 'sell', item, quantity: bought }]);
          expect(a.inventory[item] ?? 0).toBe(0);
          expect(a.money).toBeLessThan(10_000);
          expect(s.market.stock[item]).toBe(startStock);
        }
      }
    }
  });

  it('market buy stops when coins run out mid-purchase', () => {
    const s = fresh();
    const a = placeAt(s, 'a1', 'market');
    s.market.stock.sheep = 3;
    // Price rises as stock drops: give enough for 1 sheep plus less than the 2nd sheep's price.
    const first = quote(s.market, 'sheep').buy;
    const sim = { stock: { ...s.market.stock, sheep: 2 } };
    const second = quote(sim, 'sheep').buy;
    a.money = first + second - 1;
    a.inventory = {};
    run(s, 'a1', [{ type: 'buy', item: 'sheep', quantity: 3 }]);
    expect(a.inventory.sheep).toBe(1);
    expect(a.money).toBe(second - 1);
    expect(s.market.stock.sheep).toBe(2);
  });

  it('respond_offer prunes offers from dead senders immediately', () => {
    const s = fresh();
    const giver = s.agents.find((x) => x.id === 'a1')!;
    const taker = s.agents.find((x) => x.id === 'a2')!;
    taker.x = giver.x + 1;
    taker.y = giver.y;
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
    const offerId = s.offers[0]!.id;
    giver.alive = false;
    run(s, 'a2', [{ type: 'respond_offer', offerId, accept: true }]);
    expect(s.offers).toHaveLength(0);
  });

  it('crafts bread at the bakery from wheat', () => {
    const s = fresh();
    const a = placeAt(s, 'a3', 'bakery'); // Elsbeth, cooking 70 → bonus loaf
    a.inventory = { wheat: 3 };
    run(s, 'a3', [{ type: 'craft', recipe: 'bread' }]);
    expect(a.inventory.wheat).toBeUndefined();
    expect(a.inventory.bread).toBe(3);
  });

  it('chops wood from a nearby tree, reports changedResources, and lets young onlookers learn', () => {
    const s = fresh();
    const a = s.agents.find((x) => x.id === 'a5')!;
    const tree = s.map.objects.find(
      (o) => o.kind === 'tree' && interactionTiles(s.map, o).length > 0,
    )!;
    const tile = interactionTiles(s.map, tree)[0]!;
    a.x = tile.x;
    a.y = tile.y;
    a.indoorsId = null;
    a.skills.building = 40;
    const child = s.agents.find((x) => x.age >= 3 && x.age < 18)!;
    child.x = tile.x + 1;
    child.y = tile.y;
    child.indoorsId = null;
    child.asleep = false;
    child.skills.building = 0;
    const changed = new Set<string>();
    let first = true;
    for (let i = 0; i < 60 && (a.inventory.wood ?? 0) === 0; i++) {
      const inputs: TickInput[] = [];
      for (const ag of s.agents) {
        if (!ag.alive) continue;
        if (ag.id === a.id && first) {
          inputs.push({
            kind: 'decision',
            agentId: a.id,
            decision: { thought: '', goal: '', plan: [{ type: 'chop_wood', objectId: tree.id }] },
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
      for (const id of step(s, inputs).changedResources) changed.add(id);
    }
    expect(a.inventory.wood ?? 0).toBeGreaterThanOrEqual(2);
    expect(changed.has(tree.id)).toBe(true);
    expect(child.skills.building).toBeGreaterThan(0);
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
