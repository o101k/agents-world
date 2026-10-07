import type { Intent, MapObject, Point, WorldMap } from '@aw/shared';
import type { Agent, TaskAction } from './agent.ts';
import { fail, type Ctx } from './engine.ts';

/**
 * Quarrying stone from rocks (feature 3 of docs/plans/growing-the-village.md).
 * GROUNDWORK STUB: the quarry teammate fills these in.
 */

export function startQuarry(
  ctx: Ctx,
  agent: Agent,
  _intent: Extract<Intent, { type: 'quarry' }>,
  _arrived: boolean,
): void {
  fail(ctx, agent, "I don't know how to quarry stone yet.");
}

export function finishQuarry(_ctx: Ctx, agent: Agent, _action: TaskAction): void {
  agent.action = null;
}

/** Rocks whose tile is within `radius` (Chebyshev) of a point. */
export function rocksNear(_map: WorldMap, _p: Point, _radius: number): MapObject[] {
  return [];
}
