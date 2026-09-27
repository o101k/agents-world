/**
 * Stress test: a large generated village run headless with the free Mock brain.
 *   npm run stress -- [adults=100] [children=50] [days=3] [mapSize=huge]
 * Prints simulation speed, survival, and the sizes of what gets saved and sent to the browser.
 */
import { gzipSync } from 'node:zlib';
import { mockDecide } from '@aw/brain';
import type { MapSize } from '@aw/shared';
import {
  agentView,
  createWorldState,
  generateCast,
  pendingRequests,
  serializeWorldState,
  step,
  type TickInput,
} from '@aw/sim';

const [adults = 100, children = 50, days = 3] = process.argv.slice(2, 5).map(Number);
const mapSize = (process.argv[5] ?? 'huge') as MapSize;
const seed = 'stress';
const t0 = performance.now();
const state = createWorldState({ seed, mapSize, cast: generateCast(seed, { adults, children }) });
console.log(
  `${state.agents.length} people, ${state.map.width}×${state.map.height} map, ` +
    `${state.map.objects.filter((o) => o.kind === 'house').length} houses, ` +
    `${state.map.objects.filter((o) => o.kind === 'field').length} fields ` +
    `(created in ${Math.round(performance.now() - t0)} ms)`,
);

let requests = pendingRequests(state);
let decisions = 0;
let decideMs = 0;
let stepMs = 0;
const deaths: Record<string, number> = {};
const ticks = days * 1440;
let slowest = 0;
for (let i = 0; i < ticks; i++) {
  const d0 = performance.now();
  const inputs: TickInput[] = requests.map((r) => ({
    kind: 'decision',
    agentId: r.agentId,
    decision: mockDecide(r.perception),
  }));
  decisions += inputs.length;
  const s0 = performance.now();
  decideMs += s0 - d0;
  const res = step(state, inputs);
  const took = performance.now() - s0;
  stepMs += took;
  slowest = Math.max(slowest, took);
  for (const e of res.events) {
    if (e.kind === 'died') {
      const cause = e.text.replace(/.* died of ([^,]+),.*/, '$1');
      deaths[cause] = (deaths[cause] ?? 0) + 1;
    }
  }
  requests = res.requests;
  if (i % 1440 === 1439)
    console.log(
      `day ${Math.floor(i / 1440) + 1}: ${(stepMs / (i + 1)).toFixed(2)} ms/tick (sim), ` +
        `${(decideMs / (i + 1)).toFixed(2)} ms/tick (perception + mock brain), ` +
        `${state.agents.filter((a) => a.alive).length} alive`,
    );
}
const json = JSON.stringify(serializeWorldState(state));
const frame = JSON.stringify(state.agents.map(agentView));
const mem = state.agents.reduce((s, a) => s + a.memories.length, 0) / state.agents.length;
console.log({
  msPerTick: +(stepMs / ticks).toFixed(3),
  slowestTickMs: +slowest.toFixed(1),
  inGameMinutesPerSecond: Math.round(1000 / ((stepMs + decideMs) / ticks)),
  decisionsPerDay: Math.round(decisions / days),
  deaths,
  avgMemories: Math.round(mem),
  snapshotKB: Math.round(json.length / 1024),
  snapshotGzKB: Math.round(gzipSync(json).length / 1024),
  frameKB: Math.round(frame.length / 1024),
});
