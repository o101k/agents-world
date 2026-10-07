import type { Intent, MapObject } from '@aw/shared';
import type { Agent, TaskAction } from './agent.ts';
import { fail, type Ctx } from './engine.ts';

/**
 * Clearing new fields and sowing them (feature 1 of docs/plans/growing-the-village.md).
 * GROUNDWORK STUB: the farming teammate fills these in.
 */

export function startClearField(
  ctx: Ctx,
  agent: Agent,
  _intent: Extract<Intent, { type: 'clear_field' }>,
  _arrived: boolean,
): void {
  fail(ctx, agent, "I don't know how to clear land yet.");
}

export function startSow(
  ctx: Ctx,
  agent: Agent,
  _intent: Extract<Intent, { type: 'sow' }>,
  _arrived: boolean,
): void {
  fail(ctx, agent, "I don't know how to sow yet.");
}

/** A `clear_field` or `sow` task has run its time. */
export function finishFarmingTask(_ctx: Ctx, agent: Agent, _action: TaskAction): void {
  agent.action = null;
}

/** Someone just took `got` units of crop from a field (the owner may notice a stranger). */
export function onFieldHarvest(_ctx: Ctx, _agent: Agent, _field: MapObject, _got: number): void {}
