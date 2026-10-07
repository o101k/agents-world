import { TICKS_PER_DAY, type Intent, type MapObject, type VillageKnowledge } from '@aw/shared';
import { remember, fullName, type Agent } from './agent.ts';
import { cheb, approach, emit, fail, objName, TALK_RANGE, witnesses, type Ctx } from './engine.ts';
import { feel } from './life.ts';
import { nameAsKnown } from './perception.ts';
import { distanceToObject, mapCache } from './spatial.ts';
import { findAgent, type Meeting, type Proposal, type Rule, type WorldState } from './world.ts';

/**
 * Village meetings, votes, rules, a leader, and the village purse (feature 7 of
 * docs/plans/growing-the-village.md).
 */

export type GovernanceIntent = Extract<
  Intent,
  { type: 'call_meeting' | 'propose_rule' | 'vote' | 'pay_from_treasury' }
>;

/** Hearing range for a called meeting. */
const CALL_RANGE = 12;
/** How close to the market you must be to attend, speak or vote. */
const SPOT_RANGE = 4;
const MEETING_LEAD = 60;
const MEETING_LENGTH = 90;
const JOIN_EVERY = 10;
const MAX_PROPOSALS = 5;
const LEVY_TICK = 6 * 60;

/** Drop a proposal's own closing punctuation before a sentence-ending period is added. */
const endSentence = (text: string) => text.replace(/[.!?]+$/, '');

const awareAt = (a: Agent) => a.alive && !a.asleep && !a.indoorsId;
const canTrigger = (a: Agent) => a.alive && !a.awaiting && !a.asleep;

function findMarket(state: WorldState): MapObject | undefined {
  return state.map.objects.find((o) => o.kind === 'market');
}

function marketOf(state: WorldState, meeting: Meeting): MapObject | undefined {
  return mapCache(state.map).byId.get(meeting.placeId);
}

/** The meeting open right now and within reach of the agent, if any. */
function openMeetingNear(state: WorldState, agent: Agent): Meeting | undefined {
  return state.meetings.find((m) => {
    if (state.tick < m.startTick || state.tick >= m.endTick) return false;
    const mk = marketOf(state, m);
    return mk !== undefined && distanceToObject(mk, agent) <= SPOT_RANGE;
  });
}

function dropMeetingId(state: WorldState, id: string): void {
  for (const a of state.agents) {
    const i = a.knownMeetings.indexOf(id);
    if (i >= 0) a.knownMeetings.splice(i, 1);
  }
}

function removeMeeting(state: WorldState, m: Meeting): void {
  state.meetings = state.meetings.filter((x) => x !== m);
  dropMeetingId(state, m.id);
}

/** The latest rule that set a levy (undefined if none ever did). */
function currentTax(state: WorldState): number {
  for (let i = state.rules.length - 1; i >= 0; i--) {
    const t = state.rules[i]!.tax;
    if (t !== undefined) return t;
  }
  return 0;
}

export function governanceAction(ctx: Ctx, agent: Agent, intent: GovernanceIntent): void {
  switch (intent.type) {
    case 'call_meeting':
      return callMeeting(ctx, agent, intent.topic);
    case 'propose_rule':
      return proposeRule(ctx, agent, intent);
    case 'vote':
      return vote(ctx, agent, intent.proposalId, intent.accept);
    case 'pay_from_treasury':
      return payFromTreasury(ctx, agent, intent);
  }
}

function callMeeting(ctx: Ctx, agent: Agent, topic: string): void {
  const { state } = ctx;
  const tick = state.tick;
  if (state.meetings.length > 0) return fail(ctx, agent, 'A meeting has already been called.');
  const market = findMarket(state);
  if (!market) return fail(ctx, agent, "There's no market to hold a meeting at.");
  const meeting: Meeting = {
    id: 'm' + state.nextMeetingNum++,
    caller: agent.id,
    topic,
    placeId: market.id,
    startTick: tick + MEETING_LEAD,
    endTick: tick + MEETING_LEAD + MEETING_LENGTH,
    proposals: [],
    attendees: [],
  };
  state.meetings.push(meeting);
  const place = objName(state, market.id);
  for (const a of state.agents) {
    if (!a.alive) continue;
    if (a !== agent && !(awareAt(a) && cheb(a, agent) <= CALL_RANGE)) continue;
    if (!a.knownMeetings.includes(meeting.id)) a.knownMeetings.push(meeting.id);
    if (a === agent) {
      remember(a, tick, `I called a village meeting at the market about “${topic}”, in an hour.`, 4, 'experience', [agent.id]);
      continue;
    }
    remember(
      a,
      tick,
      `${nameAsKnown(a, agent)} called a village meeting at the market about “${topic}”, in an hour.`,
      4,
      'experience',
      [agent.id],
    );
    if (a.age >= 13 && canTrigger(a)) {
      a.awaiting = {
        kind: 'meeting_called',
        byName: nameAsKnown(a, agent),
        topic,
        place,
        startsInMinutes: MEETING_LEAD,
      };
    }
  }
  agent.speech = { text: `A village meeting about ${topic}, at the market in an hour!`, until: tick + 30 };
  emit(ctx, 'meeting', [agent.id], `${fullName(agent)} called a village meeting about “${topic}”.`, 4);
  agent.action = { type: 'rest', until: tick + 3 };
}

/** Attendance: alive, awake, outdoors, grown enough, and within reach of the market. */
function isAttendee(a: Agent, market: MapObject): boolean {
  return a.age >= 13 && awareAt(a) && distanceToObject(market, a) <= SPOT_RANGE;
}

/** Once a tick: meetings opening and closing (votes counted), and the daily levy. */
export function governanceTick(ctx: Ctx): void {
  const { state } = ctx;
  const tick = state.tick;
  if (state.meetings.length > 0) {
    for (const m of state.meetings.slice()) {
      const market = marketOf(state, m);
      if (!market) {
        removeMeeting(state, m);
        continue;
      }
      if (tick === m.startTick) startMeeting(ctx, m, market);
      else if (tick > m.startTick && tick < m.endTick && (tick - m.startTick) % JOIN_EVERY === 0)
        joinNewcomers(state, m, market);
      else if (tick === m.endTick) closeMeeting(ctx, m);
    }
  }
  if (tick % TICKS_PER_DAY === LEVY_TICK) levy(ctx);
}

function startMeeting(ctx: Ctx, m: Meeting, market: MapObject): void {
  const { state } = ctx;
  const attendees = state.agents.filter((a) => isAttendee(a, market));
  if (attendees.length < 2) {
    emit(ctx, 'meeting', [m.caller], `Nobody came to the meeting about ${m.topic}.`, 2);
    const caller = findAgent(state, m.caller);
    if (caller) remember(caller, state.tick, `Nobody came to my meeting about “${m.topic}”.`, 4);
    removeMeeting(state, m);
    return;
  }
  m.attendees = attendees.map((a) => a.id);
  for (const a of attendees) {
    remember(a, state.tick, `The village meeting about “${m.topic}” has started.`, 3);
    if (canTrigger(a)) a.awaiting = { kind: 'meeting_open', topic: m.topic };
  }
  emit(
    ctx,
    'meeting',
    m.attendees.slice(0, 6),
    `The village meeting about ${m.topic} began with ${attendees.length} people.`,
    3,
  );
}

function joinNewcomers(state: WorldState, m: Meeting, market: MapObject): void {
  for (const a of state.agents) {
    if (m.attendees.includes(a.id) || !isAttendee(a, market)) continue;
    m.attendees.push(a.id);
    if (canTrigger(a)) a.awaiting = { kind: 'meeting_open', topic: m.topic };
  }
}

function closeMeeting(ctx: Ctx, m: Meeting): void {
  const { state } = ctx;
  removeMeeting(state, m);
  const attendees = m.attendees
    .map((id) => findAgent(state, id))
    .filter((a): a is Agent => a !== undefined && a.alive);
  for (const p of m.proposals) {
    const yes = attendees.filter((a) => p.votes[a.id] === true).length;
    const no = attendees.filter((a) => p.votes[a.id] === false).length;
    const passed = yes > no && yes >= 2;
    if (passed) {
      const rule: Rule = {
        id: 'r' + state.nextRuleNum++,
        text: p.text,
        proposer: p.by,
        passedTick: state.tick,
      };
      if (p.tax !== undefined) rule.tax = p.tax;
      if (p.leaderId !== undefined) {
        rule.leaderId = p.leaderId;
        const leader = findAgent(state, p.leaderId);
        if (leader?.alive) state.leaderId = leader.id;
      }
      state.rules.push(rule);
      emit(ctx, 'rule_passed', [p.by], `The village agreed: ${p.text}`, 4);
    } else {
      emit(ctx, 'meeting', [p.by], `The village voted down: ${p.text}`, 2);
    }
    for (const a of attendees) {
      remember(
        a,
        state.tick,
        passed
          ? `The village agreed: ${endSentence(p.text)}.`
          : `The village voted down: ${endSentence(p.text)}.`,
        passed ? 6 : 4,
      );
    }
  }
  for (const a of attendees) readNoticeBoard(state, a);
}

function levy(ctx: Ctx): void {
  const { state } = ctx;
  const tax = currentTax(state);
  if (tax <= 0) return;
  let paid = 0;
  let total = 0;
  for (const a of state.agents) {
    if (!a.alive || a.age < 18) continue;
    if (a.money >= tax) {
      a.money -= tax;
      state.treasury += tax;
      paid += 1;
      total += tax;
    } else {
      remember(a, state.tick, "I couldn't pay the village levy.", 3);
    }
  }
  if (paid > 0) emit(ctx, 'treasury', [], `${paid} people paid the levy (${total} coins).`, 2);
}

function proposeRule(ctx: Ctx, agent: Agent, intent: Extract<Intent, { type: 'propose_rule' }>): void {
  const { state } = ctx;
  const tick = state.tick;
  const meeting = openMeetingNear(state, agent);
  if (!meeting) return fail(ctx, agent, 'There is no meeting here to propose that at.');
  if (meeting.proposals.length >= MAX_PROPOSALS)
    return fail(ctx, agent, 'There is no time left for more proposals.');
  if (intent.leaderId !== undefined) {
    const leader = findAgent(state, intent.leaderId);
    if (!leader || !leader.alive || leader.age < 18)
      return fail(ctx, agent, "That person can't be made leader.");
  }
  const proposal: Proposal = {
    id: 'p' + state.nextProposalNum++,
    by: agent.id,
    text: intent.text,
    votes: { [agent.id]: true },
  };
  if (intent.tax !== undefined) proposal.tax = intent.tax;
  if (intent.leaderId !== undefined) proposal.leaderId = intent.leaderId;
  meeting.proposals.push(proposal);
  if (!meeting.attendees.includes(agent.id)) meeting.attendees.push(agent.id);
  agent.speech = { text: `I propose: ${intent.text}`, until: tick + 30 };
  emit(ctx, 'meeting', [agent.id], `${fullName(agent)} proposed: ${intent.text}`, 3);
  const market = marketOf(state, meeting)!;
  for (const id of meeting.attendees) {
    if (id === agent.id) continue;
    const other = findAgent(state, id);
    if (!other || !other.alive || other.asleep || other.indoorsId) continue;
    if (distanceToObject(market, other) > SPOT_RANGE) continue;
    remember(
      other,
      tick,
      `${nameAsKnown(other, agent)} proposed at the village meeting: “${endSentence(intent.text)}”.`,
      4,
      'experience',
      [agent.id],
    );
    if (canTrigger(other)) {
      other.awaiting = {
        kind: 'rule_proposed',
        proposalId: proposal.id,
        byName: nameAsKnown(other, agent),
        text: intent.text,
      };
    }
  }
  agent.action = { type: 'rest', until: tick + 3 };
}

function vote(ctx: Ctx, agent: Agent, proposalId: string, accept: boolean): void {
  const { state } = ctx;
  const meeting = openMeetingNear(state, agent);
  const proposal = meeting?.proposals.find((p) => p.id === proposalId);
  if (!meeting || !proposal) return fail(ctx, agent, 'There is no such proposal here.');
  proposal.votes[agent.id] = accept;
  if (!meeting.attendees.includes(agent.id)) meeting.attendees.push(agent.id);
  const word = accept ? 'for' : 'against';
  emit(ctx, 'meeting', [agent.id], `${fullName(agent)} voted ${word}: ${proposal.text}`, 1);
  remember(agent, state.tick, `I voted ${word} “${proposal.text}”.`, 2);
  agent.action = { type: 'rest', until: state.tick + 2 };
}

function payFromTreasury(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'pay_from_treasury' }>,
): void {
  const { state } = ctx;
  const coins = Math.floor(intent.coins);
  if (state.leaderId !== agent.id)
    return fail(ctx, agent, 'Only the village leader can spend the village purse.');
  if (!(coins > 0)) return fail(ctx, agent, 'I meant to pay from the purse but chose no coins.');
  if (coins > state.treasury) return fail(ctx, agent, "The purse doesn't hold that much.");
  const other = findAgent(state, intent.agentId);
  if (!other || !other.alive) return fail(ctx, agent, "I can't pay someone who isn't here.");
  if (other === agent) return fail(ctx, agent, "I can't pay myself from the purse.");
  if (!approach(ctx, agent, other, intent, TALK_RANGE, 'pay')) return;
  state.treasury -= coins;
  other.money += coins;
  const tick = state.tick;
  emit(
    ctx,
    'treasury',
    [agent.id, other.id],
    `${fullName(agent)} paid ${coins} coins from the village purse to ${fullName(other)}.`,
    4,
  );
  remember(
    agent,
    tick,
    `I paid ${coins} coins from the village purse to ${nameAsKnown(agent, other)}.`,
    5,
    'experience',
    [other.id],
  );
  remember(
    other,
    tick,
    `${nameAsKnown(other, agent)} paid me ${coins} coins from the village purse.`,
    5,
    'experience',
    [agent.id],
  );
  for (const w of witnesses(state, agent, other)) {
    remember(
      w,
      tick,
      `I saw ${nameAsKnown(w, agent)} pay ${coins} coins from the village purse to ${nameAsKnown(w, other)}.`,
      4,
      'experience',
      [agent.id, other.id],
    );
  }
  feel(other, agent, tick, { trust: 3 });
  agent.action = { type: 'rest', until: tick + 3 };
}

/** Standing by the market: read the notice board (rules, leader, the purse). */
export function readNoticeBoard(state: WorldState, agent: Agent): void {
  agent.noticeBoard = {
    tick: state.tick,
    ruleIds: state.rules.map((r) => r.id),
    leaderId: state.leaderId,
    treasury: state.treasury,
    taxPerDay: currentTax(state),
  };
  for (const m of state.meetings) {
    if (!agent.knownMeetings.includes(m.id)) agent.knownMeetings.push(m.id);
  }
}

/** What this person knows of meetings, rules and the leader (undefined = nothing to tell). */
export function villageKnowledge(state: WorldState, agent: Agent): VillageKnowledge | undefined {
  const board = agent.noticeBoard;
  const here = openMeetingNear(state, agent);
  const meetings = state.meetings.filter((m) => agent.knownMeetings.includes(m.id) || m === here);
  if (!board && meetings.length === 0 && !here) return undefined;

  const leader = board?.leaderId ? findAgent(state, board.leaderId) : undefined;
  const rules = board
    ? board.ruleIds
        .map((id) => state.rules.find((r) => r.id === id))
        .filter((r): r is Rule => r !== undefined)
        .map((r) => r.text)
    : [];

  return {
    leader: leader?.alive ? { id: leader.id, name: nameAsKnown(agent, leader) } : null,
    rules,
    treasury: board ? board.treasury : null,
    taxPerDay: board ? board.taxPerDay : 0,
    meetings: meetings.map((m) => {
      const mk = marketOf(state, m);
      return {
        id: m.id,
        topic: m.topic,
        place: mk ? objName(state, mk.id) : 'the market',
        placeId: m.placeId,
        startsInMinutes: m.startTick - state.tick,
        open: state.tick >= m.startTick,
      };
    }),
    proposals: here
      ? here.proposals.map((p) => {
          const by = findAgent(state, p.by);
          const leaderOfRule = p.leaderId !== undefined ? findAgent(state, p.leaderId) : undefined;
          const view: VillageKnowledge['proposals'][number] = {
            id: p.id,
            byName: by ? nameAsKnown(agent, by) : 'someone',
            text: p.text,
            voted: p.votes[agent.id] !== undefined,
          };
          if (p.tax !== undefined) view.tax = p.tax;
          if (leaderOfRule) view.leaderName = nameAsKnown(agent, leaderOfRule);
          return view;
        })
      : [],
  };
}
