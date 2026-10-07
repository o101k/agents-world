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

/** Answer triggers the growing village causes (job offers, meetings, proposals). */
export function villageReply(p: Perception, roll: number): Decision | null {
  for (const f of FEATURES) {
    const d = f.reply(p, roll);
    if (d) return d;
  }
  return null;
}

/** A day's work that grows the village, now and then (each feature keeps its own odds). */
export function villagePlan(p: Perception, roll: number): Decision | null {
  for (const f of FEATURES) {
    const d = f.plan(p, roll);
    if (d) return d;
  }
  return null;
}
