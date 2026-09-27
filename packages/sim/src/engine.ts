import {
  IntentSchema,
  ITEM_LABELS,
  OBJECT_LABELS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  tickToClock,
  type BrainConfig,
  type Decision,
  type DecisionRequest,
  type DecisionTrigger,
  type Facing,
  type Intent,
  type ItemName,
  type NeedName,
  type Point,
  type WorldEvent,
} from '@aw/shared';
import { fullName, remember, type Agent } from './agent.ts';
import type { AgentSpec } from './cast.ts';
import { NUTRITION } from './items.ts';
import { findPathToAny } from './pathfinding.ts';
import { buildPerception, nameAsKnown } from './perception.ts';
import { addAgent } from './population.ts';
import type { Rng } from './rng.ts';
import {
  distanceToObject,
  interactionTiles,
  isAt,
  isDrinkSpot,
  isWalkable,
  mapCache,
  moveCost,
  nearestWalkable,
  objectsNear,
} from './spatial.ts';
import { withRng, type WorldState } from './world.ts';

/** Everything the simulation consumes besides its own state. Logged per tick for exact replay. */
export type TickInput =
  | { kind: 'decision'; agentId: string; decision: Decision; usage?: { costUsd: number } }
  | { kind: 'decision_timeout'; agentId: string }
  | { kind: 'spawn_agent'; spec: AgentSpec }
  | { kind: 'set_brain'; agentId: string; brain: BrainConfig }
  | { kind: 'set_default_brain'; brain: BrainConfig; applyToAll?: boolean }
  | { kind: 'set_days_per_year'; value: number };

export interface StepResult {
  events: WorldEvent[];
  /** Agents waiting for a decision after this tick. The runner must answer before the next tick. */
  requests: DecisionRequest[];
  /** Objects whose visible resource amount changed. */
  changedResources: string[];
}

// Rates are per in-game hour.
const RATES = {
  foodAwake: 4,
  foodAsleep: 2,
  waterAwake: 5.5,
  waterAsleep: 2.5,
  energyAwake: 5.5,
  energySleepIndoors: 13,
  energySleepOutdoors: 8,
  warmIndoors: 20,
  coldNightAwake: 6,
  coldNightAsleep: 9,
  coolTwilight: 2,
};
const H = TICKS_PER_HOUR;
/** How long an awake agent may go without a fresh decision, by effort level. */
const CHECK_IN_TICKS: Record<string, number> = { frugal: 8 * H, standard: 4 * H, deep: 3 * H };
const checkInFor = (a: Agent) => CHECK_IN_TICKS[a.brain.effort] ?? 4 * H;
/** Talk range (Chebyshev tiles), how far voices carry to bystanders, and conversation length. */
const TALK_RANGE = 2;
const OVERHEAR_RANGE = 5;
const MAX_TURNS = 6;
const URGENT = 20;
const RECOVERED = 50;
export const VISION_DAY = 8;
export const VISION_NIGHT = 4;

interface Ctx {
  state: WorldState;
  rng: Rng;
  events: WorldEvent[];
  changed: Set<string>;
}

export function isNight(tick: number): boolean {
  const { hour } = tickToClock(tick);
  return hour < 6 || hour >= 21;
}

function isTwilight(tick: number): boolean {
  const { hour } = tickToClock(tick);
  return hour === 6 || hour === 19 || hour === 20;
}

/** Advance the world by one tick. Mutates `state`. Pure apart from that: same inputs, same result. */
export function step(state: WorldState, inputs: TickInput[] = []): StepResult {
  state.tick += 1;
  const ctx: Ctx = { state, rng: undefined as unknown as Rng, events: [], changed: new Set() };
  withRng(state, (rng) => {
    ctx.rng = rng;
    for (const input of inputs) applyInput(ctx, input);
    if (state.tick % TICKS_PER_DAY === 0) {
      const alive = state.agents.filter((a) => a.alive).length;
      emit(
        ctx,
        'new_day',
        [],
        `Day ${tickToClock(state.tick).day} begins. ${alive} villagers are alive.`,
        1,
      );
    }
    if (state.tick % H === 0) regrowResources(ctx);
    const ageStep = 1 / (TICKS_PER_DAY * state.settings.daysPerYear);
    for (let i = 0; i < state.agents.length; i++) {
      const agent = state.agents[i]!;
      if (!agent.alive) continue;
      agent.age += ageStep;
      if (agent.speech && state.tick >= agent.speech.until) agent.speech = null;
      updateBody(ctx, agent);
      if (!agent.alive) continue;
      if (!agent.asleep) {
        progressAction(ctx, agent);
        maybeNeedDecision(ctx, agent);
      }
      if ((state.tick + i) % 5 === 0) look(state, agent);
    }
  });
  return {
    events: ctx.events,
    requests: pendingRequests(state),
    changedResources: [...ctx.changed],
  };
}

/** Decision requests for every agent currently waiting on its brain. */
export function pendingRequests(state: WorldState): DecisionRequest[] {
  const out: DecisionRequest[] = [];
  for (const a of state.agents) {
    if (a.alive && a.awaiting)
      out.push({ agentId: a.id, tick: state.tick, perception: buildPerception(state, a) });
  }
  return out;
}

function emit(
  ctx: Ctx,
  kind: WorldEvent['kind'],
  actors: string[],
  text: string,
  importance: number,
) {
  ctx.events.push({ tick: ctx.state.tick, kind, actors, text, importance });
}

function objName(state: WorldState, id: string): string {
  const o = mapCache(state.map).byId.get(id);
  return o ? (o.name ?? OBJECT_LABELS[o.kind].toLowerCase()) : id;
}

// ------------------------------------------------------------------ inputs

function applyInput(ctx: Ctx, input: TickInput): void {
  const { state } = ctx;
  switch (input.kind) {
    case 'decision': {
      const agent = state.agents.find((a) => a.id === input.agentId);
      if (!agent?.alive) return;
      agent.awaiting = null;
      agent.thought = String(input.decision.thought ?? '').slice(0, 2000);
      agent.goal = String(input.decision.goal ?? '').slice(0, 300);
      const plan: Intent[] = [];
      for (const raw of (input.decision.plan ?? []).slice(0, 20)) {
        const parsed = IntentSchema.safeParse(raw);
        if (parsed.success) plan.push(parsed.data as Intent);
      }
      agent.plan = plan;
      agent.nextCheckIn = state.tick + checkInFor(agent);
      agent.decisions += 1;
      agent.spentUsd += Math.max(0, input.usage?.costUsd ?? 0);
      const note = input.decision.remember;
      if (note?.text)
        remember(
          agent,
          state.tick,
          `I made a note to myself: ${String(note.text).slice(0, 500)}`,
          Math.max(2, Number(note.importance) || 3),
          'thought',
        );
      if (agent.action?.type !== 'sleep') agent.action = null;
      if (agent.asleep && plan.length > 0 && plan[0]!.type !== 'sleep') wake(ctx, agent, false);
      if (agent.goal)
        emit(ctx, 'decided', [agent.id], `${fullName(agent)} decided: ${agent.goal}`, 1);
      return;
    }
    case 'decision_timeout': {
      const agent = state.agents.find((a) => a.id === input.agentId);
      if (!agent?.alive) return;
      agent.awaiting = null;
      agent.nextCheckIn = state.tick + 30;
      return;
    }
    case 'spawn_agent': {
      const agent = addAgent(state, input.spec, ctx.rng);
      const where = agent.homeId
        ? `at ${objName(state, agent.homeId)}`
        : 'on the road into the village';
      emit(ctx, 'agent_arrived', [agent.id], `${fullName(agent)} appeared ${where}.`, 4);
      if (!agent.homeId)
        remember(agent, state.tick, 'I have just arrived in this village. I know no one here.', 6);
      look(state, agent);
      return;
    }
    case 'set_brain': {
      const agent = state.agents.find((a) => a.id === input.agentId);
      if (agent) agent.brain = { ...input.brain };
      return;
    }
    case 'set_default_brain':
      state.settings.defaultBrain = { ...input.brain };
      if (input.applyToAll) for (const a of state.agents) if (a.alive) a.brain = { ...input.brain };
      return;
    case 'set_days_per_year':
      state.settings.daysPerYear = Math.min(60, Math.max(1, input.value));
      return;
  }
}

// ------------------------------------------------------------------ world

function regrowResources(ctx: Ctx): void {
  const { state } = ctx;
  const ids = Object.keys(state.resources).sort();
  for (const id of ids) {
    const r = state.resources[id]!;
    if (r.amount >= r.max) continue;
    const before = Math.floor(r.amount);
    r.amount = Math.min(r.max, r.amount + r.regenPerDay / 24);
    if (Math.floor(r.amount) !== before) ctx.changed.add(id);
  }
}

// ------------------------------------------------------------------ body

function clamp(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

function updateBody(ctx: Ctx, agent: Agent): void {
  const { state } = ctx;
  const n = agent.needs;
  const asleep = agent.asleep;
  const indoors = agent.indoorsId !== null;
  const night = isNight(state.tick);

  n.food = clamp(n.food - (asleep ? RATES.foodAsleep : RATES.foodAwake) / H);
  n.water = clamp(n.water - (asleep ? RATES.waterAsleep : RATES.waterAwake) / H);
  if (asleep) {
    n.energy = clamp(
      n.energy + (indoors ? RATES.energySleepIndoors : RATES.energySleepOutdoors) / H,
    );
  } else {
    n.energy = clamp(n.energy - RATES.energyAwake / H);
  }
  if (indoors || (!night && !isTwilight(state.tick)))
    n.warmth = clamp(n.warmth + RATES.warmIndoors / H);
  else if (night)
    n.warmth = clamp(n.warmth - (asleep ? RATES.coldNightAsleep : RATES.coldNightAwake) / H);
  else n.warmth = clamp(n.warmth - RATES.coolTwilight / H);

  // Health: suffers when needs hit bottom, recovers when they're comfortable.
  let damage = 0;
  if (n.food <= 0) damage += 4;
  if (n.water <= 0) damage += 8;
  if (n.warmth <= 0) damage += 5;
  for (const k of ['food', 'water', 'warmth'] as NeedName[])
    if (n[k] > 0 && n[k] < 10) damage += 0.5;
  if (damage > 0) agent.health = clamp(agent.health - damage / H);
  else if (n.food >= 30 && n.water >= 30 && n.warmth >= 30)
    agent.health = clamp(agent.health + (asleep ? 3 : 1.5) / H);

  if (agent.health <= 0) {
    die(ctx, agent);
    return;
  }

  for (const k of ['food', 'water', 'warmth'] as NeedName[]) {
    if (n[k] <= 0 && !agent.alerted[`${k}_zero`]) {
      agent.alerted[`${k}_zero`] = true;
      const what = { food: 'starving', water: 'dying of thirst', warmth: 'freezing' }[
        k as 'food' | 'water' | 'warmth'
      ];
      emit(ctx, 'need_critical', [agent.id], `${fullName(agent)} is ${what}.`, 4);
      remember(agent, state.tick, `I am ${what}.`, 6);
    } else if (n[k] > 20) {
      delete agent.alerted[`${k}_zero`];
    }
  }

  if (asleep) {
    const { hour } = tickToClock(state.tick);
    // Sleep through the night; by day, get up once rested.
    const rested = hour >= 5 && hour < 21 && n.energy >= 90;
    const desperate = n.food < 8 || n.water < 8;
    if (rested || desperate) wake(ctx, agent, true);
  } else if (n.energy <= 0) {
    agent.plan = [];
    agent.action = { type: 'sleep', since: state.tick };
    agent.asleep = true;
    emit(ctx, 'collapsed', [agent.id], `${fullName(agent)} collapsed from exhaustion.`, 3);
    remember(agent, state.tick, 'I collapsed from exhaustion.', 5);
  }
}

function die(ctx: Ctx, agent: Agent): void {
  const n = agent.needs;
  const lowest = (['water', 'food', 'warmth'] as NeedName[]).reduce((a, b) =>
    n[a] <= n[b] ? a : b,
  );
  const cause =
    n[lowest] <= 0
      ? { water: 'thirst', food: 'starvation', warmth: 'cold', energy: 'exhaustion' }[lowest]
      : 'poor health';
  agent.alive = false;
  agent.death = { tick: ctx.state.tick, cause };
  agent.asleep = false;
  agent.action = null;
  agent.plan = [];
  agent.awaiting = null;
  agent.indoorsId = null;
  emit(
    ctx,
    'died',
    [agent.id],
    `${fullName(agent)} died of ${cause}, aged ${Math.floor(agent.age)}.`,
    5,
  );
}

function wake(ctx: Ctx, agent: Agent, requestDecision: boolean): void {
  agent.asleep = false;
  agent.indoorsId = null;
  agent.action = null;
  agent.alerted = {};
  emit(ctx, 'woke_up', [agent.id], `${fullName(agent)} woke up.`, 1);
  if (requestDecision) {
    agent.plan = [];
    agent.awaiting = { kind: 'woke_up' };
  }
}

// ------------------------------------------------------------------ decisions

function maybeNeedDecision(ctx: Ctx, agent: Agent): void {
  if (agent.awaiting) return;
  const { state } = ctx;
  const request = (trigger: DecisionTrigger) => {
    agent.awaiting = trigger;
  };

  for (const k of ['water', 'food', 'energy', 'warmth'] as NeedName[]) {
    const v = agent.needs[k];
    if (v < URGENT && !agent.alerted[k]) {
      agent.alerted[k] = true;
      if (!isAddressing(agent, k)) return request({ kind: 'urgent_need', need: k });
    } else if (v > RECOVERED && agent.alerted[k]) {
      delete agent.alerted[k];
    }
  }
  if (!agent.action && agent.plan.length === 0) return request({ kind: 'plan_done' });
  if (state.tick >= agent.nextCheckIn) {
    agent.nextCheckIn = state.tick + checkInFor(agent);
    return request({ kind: 'check_in' });
  }
}

/** Is the agent's current action or plan already about this need? (Avoids nagging the brain.) */
function isAddressing(agent: Agent, need: NeedName): boolean {
  const steps: string[] = agent.plan.map((i) => i.type);
  if (agent.action)
    steps.unshift(
      agent.action.type === 'walk' && agent.action.then
        ? agent.action.then.type
        : agent.action.type,
    );
  if (need === 'food') return steps.includes('eat') || steps.includes('gather');
  if (need === 'water') return steps.includes('drink');
  if (need === 'energy') return steps.includes('sleep');
  return steps.includes('sleep');
}

function fail(ctx: Ctx, agent: Agent, reason: string): void {
  agent.plan = [];
  agent.action = null;
  remember(agent, ctx.state.tick, reason, 2);
  if (!agent.awaiting) agent.awaiting = { kind: 'action_failed', reason };
}

// ------------------------------------------------------------------ actions

function progressAction(ctx: Ctx, agent: Agent): void {
  const { state } = ctx;
  // Start the next plan step if idle (a few zero-time steps may chain in one tick).
  for (
    let guard = 0;
    guard < 4 && !agent.action && agent.plan.length > 0 && !agent.awaiting;
    guard++
  ) {
    startIntent(ctx, agent, agent.plan.shift()!);
  }
  const action = agent.action;
  if (!action) return;
  switch (action.type) {
    case 'walk': {
      const next = action.path[action.step];
      if (!next) {
        agent.action = null;
        if (action.then) startIntent(ctx, agent, action.then);
        return;
      }
      if (!isWalkable(state.map, next.x, next.y)) return fail(ctx, agent, 'My way was blocked.');
      agent.facing = facingTo(agent, next);
      agent.x = next.x;
      agent.y = next.y;
      action.step++;
      if (action.step >= action.path.length) {
        agent.action = null;
        if (action.then) startIntent(ctx, agent, action.then);
      }
      return;
    }
    case 'gather':
      if (state.tick >= action.until) finishGather(ctx, agent, action.objectId);
      return;
    case 'eat':
      if (state.tick >= action.until) {
        const have = agent.inventory[action.item] ?? 0;
        if (have <= 0) {
          agent.action = null;
          return;
        }
        agent.inventory[action.item] = have - 1;
        if (agent.inventory[action.item] === 0) delete agent.inventory[action.item];
        agent.needs.food = clamp(agent.needs.food + NUTRITION[action.item]);
        if (agent.needs.food < 92 && (agent.inventory[action.item] ?? 0) > 0) {
          action.until = state.tick + 5;
        } else {
          agent.action = null;
          const text = `${fullName(agent)} ate ${ITEM_LABELS[action.item].toLowerCase()}.`;
          emit(ctx, 'ate', [agent.id], text, 1);
          remember(agent, state.tick, `I ate ${ITEM_LABELS[action.item].toLowerCase()}.`);
        }
      }
      return;
    case 'drink':
      if (state.tick >= action.until) {
        agent.needs.water = 100;
        agent.action = null;
        emit(ctx, 'drank', [agent.id], `${fullName(agent)} drank some water.`, 1);
        remember(agent, state.tick, 'I drank water.');
      }
      return;
    case 'rest':
      if (state.tick >= action.until) agent.action = null;
      return;
    case 'sleep':
      return;
  }
}

function facingTo(from: Point, to: Point): Facing {
  if (to.x > from.x) return 'right';
  if (to.x < from.x) return 'left';
  if (to.y < from.y) return 'up';
  return 'down';
}

function walkTo(
  ctx: Ctx,
  agent: Agent,
  goals: Point[],
  then: Intent | null,
  what: string,
): boolean {
  const { map } = ctx.state;
  const path = findPathToAny(map.width, map.height, agent, goals, moveCost(map));
  if (!path) {
    fail(ctx, agent, `I couldn't find a way to ${what}.`);
    return false;
  }
  if (path.length <= 1) {
    if (then) startIntent(ctx, agent, then, true);
    return true;
  }
  agent.action = { type: 'walk', path, step: 1, then };
  return true;
}

function startIntent(ctx: Ctx, agent: Agent, intent: Intent, arrived = false): void {
  const { state } = ctx;
  const { map } = state;
  const cache = mapCache(map);
  switch (intent.type) {
    case 'go_to': {
      if ('objectId' in intent.target) {
        const o = cache.byId.get(intent.target.objectId);
        if (!o) return fail(ctx, agent, `I tried to go somewhere that doesn't exist.`);
        walkTo(ctx, agent, interactionTiles(map, o), null, objName(state, o.id));
      } else {
        const { x, y } = intent.target;
        const goal = isWalkable(map, x, y)
          ? { x, y }
          : nearestWalkable(map, { x, y }, (p) => isWalkable(map, p.x, p.y), 6);
        if (!goal) return fail(ctx, agent, `I couldn't find a way to (${x}, ${y}).`);
        walkTo(ctx, agent, [goal], null, `(${x}, ${y})`);
      }
      return;
    }
    case 'gather': {
      const o = cache.byId.get(intent.objectId);
      if (!o || !['berry_bush', 'field', 'dock'].includes(o.kind)) {
        return fail(ctx, agent, "I tried to gather food where there isn't any.");
      }
      const tiles = interactionTiles(map, o);
      if (!arrived && !isAt(agent, tiles)) {
        walkTo(ctx, agent, tiles, intent, objName(state, o.id));
        return;
      }
      if (o.kind !== 'dock') {
        const r = state.resources[o.id];
        if (!r || r.amount < 1) {
          agent.knowledge[o.id] = { lastSeenTick: state.tick, lastSeenAmount: 0 };
          return fail(ctx, agent, `The ${objName(state, o.id)} had nothing left to gather.`);
        }
      }
      if (o.x > agent.x) agent.facing = 'right';
      else if (o.x + o.w - 1 < agent.x) agent.facing = 'left';
      else agent.facing = o.y < agent.y ? 'up' : 'down';
      const duration = o.kind === 'berry_bush' ? 20 : o.kind === 'field' ? 40 : 30;
      agent.action = { type: 'gather', objectId: o.id, until: state.tick + duration };
      return;
    }
    case 'eat': {
      if ((agent.inventory[intent.item] ?? 0) <= 0) {
        return fail(
          ctx,
          agent,
          `I wanted to eat ${ITEM_LABELS[intent.item].toLowerCase()} but had none.`,
        );
      }
      agent.action = { type: 'eat', item: intent.item, until: state.tick + 5 };
      return;
    }
    case 'drink': {
      if (isDrinkSpot(map, agent)) {
        agent.action = { type: 'drink', until: state.tick + 10 };
        return;
      }
      if (arrived) return fail(ctx, agent, 'There was no water where I went to drink.');
      let goals: Point[] = [];
      const source = intent.sourceId ? cache.byId.get(intent.sourceId) : undefined;
      if (source) goals = interactionTiles(map, source).filter((p) => isDrinkSpot(map, p));
      if (goals.length === 0) {
        const spot = nearestWalkable(map, agent, (p) => isDrinkSpot(map, p), 120);
        if (spot) goals = [spot];
      }
      if (goals.length === 0) return fail(ctx, agent, "I couldn't find any water to drink.");
      walkTo(ctx, agent, goals, intent, 'water');
      return;
    }
    case 'sleep': {
      const home = agent.homeId ? cache.byId.get(agent.homeId) : undefined;
      agent.asleep = true;
      agent.plan = [];
      agent.action = { type: 'sleep', since: state.tick };
      agent.indoorsId =
        home?.door && home.door.x === agent.x && home.door.y === agent.y ? home.id : null;
      const where = agent.indoorsId ? 'at home' : 'outside';
      emit(ctx, 'fell_asleep', [agent.id], `${fullName(agent)} fell asleep ${where}.`, 1);
      remember(agent, state.tick, `I went to sleep ${where}.`);
      return;
    }
    case 'rest':
      agent.action = {
        type: 'rest',
        until: state.tick + Math.min(600, Math.max(1, Math.round(intent.minutes))),
      };
      return;
    case 'talk_to': {
      const other = state.agents.find((a) => a.id === intent.agentId);
      if (!other || other === agent)
        return fail(ctx, agent, "I tried to talk to someone who isn't here.");
      const who = nameAsKnown(agent, other);
      if (!other.alive) return fail(ctx, agent, `I wanted to talk to ${who}, but they are dead.`);
      const dist = Math.max(Math.abs(other.x - agent.x), Math.abs(other.y - agent.y));
      if (dist <= TALK_RANGE && !other.indoorsId) {
        speak(ctx, agent, other, intent.message);
        // Talking takes time: roughly one in-game minute per 15 words, then a pause for the answer.
        const words = intent.message.split(/\s+/).length;
        agent.action = { type: 'rest', until: state.tick + 2 + Math.ceil(words / 15) };
        return;
      }
      if (other.indoorsId)
        return fail(ctx, agent, `I wanted to talk to ${who}, but they are indoors.`);
      if (dist > 60) return fail(ctx, agent, `${who} is too far away to reach.`);
      const tries = intent.tries ?? 0;
      if (tries >= 3) return fail(ctx, agent, `I couldn't catch up with ${who}.`);
      const goals: Point[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && isWalkable(map, other.x + dx, other.y + dy))
            goals.push({ x: other.x + dx, y: other.y + dy });
        }
      }
      if (goals.length === 0) goals.push({ x: other.x, y: other.y });
      walkTo(ctx, agent, goals, { ...intent, tries: tries + 1 }, who);
      return;
    }
    case 'explore': {
      const target = pickExploreTarget(ctx, agent);
      if (!target) return fail(ctx, agent, "I couldn't find anywhere new to explore.");
      walkTo(ctx, agent, [target], null, 'explore');
      return;
    }
  }
}

/** Say something to someone nearby. They hear it (and may reply); bystanders overhear. */
function speak(ctx: Ctx, speaker: Agent, listener: Agent, raw: string): void {
  const { state } = ctx;
  const message = raw.trim().slice(0, 600);
  if (!message) return;
  speaker.speech = { text: message, until: state.tick + 30 };
  speaker.facing = facingTo(speaker, listener);
  const listenerHears = !listener.asleep;
  const speakerName = fullName(speaker);
  emit(
    ctx,
    'said',
    [speaker.id, listener.id],
    `${speakerName} to ${fullName(listener)}: “${message}”`,
    2,
  );
  remember(
    speaker,
    state.tick,
    `I said to ${nameAsKnown(speaker, listener)}: “${message}”`,
    3,
    'conversation',
    [listener.id],
  );
  meet(speaker, listener, state.tick, false);
  if (listenerHears) {
    meet(listener, speaker, state.tick, true); // people introduce themselves when they speak
    remember(
      listener,
      state.tick,
      `${nameAsKnown(listener, speaker)} said to me: “${message}”`,
      4,
      'conversation',
      [speaker.id],
    );
    const c = listener.convo[speaker.id];
    const turns = c && state.tick - c.lastTick < 90 ? c.turns + 1 : 1;
    listener.convo[speaker.id] = { turns, lastTick: state.tick };
    speaker.convo[listener.id] = { turns, lastTick: state.tick };
    if (turns <= MAX_TURNS && !listener.awaiting && listener.alive) {
      listener.awaiting = {
        kind: 'spoken_to',
        fromId: speaker.id,
        fromName: nameAsKnown(listener, speaker),
        message,
      };
    }
  }
  for (const other of state.agents) {
    if (other === speaker || other === listener || !other.alive || other.asleep || other.indoorsId)
      continue;
    const d = Math.max(Math.abs(other.x - speaker.x), Math.abs(other.y - speaker.y));
    if (d > OVERHEAR_RANGE) continue;
    remember(
      other,
      state.tick,
      `I overheard ${nameAsKnown(other, speaker)} tell ${nameAsKnown(other, listener)}: “${message}”`,
      2,
      'conversation',
      [speaker.id, listener.id],
    );
  }
}

/** `viewer` has an encounter with `other`; learnName = other introduced themselves. */
function meet(viewer: Agent, other: Agent, tick: number, learnName: boolean): void {
  const p = viewer.people[other.id] ?? { name: null, familiarity: 0, lastSeenTick: tick };
  if (learnName && !p.name) p.name = fullName(other);
  p.familiarity = Math.min(100, p.familiarity + 2);
  p.lastSeenTick = tick;
  viewer.people[other.id] = p;
}

function pickExploreTarget(ctx: Ctx, agent: Agent): Point | null {
  const { map } = ctx.state;
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = ctx.rng.range(0, Math.PI * 2);
    const dist = ctx.rng.range(8, 18);
    const x = Math.round(agent.x + Math.cos(angle) * dist);
    const y = Math.round(agent.y + Math.sin(angle) * dist);
    if (isWalkable(map, x, y)) return { x, y };
  }
  return null;
}

function finishGather(ctx: Ctx, agent: Agent, objectId: string): void {
  const { state } = ctx;
  const o = mapCache(state.map).byId.get(objectId)!;
  agent.action = null;
  let item: ItemName;
  let got: number;
  if (o.kind === 'dock') {
    item = 'fish';
    const chance = 0.3 + agent.skills.fishing * 0.005;
    got = ctx.rng.chance(chance) ? 1 : 0;
    agent.skills.fishing = Math.min(100, agent.skills.fishing + 0.2);
  } else {
    const r = state.resources[o.id]!;
    item = o.kind === 'field' ? 'vegetables' : 'berries';
    got = Math.min(3, Math.floor(r.amount));
    r.amount -= got;
    ctx.changed.add(o.id);
    agent.knowledge[o.id] = { lastSeenTick: state.tick, lastSeenAmount: Math.floor(r.amount) };
    const skill = o.kind === 'field' ? 'farming' : 'foraging';
    agent.skills[skill] = Math.min(100, agent.skills[skill] + 0.2);
  }
  const label = ITEM_LABELS[item].toLowerCase();
  if (got > 0) {
    agent.inventory[item] = (agent.inventory[item] ?? 0) + got;
    emit(
      ctx,
      'gathered',
      [agent.id],
      `${fullName(agent)} gathered ${got} ${label} at ${objName(state, o.id)}.`,
      1,
    );
    remember(agent, state.tick, `I gathered ${got} ${label} at ${objName(state, o.id)}.`);
  } else {
    remember(
      agent,
      state.tick,
      o.kind === 'dock' ? 'I fished but caught nothing.' : `I found no ${label}.`,
    );
  }
}

// ------------------------------------------------------------------ senses

/** Update what the agent knows from what it can see right now. */
export function look(state: WorldState, agent: Agent): void {
  if (!agent.alive || agent.asleep || agent.indoorsId) return;
  const radius = isNight(state.tick) ? VISION_NIGHT : VISION_DAY;
  for (const o of objectsNear(state.map, agent, radius)) {
    const r = state.resources[o.id];
    agent.knowledge[o.id] = {
      lastSeenTick: state.tick,
      lastSeenAmount: r ? Math.floor(r.amount) : undefined,
    };
  }
}

/** Nearest known place of a kind, by straight-line distance. */
export function nearestKnown(state: WorldState, agent: Agent, kinds: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const cache = mapCache(state.map);
  for (const id of Object.keys(agent.knowledge)) {
    const o = cache.byId.get(id);
    if (!o || !kinds.includes(o.kind)) continue;
    const d = distanceToObject(o, agent);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}
