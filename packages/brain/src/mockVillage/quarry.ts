import type { Decision, Perception } from '@aw/shared';

/**
 * Mock brain: Quarrying stone.
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  if (roll >= 0.12 || !p.canDo.includes('quarry')) return null;
  const occ = p.self.occupation.toLowerCase();
  if (!(occ.includes('carpenter') || occ.includes('odd') || occ.includes('wood'))) return null;
  if ((p.rocksNearby ?? 0) <= 0) return null;
  const have = p.self.inventory.stone ?? 0;
  if (have >= 4) return null;
  const quarry = { type: 'quarry' as const };
  const market = p.knownPlaces.some((k) => k.kind === 'market' && !k.burnt && !k.unreachable);
  // Two quarrying stretches add about 4 stone; sell what was already held so the stock stays at 4.
  const sell =
    market && have > 0 && p.canDo.includes('sell')
      ? [{ type: 'sell' as const, item: 'stone' as const, quantity: have }]
      : [];
  return {
    thought: 'There are rocks nearby. Some stone would come in useful.',
    goal: 'Cut stone from the rocks',
    plan: [quarry, quarry, ...sell],
  };
}
