import type { Decision, Perception } from '@aw/shared';

/**
 * Mock brain: Clearing and sowing fields of one's own.
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  const mine = p.knownPlaces.filter((k) => k.kind === 'field' && k.owner === 'you');
  const unfinished = mine.find((k) => k.progress !== undefined);
  if (unfinished) {
    if (roll < 0.5) {
      return {
        thought: 'My field is not cleared yet. I should keep clearing it.',
        goal: 'Clear my field',
        plan: [{ type: 'clear_field' }],
      };
    }
    return null;
  }

  const ready = mine.find((k) => k.progress === undefined && !k.produce);
  const inv = p.self.inventory;
  if (ready) {
    const item = (inv.wheat ?? 0) >= 2 ? 'wheat' : (inv.vegetables ?? 0) >= 2 ? 'vegetables' : null;
    if (item) {
      return {
        thought: `My field is ready. I'll sow it with ${item}.`,
        goal: 'Sow my field',
        plan: [{ type: 'sow', item, objectId: ready.id }],
      };
    }
  }

  if (mine.length === 0 && p.self.occupation.toLowerCase().includes('farm') && roll < 0.08) {
    return {
      thought: 'I need land of my own. I will clear a field.',
      goal: 'Clear a field',
      plan: [{ type: 'clear_field' }],
    };
  }
  return null;
}
