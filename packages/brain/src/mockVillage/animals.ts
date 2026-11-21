import { ITEMS, type Decision, type Intent, type ItemName, type Perception } from '@aw/shared';

/**
 * Mock brain: Keeping hens and sheep, and making warm clothes.
 * See docs/plans/growing-the-village.md (feature 4).
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** What a person would pay at the market, as far as they know. */
function knownBuyPrice(p: Perception, item: ItemName): number {
  return p.marketPrices?.prices[item]?.buy ?? Math.ceil(ITEMS[item].basePrice * 1.2);
}

function decide(thought: string, goal: string, plan: Intent[]): Decision {
  return { thought, goal, plan };
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  const inv = p.self.inventory;
  const pen = p.knownPlaces.find(
    (k) =>
      k.kind === 'pen' &&
      k.owner === 'you' &&
      k.progress === undefined &&
      !k.burnt &&
      !k.unreachable,
  );
  const market = p.knownPlaces.some((k) => k.kind === 'market' && !k.burnt && !k.unreachable);

  if (pen && p.canDo.includes('tend_animals')) {
    const animals = pen.animals ?? { hens: 0, sheep: 0 };
    const empty = animals.hens + animals.sheep === 0;
    const carryingLivestock = (inv.hen ?? 0) > 0 || (inv.sheep ?? 0) > 0;
    if (empty && carryingLivestock) {
      return decide('I have animals to put in my pen.', 'Stock the pen', [
        { type: 'tend_animals', objectId: pen.id },
      ]);
    }
    // A shepherd buys sheep for an empty pen when they can afford two; others buy hens.
    const shepherd = /shepherd/i.test(p.self.occupation);
    if (
      empty &&
      shepherd &&
      market &&
      p.canDo.includes('buy') &&
      p.self.money >= 2 * knownBuyPrice(p, 'sheep') &&
      roll < 0.3
    ) {
      return decide('My pen is empty. I should buy some sheep and see to them.', 'Keep sheep', [
        { type: 'buy', item: 'sheep', quantity: 2 },
        { type: 'tend_animals', objectId: pen.id },
      ]);
    }
    if (
      empty &&
      market &&
      p.canDo.includes('buy') &&
      p.self.money >= 2 * knownBuyPrice(p, 'hen') &&
      roll < 0.3
    ) {
      return decide('My pen is empty. I should buy some hens and see to them.', 'Keep hens', [
        { type: 'buy', item: 'hen', quantity: 2 },
        { type: 'tend_animals', objectId: pen.id },
      ]);
    }
    // An empty pen has nothing to see to, so only tend one that has animals.
    if (!empty && roll < 0.35) {
      return decide('The animals need seeing to.', 'Tend the animals', [
        { type: 'tend_animals', objectId: pen.id },
      ]);
    }
  }

  if ((inv.wool ?? 0) >= 3 && p.canDo.includes('craft') && roll < 0.15) {
    return decide('I have wool enough. I could make warm clothes from it.', 'Make clothes', [
      { type: 'craft', recipe: 'clothes' },
    ]);
  }

  const cold = p.season === 'autumn' || p.season === 'winter';
  if (
    cold &&
    !inv.clothes &&
    market &&
    p.canDo.includes('buy') &&
    p.self.money >= knownBuyPrice(p, 'clothes') &&
    roll < 0.1
  ) {
    return decide('It is getting cold. I should buy warm clothes.', 'Stay warm', [
      { type: 'buy', item: 'clothes', quantity: 1 },
    ]);
  }
  return null;
}
