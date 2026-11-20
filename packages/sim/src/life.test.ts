import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, type Intent } from '@aw/shared';
import type { Agent } from './agent.ts';
import { step, type TickInput } from './engine.ts';
import { canDo, fertility, oldAgeRisk } from './life.ts';
import { createWorldState, type WorldState } from './world.ts';

function fresh(): WorldState {
  const s = createWorldState({ seed: 'life-test', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
  }
  return s;
}
const who = (s: WorldState, name: string) => s.agents.find((a) => a.name === name)!;

/** Give each named agent a plan on the first tick; answer everyone else with a long rest. */
function run(s: WorldState, plans: Record<string, Intent[]>, ticks: number): void {
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
    step(s, inputs);
  }
}

function adjacent(a: Agent, b: Agent) {
  b.x = a.x + 1;
  b.y = a.y;
}

describe('life cycle', () => {
  it('limits what the young can do', () => {
    const s = fresh();
    const lise = who(s, 'Lise'); // 6 months
    const oskar = who(s, 'Oskar'); // 2 years
    const mira = who(s, 'Mira'); // 7 years
    expect(canDo(lise, 'go_to')).toBe(false);
    expect(canDo(lise, 'talk_to')).toBe(true);
    expect(canDo(oskar, 'go_to')).toBe(true);
    expect(canDo(oskar, 'buy')).toBe(false);
    expect(canDo(mira, 'buy')).toBe(true);
    expect(canDo(mira, 'try_for_child')).toBe(false);
    // Babies stay indoors at home.
    run(s, {}, 2);
    expect(lise.indoorsId).toBe(lise.homeId);
  });

  it('babies babble, and a parent can feed them', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const lise = who(s, 'Lise');
    const home = s.map.objects.find((o) => o.id === maren.homeId)!;
    maren.x = home.door!.x;
    maren.y = home.door!.y;
    maren.inventory = { bread: 2 };
    lise.needs.food = 20;
    lise.needs.water = 20;
    run(s, { [maren.id]: [{ type: 'feed', agentId: lise.id, item: 'bread' }] }, 5);
    expect(lise.needs.food).toBeGreaterThan(50);
    expect(lise.needs.water).toBeGreaterThan(95);
    expect(maren.inventory.bread).toBe(1);
    lise.asleep = false;
    lise.action = null;
    run(
      s,
      {
        [lise.id]: [
          {
            type: 'talk_to',
            agentId: maren.id,
            message: 'Please give me some more bread, mother dear',
          },
        ],
      },
      3,
    );
    expect(lise.recent.at(-1)?.text).not.toContain('bread, mother dear'); // babies can't say sentences
  });

  it('partners who both agree can conceive; the child inherits from both', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    adjacent(maren, tobias);
    // Try repeatedly on separate days until conception (chance-based but fertile, healthy, 34).
    for (let day = 0; day < 20 && !maren.pregnancy; day++) {
      run(s, { [maren.id]: [{ type: 'try_for_child', agentId: tobias.id }] }, 3);
      run(
        s,
        { [tobias.id]: [{ type: 'respond_child_request', fromId: maren.id, accept: true }] },
        3,
      );
      maren.lastChildTry = -1e9;
      tobias.lastChildTry = -1e9;
      tobias.asleep = false;
      tobias.indoorsId = null;
      tobias.action = null;
      adjacent(maren, tobias);
    }
    expect(maren.pregnancy?.fatherId).toBe(tobias.id);
    // Skip ahead: finish the pregnancy.
    maren.pregnancy!.progress = 0.749;
    const before = s.agents.length;
    run(s, {}, 30);
    expect(s.agents.length).toBe(before + 1);
    const baby = s.agents.at(-1)!;
    expect(baby.motherId).toBe(maren.id);
    expect(baby.fatherId).toBe(tobias.id);
    expect(baby.familyName).toBe('Holt');
    expect(maren.childrenIds).toContain(baby.id);
    expect([maren.appearance.skin, tobias.appearance.skin, expect.any(String)]).toContainEqual(
      baby.appearance.skin,
    );
    expect(baby.personality.openness).toBeGreaterThanOrEqual(5);
    // Parents name the baby.
    run(s, { [tobias.id]: [{ type: 'name_child', childId: baby.id, name: 'Wilma' }] }, 2);
    expect(baby.name).toBe('Wilma');
    expect(baby.named).toBe(true);
  });

  it('enforces 1-day child cooldown, re-verifies partnership, and sleeps indoors at home door', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    const home = s.map.objects.find((o) => o.id === tobias.homeId)!;
    tobias.x = home.door!.x;
    tobias.y = home.door!.y;
    maren.x = home.door!.x + 1;
    maren.y = home.door!.y;
    tobias.indoorsId = null;
    maren.indoorsId = null;
    run(s, { [maren.id]: [{ type: 'try_for_child', agentId: tobias.id }] }, 2);
    run(s, { [tobias.id]: [{ type: 'respond_child_request', fromId: maren.id, accept: true }] }, 2);
    // Proper indoor check: sleeping at own home door puts responder indoors.
    if (!maren.pregnancy || tobias.asleep) expect(tobias.indoorsId).toBe(tobias.homeId);
    // Immediate retry within 1 day is blocked by lastChildTry cooldown.
    tobias.asleep = false;
    tobias.indoorsId = null;
    tobias.action = null;
    run(s, { [maren.id]: [{ type: 'try_for_child', agentId: tobias.id }] }, 2);
    expect(maren.recent.some((r) => r.text.includes('wait another day'))).toBe(true);
    // If partnership ends before response, respond_child_request rejects.
    maren.lastChildTry = -1e9;
    tobias.lastChildTry = -1e9;
    run(s, { [maren.id]: [{ type: 'try_for_child', agentId: tobias.id }] }, 2);
    maren.partnerId = null;
    tobias.partnerId = null;
    run(s, { [tobias.id]: [{ type: 'respond_child_request', fromId: maren.id, accept: true }] }, 2);
    expect(tobias.recent.some((r) => r.text.includes('no longer partners'))).toBe(true);
  });

  it('guards dead targets in name_child, declare_will, and giveBirth, and gives heirs building knowledge', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    const piet = who(s, 'Piet');
    // Dead heir rejected in declare_will.
    piet.alive = false;
    run(s, { [maren.id]: [{ type: 'declare_will', agentId: piet.id }] }, 2);
    expect(maren.will).toBeNull();
    // giveBirth does not notify dead father or wake asleep mother with awaiting.
    tobias.alive = false;
    const deadFatherMemories = tobias.memories.length;
    maren.pregnancy = { fatherId: tobias.id, progress: 0.749, known: true };
    maren.asleep = true;
    maren.action = { type: 'sleep', since: s.tick };
    run(s, {}, 20);
    const baby = s.agents.at(-1)!;
    expect(tobias.memories.length).toBe(deadFatherMemories);
    expect(maren.awaiting).toBeNull();
    // Dead child rejected in name_child.
    baby.alive = false;
    maren.asleep = false;
    maren.action = null;
    run(s, { [maren.id]: [{ type: 'name_child', childId: baby.id, name: 'Ghost' }] }, 2);
    expect(baby.named).toBe(false);
    // Heir gains knowledge of inherited buildings.
    const jory = who(s, 'Jory');
    delete jory.knowledge[maren.homeId!];
    maren.will = { heirId: jory.id };
    maren.health = 0.01;
    maren.needs.water = 0;
    run(s, {}, 5);
    expect(jory.knowledge[maren.homeId!]).toBeDefined();
  });

  it('infants cannot walk across the map via approach', () => {
    const s = fresh();
    const lise = who(s, 'Lise'); // 6 months
    const piet = who(s, 'Piet');
    piet.x = lise.x + 10;
    piet.y = lise.y;
    piet.indoorsId = null;
    lise.asleep = false;
    lise.action = null;
    run(s, { [lise.id]: [{ type: 'talk_to', agentId: piet.id, message: 'hi' }] }, 3);
    expect((lise.action as { type: string } | null)?.type).not.toBe('walk');
    expect(lise.recent.some((r) => r.text.includes('too little'))).toBe(true);
  });

  it('refuses conception when the answer is no', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    adjacent(maren, tobias);
    run(s, { [maren.id]: [{ type: 'try_for_child', agentId: tobias.id }] }, 3);
    run(
      s,
      { [tobias.id]: [{ type: 'respond_child_request', fromId: maren.id, accept: false }] },
      3,
    );
    expect(maren.pregnancy).toBeNull();
    expect(tobias.memories.some((m) => m.text.includes('not ready'))).toBe(true);
  });

  it('proposals create partnerships and a shared home', () => {
    const s = fresh();
    const jory = who(s, 'Jory');
    const piet = who(s, 'Piet');
    adjacent(jory, piet);
    run(s, { [jory.id]: [{ type: 'propose_partnership', agentId: piet.id }] }, 3);
    run(s, { [piet.id]: [{ type: 'respond_proposal', fromId: jory.id, accept: true }] }, 2);
    expect(jory.partnerId).toBe(piet.id);
    expect(piet.partnerId).toBe(jory.id);
    expect(jory.people[piet.id]?.role).toBe('partner');
    expect(jory.homeId).toBe(piet.homeId);
  });

  it('estates pass to the will, the partner, or the children', () => {
    const s = fresh();
    const maren = who(s, 'Maren');
    const tobias = who(s, 'Tobias');
    const piet = who(s, 'Piet');
    maren.money = 100;
    maren.inventory = { fish: 4 };
    // No will: partner inherits.
    maren.health = 0.01;
    maren.needs.water = 0;
    run(s, {}, 5);
    expect(maren.alive).toBe(false);
    expect(tobias.money).toBe(12 + 100);
    expect(tobias.inventory.fish).toBe(2 + 4);
    // With a will: the named heir inherits (and co-owns the house).
    tobias.will = { heirId: piet.id };
    const pietMoney = piet.money;
    tobias.health = 0.01;
    tobias.needs.water = 0;
    run(s, {}, 5);
    expect(tobias.alive).toBe(false);
    expect(piet.money).toBe(pietMoney + 112);
    expect(s.owners[tobias.homeId!]).toContain(piet.id);
  });

  it('old age and fertility follow sensible curves', () => {
    expect(oldAgeRisk(40, 1)).toBe(0);
    expect(oldAgeRisk(80, 1)).toBeGreaterThan(oldAgeRisk(60, 1) * 5);
    expect(oldAgeRisk(80, 1.2)).toBeLessThan(oldAgeRisk(80, 0.8));
    expect(fertility(16)).toBe(0);
    expect(fertility(30)).toBe(1);
    expect(fertility(44)).toBeLessThan(0.5);
    expect(fertility(50)).toBe(0);
  });

  it('children grow up over the years (and the aging slider changes the pace)', () => {
    const s = fresh();
    const mira = who(s, 'Mira');
    const age0 = mira.age;
    run(s, {}, TICKS_PER_DAY);
    expect(mira.age - age0).toBeCloseTo(1 / 4, 2); // 4 days per year
    step(s, [{ kind: 'set_days_per_year', value: 2 }]);
    for (const a of s.agents) a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    const age1 = mira.age;
    run(s, {}, TICKS_PER_DAY);
    expect(mira.alive).toBe(true);
    expect(mira.age - age1).toBeCloseTo(1 / 2, 2);
  });
});
