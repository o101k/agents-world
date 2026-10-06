import {
  OBJECT_LABELS,
  describeIntent,
  stageOf,
  type Activity,
  type AgentDetail,
  type AgentView,
} from '@aw/shared';
import { fullName, type Agent } from './agent.ts';
import { mapCache } from './spatial.ts';
import { findAgent, type WorldState } from './world.ts';

/** Owners' display names for every owned building. */
export function ownerNames(state: WorldState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(state.owners)) {
    out[id] = ids
      .map((aid) => findAgent(state, aid))
      .filter((a): a is Agent => Boolean(a))
      .map(
        (a) => (a.familyName ? `${a.name} ${a.familyName}` : a.name) + (a.alive ? '' : ' (dead)'),
      );
  }
  return out;
}

export function activity(agent: Agent): Activity {
  if (!agent.alive) return 'dead';
  if (agent.asleep) return 'sleeping';
  switch (agent.action?.type) {
    case 'walk':
      return 'walking';
    case 'gather':
    case 'chop':
      return 'gathering';
    case 'craft':
    case 'build':
      return 'working';
    case 'eat':
      return 'eating';
    case 'drink':
      return 'drinking';
    case 'rest':
      return 'resting';
    case 'sleep':
      return 'sleeping';
    case undefined:
      break;
    default: {
      // Compile-time exhaustiveness; an unknown action in an old save falls through safely.
      const unhandled: never = agent.action;
      void unhandled;
    }
  }
  return agent.awaiting ? 'thinking' : 'idle';
}

/** What the map needs to draw one person. */
export function agentView(agent: Agent): AgentView {
  return {
    id: agent.id,
    name: fullName(agent),
    x: agent.x,
    y: agent.y,
    facing: agent.facing,
    activity: activity(agent),
    indoors: agent.indoorsId !== null,
    ...(agent.indoorsId ? { indoorsId: agent.indoorsId } : {}),
    alive: agent.alive,
    sex: agent.sex,
    age: Math.floor(agent.age),
    appearance: agent.appearance,
    speech: agent.speech?.text,
    stage: stageOf(agent.age),
    ...(agent.sickness?.known ? { sick: true } : {}),
  };
}

/** Everything the observer may inspect about one person. */
export function agentDetail(state: WorldState, agent: Agent): AgentDetail {
  const cache = mapCache(state.map);
  const name = (id: string) => {
    const o = cache.byId.get(id);
    return o ? (o.name ?? OBJECT_LABELS[o.kind].toLowerCase()) : id;
  };
  let currentAction: string | null = null;
  const a = agent.action;
  if (a) {
    if (a.type === 'walk')
      currentAction = a.then ? `Walking → ${describeIntent(a.then, name)}` : 'Walking';
    else if (a.type === 'gather') currentAction = `Gathering at ${name(a.objectId)}`;
    else if (a.type === 'eat') currentAction = `Eating ${a.item}`;
    else if (a.type === 'drink') currentAction = 'Drinking';
    else if (a.type === 'chop') currentAction = 'Chopping wood';
    else if (a.type === 'craft') currentAction = `Making ${a.recipe}`;
    else if (a.type === 'build') currentAction = `Building ${name(a.objectId)}`;
    else if (a.type === 'sleep') currentAction = 'Sleeping';
    else currentAction = 'Resting';
  }
  const home = agent.homeId ? cache.byId.get(agent.homeId) : undefined;
  return {
    ...agentView(agent),
    familyName: agent.familyName,
    occupation: agent.occupation,
    traits: agent.traits,
    background: agent.background,
    personality: agent.personality,
    needs: { ...agent.needs },
    health: agent.health,
    money: agent.money,
    inventory: { ...agent.inventory } as Record<string, number>,
    skills: { ...agent.skills },
    homeId: agent.homeId,
    homeName: home?.name ?? null,
    brain: agent.brain,
    thought: agent.thought,
    goal: agent.goal,
    plan: agent.plan.map((i) => describeIntent(i, name)),
    currentAction,
    awaitingDecision: agent.awaiting !== null,
    knownPlaces: Object.keys(agent.knowledge).length,
    recent: [...agent.recent].reverse(),
    memories: [...agent.memories]
      .sort((a, b) => b.tick - a.tick)
      .map((m) => ({
        tick: m.tick,
        text: m.text,
        importance: m.importance,
        kind: m.kind,
        strength: Math.round(m.strength * 10) / 10,
      })),
    forgotten: [...agent.forgotten]
      .sort((a, b) => b.tick - a.tick)
      .map((m) => ({ ...m, forgotten: true })),
    sickness: agent.sickness?.known
      ? { severity: Math.round(agent.sickness.severity * 100) / 100, since: agent.sickness.since }
      : null,
    people: Object.entries(agent.people)
      .map(([id, p]) => ({
        id,
        name: p.name ?? '(not introduced)',
        familiarity: Math.round(p.familiarity),
        affection: Math.round(p.affection ?? 0),
        trust: Math.round(p.trust ?? 0),
        romance: Math.round(p.romance ?? 0),
        ...(p.role ? { role: p.role } : {}),
        lastSeenTick: p.lastSeenTick,
      }))
      .sort((a, b) => (b.role ? 1 : 0) - (a.role ? 1 : 0) || b.familiarity - a.familiarity),
    family: {
      mother: person(state, agent.motherId),
      father: person(state, agent.fatherId),
      partner: person(state, agent.partnerId),
      children: agent.childrenIds
        .map((id) => {
          const p = person(state, id);
          const adopted = findAgent(state, id)?.adoptiveParentIds.includes(agent.id);
          return p && adopted ? { ...p, adopted: true } : p;
        })
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
      adoptiveParents: agent.adoptiveParentIds
        .map((id) => person(state, id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p)),
    },
    aptitude: { ...agent.aptitude },
    constitution: agent.constitution,
    pregnancy: agent.pregnancy
      ? {
          fatherName: person(state, agent.pregnancy.fatherId)?.name ?? 'unknown',
          progress: agent.pregnancy.progress / 0.75,
        }
      : null,
    will: agent.will ? { heirName: person(state, agent.will.heirId)?.name ?? 'unknown' } : null,
    spentUsd: agent.spentUsd,
    decisions: agent.decisions,
    owns: Object.entries(state.owners)
      .filter(([, ids]) => ids.includes(agent.id))
      .map(([id]) => ({ id, name: name(id) })),
    death: agent.death,
    bornTick: agent.bornTick,
  };
}

function person(state: WorldState, id: string | null) {
  const a = id ? findAgent(state, id) : undefined;
  return a ? { id: a.id, name: fullName(a), alive: a.alive } : null;
}
