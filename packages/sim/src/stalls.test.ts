import { describe, expect, it } from 'vitest';
import type { Intent, MapObject } from '@aw/shared';
import { interactionTiles, invalidateMapCaches } from './spatial.ts';
import { look, step, type TickInput } from './engine.ts';
import { findFreePlot } from './land.ts';
import { stallListing } from './stalls.ts';
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
  const s = createWorldState({ seed: 'stalls', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}

/** Add a finished stall of `ownerId`'s next to the market (no stall exists at the start). */
function addStall(state: WorldState, ownerId: string): MapObject {
  const market = state.map.objects.find((o) => o.kind === 'market')!;
  const spot = findFreePlot(state, { x: market.x, y: market.y }, 2, 1, false)!;
  const stall: MapObject = {
    id: 'stall1',
    kind: 'stall',
    x: spot.x,
    y: spot.y,
    w: 2,
    h: 1,
    name: 'Market stall 1',
  };
  state.map.objects.push(stall);
  state.owners[stall.id] = [ownerId];
  invalidateMapCaches(state.map);
  state.mapVersion += 1;
  return stall;
}

function placeAt(state: WorldState, id: string, o: MapObject) {
  const t = interactionTiles(state.map, o)[0]!;
  const a = state.agents.find((x) => x.id === id)!;
  a.x = t.x;
  a.y = t.y;
  return a;
}

describe('market stalls', () => {
  it('stocks goods from the bag at the owner’s price', () => {
    const s = fresh();
    const stall = addStall(s, 'a1');
    const a = placeAt(s, 'a1', stall);
    a.inventory = { bread: 4 };
    run(s, 'a1', [{ type: 'stock_stall', item: 'bread', quantity: 3, price: 9 }]);
    expect(a.inventory.bread).toBe(1);
    expect(s.stalls[stall.id]!.stock.bread).toEqual({ quantity: 3, price: 9 });
    expect(stallListing(s, stall.id)).toEqual([{ item: 'bread', quantity: 3, price: 9 }]);
  });

  it('buys from someone else’s stall, limited by stock and money', () => {
    const s = fresh();
    const stall = addStall(s, 'a2');
    s.stalls[stall.id] = { stock: { eggs: { quantity: 3, price: 4 } } };
    const seller = s.agents.find((x) => x.id === 'a2')!;
    const buyer = placeAt(s, 'a1', stall);
    buyer.money = 10;
    buyer.inventory = {};
    const sellerMoney = seller.money;
    run(s, 'a1', [{ type: 'buy_from_stall', objectId: stall.id, item: 'eggs', quantity: 5 }]);
    // Money allows 2 eggs (10 / 4), stock has 3, the buyer asked for 5.
    expect(buyer.inventory.eggs).toBe(2);
    expect(buyer.money).toBe(2);
    expect(seller.money).toBe(sellerMoney + 8);
    expect(s.stalls[stall.id]!.stock.eggs).toEqual({ quantity: 1, price: 4 });
    expect(seller.memories.some((m) => m.text.includes('bought 2 eggs at my stall'))).toBe(true);
  });

  it('will not let someone buy from their own stall', () => {
    const s = fresh();
    const stall = addStall(s, 'a1');
    s.stalls[stall.id] = { stock: { eggs: { quantity: 3, price: 4 } } };
    const a = placeAt(s, 'a1', stall);
    a.money = 50;
    a.inventory = {};
    const money = a.money;
    run(s, 'a1', [{ type: 'buy_from_stall', objectId: stall.id, item: 'eggs', quantity: 2 }]);
    expect(a.money).toBe(money);
    expect(a.inventory.eggs).toBeUndefined();
    expect(s.stalls[stall.id]!.stock.eggs?.quantity).toBe(3);
  });

  it('takes goods back off the owner’s stall', () => {
    const s = fresh();
    const stall = addStall(s, 'a1');
    s.stalls[stall.id] = { stock: { bread: { quantity: 3, price: 9 } } };
    const a = placeAt(s, 'a1', stall);
    a.inventory = {};
    run(s, 'a1', [{ type: 'take_from_stall', item: 'bread', quantity: 2 }]);
    expect(a.inventory.bread).toBe(2);
    expect(s.stalls[stall.id]!.stock.bread?.quantity).toBe(1);
    run(s, 'a1', [{ type: 'take_from_stall', item: 'bread', quantity: 5 }]);
    expect(a.inventory.bread).toBe(3);
    expect(s.stalls[stall.id]!.stock.bread).toBeUndefined();
  });

  it('a passer-by sees what is for sale after looking', () => {
    const s = fresh();
    const stall = addStall(s, 'a1');
    s.stalls[stall.id] = { stock: { eggs: { quantity: 2, price: 5 } } };
    const passer = s.agents.find((x) => x.id === 'a3')!;
    const t = interactionTiles(s.map, stall)[0]!;
    passer.x = t.x;
    passer.y = t.y;
    passer.asleep = false;
    passer.indoorsId = null;
    look(s, passer);
    expect(passer.knowledge[stall.id]?.lastSeenForSale).toEqual([
      { item: 'eggs', quantity: 2, price: 5 },
    ]);
  });
});
