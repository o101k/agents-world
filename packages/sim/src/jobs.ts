import { TICKS_PER_DAY, tickToClock, type Intent, type JobView } from '@aw/shared';
import { remember, fullName, type Agent } from './agent.ts';
import { approach, emit, fail, meet, TALK_RANGE, type Ctx } from './engine.ts';
import { feel } from './life.ts';
import { nameAsKnown } from './perception.ts';
import { findAgent, type Contract, type WorldState } from './world.ts';

/**
 * Hiring people for a daily wage (feature 6 of docs/plans/growing-the-village.md).
 *
 * An employer offers a wage per day for a number of days; the worker accepts or declines. An
 * agreement is a `Contract` in the world. Wages are paid at 20:00 each day. It ends when its
 * days run out, when either person dies, when someone ends it, or when the employer can't pay.
 */

export type JobIntent = Extract<Intent, { type: 'hire' | 'respond_job' | 'end_job' }>;

/** The agreement between two people, whichever way round they are. */
function agreementBetween(state: WorldState, a: Agent, b: Agent): Contract | undefined {
  return state.contracts.find(
    (c) => (c.employer === a.id && c.worker === b.id) || (c.employer === b.id && c.worker === a.id),
  );
}

/** Let someone know a work agreement has ended (only if they can still take it in). */
function tellEnded(other: Agent, byName: string, reason: string) {
  if (other.awaiting || other.asleep || !other.alive) return;
  other.awaiting = { kind: 'job_ended', byName, reason };
}

export function jobAction(ctx: Ctx, agent: Agent, intent: JobIntent): void {
  const { state } = ctx;
  const tick = state.tick;

  if (intent.type === 'hire') {
    const other = findAgent(state, intent.agentId);
    if (!other || other === agent)
      return fail(ctx, agent, "The person I wanted to hire isn't here.");
    const who = nameAsKnown(agent, other);
    if (other.alive && other.age < 13)
      return fail(ctx, agent, `${who} is too young to work for me.`);
    if (state.contracts.some((c) => c.employer === agent.id && c.worker === other.id))
      return fail(ctx, agent, `${who} already works for me.`);
    if (agent.money < intent.wage) return fail(ctx, agent, "I can't afford to pay a wage.");
    if (!approach(ctx, agent, other, intent, TALK_RANGE, 'speak with')) return;

    state.requests = state.requests.filter(
      (r) => !(r.kind === 'job' && r.from === agent.id && r.to === other.id),
    );
    state.requests.push({
      kind: 'job',
      from: agent.id,
      to: other.id,
      tick,
      terms: { wage: intent.wage, days: intent.days },
    });
    agent.speech = {
      text: `Will you work for me? ${intent.wage} coins a day, for ${intent.days} days.`,
      until: tick + 30,
    };
    emit(
      ctx,
      'job',
      [agent.id, other.id],
      `${fullName(agent)} offered ${fullName(other)} work at ${intent.wage} coins a day for ${intent.days} days.`,
      2,
    );
    remember(
      agent,
      tick,
      `I offered ${who} work at ${intent.wage} coins a day for ${intent.days} days.`,
      4,
      'conversation',
      [other.id],
    );
    meet(other, agent, tick, true);
    remember(
      other,
      tick,
      `${nameAsKnown(other, agent)} offered me work at ${intent.wage} coins a day for ${intent.days} days.`,
      4,
      'conversation',
      [agent.id],
    );
    if (!other.awaiting && !other.asleep)
      other.awaiting = {
        kind: 'job_offer',
        fromId: agent.id,
        fromName: nameAsKnown(other, agent),
        wage: intent.wage,
        days: intent.days,
      };
    agent.action = { type: 'rest', until: tick + 3 };
    return;
  }

  if (intent.type === 'respond_job') {
    const req = state.requests.find(
      (r) => r.kind === 'job' && r.from === intent.fromId && r.to === agent.id,
    );
    const employer = findAgent(state, intent.fromId);
    if (!req || !req.terms || !employer?.alive)
      return fail(ctx, agent, 'That offer is no longer open.');
    state.requests = state.requests.filter((r) => r !== req);
    const who = nameAsKnown(agent, employer);
    const { wage, days } = req.terms;

    if (!intent.accept) {
      remember(agent, tick, `I turned down ${who}'s job offer.`, 4, 'conversation', [employer.id]);
      remember(
        employer,
        tick,
        `${nameAsKnown(employer, agent)} turned down my job offer.`,
        4,
        'conversation',
        [agent.id],
      );
      if (!employer.awaiting && !employer.asleep)
        employer.awaiting = {
          kind: 'job_answered',
          byName: nameAsKnown(employer, agent),
          accepted: false,
        };
      return;
    }

    state.contracts.push({
      id: 'j' + state.nextContractNum++,
      employer: employer.id,
      worker: agent.id,
      wage,
      startTick: tick,
      endTick: tick + days * TICKS_PER_DAY,
      lastPaidDay: tickToClock(tick).day - 1,
    });
    emit(
      ctx,
      'job',
      [employer.id, agent.id],
      `${fullName(agent)} agreed to work for ${fullName(employer)} for ${wage} coins a day.`,
      3,
    );
    remember(
      agent,
      tick,
      `I agreed to work for ${who} for ${wage} coins a day.`,
      5,
      'conversation',
      [employer.id],
    );
    remember(
      employer,
      tick,
      `${nameAsKnown(employer, agent)} agreed to work for me at ${wage} coins a day.`,
      5,
      'conversation',
      [agent.id],
    );
    feel(agent, employer, tick, { trust: 3 });
    feel(employer, agent, tick, { trust: 3 });
    if (!employer.awaiting && !employer.asleep)
      employer.awaiting = {
        kind: 'job_answered',
        byName: nameAsKnown(employer, agent),
        accepted: true,
      };
    agent.action = { type: 'rest', until: tick + 3 };
    return;
  }

  // end_job
  const other = findAgent(state, intent.agentId);
  const contract = other && other !== agent ? agreementBetween(state, agent, other) : undefined;
  if (!contract || !other) return fail(ctx, agent, 'We have no work agreement.');
  state.contracts = state.contracts.filter((c) => c !== contract);
  remember(
    agent,
    tick,
    `I ended my work agreement with ${nameAsKnown(agent, other)}.`,
    4,
    'conversation',
    [other.id],
  );
  if (other.alive) {
    const byName = nameAsKnown(other, agent);
    remember(other, tick, `${byName} ended our work agreement.`, 4, 'conversation', [agent.id]);
    tellEnded(other, byName, `${byName} ended it`);
  }
  emit(
    ctx,
    'job',
    [agent.id, other.id],
    `${fullName(agent)} ended the work agreement with ${fullName(other)}.`,
    2,
  );
  agent.action = { type: 'rest', until: tick + 3 };
}

/** Once a tick: paydays, agreements running out, and agreements with the dead. */
export function jobsTick(ctx: Ctx): void {
  const { state } = ctx;
  const tick = state.tick;
  const clock = tickToClock(tick);
  if (tick % 60 !== 0) return;

  // Agreements that ran out, or where someone died.
  for (const c of [...state.contracts]) {
    const employer = findAgent(state, c.employer);
    const worker = findAgent(state, c.worker);
    if (!employer || !worker) {
      state.contracts = state.contracts.filter((x) => x !== c);
      continue;
    }
    if (!employer.alive || !worker.alive) {
      state.contracts = state.contracts.filter((x) => x !== c);
      const living = employer.alive ? employer : worker.alive ? worker : null;
      const dead = employer.alive ? worker : employer;
      if (living) {
        remember(
          living,
          tick,
          `${nameAsKnown(living, dead)} died, so our work agreement ended.`,
          4,
          'experience',
          [dead.id],
        );
      }
      continue;
    }
    if (tick >= c.endTick) {
      state.contracts = state.contracts.filter((x) => x !== c);
      const byName = nameAsKnown(worker, employer);
      remember(
        employer,
        tick,
        `My work agreement with ${nameAsKnown(employer, worker)} ran out.`,
        4,
        'experience',
        [worker.id],
      );
      remember(worker, tick, `My work agreement with ${byName} ran out.`, 4, 'experience', [
        employer.id,
      ]);
      tellEnded(worker, byName, 'the agreed days are up');
    }
  }

  // Payday at 20:00: every agreement not yet paid today.
  if (clock.hour !== 20) return;
  for (const c of [...state.contracts]) {
    if (c.lastPaidDay >= clock.day) continue;
    const employer = findAgent(state, c.employer)!;
    const worker = findAgent(state, c.worker)!;
    const workerName = nameAsKnown(employer, worker);
    const employerName = nameAsKnown(worker, employer);
    if (employer.money >= c.wage) {
      employer.money -= c.wage;
      worker.money += c.wage;
      c.lastPaidDay = clock.day;
      remember(
        employer,
        tick,
        `I paid ${workerName} ${c.wage} coins for the day's work.`,
        2,
        'experience',
        [worker.id],
      );
      remember(
        worker,
        tick,
        `${employerName} paid me ${c.wage} coins for the day's work.`,
        2,
        'experience',
        [employer.id],
      );
      emit(
        ctx,
        'job',
        [employer.id, worker.id],
        `${fullName(employer)} paid ${fullName(worker)} ${c.wage} coins for the day's work.`,
        1,
      );
    } else {
      state.contracts = state.contracts.filter((x) => x !== c);
      remember(worker, tick, `${employerName} couldn't pay my wage.`, 6, 'experience', [
        employer.id,
      ]);
      feel(worker, employer, tick, { trust: -15 });
      tellEnded(worker, employerName, 'they could not pay');
      remember(
        employer,
        tick,
        `I couldn't pay ${workerName}'s wage, so the work agreement ended.`,
        5,
        'experience',
        [worker.id],
      );
    }
  }
}

/** This person's work agreements, as they know them. */
export function jobsFor(state: WorldState, agent: Agent): JobView[] {
  const views: JobView[] = [];
  for (const c of state.contracts) {
    if (state.tick >= c.endTick) continue;
    const role = c.employer === agent.id ? 'employer' : c.worker === agent.id ? 'worker' : null;
    if (!role) continue;
    const other = findAgent(state, role === 'employer' ? c.worker : c.employer);
    if (!other?.alive) continue;
    views.push({
      role,
      otherId: other.id,
      otherName: nameAsKnown(agent, other),
      wage: c.wage,
      untilDay: tickToClock(c.endTick).day,
    });
  }
  return views;
}
