import { mockDecide } from '@aw/brain';
import { createWorldState, pendingRequests, step, type TickInput } from '@aw/sim';
const state = createWorldState({ seed: 'life' });
let requests = pendingRequests(state);
const counts: Record<string, number> = {};
const days = Number(process.argv[2] ?? 120);
for (let i = 0; i < days * 1440; i++) {
  const inputs: TickInput[] = requests.map((r) => ({
    kind: 'decision',
    agentId: r.agentId,
    decision: mockDecide(r.perception),
  }));
  const res = step(state, inputs);
  for (const e of res.events) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    if (e.importance >= 4) console.log(`d${Math.floor(e.tick / 1440) + 1}`, e.text);
  }
  requests = res.requests;
}
console.log(counts);
const alive = state.agents.filter((a) => a.alive);
console.log('alive', alive.length, 'dead', state.agents.length - alive.length);
for (const a of state.agents)
  console.log(
    a.id,
    a.name || 'Baby',
    a.familyName,
    Math.floor(a.age),
    a.alive ? 'alive' : `dead: ${a.death?.cause}`,
    'lang',
    Math.round(a.skills.language),
    'partner',
    a.partnerId ?? '-',
    'kids',
    a.childrenIds.length,
  );
