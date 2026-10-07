import {
  BUILDINGS,
  BUILDING_KINDS,
  type BuildingKind,
  type Decision,
  type Perception,
} from '@aw/shared';

/**
 * Mock brain: Building bakeries, workshops, wells, pens and stalls (and stonework).
 * Only reads the Perception. See docs/plans/growing-the-village.md.
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  if (!p.canDo.includes('build')) return null;
  const inv = p.self.inventory;
  const planks = inv.planks ?? 0;
  const stone = inv.stone ?? 0;
  const ownsKind = (kind: string) => p.knownPlaces.some((k) => k.kind === kind && k.owner === 'you');

  // An unfinished building of our own, once there is material for a stretch of work.
  const unfinished = p.knownPlaces.find(
    (k) =>
      k.owner === 'you' &&
      k.progress !== undefined &&
      k.kind !== 'field' &&
      (BUILDING_KINDS as string[]).includes(k.kind),
  );
  if (unfinished && roll < 0.6) {
    const kind = unfinished.kind as BuildingKind;
    const info = BUILDINGS[kind];
    if (planks >= info.planks && stone >= info.stone) {
      return {
        thought: `${unfinished.name} won't finish itself. I'll get back to it.`,
        goal: `Finish ${unfinished.name}`,
        plan: [{ type: 'build', building: kind }],
      };
    }
  }

  const occ = p.self.occupation.toLowerCase();
  if (planks >= BUILDINGS.stall.planks && roll < 0.15 && /trad|merchant/.test(occ) && !ownsKind('stall')) {
    return {
      thought: 'A stall at the market would let me sell my goods.',
      goal: 'Set up a market stall',
      plan: [{ type: 'build', building: 'stall' }],
    };
  }
  const keepsAnimals = /shepherd|weaver/.test(occ) || (inv.hen ?? 0) > 0 || (inv.sheep ?? 0) > 0;
  if (planks >= BUILDINGS.pen.planks && roll < 0.15 && keepsAnimals && !ownsKind('pen')) {
    return {
      thought: 'I need a pen for my animals.',
      goal: 'Build an animal pen',
      plan: [{ type: 'build', building: 'pen' }],
    };
  }
  return null;
}
