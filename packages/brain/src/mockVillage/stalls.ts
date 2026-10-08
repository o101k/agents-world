import { FOOD_ITEMS, ITEMS, type Decision, type Intent, type ItemName, type Perception } from '@aw/shared';

/**
 * Mock brain: Selling from one's own market stall, and buying at others'.
 */

const SELLABLE: ItemName[] = [
  'bread',
  'vegetables',
  'fish',
  'eggs',
  'wool',
  'clothes',
  'planks',
  'stone',
];

/** What a person would pay at the market, as far as they know. */
function knownPrice(p: Perception, item: ItemName, side: 'buy' | 'sell'): number {
  return p.marketPrices?.prices[item]?.[side] ?? Math.ceil(ITEMS[item].basePrice * 1.2);
}

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  const sellPlan = sellFromOwnStall(p, roll);
  if (sellPlan) return sellPlan;
  return buyFromAStall(p, roll);
}

/** A trader or baker with a finished stall sells their surplus (more than 3 of a good). */
function sellFromOwnStall(p: Perception, roll: number): Decision | null {
  if (!/trad|bak/i.test(p.self.occupation) || !p.canDo.includes('stock_stall')) return null;
  const stall = p.knownPlaces.find(
    (k) => k.kind === 'stall' && k.owner === 'you' && k.progress === undefined && !k.burnt,
  );
  if (!stall || roll >= 0.3) return null;
  for (const item of SELLABLE) {
    const have = p.self.inventory[item] ?? 0;
    if (have <= 3) continue;
    const price = Math.max(1, knownPrice(p, item, 'buy') - 1);
    const intent: Intent = { type: 'stock_stall', item, quantity: have - 3, price };
    return {
      thought: `I have spare ${ITEMS[item].label.toLowerCase()}. I'll sell it from my stall.`,
      goal: 'sell my surplus at my stall',
      plan: [intent],
    };
  }
  return null;
}

/** Someone short of food buys a couple of food units at a stall that's no dearer than the market. */
function buyFromAStall(p: Perception, roll: number): Decision | null {
  if (!p.canDo.includes('buy_from_stall') || roll >= 0.3) return null;
  const food = FOOD_ITEMS.reduce((n, i) => n + (p.self.inventory[i] ?? 0), 0);
  if (food >= 4) return null;
  let best: { id: string; item: ItemName; price: number } | null = null;
  for (const k of p.knownPlaces) {
    if (k.kind !== 'stall' || k.owner === 'you' || k.burnt || k.unreachable || !k.forSale) continue;
    for (const f of k.forSale) {
      if (!FOOD_ITEMS.includes(f.item)) continue;
      if (f.price > knownPrice(p, f.item, 'buy')) continue;
      if (p.self.money < 2 * f.price) continue;
      if (!best || f.price < best.price) best = { id: k.id, item: f.item, price: f.price };
    }
  }
  if (!best) return null;
  return {
    thought: `I'm short of food. The stall has ${ITEMS[best.item].label.toLowerCase()} at a fair price.`,
    goal: 'buy food from a stall',
    plan: [{ type: 'buy_from_stall', objectId: best.id, item: best.item, quantity: 2 }],
  };
}
