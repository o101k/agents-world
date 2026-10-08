import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, type Intent } from '@aw/shared';
import { interactionTiles } from './spatial.ts';
import { step, type TickInput } from './engine.ts';
import { createWorldState, type WorldState } from './world.ts';
import { readNoticeBoard, villageKnowledge } from './governance.ts';

/** Ask one person to act on a plan right now (other people get no decisions). */
function act(state: WorldState, agentId: string, plan: Intent[]): void {
  const inputs: TickInput[] = [
    { kind: 'decision', agentId, decision: { thought: '', goal: '', plan } },
  ];
  step(state, inputs);
}

/** Tick forward until `done` holds (or `max` ticks pass). */
function until(state: WorldState, done: () => boolean, max = 400): void {
  for (let i = 0; i < max && !done(); i++) step(state);
}

function fresh(): WorldState {
  const s = createWorldState({ seed: 'gov', mapSize: 'small' });
  for (const a of s.agents) {
    a.needs = { food: 100, water: 100, energy: 100, warmth: 100 };
    a.awaiting = null;
    a.age = 30;
  }
  return s;
}

/** Only the named people stay alive; everyone else is taken out of the story. */
function onlyPeople(s: WorldState, ids: string[]): void {
  for (const a of s.agents) {
    if (!ids.includes(a.id)) a.alive = false;
  }
}

/** Stand a person on the first tile by the market; `near` takes the next tile over. */
function atMarket(s: WorldState, id: string, slot = 0): void {
  const market = s.map.objects.find((o) => o.kind === 'market')!;
  const t = interactionTiles(s.map, market)[slot]!;
  const a = s.agents.find((x) => x.id === id)!;
  a.x = t.x;
  a.y = t.y;
  a.indoorsId = null;
  a.asleep = false;
}

describe('governance: meetings', () => {
  it('calling a meeting reaches people nearby and gives adults a trigger', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    atMarket(s, 'a2', 1);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'Building a new well' }]);
    expect(s.meetings).toHaveLength(1);
    const m = s.meetings[0]!;
    expect(m.topic).toBe('Building a new well');
    const a1 = s.agents.find((a) => a.id === 'a1')!;
    const a2 = s.agents.find((a) => a.id === 'a2')!;
    expect(a1.knownMeetings).toContain(m.id);
    expect(a2.knownMeetings).toContain(m.id);
    expect(a2.awaiting?.kind).toBe('meeting_called');
  });

  it('refuses a second meeting while one is called', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'First' }]);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'Second' }]);
    expect(s.meetings).toHaveLength(1);
    expect(s.meetings[0]!.topic).toBe('First');
  });

  it('opens with attendees, and fizzles with fewer than two', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    atMarket(s, 'a2', 1);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'Opening' }]);
    const m = s.meetings[0]!;
    // Pretend a2 has answered each earlier prompt, so the opening prompt is the one left.
    const a2 = s.agents.find((a) => a.id === 'a2')!;
    until(s, () => {
      a2.awaiting = null;
      return s.tick >= m.startTick - 1;
    });
    step(s);
    expect(s.meetings[0]!.attendees.sort()).toEqual(['a1', 'a2']);
    expect(s.agents.find((a) => a.id === 'a2')!.awaiting?.kind).toBe('meeting_open');

    const lone = fresh();
    onlyPeople(lone, ['a1']);
    atMarket(lone, 'a1', 0);
    act(lone, 'a1', [{ type: 'call_meeting', topic: 'Nobody' }]);
    const lm = lone.meetings[0]!;
    until(lone, () => lone.tick > lm.endTick);
    expect(lone.meetings).toHaveLength(0);
  });
});

describe('governance: rules', () => {
  it('a proposal with two yes votes passes at the end and becomes a rule', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    atMarket(s, 'a2', 1);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'Fields' }]);
    const m = s.meetings[0]!;
    until(s, () => s.tick >= m.startTick);
    act(s, 'a1', [{ type: 'propose_rule', text: 'Nobody takes crops from another field.' }]);
    const proposal = s.meetings[0]!.proposals[0]!;
    expect(proposal.text).toBe('Nobody takes crops from another field.');
    act(s, 'a2', [{ type: 'vote', proposalId: proposal.id, accept: true }]);
    expect(s.meetings[0]!.proposals[0]!.votes.a2).toBe(true);
    until(s, () => s.meetings.length === 0);
    expect(s.rules).toHaveLength(1);
    expect(s.rules[0]!.text).toBe('Nobody takes crops from another field.');
  });

  it('a proposal that elects a leader makes them leader', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    atMarket(s, 'a2', 1);
    act(s, 'a1', [{ type: 'call_meeting', topic: 'Leader' }]);
    const m = s.meetings[0]!;
    until(s, () => s.tick >= m.startTick);
    act(s, 'a1', [{ type: 'propose_rule', text: 'Elect Bram.', leaderId: 'a2' }]);
    const proposal = s.meetings[0]!.proposals[0]!;
    act(s, 'a2', [{ type: 'vote', proposalId: proposal.id, accept: true }]);
    until(s, () => s.meetings.length === 0);
    expect(s.leaderId).toBe('a2');
  });

  it('the levy is collected from grown-ups at 06:00', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    s.rules.push({ id: 'r1', text: 'Pay up', tax: 2, proposer: 'a1', passedTick: 0 });
    const a1 = s.agents.find((a) => a.id === 'a1')!;
    const a2 = s.agents.find((a) => a.id === 'a2')!;
    a1.money = 10;
    a2.money = 1;
    until(s, () => s.tick % TICKS_PER_DAY === 6 * 60, TICKS_PER_DAY + 10);
    expect(a1.money).toBe(8);
    expect(a2.money).toBe(1);
    expect(s.treasury).toBe(2);
  });
});

describe('governance: the purse', () => {
  it('only the leader can pay from the purse', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    atMarket(s, 'a1', 0);
    atMarket(s, 'a2', 1);
    s.treasury = 50;
    s.leaderId = 'a2';
    const a1 = s.agents.find((a) => a.id === 'a1')!;
    const a2 = s.agents.find((a) => a.id === 'a2')!;
    a1.money = 0;
    a2.money = 0;
    act(s, 'a1', [{ type: 'pay_from_treasury', agentId: 'a2', coins: 10 }]);
    expect(s.treasury).toBe(50);
    expect(a2.money).toBe(0);

    act(s, 'a2', [{ type: 'pay_from_treasury', agentId: 'a1', coins: 10 }]);
    // The leader walks over to pay, so give it time.
    until(s, () => a1.money === 10);
    expect(s.treasury).toBe(40);
    expect(a1.money).toBe(10);
  });

  it('reading the notice board shows the leader, rules and purse', () => {
    const s = fresh();
    onlyPeople(s, ['a1', 'a2']);
    s.treasury = 12;
    s.leaderId = 'a2';
    s.rules.push({ id: 'r1', text: 'Keep the well clean.', proposer: 'a1', passedTick: 0 });
    const a1 = s.agents.find((a) => a.id === 'a1')!;
    expect(villageKnowledge(s, a1)).toBeUndefined();
    readNoticeBoard(s, a1);
    const k = villageKnowledge(s, a1)!;
    expect(k.rules).toEqual(['Keep the well clean.']);
    expect(k.treasury).toBe(12);
    expect(k.leader?.id).toBe('a2');
  });
});
