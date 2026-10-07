import type { Intent, ItemName } from '@aw/shared';
import type { Agent } from './agent.ts';
import { fail, type Ctx } from './engine.ts';
import type { WorldState } from './world.ts';

/**
 * Villagers' own market stalls (feature 5 of docs/plans/growing-the-village.md).
 * GROUNDWORK STUB: the stalls teammate fills these in.
 */

export type StallIntent = Extract<
  Intent,
  { type: 'stock_stall' | 'take_from_stall' | 'buy_from_stall' }
>;

export function stallAction(ctx: Ctx, agent: Agent, _intent: StallIntent, _arrived: boolean): void {
  fail(ctx, agent, "I don't know how to use a stall yet.");
}

/** What a stall has for sale right now, item by item. */
export function stallListing(
  _state: WorldState,
  _stallId: string,
): { item: ItemName; quantity: number; price: number }[] {
  return [];
}
