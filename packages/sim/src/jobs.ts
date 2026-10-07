import type { Intent, JobView } from '@aw/shared';
import type { Agent } from './agent.ts';
import { fail, type Ctx } from './engine.ts';
import type { WorldState } from './world.ts';

/**
 * Hiring people for a daily wage (feature 6 of docs/plans/growing-the-village.md).
 * GROUNDWORK STUB: the jobs teammate fills these in.
 */

export type JobIntent = Extract<Intent, { type: 'hire' | 'respond_job' | 'end_job' }>;

export function jobAction(ctx: Ctx, agent: Agent, _intent: JobIntent): void {
  fail(ctx, agent, "I don't know how to hire anyone yet.");
}

/** Once a tick: paydays, agreements running out, and agreements with the dead. */
export function jobsTick(_ctx: Ctx): void {}

/** This person's work agreements, as they know them. */
export function jobsFor(_state: WorldState, _agent: Agent): JobView[] {
  return [];
}
