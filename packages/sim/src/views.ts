import {
  OBJECT_LABELS,
  describeIntent,
  type Activity,
  type AgentDetail,
  type AgentView,
} from '@aw/shared';
import type { Agent } from './agent.ts';
import { mapCache } from './spatial.ts';
import type { WorldState } from './world.ts';

export function activity(agent: Agent): Activity {
  if (!agent.alive) return 'dead';
  if (agent.asleep) return 'sleeping';
  switch (agent.action?.type) {
    case 'walk':
      return 'walking';
    case 'gather':
      return 'gathering';
    case 'eat':
      return 'eating';
    case 'drink':
      return 'drinking';
    case 'rest':
      return 'resting';
  }
  return agent.awaiting ? 'thinking' : 'idle';
}

/** What the map needs to draw one person. */
export function agentView(agent: Agent): AgentView {
  return {
    id: agent.id,
    name: agent.familyName ? `${agent.name} ${agent.familyName}` : agent.name,
    x: agent.x,
    y: agent.y,
    facing: agent.facing,
    activity: activity(agent),
    indoors: agent.indoorsId !== null,
    alive: agent.alive,
    sex: agent.sex,
    age: Math.floor(agent.age),
    appearance: agent.appearance,
    speech: agent.speech?.text,
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
      .map((m) => ({ tick: m.tick, text: m.text, importance: m.importance, kind: m.kind })),
    people: Object.entries(agent.people)
      .map(([id, p]) => ({
        id,
        name: p.name ?? '(not introduced)',
        familiarity: Math.round(p.familiarity),
        lastSeenTick: p.lastSeenTick,
      }))
      .sort((a, b) => b.familiarity - a.familiarity),
    spentUsd: agent.spentUsd,
    decisions: agent.decisions,
    death: agent.death,
    bornTick: agent.bornTick,
  };
}
