import type { Decision, Perception } from '@aw/shared';

/**
 * Mock brain: Quarrying stone.
 * GROUNDWORK STUB — see docs/plans/growing-the-village.md.
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(_p: Perception, _roll: number): Decision | null {
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(_p: Perception, _roll: number): Decision | null {
  return null;
}
