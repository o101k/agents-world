import { TICKS_PER_DAY } from '@aw/shared';
import { step, type WorldState } from '@aw/sim';
import type { WorldFile } from './worldFile.ts';

/**
 * Rebuilds the world as it was at any past tick: the nearest earlier snapshot plus the logged
 * inputs since, run through the same deterministic rules. No AI is asked anything; nothing is
 * written. Keeps the last replayed state, so scrubbing forward only steps the difference.
 */
export class Replayer {
  private state: WorldState | null = null;

  constructor(private readonly file: WorldFile) {}

  /** The world at `tick` (the caller clamps it to the live tick). Don't mutate the result. */
  at(tick: number): WorldState {
    const target = Math.max(this.file.firstSnapshotTick(), tick);
    let s = this.state;
    this.state = null;
    const nearest = this.file.snapshotTickAtOrBefore(target);
    // Start again from a snapshot when going back in time, or when one is closer than we are.
    if (!s || s.tick > target || (nearest > s.tick && target - s.tick > TICKS_PER_DAY / 4)) {
      s = this.file.loadSnapshotAtOrBefore(target);
    }
    if (s.tick < target) {
      const inputs = this.file.readInputsBetween(s.tick, target);
      while (s.tick < target) step(s, inputs.get(s.tick + 1) ?? []);
    }
    this.state = s;
    return s;
  }

  /** Forget the cached state (e.g. when the world is reopened). */
  reset(): void {
    this.state = null;
  }
}
