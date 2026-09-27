import { describe, expect, it } from 'vitest';
import type { Intent, WorldEvent } from '@aw/shared';
import type { Agent } from './agent.ts';
import { step, type TickInput } from './engine.ts';
import { isOrphan } from './life.ts';
import {
  createWorldState,
  deserializeWorldState,
  serializeWorldState,
  type WorldState,
} from './world.ts';

function fresh(): WorldState {
  const s = createWorldState({ seed: 'adoption-test', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}
const who = (s: WorldState, name: string) => s.agents.find((a) => a.name === name)!;

/** Give each named agent a plan on the first tick; answer everyone else with a long rest. */
function run(s: WorldState, plans: Record<string, Intent[]>, ticks: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  let first = true;
  for (let i = 0; i < ticks; i++) {
    const inputs: TickInput[] = [];
    for (const a of s.agents) {
      if (!a.alive) continue;
      const plan = first ? plans[a.id] : undefined;
      if (plan)
        inputs.push({ kind: 'decision', agentId: a.id, decision: { thought: '', goal: '', plan } });
      else if (a.awaiting)
        inputs.push({
          kind: 'decision',
          agentId: a.id,
          decision: { thought: '', goal: '', plan: [{ type: 'rest', minutes: 600 }] },
        });
    }
    first = false;
    events.push(...step(s, inputs).events);
  }
  return events;
}

function adjacent(a: Agent, b: Agent) {
  b.x = a.x + 1;
  b.y = a.y;
  b.indoorsId = null;
  b.asleep = false;
}

/** Aldric and Wenna Venn die, leaving Oskar (2) and Mira (7) with no parents. */
function orphanTheVenns(s: WorldState): WorldEvent[] {
  for (const name of ['Aldric', 'Wenna']) {
    const p = who(s, name);
    p.health = 0.01;
    p.needs.water = 0;
  }
  return run(s, {}, 5);
}

describe('orphans and adoption', () => {
  it('a child whose last parent dies is an orphan, and the village hears of it', () => {
    const s = fresh();
    const mira = who(s, 'Mira');
    const oskar = who(s, 'Oskar');
    const aldric = who(s, 'Aldric');
    // Someone nearby when it happens hears of it.
    const piet = who(s, 'Piet');
    adjacent(aldric, piet);
    let alerted = false;
    const events: WorldEvent[] = [];
    for (const name of ['Aldric', 'Wenna']) {
      const p = who(s, name);
      p.health = 0.01;
      p.needs.water = 0;
    }
    for (let i = 0; i < 5; i++) {
      events.push(...step(s, []).events);
      if (piet.awaiting?.kind === 'orphaned') alerted = true;
    }
    expect(who(s, 'Wenna').alive).toBe(false);
    expect(aldric.alive).toBe(false);
    expect(isOrphan(s, mira)).toBe(true);
    expect(isOrphan(s, oskar)).toBe(true);
    expect(events.filter((e) => e.kind === 'orphaned').map((e) => e.actors[0])).toEqual(
      expect.arrayContaining([mira.id, oskar.id]),
    );
    expect(mira.memories.some((m) => m.text.includes('no mother or father'))).toBe(true);
    expect(piet.memories.some((m) => m.text.includes('no parents left'))).toBe(true);
    expect(alerted).toBe(true);
    // Children with a living parent are not orphans.
    expect(isOrphan(s, who(s, 'Lise'))).toBe(false);
  });

  it('a couple takes in a toddler straight away; the child joins their home and family', () => {
    const s = fresh();
    orphanTheVenns(s);
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    const oskar = who(s, 'Oskar');
    const lise = who(s, 'Lise');
    // Oskar is wherever he was (maybe indoors at home): Maren goes to him.
    const events = run(s, { [maren.id]: [{ type: 'adopt_child', childId: oskar.id }] }, 120);
    expect(events.some((e) => e.kind === 'adopted')).toBe(true);
    expect(oskar.adoptiveParentIds).toEqual([maren.id, tobias.id]);
    expect(maren.childrenIds).toContain(oskar.id);
    expect(tobias.childrenIds).toContain(oskar.id);
    expect(oskar.homeId).toBe(maren.homeId);
    expect(oskar.people[maren.id]?.role).toBe('mother');
    expect(oskar.people[tobias.id]?.role).toBe('father');
    expect(maren.people[oskar.id]?.role).toBe('child');
    expect(lise.people[oskar.id]?.role).toBe('sibling');
    expect(oskar.people[lise.id]?.role).toBe('sibling');
    // Birth parents stay on record.
    expect(oskar.motherId).toBe(who(s, 'Wenna').id);
    expect(isOrphan(s, oskar)).toBe(false);
  });

  it('an older child is asked first, and can say no', () => {
    const s = fresh();
    orphanTheVenns(s);
    const piet = who(s, 'Piet');
    const mira = who(s, 'Mira');
    adjacent(piet, mira);
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: mira.id }] }, 3);
    expect(mira.adoptiveParentIds).toEqual([]);
    expect(s.requests.some((r) => r.kind === 'adoption' && r.to === mira.id)).toBe(true);
    run(s, { [mira.id]: [{ type: 'respond_adoption', fromId: piet.id, accept: false }] }, 2);
    expect(mira.adoptiveParentIds).toEqual([]);
    expect(isOrphan(s, mira)).toBe(true);
    expect(piet.memories.some((m) => m.text.includes("didn't want me to adopt"))).toBe(true);

    // Asked again, she agrees; Piet becomes her parent and, as her only parent, his estate is hers.
    adjacent(piet, mira);
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: mira.id }] }, 3);
    run(s, { [mira.id]: [{ type: 'respond_adoption', fromId: piet.id, accept: true }] }, 2);
    expect(mira.adoptiveParentIds).toEqual([piet.id]);
    expect(mira.homeId).toBe(piet.homeId);
    expect(piet.childrenIds).toEqual([mira.id]);
    expect(mira.people[piet.id]?.role).toBe('father');
    piet.money = 50;
    const before = mira.money;
    piet.health = 0.01;
    piet.needs.water = 0;
    run(s, {}, 5);
    expect(piet.alive).toBe(false);
    expect(mira.money).toBe(before + 50);
    // Orphaned again.
    expect(isOrphan(s, mira)).toBe(true);
  });

  it("can't adopt a child who still has a parent, or without a home", () => {
    const s = fresh();
    const piet = who(s, 'Piet');
    const lise = who(s, 'Lise');
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: lise.id }] }, 2);
    expect(lise.adoptiveParentIds).toEqual([]);
    expect(piet.memories.some((m) => m.text.includes('still has a parent'))).toBe(true);

    orphanTheVenns(s);
    const oskar = who(s, 'Oskar');
    piet.homeId = null;
    adjacent(piet, oskar);
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: oskar.id }] }, 2);
    expect(oskar.adoptiveParentIds).toEqual([]);
    expect(piet.memories.some((m) => m.text.includes('no home'))).toBe(true);
  });

  it('a yes to someone who has since lost their home fails, and is not taken as a no', () => {
    const s = fresh();
    orphanTheVenns(s);
    const piet = who(s, 'Piet');
    const mira = who(s, 'Mira');
    adjacent(piet, mira);
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: mira.id }] }, 3);
    piet.homeId = null;
    run(s, { [mira.id]: [{ type: 'respond_adoption', fromId: piet.id, accept: true }] }, 2);
    expect(mira.adoptiveParentIds).toEqual([]);
    expect(mira.memories.some((m) => m.text.includes('no home to take me'))).toBe(true);
    expect(mira.memories.some((m) => m.text.includes("don't want to be adopted"))).toBe(false);
  });

  it('an older child asleep indoors is not asked until they are up', () => {
    const s = fresh();
    orphanTheVenns(s);
    const piet = who(s, 'Piet');
    const mira = who(s, 'Mira');
    const home = s.map.objects.find((o) => o.id === mira.homeId)!;
    mira.x = home.door!.x;
    mira.y = home.door!.y;
    mira.indoorsId = home.id;
    mira.asleep = true;
    mira.action = { type: 'sleep', since: s.tick };
    piet.x = home.door!.x + 1;
    piet.y = home.door!.y;
    run(s, { [piet.id]: [{ type: 'adopt_child', childId: mira.id }] }, 2);
    expect(s.requests.some((r) => r.kind === 'adoption')).toBe(false);
    expect(piet.memories.some((m) => m.text.includes('asleep indoors'))).toBe(true);
  });

  it('adoptive parents can name an unnamed baby', () => {
    const s = fresh();
    orphanTheVenns(s);
    const maren = who(s, 'Maren');
    const oskar = who(s, 'Oskar');
    oskar.named = false;
    adjacent(maren, oskar);
    run(s, { [maren.id]: [{ type: 'adopt_child', childId: oskar.id }] }, 3);
    run(s, { [maren.id]: [{ type: 'name_child', childId: oskar.id, name: 'Wim' }] }, 2);
    expect(oskar.name).toBe('Wim');
  });

  it('older saves load with nobody adopted', () => {
    const s = fresh();
    const data = serializeWorldState(s) as unknown as {
      version: number;
      agents: Record<string, unknown>[];
    };
    data.version = 7;
    for (const a of data.agents) delete a.adoptiveParentIds;
    const back = deserializeWorldState(JSON.parse(JSON.stringify(data)));
    expect(back.agents.every((a) => Array.isArray(a.adoptiveParentIds))).toBe(true);
  });
});
