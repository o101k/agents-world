import type { Decision, ItemName, Perception } from '@aw/shared';

/**
 * Mock brain: Hiring people for a daily wage.
 * Offers are judged on the wage; a worker with a surplus gives a little to the employer.
 */

/** Answer a trigger this feature causes (an offer, a meeting...). null = not ours. */
export function reply(p: Perception, _roll: number): Decision | null {
  const t = p.trigger;
  if (t.kind !== 'job_offer' || !p.canDo.includes('respond_job')) return null;
  const yes = t.wage >= 4 || p.self.money < 15;
  return {
    thought: yes
      ? `${t.fromName} will pay ${t.wage} coins a day. That's fair.`
      : `${t.fromName}'s wage is too low for me.`,
    goal: yes ? 'Take the work' : 'Turn the work down',
    plan: [{ type: 'respond_job', fromId: t.fromId, accept: yes }],
  };
}

/** Now and then, choose to do this feature's work. null = not now. */
export function plan(p: Perception, roll: number): Decision | null {
  const occ = p.self.occupation.toLowerCase();
  const jobs = p.jobs ?? [];

  // A baker, farmer or carpenter with savings and no one working for them hires a helper.
  if (
    p.canDo.includes('hire') &&
    /baker|farmer|carpenter/.test(occ) &&
    p.self.money >= 60 &&
    roll < 0.03
  ) {
    const employs = jobs.some((j) => j.role === 'employer');
    const known = p.visibleAgents.find((a) => p.knownPeople.some((k) => k.id === a.id));
    if (!employs && known) {
      return {
        thought: `I could use a hand. ${known.name} could help me for 5 coins a day.`,
        goal: 'Hire help',
        plan: [{ type: 'hire', agentId: known.id, wage: 5, days: 3 }],
      };
    }
  }

  // A worker with a surplus of some good shares a little with the employer.
  const working = jobs.find((j) => j.role === 'worker');
  if (working && p.canDo.includes('give') && roll < 0.1) {
    const surplus = Object.entries(p.self.inventory).find(([, n]) => (n ?? 0) > 4);
    if (surplus) {
      const [item] = surplus;
      return {
        thought: `I'll give ${working.otherName} some of my ${item}. They've been good to me.`,
        goal: 'Keep the employer happy',
        plan: [
          {
            type: 'give',
            agentId: working.otherId,
            gift: { item: item as ItemName, quantity: 2 },
          },
        ],
      };
    }
  }
  return null;
}
