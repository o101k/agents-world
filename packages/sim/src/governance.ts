import type { Intent, VillageKnowledge } from '@aw/shared';
import type { Agent } from './agent.ts';
import { fail, type Ctx } from './engine.ts';
import type { WorldState } from './world.ts';

/**
 * Village meetings, votes, rules, a leader, and the village purse (feature 7 of
 * docs/plans/growing-the-village.md). GROUNDWORK STUB: the governance teammate fills these in.
 */

export type GovernanceIntent = Extract<
  Intent,
  { type: 'call_meeting' | 'propose_rule' | 'vote' | 'pay_from_treasury' }
>;

export function governanceAction(ctx: Ctx, agent: Agent, _intent: GovernanceIntent): void {
  fail(ctx, agent, "I don't know how to do that yet.");
}

/** Once a tick: meetings opening and closing (votes counted), and the daily levy. */
export function governanceTick(_ctx: Ctx): void {}

/** Standing by the market: read the notice board (rules, leader, the purse). */
export function readNoticeBoard(_state: WorldState, _agent: Agent): void {}

/** What this person knows of meetings, rules and the leader (undefined = nothing to tell). */
export function villageKnowledge(_state: WorldState, _agent: Agent): VillageKnowledge | undefined {
  return undefined;
}
