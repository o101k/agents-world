import {
  OBJECT_LABELS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  type ActiveCondition,
  type Intent,
  type MapObject,
  type Point,
} from '@aw/shared';
import { fullName, remember, type Agent } from './agent.ts';
import { approach, emit, fail, wake, type Ctx } from './engine.ts';
import { feel, train } from './life.ts';
import { describeSeason } from './seasons.ts';
import { nameAsKnown } from './perception.ts';
import {
  distanceToObject,
  isDrinkSpot,
  isWalkable,
  mapCache,
  nearestWalkable,
  objectsNear,
} from './spatial.ts';
import { findAgent, type WorldState } from './world.ts';

const H = TICKS_PER_HOUR;

export type WorldEventKind = 'drought' | 'storm' | 'disease' | 'fire' | 'bumper_harvest';

/** An observer-triggered world event. */
export interface WorldEventSpec {
  kind: WorldEventKind;
  /** 0.1 (mild) – 1 (severe). */
  intensity: number;
  /** In-game hours (a fire burns for an hour whatever this says). */
  hours: number;
  /** A building for a fire, a person for a disease. */
  targetId?: string;
}

/** Condition state is exactly what the viewer is shown. */
export type Condition = ActiveCondition;

const FIRE_TICKS = 60;
const BURNABLE_KINDS = new Set(['house', 'bakery', 'workshop', 'pen', 'stall']);
/** Wooden buildings burn; stone-built ones don't. */
const burnable = (o: MapObject) => BURNABLE_KINDS.has(o.kind) && !o.stone;
/** How long someone who recovered can't catch the sickness again. */
const IMMUNITY_TICKS = 30 * TICKS_PER_DAY;
/** Symptoms show a few hours after catching it. */
const INCUBATION_TICKS = 3 * H;

/** Strongest active condition of a kind (0 = none). */
export function conditionLevel(state: WorldState, kind: Condition['kind']): number {
  let level = 0;
  for (const c of state.conditions) if (c.kind === kind && c.intensity > level) level = c.intensity;
  return level;
}

export function onFire(state: WorldState, objectId: string): boolean {
  return state.conditions.some((c) => c.kind === 'fire' && c.targetId === objectId);
}

/** A building people can use: finished (or rebuilt) and not burning. */
export function usable(state: WorldState, objectId: string): boolean {
  const o = mapCache(state.map).byId.get(objectId);
  return Boolean(o && (o.progress ?? 1) >= 1 && !onFire(state, objectId));
}

/** Can someone drink standing here? In a bad drought the river runs dry and only the well works. */
export function canDrinkAt(state: WorldState, p: Point): boolean {
  if (!isDrinkSpot(state.map, p)) return false;
  if (conditionLevel(state, 'drought') < 0.5) return true;
  return objectsNear(state.map, p, 1).some(
    (o) => o.kind === 'well' && distanceToObject(o, p) === 1,
  );
}

const cheb = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const objLabel = (state: WorldState, id: string) => {
  const o = mapCache(state.map).byId.get(id);
  return o ? (o.name ?? OBJECT_LABELS[o.kind]) : id;
};

// ------------------------------------------------------------------ starting events

export function startWorldEvent(ctx: Ctx, spec: WorldEventSpec): void {
  const { state, rng } = ctx;
  const intensity = Math.min(1, Math.max(0.1, spec.intensity));
  const hours = Math.min(24 * 30, Math.max(1, spec.hours));
  const tick = state.tick;
  const add = (kind: Condition['kind'], endTick: number, targetId?: string) => {
    const c: Condition = {
      id: `c${state.nextConditionNum++}`,
      kind,
      intensity,
      startTick: tick,
      endTick,
    };
    if (targetId) c.targetId = targetId;
    state.conditions.push(c);
    return c;
  };
  const severity = intensity >= 0.8 ? 'severe ' : intensity <= 0.3 ? 'mild ' : '';
  switch (spec.kind) {
    case 'drought': {
      add('drought', tick + hours * H);
      emit(ctx, 'world_event', [], `A ${severity}drought has set in. No rain is coming.`, 5);
      return;
    }
    case 'storm': {
      add('storm', tick + hours * H);
      emit(ctx, 'world_event', [], `A ${severity}storm is sweeping over the village.`, 5);
      for (const a of state.agents) {
        if (!a.alive || a.age < 1) continue;
        if (a.asleep) {
          if (a.indoorsId) continue;
          wake(ctx, a, false);
        }
        remember(
          a,
          tick,
          a.indoorsId
            ? 'A storm is howling outside.'
            : 'A storm blew in — wind, cold rain, and the sky gone dark.',
          a.indoorsId ? 3 : 5,
        );
        if (!a.indoorsId && !a.awaiting)
          a.awaiting = {
            kind: 'world_event',
            description: 'A storm has blown in: wind and cold rain. Being outside will chill you.',
          };
      }
      return;
    }
    case 'bumper_harvest': {
      add('bumper_harvest', tick + hours * H);
      for (const id of Object.keys(state.resources).sort()) {
        const r = state.resources[id]!;
        if (r.item === 'wood') continue;
        r.amount = r.max;
        ctx.changed.add(id);
      }
      emit(ctx, 'world_event', [], 'A bumper harvest! Fields and bushes are heavy with food.', 5);
      return;
    }
    case 'disease': {
      add('disease', tick + hours * H);
      const chosen = findAgent(state, spec.targetId);
      const target = chosen?.alive ? chosen : undefined;
      const pool = state.agents.filter((a) => a.alive && !a.sickness && a.immuneUntil <= tick);
      const count = Math.max(1, Math.round(pool.length * 0.15 * intensity));
      const patients = target ? [target] : rng.shuffle([...pool]).slice(0, count);
      for (const p of patients) infect(ctx, p, intensity);
      emit(
        ctx,
        'world_event',
        [],
        `A ${severity}sickness has come to the village (${patients.length} caught it).`,
        5,
      );
      return;
    }
    case 'fire': {
      const cache = mapCache(state.map);
      const pick = spec.targetId ? cache.byId.get(spec.targetId) : undefined;
      const candidates = state.map.objects.filter(
        (o) => burnable(o) && (o.progress ?? 1) >= 1 && !onFire(state, o.id),
      );
      const target =
        pick && candidates.includes(pick)
          ? pick
          : candidates.length
            ? rng.pick(
                candidates.filter((o) => o.kind === 'house').length
                  ? candidates.filter((o) => o.kind === 'house')
                  : candidates,
              )
            : undefined;
      if (!target) {
        emit(ctx, 'world_event', [], 'Sparks flew, but there was nothing to burn.', 3);
        return;
      }
      igniteBuilding(ctx, target.id, intensity);
      return;
    }
  }
}

function igniteBuilding(ctx: Ctx, objectId: string, intensity: number): void {
  const { state } = ctx;
  const tick = state.tick;
  const o = mapCache(state.map).byId.get(objectId)!;
  const c: Condition = {
    id: `c${state.nextConditionNum++}`,
    kind: 'fire',
    intensity,
    startTick: tick,
    endTick: tick + FIRE_TICKS,
    targetId: o.id,
  };
  state.conditions.push(c);
  const name = objLabel(state, o.id);
  emit(ctx, 'fire', [], `${name} is on fire!`, 5, [o.id]);
  // Everyone inside gets out, burnt and frightened.
  for (const a of state.agents) {
    if (!a.alive || a.indoorsId !== o.id) continue;
    if (a.asleep) wake(ctx, a, false);
    a.indoorsId = null;
    const out = nearestWalkable(
      state.map,
      { x: o.door?.x ?? o.x, y: (o.door?.y ?? o.y) + 1 },
      (p) => isWalkable(state.map, p.x, p.y),
      4,
    );
    if (out) {
      a.x = out.x;
      a.y = out.y;
    }
    a.health = Math.max(1, a.health - (10 + 20 * intensity));
    a.plan = [];
    a.action = null;
    remember(a, tick, `I woke to flames — ${name} was burning and I barely got out!`, 9);
    if (!a.awaiting) a.awaiting = { kind: 'world_event', description: `${name} is on fire!` };
  }
  // Those who see it.
  for (const a of state.agents) {
    if (!a.alive || a.asleep || a.indoorsId || distanceToObject(o, a) > 8) continue;
    if (a.memories.some((m) => m.tick === tick && m.text.includes('flames'))) continue;
    const home = a.homeId === o.id || state.owners[o.id]?.includes(a.id);
    remember(a, tick, `${home ? 'My home' : name} caught fire!`, home ? 9 : 6);
    if (!a.awaiting) a.awaiting = { kind: 'world_event', description: `${name} is on fire!` };
  }
}

/** A fire has burnt out: the building is left a ruin to be rebuilt; it may have spread. */
function burnDown(ctx: Ctx, fire: Condition): void {
  const { state, rng } = ctx;
  const o = mapCache(state.map).byId.get(fire.targetId ?? '');
  if (!o) return;
  o.burntTick = state.tick;
  o.progress = 0.3;
  state.mapVersion += 1;
  const name = objLabel(state, o.id);
  emit(ctx, 'fire', [], `${name} burnt down.`, 5, [o.id]);
  for (const a of state.agents) {
    if (!a.alive || a.asleep || a.indoorsId || distanceToObject(o, a) > 8) continue;
    a.knowledge[o.id] = { lastSeenTick: state.tick };
    remember(a, state.tick, `${name} burnt down.`, a.homeId === o.id ? 9 : 5);
  }
  if (conditionLevel(state, 'storm') >= 0.3) return; // the rain stops it spreading
  for (const other of state.map.objects) {
    if (other === o || !burnable(other) || (other.progress ?? 1) < 1) continue;
    if (onFire(state, other.id)) continue;
    const gap = Math.max(
      other.x - (o.x + o.w - 1),
      o.x - (other.x + other.w - 1),
      other.y - (o.y + o.h - 1),
      o.y - (other.y + other.h - 1),
    );
    if (gap <= 3 && rng.chance(0.25 * fire.intensity))
      igniteBuilding(ctx, other.id, fire.intensity * 0.8);
  }
}

// ------------------------------------------------------------------ every tick

/** World-level condition upkeep: endings, fires and contagion. */
export function conditionsTick(ctx: Ctx): void {
  const { state } = ctx;
  if (state.conditions.length === 0) return;
  const ended = state.conditions.filter((c) => state.tick >= c.endTick);
  if (ended.length) {
    state.conditions = state.conditions.filter((c) => state.tick < c.endTick);
    for (const c of ended) endCondition(ctx, c);
  }
  if (state.tick % 10 === 0) spreadDisease(ctx);
}

function endCondition(ctx: Ctx, c: Condition): void {
  const { state } = ctx;
  const say = (text: string) => emit(ctx, 'world_event', [], text, 4);
  switch (c.kind) {
    case 'fire':
      return burnDown(ctx, c);
    case 'drought':
      if (conditionLevel(state, 'drought') === 0) say('The drought has broken — rain at last.');
      return;
    case 'storm':
      if (conditionLevel(state, 'storm') === 0) say('The storm has passed.');
      return;
    case 'bumper_harvest':
      if (conditionLevel(state, 'bumper_harvest') === 0) say('The season of plenty is over.');
      return;
    case 'disease':
      if (conditionLevel(state, 'disease') === 0)
        say('The sickness is dying out: no one else is catching it.');
      return;
  }
}

export function infect(ctx: Ctx, agent: Agent, intensity: number): void {
  if (agent.sickness || !agent.alive) return;
  const frail = agent.age < 3 || agent.age >= 65 ? 1.25 : 1;
  agent.sickness = {
    severity: Math.min(1, (0.3 + 0.5 * intensity) * frail * ctx.rng.range(0.8, 1.2)),
    since: ctx.state.tick,
    known: false,
    tended: -1e9,
  };
}

/** Every 10 minutes the sick may pass it on to anyone close (sharing a house counts). */
function spreadDisease(ctx: Ctx): void {
  const { state, rng } = ctx;
  const level = conditionLevel(state, 'disease');
  if (level === 0) return;
  const sick = state.agents.filter((a) => a.alive && a.sickness);
  if (sick.length === 0) return;
  for (const a of state.agents) {
    if (!a.alive || a.sickness || a.immuneUntil > state.tick) continue;
    const exposed = sick.some((s) =>
      a.indoorsId || s.indoorsId
        ? a.indoorsId === s.indoorsId && cheb(a, s) === 0
        : cheb(a, s) <= 2,
    );
    if (!exposed) continue;
    const frail = a.age < 3 || a.age >= 65 ? 1.3 : 1;
    if (rng.chance((0.08 * level * frail) / Math.max(0.5, a.constitution))) infect(ctx, a, level);
  }
}

/** Per person, per tick: the course of an illness. */
export function sicknessTick(ctx: Ctx, agent: Agent): void {
  const s = agent.sickness;
  if (!s) return;
  const { state } = ctx;
  const n = agent.needs;
  const frail = agent.age < 3 || agent.age >= 65 ? 0.6 : 1;
  let change = -0.02 * agent.constitution * frail * (agent.asleep ? 2 : 1);
  if (n.food < 20 || n.water < 20 || n.warmth < 20) change += 0.03;
  s.severity = Math.min(1, s.severity + change / H);
  agent.health = Math.max(0, agent.health - (2.5 * s.severity) / H);
  n.energy = Math.max(0, n.energy - (3 * s.severity) / H);
  if (!s.known && state.tick - s.since >= INCUBATION_TICKS) {
    s.known = true;
    emit(ctx, 'fell_ill', [agent.id], `${fullName(agent)} has fallen ill.`, 3);
    remember(agent, state.tick, "I feel feverish and weak — I think I'm ill.", 6);
    if (!agent.awaiting && !agent.asleep) agent.awaiting = { kind: 'unwell' };
  }
  if (s.severity <= 0) {
    agent.sickness = null;
    agent.immuneUntil = state.tick + IMMUNITY_TICKS;
    emit(ctx, 'recovered', [agent.id], `${fullName(agent)} has recovered from the sickness.`, 3);
    remember(agent, state.tick, "I've got over the sickness. I feel myself again.", 5);
  }
}

// ------------------------------------------------------------------ tending the sick

export function tendAction(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'tend' }>,
): void {
  const { state } = ctx;
  const tick = state.tick;
  const other = findAgent(state, intent.agentId);
  if (!other) return fail(ctx, agent, "The person I meant to look after isn't here.");
  if (other === agent) return fail(ctx, agent, "I can't nurse myself — I should rest instead.");
  const who = nameAsKnown(agent, other);
  if (!other.alive) return fail(ctx, agent, `${who} is beyond help.`);
  if (!other.sickness?.known) return fail(ctx, agent, `${who} doesn't seem to be ill.`);
  if (other.indoorsId) {
    const home = mapCache(state.map).byId.get(other.indoorsId);
    if (home?.door && (agent.x !== home.door.x || agent.y !== home.door.y)) {
      ctx.walkTo(agent, [home.door], intent, `${who}'s bedside`);
      return;
    }
  } else if (!approach(ctx, agent, other, intent, 1, 'look after')) return;
  if (tick - other.sickness.tended < 60)
    return fail(ctx, agent, `I've just tended to ${who}; they need rest now.`);
  const care = agent.skills.caregiving ?? 0;
  other.sickness.tended = tick;
  other.sickness.severity = Math.max(0, other.sickness.severity - 0.1 * (0.5 + care / 100));
  other.health = Math.min(100, other.health + 8);
  train(agent, 'caregiving', 0.6);
  feel(other, agent, tick, { affection: 4, trust: 3 });
  emit(ctx, 'tended', [agent.id, other.id], `${fullName(agent)} nursed ${fullName(other)}.`, 3);
  remember(agent, tick, `I nursed ${who} through their sickness.`, 4, 'experience', [other.id]);
  remember(
    other,
    tick,
    `${nameAsKnown(other, agent)} nursed me while I was ill.`,
    6,
    'experience',
    [agent.id],
  );
  agent.action = { type: 'rest', until: tick + 20 };
}

// ------------------------------------------------------------------ what people sense

/** What someone can tell about the world's conditions right now. */
export function sensedConditions(state: WorldState, agent: Agent): string[] {
  const out: string[] = [];
  if (!agent.alive) return out;
  const awake = !agent.asleep;
  if (awake && agent.age >= 3) out.push(describeSeason(state));
  const storm = conditionLevel(state, 'storm');
  if (storm > 0)
    out.push(
      agent.indoorsId
        ? 'A storm is raging outside; you are sheltered indoors.'
        : `A ${storm >= 0.7 ? 'violent ' : ''}storm is raging: wind and cold rain. Staying outside will chill you${storm >= 0.5 ? '; fishing is impossible' : ''}.`,
    );
  const drought = conditionLevel(state, 'drought');
  if (drought > 0 && awake) {
    out.push('It has not rained for a long while; crops and berries are barely growing.');
    if (drought >= 0.5) out.push('The river has dried to cracked mud — only the well has water.');
  }
  if (conditionLevel(state, 'bumper_harvest') > 0 && awake)
    out.push('It is a season of plenty: fields and bushes regrow fast.');
  for (const c of state.conditions) {
    if (c.kind !== 'fire' || !c.targetId) continue;
    const o = mapCache(state.map).byId.get(c.targetId);
    if (o && awake && !agent.indoorsId && distanceToObject(o, agent) <= 12)
      out.push(`${objLabel(state, o.id)} is on fire!`);
  }
  if (awake) {
    const seesSick = state.agents.some(
      (o) => o !== agent && o.alive && o.sickness?.known && !o.indoorsId && cheb(o, agent) <= 8,
    );
    if (seesSick || agent.sickness?.known)
      out.push('There is a sickness going around; it passes between people who stay close.');
  }
  return out;
}
