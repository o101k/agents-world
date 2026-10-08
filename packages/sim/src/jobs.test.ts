import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, type Intent } from '@aw/shared';
import { interactionTiles } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { createWorldState, type WorldState } from './world.ts';
import type { Agent } from './agent.ts';

type Answer = (a: Agent) => Intent[] | null;

/**
 * Run the world for `ticks` ticks. `plans` are decisions for people on their first tick; `answer`
 * gives the decision for anyone awaiting one (null = leave them waiting).
 */
function advance(
  state: WorldState,
  ticks: number,
  plans: Record<string, Intent[]> = {},
  answer: Answer = () => [{ type: 'rest', minutes: 600 }],
) {
  let planned = false;
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = [];
    if (!planned) {
      for (const [agentId, plan] of Object.entries(plans))
        inputs.push({ kind: 'decision', agentId, decision: { thought: '', goal: '', plan } });
      planned = true;
    }
    for (const a of state.agents) {
      if (!a.alive || !a.awaiting || Object.keys(plans).includes(a.id)) continue;
      const plan = answer(a);
      if (plan)
        inputs.push({ kind: 'decision', agentId: a.id, decision: { thought: '', goal: '', plan } });
    }
    step(state, inputs);
  }
}

function fresh(): { s: WorldState; employer: Agent; worker: Agent } {
  const s = createWorldState({ seed: 'jobs', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  const adults = s.agents.filter((a) => a.alive && a.age >= 18);
  const [employer, worker] = [adults[0]!, adults[1]!];
  // Stand them side by side on the market's tile so they can talk at once.
  const market = s.map.objects.find((o) => o.kind === 'market')!;
  const t = interactionTiles(s.map, market)[0]!;
  employer.x = t.x;
  employer.y = t.y;
  worker.x = t.x + 1;
  worker.y = t.y;
  employer.money = 50;
  worker.money = 0;
  return { s, employer, worker };
}

const hire = (agentId: string, wage: number, days: number): Intent => ({
  type: 'hire',
  agentId,
  wage,
  days,
});

const acceptJob =
  (fromId: string, accept = true): Answer =>
  (a) =>
    a.awaiting?.kind === 'job_offer' ? [{ type: 'respond_job', fromId, accept }] : null;

describe('jobs', () => {
  it('a hire makes a job offer that the worker can accept', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    expect(
      s.requests.some((r) => r.kind === 'job' && r.from === employer.id && r.to === worker.id),
    ).toBe(true);
    expect(worker.awaiting).toMatchObject({
      kind: 'job_offer',
      wage: 5,
      days: 3,
      fromId: employer.id,
    });

    advance(s, 3, {}, acceptJob(employer.id));
    expect(s.requests.some((r) => r.kind === 'job')).toBe(false);
    expect(s.contracts).toHaveLength(1);
    expect(s.contracts[0]).toMatchObject({ employer: employer.id, worker: worker.id, wage: 5 });
    expect(s.contracts[0]!.endTick - s.contracts[0]!.startTick).toBe(3 * TICKS_PER_DAY);
  });

  it('a declined offer makes no agreement', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id, false));
    expect(s.contracts).toHaveLength(0);
    expect(s.requests.some((r) => r.kind === 'job')).toBe(false);
  }, 20000);

  it('wages are paid at 20:00 each day', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id));
    const before = { e: employer.money, w: worker.money };
    // Run until a full day after the agreement began: exactly one wage has been paid.
    advance(s, TICKS_PER_DAY + 60, {}, () => [{ type: 'rest', minutes: 600 }]);
    expect(employer.money).toBe(before.e - 5);
    expect(worker.money).toBe(before.w + 5);
  }, 60000);

  it('an employer without the money to pay loses the worker', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id));
    expect(s.contracts).toHaveLength(1);
    employer.money = 0;
    advance(s, TICKS_PER_DAY + 60, {}, () => [{ type: 'rest', minutes: 600 }]);
    expect(s.contracts).toHaveLength(0);
    expect(worker.recent.some((r) => r.text.includes("couldn't pay my wage"))).toBe(true);
  }, 60000);

  it('end_job ends the agreement from either side', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id));
    expect(s.contracts).toHaveLength(1);
    advance(s, 2, { [worker.id]: [{ type: 'end_job', agentId: employer.id }] }, () => null);
    expect(s.contracts).toHaveLength(0);
  }, 20000);

  it('an agreement lapses after its days', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 1)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id));
    expect(s.contracts).toHaveLength(1);
    advance(s, TICKS_PER_DAY + 120, {}, () => [{ type: 'rest', minutes: 600 }]);
    expect(s.contracts).toHaveLength(0);
  }, 60000);

  it('a death ends the agreement', () => {
    const { s, employer, worker } = fresh();
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    advance(s, 3, {}, acceptJob(employer.id));
    expect(s.contracts).toHaveLength(1);
    worker.alive = false;
    advance(s, 120, {}, () => null);
    expect(s.contracts).toHaveLength(0);
  }, 20000);

  it('children are too young to be hired', () => {
    const { s, employer, worker } = fresh();
    worker.age = 12;
    advance(s, 3, { [employer.id]: [hire(worker.id, 5, 3)] }, () => null);
    expect(employer.recent.some((r) => r.text.includes('too young to work for me'))).toBe(true);
    expect(s.requests.some((r) => r.kind === 'job')).toBe(false);
  });
});
