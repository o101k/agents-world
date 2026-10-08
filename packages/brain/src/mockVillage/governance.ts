import type { Decision, Perception } from '@aw/shared';

/**
 * Mock brain: Village meetings, rules, a leader and the purse.
 * See docs/plans/growing-the-village.md (feature 7).
 */

const TOPICS = ['How to share the fields', 'Building a new well', 'A village purse'];

const RULES: { text: string; tax?: number }[] = [
  { text: "Nobody takes crops from another's field." },
  { text: 'Every grown-up pays 1 coin a day into the village purse.', tax: 1 },
];

function decision(thought: string, goal: string, plan: Decision['plan']): Decision {
  return { thought, goal, plan };
}

/** Whether the mock would back a proposal or vote for it. */
function inFavour(p: Perception, roll: number): boolean {
  return p.personality.agreeableness > 40 || roll < 0.5;
}

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(p: Perception, roll: number): Decision | null {
  const t = p.trigger;
  if (t.kind === 'meeting_called') {
    if (p.self.age < 18 || roll >= 0.6) return null;
    const place = p.village?.meetings.find((m) => m.topic === t.topic)?.placeId;
    if (!place) return null;
    return decision(
      `A village meeting about ${t.topic} is called. I'll go and hear what's said.`,
      'Go to the meeting',
      [
        { type: 'go_to', target: { objectId: place } },
        { type: 'rest', minutes: 90 },
      ],
    );
  }
  if (t.kind === 'meeting_open') {
    const proposals = p.village?.proposals ?? [];
    if (proposals.length === 0 && p.personality.agreeableness > 55) {
      const options = [...RULES];
      const trusted = p.knownPeople.slice().sort((a, b) => b.trust - a.trust)[0];
      if (trusted && trusted.trust > 0) {
        options.push({ text: `Elect ${trusted.name} as village leader.` });
      }
      const pick = options[Math.min(options.length - 1, Math.floor(roll * options.length))]!;
      const elect = pick.text.startsWith('Elect ') ? trusted : undefined;
      const intent = {
        type: 'propose_rule' as const,
        text: pick.text,
        ...(pick.tax !== undefined ? { tax: pick.tax } : {}),
        ...(elect ? { leaderId: elect.id } : {}),
      };
      return decision(
        'Something the village needs settled. I will say what I think.',
        'Propose a rule',
        [intent],
      );
    }
    const open = proposals.find((x) => !x.voted);
    if (!open) return null;
    return decision('A proposal is being voted on. I should have my say.', 'Vote', [
      { type: 'vote', proposalId: open.id, accept: inFavour(p, roll) },
    ]);
  }
  if (t.kind === 'rule_proposed') {
    const tax = p.village?.proposals.find((x) => x.id === t.proposalId)?.tax ?? 0;
    const accept = tax > 2 && p.self.money < 20 ? false : inFavour(p, roll);
    return decision(`${t.byName} has proposed something at the meeting. I'll vote.`, 'Vote', [
      { type: 'vote', proposalId: t.proposalId, accept },
    ]);
  }
  return null;
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  const village = p.village;
  // An extraverted grown-up with no meeting in view now and then calls one.
  if (
    (village?.meetings.length ?? 0) === 0 &&
    p.self.age >= 18 &&
    p.personality.extraversion > 70 &&
    roll < 0.004
  ) {
    const topic = TOPICS[Math.min(TOPICS.length - 1, Math.floor((roll / 0.004) * TOPICS.length))]!;
    return decision('The village has no meeting going. I should call one.', 'Call a meeting', [
      { type: 'call_meeting', topic },
    ]);
  }
  // The leader with a purse of 20+ now and then pays 5 coins to someone they know who is near.
  if (village?.leader?.id === p.agentId && (village.treasury ?? 0) >= 20 && roll < 0.05) {
    const near = p.visibleAgents.find((v) => p.knownPeople.some((k) => k.id === v.id));
    if (near) {
      return decision(`The purse can spare a little. ${near.name} could use it.`, 'Pay from the purse', [
        { type: 'pay_from_treasury', agentId: near.id, coins: 5 },
      ]);
    }
  }
  return null;
}
