import { describe, expect, it } from 'vitest';
import { mockDecide } from '@aw/brain';
import { TICKS_PER_DAY } from '@aw/shared';
import {
  createWorldState,
  deserializeWorldState,
  fnv1a,
  pendingRequests,
  serializeWorldState,
  step,
  type TickInput,
  type WorldState,
} from '@aw/sim';

/** Run a world with mock brains, the same way the runner does (world waits for decisions). */
function run(state: WorldState, ticks: number, log?: Map<number, TickInput[]>) {
  let requests = pendingRequests(state);
  const events = [];
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = requests.map((r) => ({
      kind: 'decision',
      agentId: r.agentId,
      decision: mockDecide(r.perception),
    }));
    log?.set(state.tick + 1, inputs);
    const res = step(state, inputs);
    events.push(...res.events);
    requests = res.requests;
  }
  return events;
}

const hashState = (s: WorldState) => fnv1a(JSON.stringify(serializeWorldState(s)));

describe('simulation with mock brains', () => {
  it('keeps most villagers alive for 5 days', () => {
    const state = createWorldState({ seed: 'survive', mapSize: 'medium' });
    const events = run(state, 5 * TICKS_PER_DAY);
    const alive = state.agents.filter((a) => a.alive);
    expect(alive.length).toBeGreaterThanOrEqual(Math.ceil(state.agents.length * 0.75));
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ['ate', 'drank', 'gathered', 'fell_asleep', 'woke_up'])
      expect(kinds).toContain(k);
    for (const a of alive) expect(a.health).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    const a = createWorldState({ seed: 'det', mapSize: 'small' });
    const b = createWorldState({ seed: 'det', mapSize: 'small' });
    run(a, 600);
    run(b, 600);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('replays exactly from a snapshot plus the input log', () => {
    const live = createWorldState({ seed: 'replay', mapSize: 'small' });
    run(live, 300);
    const snapshot = JSON.parse(JSON.stringify(serializeWorldState(live)));
    const log = new Map<number, TickInput[]>();
    run(live, 500, log);

    const replayed = deserializeWorldState(snapshot);
    while (replayed.tick < live.tick) step(replayed, log.get(replayed.tick + 1) ?? []);
    expect(hashState(replayed)).toBe(hashState(live));
  });

  it('villagers die without food or water', () => {
    const state = createWorldState({ seed: 'doom', mapSize: 'small' });
    // No decisions at all: nobody eats or drinks.
    for (let i = 0; i < 3 * TICKS_PER_DAY; i++) {
      const res = step(state, res0(state));
      void res;
    }
    expect(state.agents.every((a) => !a.alive)).toBe(true);
    expect(state.agents.some((a) => a.death?.cause === 'thirst')).toBe(true);
  });
});

/** Answer every request with an empty plan (the agent just stands there). */
function res0(state: WorldState): TickInput[] {
  return pendingRequests(state).map((r) => ({
    kind: 'decision',
    agentId: r.agentId,
    decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
  }));
}
