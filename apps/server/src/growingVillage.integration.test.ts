import { describe, expect, it } from 'vitest';
import { mockDecide } from '@aw/brain';
import { TICKS_PER_DAY, type Decision, type Intent } from '@aw/shared';
import {
  createWorldState,
  deserializeWorldState,
  generateCast,
  pendingRequests,
  serializeWorldState,
  step,
  type TickInput,
  type WorldState,
} from '@aw/sim';

const SEED = 'growing-village';

/**
 * Set the scene for the growing-village features (test only): give a few adults what they
 * need, and script their first plans. Everyone else, and every later request, is answered
 * by mockDecide.
 */
function setScene(state: WorldState): Map<string, Decision> {
  const adults = state.agents.filter((a) => a.alive && a.age >= 18);
  const [stallman, penkeeper, clearer, quarrier, employer, worker, caller] = adults;
  if (!stallman || !penkeeper || !clearer || !quarrier || !employer || !worker || !caller)
    throw new Error('the generated cast needs at least seven adults');

  Object.assign(stallman.inventory, { planks: 10, bread: 4 });
  stallman.money = 100;
  stallman.skills.building = 30;
  Object.assign(penkeeper.inventory, { planks: 10, hen: 2 });
  penkeeper.money = 100;
  penkeeper.skills.building = 30;
  employer.money = 200;

  const plans: [string, Intent[]][] = [
    [
      stallman.id,
      [
        { type: 'build', building: 'stall' },
        { type: 'stock_stall', item: 'bread', quantity: 2, price: 3 },
      ],
    ],
    [
      penkeeper.id,
      [
        { type: 'build', building: 'pen' },
        { type: 'tend_animals' },
      ],
    ],
    [clearer.id, [{ type: 'clear_field' }]],
    [quarrier.id, [{ type: 'quarry' }]],
    [employer.id, [{ type: 'hire', agentId: worker.id, wage: 3, days: 2 }]],
    [caller.id, [{ type: 'call_meeting', topic: 'the new stall' }]],
  ];
  return new Map(plans.map(([id, plan]) => [id, { thought: '', goal: '', plan }]));
}

/**
 * Run `ticks` ticks the way the helper does (the world waits for every due decision).
 * The scripted plans answer the first requests only; everything after uses mockDecide.
 */
function run(state: WorldState, ticks: number, scripted: Map<string, Decision> | null) {
  let requests = pendingRequests(state);
  const events = [];
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = requests.map((r) => ({
      kind: 'decision',
      agentId: r.agentId,
      decision: scripted?.get(r.agentId) ?? mockDecide(r.perception),
    }));
    scripted = null;
    const res = step(state, inputs);
    events.push(...res.events);
    requests = res.requests;
  }
  return events;
}

const snapshot = (s: WorldState) => JSON.stringify(serializeWorldState(s));

describe('growing the village: save and resume stay deterministic', () => {
  it('builds, farms, quarries, hires and meets, and resumes to the same state', () => {
    const newWorld = () =>
      createWorldState({
        seed: SEED,
        mapSize: 'medium',
        cast: generateCast(SEED, { adults: 10, children: 2 }),
      });
    const TOTAL = 2 * TICKS_PER_DAY;

    // Run A: straight through two days.
    const a = newWorld();
    const eventsA = run(a, TOTAL, setScene(a));

    // Run B: one day, then save and reload exactly as the helper does, then the rest.
    const b = newWorld();
    run(b, TICKS_PER_DAY, setScene(b));
    const reloaded = deserializeWorldState(JSON.parse(JSON.stringify(serializeWorldState(b))));
    run(reloaded, TOTAL - TICKS_PER_DAY, null);

    expect(snapshot(reloaded)).toBe(snapshot(a));

    // The features actually happened in run A.
    const kinds = new Set(eventsA.map((e) => e.kind));
    expect(Object.keys(a.stalls).length).toBeGreaterThan(0);
    expect(Object.keys(a.pens).length).toBeGreaterThan(0);
    expect(a.map.objects.some((o) => o.kind === 'stall')).toBe(true);
    expect(a.map.objects.some((o) => o.kind === 'pen')).toBe(true);
    expect(a.agents.some((x) => (x.inventory.stone ?? 0) > 0)).toBe(true);
    expect(kinds).toContain('built');
    expect(kinds).toContain('quarried');
    expect(kinds).toContain('meeting');
    expect(kinds).toContain('job');

    // New objects get a history: their events carry the object's id.
    const tagged = new Set(eventsA.flatMap((e) => e.objects ?? []));
    for (const o of a.map.objects.filter((x) => ['stall', 'pen'].includes(x.kind)))
      expect(tagged).toContain(o.id);
  });
});
