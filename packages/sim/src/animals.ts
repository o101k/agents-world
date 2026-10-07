import type { Intent } from '@aw/shared';
import type { Agent, TaskAction } from './agent.ts';
import { fail, type Ctx } from './engine.ts';
import type { WorldState } from './world.ts';

/**
 * Animal pens (hens, sheep), eggs, wool and warm clothes (feature 4 of
 * docs/plans/growing-the-village.md). GROUNDWORK STUB: the animals teammate fills these in.
 */

export function startTendAnimals(
  ctx: Ctx,
  agent: Agent,
  _intent: Extract<Intent, { type: 'tend_animals' }>,
  _arrived: boolean,
): void {
  fail(ctx, agent, "I don't know how to keep animals yet.");
}

export function finishTendAnimals(_ctx: Ctx, agent: Agent, _action: TaskAction): void {
  agent.action = null;
}

/** Once a tick: pens' daily upkeep (strays, breeding) and clothes wearing out. */
export function animalsTick(_ctx: Ctx): void {}

/** How much of the cold reaches this person (1 = all of it; warm clothes lower it). */
export function clothingWarmth(_agent: Agent): number {
  return 1;
}

/** The animals in a pen right now. */
export function penAnimals(_state: WorldState, _penId: string): { hens: number; sheep: number } {
  return { hens: 0, sheep: 0 };
}
