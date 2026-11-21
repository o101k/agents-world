import {
  BUILDINGS,
  BUILDING_KINDS,
  ITEMS,
  type BuildingKind,
  type Decision,
  type Intent,
  type ItemName,
  type Perception,
} from '@aw/shared';

/**
 * Mock brain: Building bakeries, workshops, wells, pens and stalls (and stonework).
 * Only reads the Perception. See docs/plans/growing-the-village.md.
 */

/** Most steps one decision may plan (buys and build stretches together). */
const MAX_STEPS = 8;

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** What a person would pay at the market, as far as they know. */
function knownBuyPrice(p: Perception, item: ItemName): number {
  return p.marketPrices?.prices[item]?.buy ?? Math.ceil(ITEMS[item].basePrice * 1.2);
}

/** Building skill needed to start a new site (the sim's rule; carrying on needs none). */
function skillToStart(kind: BuildingKind): number {
  return kind === 'bakery' || kind === 'workshop' ? 20 : 10;
}

/** How many building stretches the rest of the job takes, by the sim's formula. */
function stretchesLeft(p: Perception, kind: BuildingKind, left: number): number {
  const per = (0.1 * (0.5 + (p.self.skills.building ?? 0) / 100)) / BUILDINGS[kind].work;
  return Math.max(1, Math.ceil(left / per - 1e-9));
}

/** The shortfall of planks and stone for `k` stretches, and what it would cost to buy it. */
function shortfall(p: Perception, kind: BuildingKind, k: number) {
  const info = BUILDINGS[kind];
  const inv = p.self.inventory;
  const buys: { item: ItemName; quantity: number }[] = [];
  const planks = info.planks * k - (inv.planks ?? 0);
  const stone = info.stone * k - (inv.stone ?? 0);
  if (planks > 0) buys.push({ item: 'planks', quantity: planks });
  if (stone > 0) buys.push({ item: 'stone', quantity: stone });
  const cost = buys.reduce((s, b) => s + b.quantity * knownBuyPrice(p, b.item), 0);
  return { buys, cost };
}

/**
 * The steps for finishing a building (or as much of it as they can fund): buy what's missing
 * now, then build. A new site (`partial` false) needs the whole job funded or it isn't started.
 * `canBuy` false only allows what's already carried. null = can't fund it.
 */
function fundJob(
  p: Perception,
  kind: BuildingKind,
  left: number,
  opts: { partial: boolean; canBuy: boolean },
): Intent[] | null {
  if (!p.canDo.includes('build')) return null;
  const total = stretchesLeft(p, kind, left);
  for (let k = total; k >= 1; k--) {
    if (!opts.partial && k < total) return null;
    const { buys, cost } = shortfall(p, kind, k);
    const affordable =
      buys.length === 0 || (opts.canBuy && p.canDo.includes('buy') && p.self.money >= cost + 10);
    if (!affordable) continue;
    const steps = Math.min(k, MAX_STEPS - buys.length);
    if (steps < 1) return null;
    return [
      ...buys.map((b): Intent => ({ type: 'buy', ...b })),
      ...Array.from({ length: steps }, (): Intent => ({ type: 'build', building: kind })),
    ];
  }
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  if (!p.canDo.includes('build')) return null;
  const inv = p.self.inventory;
  const ownsKind = (kind: string) =>
    p.knownPlaces.some((k) => k.kind === kind && k.owner === 'you');

  // An unfinished building of our own: carry on with what we have, or buy the rest of the job
  // (or as much of it as we can pay for) when the roll allows.
  const unfinished = p.knownPlaces.find(
    (k) =>
      k.owner === 'you' &&
      k.progress !== undefined &&
      !k.burnt &&
      !k.unreachable &&
      k.kind !== 'field' &&
      (BUILDING_KINDS as string[]).includes(k.kind),
  );
  if (unfinished && roll < 0.6) {
    const kind = unfinished.kind as BuildingKind;
    const job = fundJob(p, kind, 1 - (unfinished.progress ?? 0), {
      partial: true,
      canBuy: roll < 0.15,
    });
    if (job) {
      const bought = job.some((s) => s.type === 'buy');
      return {
        thought: bought
          ? `${unfinished.name} needs more material. I'll buy what it needs and get on with it.`
          : `${unfinished.name} won't finish itself. I'll get back to it.`,
        goal: `Finish ${unfinished.name}`,
        plan: job,
      };
    }
  }

  // Starting a new stall or pen: only with the skill to start, and money (or planks) for the
  // whole job, so the site doesn't get left unfinished.
  const occ = p.self.occupation.toLowerCase();
  const skill = p.self.skills.building ?? 0;
  const start = (kind: BuildingKind, thought: string, goal: string): Decision | null => {
    if (skill < skillToStart(kind)) return null;
    const job = fundJob(p, kind, 1, { partial: false, canBuy: true });
    if (!job) return null;
    return { thought, goal, plan: job };
  };
  if (/trad|merchant|bak/.test(occ) && roll < 0.15 && !ownsKind('stall')) {
    const d = start(
      'stall',
      'A stall at the market would let me sell my goods.',
      'Set up a market stall',
    );
    if (d) return d;
  }
  const keepsAnimals = /shepherd|weaver/.test(occ) || (inv.hen ?? 0) > 0 || (inv.sheep ?? 0) > 0;
  if (keepsAnimals && roll < 0.15 && !ownsKind('pen')) {
    const d = start('pen', 'I need a pen for my animals.', 'Build an animal pen');
    if (d) return d;
  }
  return null;
}
