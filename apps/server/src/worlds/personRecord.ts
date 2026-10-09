import type { EffortLevel, PersonDigest, RecordQuery, RecordResponse } from '@aw/shared';
import type { Agent, WorldState } from '@aw/sim';
import type { WorldFile } from './worldFile.ts';

/**
 * A person's record: everything the village holds about them over a period (what happened to
 * them, what they said and heard, what they thought when deciding, their diary, their memories),
 * for the observer's record browser and, trimmed to a budget, for their brain to answer the
 * observer's questions. Read-only: nothing here changes the world.
 */

/** Their whole time in the world: from birth or arrival (or the world's first tick) to now or their death. */
export function lifeSpan(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
): { from: number; to: number } {
  void file;
  void state;
  void agent;
  throw new Error('lifeSpan is not built yet');
}

/** One page of their record for a period, newest first (see `RecordResponse`). */
export function recordPage(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
  query: RecordQuery,
): RecordResponse {
  void file;
  void state;
  void agent;
  void query;
  throw new Error('recordPage is not built yet');
}

/** What their brain reads to answer a question about [fromTick, toTick], trimmed by effort. */
export function buildDigest(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
  fromTick: number,
  toTick: number,
  effort: EffortLevel,
): PersonDigest {
  void file;
  void state;
  void agent;
  void fromTick;
  void toTick;
  void effort;
  throw new Error('buildDigest is not built yet');
}
