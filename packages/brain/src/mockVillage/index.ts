import type { Decision, Perception } from '@aw/shared';
import * as animals from './animals.ts';
import * as construction from './construction.ts';
import * as farming from './farming.ts';
import * as governance from './governance.ts';
import * as jobs from './jobs.ts';
import * as quarry from './quarry.ts';
import * as stalls from './stalls.ts';

/** The mock brain's part in growing the village, one module per feature. */
const FEATURES = [governance, jobs, stalls, animals, farming, construction, quarry];

/**
 * Each feature gets its own roll, derived from the shared one and the feature's position, so a
 * feature with very low odds (a meeting) isn't swallowed by a sibling's higher ones.
 */
function featureRoll(roll: number, index: number): number {
  let h = Math.floor(roll * 4294967296) ^ Math.imul(index + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Answer triggers the growing village causes (job offers, meetings, proposals). */
export function villageReply(p: Perception, roll: number): Decision | null {
  for (let i = 0; i < FEATURES.length; i++) {
    const d = FEATURES[i]!.reply(p, featureRoll(roll, i));
    if (d) return d;
  }
  return null;
}

/** A day's work that grows the village, now and then (each feature keeps its own odds). */
export function villagePlan(p: Perception, roll: number): Decision | null {
  for (let i = 0; i < FEATURES.length; i++) {
    const d = FEATURES[i]!.plan(p, featureRoll(roll, i));
    if (d) return d;
  }
  return null;
}
