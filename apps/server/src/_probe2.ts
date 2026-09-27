import { mockDecide } from '@aw/brain';
import { createWorldState, pendingRequests, step, type TickInput } from '@aw/sim';
const state = createWorldState({ seed: 'life' });
let requests = pendingRequests(state);
const intents: Record<string, number> = {};
const fails: Record<string, number> = {};
const trig: Record<string, number> = {};
for (let i = 0; i < 40 * 1440; i++) {
  const inputs: TickInput[] = requests.map((r) => {
    const d = mockDecide(r.perception);
    trig[r.perception.trigger.kind] = (trig[r.perception.trigger.kind] ?? 0) + 1;
    if (r.perception.trigger.kind === 'action_failed') {
      const k = r.perception.trigger.reason.slice(0, 50);
      fails[k] = (fails[k] ?? 0) + 1;
    }
    for (const p of d.plan)
      if (
        [
          'try_for_child',
          'respond_child_request',
          'propose_partnership',
          'respond_proposal',
        ].includes(p.type)
      )
        intents[p.type] = (intents[p.type] ?? 0) + 1;
    return { kind: 'decision', agentId: r.agentId, decision: d };
  });
  requests = step(state, inputs).requests;
}
console.log(intents, trig);
console.log(
  Object.entries(fails)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12),
);
const m = state.agents.find((a) => a.name === 'Maren')!;
console.log(
  Object.entries(m.people)
    .map(([id, p]) => `${p.name}:${p.affection}/${p.romance}/${p.role ?? ''}`)
    .join(' | '),
);
