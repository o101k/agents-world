import {
  IntentSchema,
  ITEM_LABELS,
  RECIPES,
  describeBundle,
  type Bundle,
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
import { fullName, remember, type Agent, type TaskAction } from './agent.ts';
import {
  animalsTick,
  clothingWarmth,
  finishTendAnimals,
  penAnimals,
  startTendAnimals,
} from './animals.ts';
import { finishBuild, startBuild } from './construction.ts';
import { finishFarmingTask, onFieldHarvest, startClearField, startSow } from './farming.ts';
import { governanceAction, governanceTick, readNoticeBoard } from './governance.ts';
import { jobAction, jobsTick } from './jobs.ts';
import { finishQuarry, startQuarry } from './quarry.ts';
import { stallAction, stallListing } from './stalls.ts';
import type { AgentSpec } from './cast.ts';
import {
  canDrinkAt,
  conditionLevel,
  conditionsTick,
  sicknessTick,
  startWorldEvent,
  tendAction,
  usable,
  type WorldEventSpec,
} from './conditions.ts';
import { applyReflection, memoryTick, reinforceRecalled } from './memory.ts';
import { calendarTick, seasonEffects } from './seasons.ts';
import { NUTRITION, isFood } from './items.ts';
import { MARKET_TARGET, allQuotes, driftMarket, quote } from './market.ts';
import { findPathToAny, type CostFn } from './pathfinding.ts';
import { crowd, occupantAt, occupies } from './occupancy.ts';
import { buildPerception, nameAsKnown } from './perception.ts';
import {
  applyFeelings,
  autoName,
  canDo,
  expireRequests,
  feel,
  garble,
  hearSpeech,
  lifeAction,
  lifeTick,
  mournDeath,
  noticeOrphans,
  observeWork,
  relation,
  settleEstate,
  simplifySpeech,
  tooYoung,
  train,
  walksSlowly,
} from './life.ts';
import { addAgent } from './population.ts';
import type { Rng } from './rng.ts';
import {
  distanceToObject,
  interactionTiles,
  isAt,
  isWalkable,
  mapCache,
  moveCost,
  nearestWalkable,
  objectsNear,
  treesNear,
} from './spatial.ts';
import { TREE_WOOD, findAgent, resourceAmount, withRng, type WorldState } from './world.ts';

/** Everything the simulation consumes besides its own state. Logged per tick for exact replay. */
export type TickInput =
  | { kind: 'decision'; agentId: string; decision: Decision; usage?: { costUsd: number } }
  | { kind: 'decision_timeout'; agentId: string }
  | { kind: 'spawn_agent'; spec: AgentSpec }
  | { kind: 'set_brain'; agentId: string; brain: BrainConfig }
  /** Give several people the same brain in one go (people who don't exist are skipped). */
  | { kind: 'set_brains'; agentIds: string[]; brain: BrainConfig }
  | { kind: 'set_default_brain'; brain: BrainConfig; applyToAll?: boolean }
  | { kind: 'set_days_per_year'; value: number }
  | { kind: 'world_event'; event: WorldEventSpec };

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
/** Shortest sleep, in minutes, before a rested sleeper gets up by day. */
const MIN_NAP = 60;

/** How long an awake agent may go without a fresh decision, by effort level. */
const CHECK_IN_TICKS: Record<string, number> = { frugal: 8 * H, standard: 4 * H, deep: 3 * H };
const checkInFor = (a: Agent) => CHECK_IN_TICKS[a.brain.effort] ?? 4 * H;
/** Talk range (Chebyshev tiles), how far voices carry to bystanders, and conversation length. */
export const TALK_RANGE = 2;
export const OVERHEAR_RANGE = 5;
const MAX_TURNS = 6;
const URGENT = 20;
const RECOVERED = 50;
export const VISION_DAY = 8;
export const VISION_NIGHT = 4;

/** Everything one tick's rules share. Exported for the life-cycle module. */
export interface Ctx {
  state: WorldState;
  rng: Rng;
  events: WorldEvent[];
  changed: Set<string>;
  /** People who already moved this tick (a head-on swap moves two at once). */
  moved: Set<string>;
  die: (agent: Agent, cause?: string) => void;
  addPerson: (spec: AgentSpec) => Agent;
  walkTo: (agent: Agent, goals: Point[], then: Intent | null, what: string) => boolean;
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
  const ctx: Ctx = {
    state,
    rng: undefined as unknown as Rng,
    events: [],
    changed: new Set(),
    moved: new Set(),
    die: (agent, cause) => die(ctx, agent, cause),
    addPerson: (spec) => addAgent(state, spec, ctx.rng),
    walkTo: (agent, goals, then, what) => walkTo(ctx, agent, goals, then, what),
  };
  withRng(state, (rng) => {
    ctx.rng = rng;
    for (const input of inputs) applyInput(ctx, input);
    conditionsTick(ctx);
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
    if (state.tick % H === 0) {
      regrowResources(ctx);
      expireOffers(ctx);
      expireRequests(state);
    }
    if (state.tick % TICKS_PER_DAY === 0) driftMarket(state.market);
    // The growing village: pens, work agreements, meetings and the purse.
    animalsTick(ctx);
    jobsTick(ctx);
    governanceTick(ctx);
    const ageStep = 1 / (TICKS_PER_DAY * state.settings.daysPerYear);
    calendarTick(ctx, ageStep);
    for (let i = 0; i < state.agents.length; i++) {
      const agent = state.agents[i]!;
      if (!agent.alive) continue;
      agent.age += ageStep;
      if (agent.speech && state.tick >= agent.speech.until) agent.speech = null;
      updateBody(ctx, agent);
      if (!agent.alive) continue;
      if (agent.sickness) sicknessTick(ctx, agent);
      lifeTick(ctx, agent, ageStep);
      if (!agent.alive) continue;
      memoryTick(ctx, agent);
      if (!agent.named) autoName(ctx, agent);
      if (!agent.asleep) {
        progressAction(ctx, agent);
        maybeNeedDecision(ctx, agent);
      }
      if ((state.tick + i) % 5 === 0) look(state, agent);
    }
    separatePeople(ctx);
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

export function emit(
  ctx: Ctx,
  kind: WorldEvent['kind'],
  actors: string[],
  text: string,
  importance: number,
) {
  ctx.events.push({ tick: ctx.state.tick, kind, actors, text, importance });
  if (SUCCESS_EVENTS.has(kind) && actors[0]) {
    const a = findAgent(ctx.state, actors[0]);
    if (a) a.failStreak = 0;
  }
}

export function objName(state: WorldState, id: string): string {
  const o = mapCache(state.map).byId.get(id);
  return o ? (o.name ?? OBJECT_LABELS[o.kind].toLowerCase()) : id;
}

// ------------------------------------------------------------------ inputs

function applyInput(ctx: Ctx, input: TickInput): void {
  const { state } = ctx;
  switch (input.kind) {
    case 'decision': {
      const agent = findAgent(state, input.agentId);
      if (!agent?.alive) return;
      const trigger = agent.awaiting;
      agent.decisions += 1;
      agent.spentUsd += Math.max(0, input.usage?.costUsd ?? 0);
      if (trigger?.kind === 'reflect') {
        // A night's reflection: the body keeps sleeping; only the mind changes.
        agent.awaiting = null;
        applyReflection(ctx, agent, trigger.scope, input.decision);
        if (Array.isArray(input.decision.feelings))
          applyFeelings(state, agent, input.decision.feelings);
        const goal = String(input.decision.goal ?? '').trim();
        if (goal) agent.goal = goal.slice(0, 300);
        return;
      }
      reinforceRecalled(state, agent);
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
      if (Array.isArray(input.decision.feelings))
        applyFeelings(state, agent, input.decision.feelings);
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
      const agent = findAgent(state, input.agentId);
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
      const agent = findAgent(state, input.agentId);
      if (agent) agent.brain = { ...input.brain };
      return;
    }
    case 'set_brains': {
      for (const id of input.agentIds) {
        const agent = findAgent(state, id);
        if (agent) agent.brain = { ...input.brain };
      }
      return;
    }
    case 'set_default_brain':
      state.settings.defaultBrain = { ...input.brain };
      if (input.applyToAll) for (const a of state.agents) if (a.alive) a.brain = { ...input.brain };
      return;
    case 'set_days_per_year':
      state.settings.daysPerYear = Math.min(60, Math.max(1, input.value));
      return;
    case 'world_event':
      startWorldEvent(ctx, input.event);
      return;
  }
}

// ------------------------------------------------------------------ world

function regrowResources(ctx: Ctx): void {
  const { state } = ctx;
  const ids = Object.keys(state.resources).sort();
  // The season sets the pace; droughts stunt growth; a bumper season doubles it.
  const season = seasonEffects(state);
  const growth =
    season.growth *
    (1 - 0.9 * conditionLevel(state, 'drought')) *
    (conditionLevel(state, 'bumper_harvest') > 0 ? 2 : 1);
  for (const id of ids) {
    const r = state.resources[id]!;
    if (r.amount >= r.max) continue;
    const before = Math.floor(r.amount);
    const rate = r.item === 'wood' ? season.woodGrowth : growth;
    r.amount = Math.min(r.max, r.amount + (r.regenPerDay * rate) / 24);
    if (Math.floor(r.amount) !== before) ctx.changed.add(id);
    // Trees are tracked only while recovering from chopping, to keep the state small.
    if (r.item === 'wood' && r.amount >= r.max) delete state.resources[id];
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

  // Babies need feeding every few hours (milk covers both food and water); the old tire faster.
  const infant = agent.age < 1;
  const pregnant = agent.pregnancy ? 1.25 : 1;
  const storm = indoors ? 0 : conditionLevel(state, 'storm');
  const season = seasonEffects(state);
  const heat = indoors || night ? 0 : 0.3 * conditionLevel(state, 'drought') + season.heat;
  // Warm clothes keep out some of the cold.
  const cold = indoors ? 1 : clothingWarmth(agent);
  n.food = clamp(
    n.food - ((infant ? 3 : asleep ? RATES.foodAsleep : RATES.foodAwake) * pregnant) / H,
  );
  n.water = clamp(
    n.water - ((infant ? 3 : asleep ? RATES.waterAsleep : RATES.waterAwake) * (1 + heat)) / H,
  );
  if (asleep) {
    n.energy = clamp(
      n.energy + (indoors ? RATES.energySleepIndoors : RATES.energySleepOutdoors) / H,
    );
  } else {
    const tiring = (agent.age < 3 ? 1.6 : agent.age >= 70 ? 1.25 : 1) * (1 + 0.3 * storm);
    n.energy = clamp(n.energy - (RATES.energyAwake * tiring) / H);
  }
  if (indoors) n.warmth = clamp(n.warmth + RATES.warmIndoors / H);
  else if (!night && !isTwilight(state.tick))
    n.warmth = clamp(n.warmth + (RATES.warmIndoors * season.dayWarmth) / H);
  else if (night)
    n.warmth = clamp(
      n.warmth -
        ((asleep ? RATES.coldNightAsleep : RATES.coldNightAwake) * season.nightCold * cold) / H,
    );
  else n.warmth = clamp(n.warmth - (RATES.coolTwilight * season.nightCold * cold) / H);
  // Wind and cold rain chill anyone caught outside.
  if (storm > 0) {
    const noSun = !night && !isTwilight(state.tick) ? RATES.warmIndoors * season.dayWarmth : 0;
    n.warmth = clamp(n.warmth - (noSun + 12 * storm * cold) / H);
  }

  // Health: suffers when needs hit bottom, recovers when they're comfortable.
  let damage = 0;
  if (n.food <= 0) damage += 4;
  if (n.water <= 0) damage += 8;
  if (n.warmth <= 0) damage += 5;
  for (const k of ['food', 'water', 'warmth'] as NeedName[])
    if (n[k] > 0 && n[k] < 10) damage += 0.5;
  if (damage > 0) agent.health = clamp(agent.health - damage / H);
  else if (!agent.sickness && n.food >= 30 && n.water >= 30 && n.warmth >= 30)
    agent.health = clamp(agent.health + ((asleep ? 3 : 1.5) * (agent.constitution ?? 1)) / H);

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
    // Sleep through the night; by day, get up once rested. Lying down while already rested
    // still means a nap of at least an hour, or the person wakes (and asks for a decision)
    // every couple of minutes.
    const slept = agent.action?.type === 'sleep' ? state.tick - agent.action.since : Infinity;
    const rested = hour >= 5 && hour < 21 && n.energy >= 90 && slept >= MIN_NAP;
    const desperate = n.food < 8 || n.water < 8;
    if (rested || desperate) {
      // Hunger or thirst can drag even an exhausted person to their feet for a while.
      if (desperate) n.energy = Math.max(n.energy, 12);
      wake(ctx, agent, true);
    }
  } else if (n.energy <= 0) {
    agent.plan = [];
    agent.action = { type: 'sleep', since: state.tick };
    agent.asleep = true;
    emit(ctx, 'collapsed', [agent.id], `${fullName(agent)} collapsed from exhaustion.`, 3);
    remember(agent, state.tick, 'I collapsed from exhaustion.', 5);
  }
}

function die(ctx: Ctx, agent: Agent, forcedCause?: string): void {
  const n = agent.needs;
  const lowest = (['water', 'food', 'warmth'] as NeedName[]).reduce((a, b) =>
    n[a] <= n[b] ? a : b,
  );
  const cause =
    forcedCause ??
    (n[lowest] <= 0
      ? { water: 'thirst', food: 'starvation', warmth: 'cold', energy: 'exhaustion' }[lowest]
      : agent.sickness
        ? 'illness'
        : 'poor health');
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
  mournDeath(ctx, agent);
  settleEstate(ctx, agent);
  noticeOrphans(ctx, agent);
}

export function wake(ctx: Ctx, agent: Agent, requestDecision: boolean): void {
  agent.asleep = false;
  agent.indoorsId = null;
  agent.action = null;
  // Fresh eyes on urgent needs after sleep, but keep "starving"/"crying" alerts until they recover.
  for (const k of ['food', 'water', 'energy', 'warmth']) delete agent.alerted[k];
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

/** Things that count as getting something done (resets the failure back-off). */
const SUCCESS_EVENTS = new Set([
  'ate',
  'drank',
  'gathered',
  'crafted',
  'traded',
  'gave',
  'said',
  'offer',
  'farmed',
  'quarried',
  'animals',
  'stall',
  'job',
  'meeting',
]);

export function fail(ctx: Ctx, agent: Agent, reason: string): void {
  agent.plan = [];
  agent.action = null;
  remember(agent, ctx.state.tick, reason, 2);
  agent.failStreak = (agent.failStreak ?? 0) + 1;
  if (agent.failStreak >= 3) {
    // Repeated failures: pause a while before thinking again, instead of hammering the brain.
    agent.action = { type: 'rest', until: ctx.state.tick + Math.min(60, 5 * agent.failStreak) };
    return;
  }
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
      if (ctx.moved.has(agent.id)) return; // already swapped places this tick
      const next = action.path[action.step];
      if (!next) {
        agent.action = null;
        if (action.then) startIntent(ctx, agent, action.then);
        return;
      }
      if (!isWalkable(state.map, next.x, next.y)) return fail(ctx, agent, 'My way was blocked.');
      if (walksSlowly(agent) && state.tick % 2 === 1) return;
      const other = occupantAt(state, next.x, next.y, agent);
      if (other && !passBy(ctx, agent, action, other)) return;
      action.blocked = 0;
      agent.facing = facingTo(agent, next);
      agent.x = next.x;
      agent.y = next.y;
      ctx.moved.add(agent.id);
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
    case 'chop':
      if (state.tick >= action.until) finishChop(ctx, agent, action.objectId);
      return;
    case 'craft':
      if (state.tick >= action.until) finishCraft(ctx, agent, action.recipe);
      return;
    case 'build':
      if (state.tick >= action.until) finishBuild(ctx, agent, action.objectId);
      return;
    case 'task':
      if (state.tick >= action.until) finishTask(ctx, agent, action);
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

/** A clearing, sowing, quarrying or tending job has run its time. */
function finishTask(ctx: Ctx, agent: Agent, action: TaskAction): void {
  switch (action.task) {
    case 'clear_field':
    case 'sow':
      return finishFarmingTask(ctx, agent, action);
    case 'quarry':
      return finishQuarry(ctx, agent, action);
    case 'tend_animals':
      return finishTendAnimals(ctx, agent, action);
  }
}

type WalkAction = Extract<NonNullable<Agent['action']>, { type: 'walk' }>;

/** Blocked ticks at which to step round whoever is in the way (rejoining the route further on). */
const DETOUR_AT = [1, 3];
/** Blocked ticks before planning a whole new route round someone standing still. */
const REPLAN_AT = 2;
/** Blocked ticks before squeezing past someone (swapping places with them). */
const SQUEEZE_STANDER = 4;
const SQUEEZE_WALKER = 10;
/** Sleepers (and the collapsed) don't get up for anyone: step over them sooner. */
const SQUEEZE_SLEEPER = 2;

/**
 * Someone stands on the walker's next tile. Returns true when the walker may step there now
 * (whoever was there has moved on); otherwise the walker waits. A line of walkers moves up
 * together and walkers whose ways cross (head-on, or round a corner) pass each other at once;
 * anyone else is stepped round if there's room, else waited for, and finally squeezed past,
 * so crowds always untangle and nobody ever shares a tile.
 */
function passBy(ctx: Ctx, agent: Agent, action: WalkAction, other: Agent): boolean {
  if (moveLine(ctx, agent) || stepAside(ctx, other, action)) return true;
  const blocked = (action.blocked = (action.blocked ?? 0) + 1);
  if (DETOUR_AT.includes(blocked) && detour(ctx, agent, action)) return false;
  if (ctx.moved.has(other.id)) return false;
  const oa = other.action?.type === 'walk' ? other.action : null;
  if (!oa && blocked === REPLAN_AT && replanAround(ctx, agent, action)) return false;
  // Someone walking will usually move on soon (pushing them back costs them a step), so they
  // are only squeezed past in a real jam.
  const squeezeAt = oa ? SQUEEZE_WALKER : other.asleep ? SQUEEZE_SLEEPER : SQUEEZE_STANDER;
  if (blocked < squeezeAt) return false;
  // Squeeze past: swap places. A walker pushed back a tile steps forward again next.
  const from = { x: other.x, y: other.y };
  other.x = agent.x;
  other.y = agent.y;
  if (oa) {
    oa.path.splice(oa.step, 0, from);
    other.facing = facingTo(other, from);
  }
  ctx.moved.add(other.id);
  return true;
}

/**
 * The walkers ahead (each on the tile the one behind wants next) all step forward together if
 * the line ends at a free tile or loops back to `agent` (people passing each other). Moves
 * everyone in the line except `agent`, and returns true if it did.
 */
function moveLine(ctx: Ctx, agent: Agent): boolean {
  const { state } = ctx;
  const line: Agent[] = [];
  const targets: Point[] = [];
  let cur = agent;
  for (;;) {
    if (line.length >= 24) return false;
    const ca = cur.action as WalkAction;
    const next = ca.path[ca.step]!;
    const occ = occupantAt(state, next.x, next.y, cur);
    if (!occ || occ === agent) break;
    const oa = occ.action;
    const theirs = oa?.type === 'walk' ? oa.path[oa.step] : undefined;
    if (
      !theirs ||
      ctx.moved.has(occ.id) ||
      line.includes(occ) ||
      !isWalkable(state.map, theirs.x, theirs.y) ||
      (walksSlowly(occ) && state.tick % 2 === 1)
    )
      return false;
    line.push(occ);
    targets.push(theirs);
    cur = occ;
  }
  if (line.length === 0) return false;
  for (let k = 0; k < line.length; k++) {
    const p = line[k]!;
    const t = targets[k]!;
    const pa = p.action as WalkAction;
    p.facing = facingTo(p, t);
    p.x = t.x;
    p.y = t.y;
    pa.step++;
    pa.blocked = 0;
    ctx.moved.add(p.id);
  }
  return true;
}

/**
 * Someone idling in the way (resting, eating, chatting, waiting for their thoughts) steps to a
 * free tile beside them that isn't on the walker's way. Returns true if they did.
 */
function stepAside(ctx: Ctx, other: Agent, action: WalkAction): boolean {
  const type = other.action?.type;
  if (other.asleep || ctx.moved.has(other.id) || (type && type !== 'rest' && type !== 'eat'))
    return false;
  const { state } = ctx;
  const ahead = action.path.slice(Math.max(0, action.step - 1), action.step + 3);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = other.x + dx;
    const y = other.y + dy;
    if (
      !isWalkable(state.map, x, y) ||
      ahead.some((p) => p.x === x && p.y === y) ||
      occupantAt(state, x, y, other)
    )
      continue;
    other.facing = facingTo(other, { x, y });
    other.x = x;
    other.y = y;
    ctx.moved.add(other.id);
    return true;
  }
  return false;
}

/**
 * Step round people in the way: a short route (others as walls) from here to a free tile a few
 * steps further along the current route, which then carries on as before.
 */
function detour(ctx: Ctx, agent: Agent, action: WalkAction): boolean {
  const { state } = ctx;
  const { map } = state;
  const others = crowd(state, agent);
  const last = action.path.length - 1;
  let k = -1;
  for (let j = action.step + 1; j <= Math.min(last, action.step + 5); j++) {
    const t = action.path[j]!;
    if (!others.taken(t.x, t.y)) {
      k = j;
      break;
    }
  }
  if (k < 0) return false;
  const goal = action.path[k]!;
  const base = moveCost(map);
  const cost: CostFn = (x, y) =>
    others.taken(x, y) || Math.abs(x - agent.x) > 6 || Math.abs(y - agent.y) > 6
      ? Infinity
      : base(x, y);
  const way = findPathToAny(map.width, map.height, agent, [goal], cost);
  // Only worth it if it isn't a long way round.
  if (!way || way.length < 2 || way.length - 1 > k - action.step + 4) return false;
  action.path = [...way, ...action.path.slice(k + 1)];
  action.step = 1;
  return true;
}

/**
 * New route from where the person stands to the walk's goals, treating every other outdoor person
 * as a wall. Returns false when there is none (the walk is left as it was).
 */
function replanAround(ctx: Ctx, agent: Agent, action: WalkAction): boolean {
  const { state } = ctx;
  const { map } = state;
  const others = crowd(state, agent);
  const goals = (action.goals ?? [action.path[action.path.length - 1]!]).filter(
    (g) => !others.taken(g.x, g.y),
  );
  if (goals.length === 0) return false;
  // Search a window around the start (a failed search would otherwise flood the whole map).
  const reach =
    8 + Math.min(...goals.map((g) => Math.abs(g.x - agent.x) + Math.abs(g.y - agent.y)));
  const base = moveCost(map);
  const cost: CostFn = (x, y) =>
    others.taken(x, y) || Math.abs(x - agent.x) > reach || Math.abs(y - agent.y) > reach
      ? Infinity
      : base(x, y);
  const path = findPathToAny(map.width, map.height, agent, goals, cost);
  if (!path) return false;
  if (path.length <= 1) {
    agent.action = null;
    if (action.then) startIntent(ctx, agent, action.then, true);
    return true;
  }
  action.path = path;
  action.step = 1;
  action.blocked = 0;
  return true;
}

/**
 * Safety net, run at the end of every tick: nobody outdoors shares a tile. The first person in
 * the list keeps the tile; later ones move to the nearest free tile (and re-route if walking).
 */
function separatePeople(ctx: Ctx): void {
  const { state } = ctx;
  const { map } = state;
  const w = map.width;
  const claimed = new Set<number>();
  let taken: Set<number> | null = null;
  for (const agent of state.agents) {
    if (!occupies(agent)) continue;
    const i = agent.y * w + agent.x;
    if (!claimed.has(i)) {
      claimed.add(i);
      continue;
    }
    if (!taken) {
      taken = new Set();
      for (const a of state.agents) if (occupies(a)) taken.add(a.y * w + a.x);
    }
    const free = nearestWalkable(map, agent, (p) => !taken!.has(p.y * w + p.x), 30);
    if (!free) continue;
    agent.x = free.x;
    agent.y = free.y;
    const j = free.y * w + free.x;
    taken.add(j);
    claimed.add(j);
    const action = agent.action;
    if (action?.type === 'walk') {
      // The old path no longer starts here.
      agent.action = null;
      const goals = action.goals ?? [action.path[action.path.length - 1]!];
      walkTo(ctx, agent, goals, action.then, 'where I was going');
    }
  }
}

export function facingTo(from: Point, to: Point): Facing {
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
  objectId?: string,
): boolean {
  const { map } = ctx.state;
  const others = crowd(ctx.state, agent);
  const free = goals.filter((g) => !others.taken(g.x, g.y));
  const useGoals = free.length > 0 ? free : goals;
  const base = moveCost(map);
  // Steer round people standing still (walkers will have moved on).
  const cost: CostFn = (x, y) => base(x, y) + (others.standing(x, y) ? 4 : 0);
  const path = findPathToAny(map.width, map.height, agent, useGoals, cost);
  if (!path) {
    // Remember that this place can't be reached from here (so nobody keeps trying).
    if (objectId)
      agent.knowledge[objectId] = {
        ...(agent.knowledge[objectId] ?? { lastSeenTick: ctx.state.tick }),
        unreachableTick: ctx.state.tick,
      };
    fail(ctx, agent, `I couldn't find a way to ${what}.`);
    return false;
  }
  if (path.length <= 1) {
    if (then) startIntent(ctx, agent, then, true);
    return true;
  }
  agent.action = { type: 'walk', path, step: 1, then, goals: useGoals, blocked: 0 };
  return true;
}

function startIntent(ctx: Ctx, agent: Agent, intent: Intent, arrived = false): void {
  const { state } = ctx;
  if (!canDo(agent, intent.type)) return fail(ctx, agent, tooYoung(agent, intent.type));
  const { map } = state;
  const cache = mapCache(map);
  // Stepping out: anything but resting or sleeping takes a person back outside.
  if (agent.indoorsId && intent.type !== 'rest' && intent.type !== 'sleep' && agent.age >= 1)
    agent.indoorsId = null;
  switch (intent.type) {
    case 'go_to': {
      if ('objectId' in intent.target) {
        const o = cache.byId.get(intent.target.objectId);
        if (!o) return fail(ctx, agent, `I tried to go somewhere that doesn't exist.`);
        walkTo(ctx, agent, interactionTiles(map, o), null, objName(state, o.id), o.id);
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
        walkTo(ctx, agent, tiles, intent, objName(state, o.id), o.id);
        return;
      }
      if (o.kind !== 'dock') {
        const r = state.resources[o.id];
        if (!r || r.amount < 1) {
          agent.knowledge[o.id] = { lastSeenTick: state.tick, lastSeenAmount: 0 };
          return fail(
            ctx,
            agent,
            o.name
              ? `${o.name} had nothing left to gather.`
              : `The ${objName(state, o.id)} had nothing left to gather.`,
          );
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
      if (!isFood(intent.item))
        return fail(ctx, agent, `I can't eat ${ITEM_LABELS[intent.item].toLowerCase()}.`);
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
      if (canDrinkAt(state, agent)) {
        agent.action = { type: 'drink', until: state.tick + 10 };
        return;
      }
      if (arrived) return fail(ctx, agent, 'There was no water where I went to drink.');
      let goals: Point[] = [];
      const source = intent.sourceId ? cache.byId.get(intent.sourceId) : undefined;
      const others = crowd(state, agent);
      if (source)
        goals = interactionTiles(map, source).filter(
          (p) => canDrinkAt(state, p) && !others.taken(p.x, p.y),
        );
      if (goals.length === 0) {
        // The nearest spot nobody is standing on (else just the nearest).
        const spot =
          nearestWalkable(
            map,
            agent,
            (p) => !others.taken(p.x, p.y) && canDrinkAt(state, p),
            120,
          ) ?? nearestWalkable(map, agent, (p) => canDrinkAt(state, p), 120);
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
        home?.door && home.door.x === agent.x && home.door.y === agent.y && usable(state, home.id)
          ? home.id
          : null;
      const where = agent.indoorsId ? 'at home' : 'outside';
      emit(ctx, 'fell_asleep', [agent.id], `${fullName(agent)} fell asleep ${where}.`, 1);
      remember(agent, state.tick, `I went to sleep ${where}.`);
      return;
    }
    case 'rest': {
      agent.action = {
        type: 'rest',
        until: state.tick + Math.min(600, Math.max(1, Math.round(intent.minutes))),
      };
      // Resting at your own front door means resting inside (warm, sheltered, out of sight).
      const home = agent.homeId ? cache.byId.get(agent.homeId) : undefined;
      if (
        home?.door &&
        home.door.x === agent.x &&
        home.door.y === agent.y &&
        usable(state, home.id)
      )
        agent.indoorsId = home.id;
      return;
    }
    case 'talk_to': {
      const other = findAgent(state, intent.agentId);
      if (!other || other === agent)
        return fail(ctx, agent, "I tried to talk to someone who isn't here.");
      if (!approach(ctx, agent, other, intent, TALK_RANGE, 'talk to')) return;
      speak(ctx, agent, other, intent.message);
      // Talking takes time: roughly one in-game minute per 15 words, then a pause for the answer.
      const words = intent.message.split(/\s+/).length;
      agent.action = { type: 'rest', until: state.tick + 2 + Math.ceil(words / 15) };
      return;
    }
    case 'chop_wood':
      return startChop(ctx, agent, intent.objectId, arrived);
    case 'craft':
      return startCraft(ctx, agent, intent, arrived);
    case 'buy':
    case 'sell':
      return marketTrade(ctx, agent, intent, arrived);
    case 'give':
    case 'offer_trade':
    case 'respond_offer':
    case 'steal':
    case 'attack':
      return personAction(ctx, agent, intent);
    case 'feed':
    case 'teach':
    case 'propose_partnership':
    case 'respond_proposal':
    case 'end_partnership':
    case 'try_for_child':
    case 'respond_child_request':
    case 'name_child':
    case 'adopt_child':
    case 'respond_adoption':
    case 'declare_will':
      return lifeAction(ctx, agent, intent);
    case 'build_house':
    case 'build':
      return startBuild(ctx, agent, intent, arrived);
    case 'tend':
      return tendAction(ctx, agent, intent);
    case 'clear_field':
      return startClearField(ctx, agent, intent, arrived);
    case 'sow':
      return startSow(ctx, agent, intent, arrived);
    case 'quarry':
      return startQuarry(ctx, agent, intent, arrived);
    case 'tend_animals':
      return startTendAnimals(ctx, agent, intent, arrived);
    case 'stock_stall':
    case 'take_from_stall':
    case 'buy_from_stall':
      return stallAction(ctx, agent, intent, arrived);
    case 'hire':
    case 'respond_job':
    case 'end_job':
      return jobAction(ctx, agent, intent);
    case 'call_meeting':
    case 'propose_rule':
    case 'vote':
    case 'pay_from_treasury':
      return governanceAction(ctx, agent, intent);
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
  const message = simplifySpeech(ctx, speaker, raw.trim().slice(0, 600));
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
    const heard = garble(ctx, listener, message);
    hearSpeech(listener);
    feel(listener, speaker, state.tick, { affection: 1 });
    remember(
      listener,
      state.tick,
      `${nameAsKnown(listener, speaker)} said to me: “${heard}”`,
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
        message: heard,
      };
    }
  }
  for (const other of state.agents) {
    if (other === speaker || other === listener || !other.alive || other.asleep || other.indoorsId)
      continue;
    const d = Math.max(Math.abs(other.x - speaker.x), Math.abs(other.y - speaker.y));
    if (d > OVERHEAR_RANGE) continue;
    // Chatter between others stays in working memory; talk of family or of oneself is remembered.
    const concerns =
      Boolean(other.people[speaker.id]?.role || other.people[listener.id]?.role) ||
      (other.name.length > 1 && message.includes(other.name));
    remember(
      other,
      state.tick,
      `I overheard ${nameAsKnown(other, speaker)} tell ${nameAsKnown(other, listener)}: “${message}”`,
      concerns ? 3 : 1,
      'conversation',
      [speaker.id, listener.id],
    );
  }
}

/** `viewer` has an encounter with `other`; learnName = other introduced themselves. */
export function meet(viewer: Agent, other: Agent, tick: number, learnName: boolean): void {
  const p = relation(viewer, other, tick);
  if (learnName && !p.name) p.name = fullName(other);
  p.familiarity = Math.min(100, p.familiarity + 2);
  p.lastSeenTick = tick;
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
  const tools = useTools(ctx, agent);
  if (o.kind === 'dock') {
    item = 'fish';
    const chance = 0.3 + agent.skills.fishing * 0.005 + (tools ? 0.15 : 0);
    const rough = conditionLevel(state, 'storm') >= 0.5;
    got = !rough && ctx.rng.chance(chance) ? 1 : 0;
    train(agent, 'fishing', 0.2);
    observeWork(state, agent, 'fishing');
  } else {
    const r = state.resources[o.id]!;
    item = r.item ?? (o.kind === 'field' ? 'vegetables' : 'berries');
    got = Math.min(3 + (tools ? 1 : 0), Math.floor(r.amount));
    r.amount -= got;
    ctx.changed.add(o.id);
    agent.knowledge[o.id] = { lastSeenTick: state.tick, lastSeenAmount: Math.floor(r.amount) };
    const skill = o.kind === 'field' ? 'farming' : 'foraging';
    train(agent, skill, 0.2);
    observeWork(state, agent, skill);
    if (o.kind === 'field' && got > 0) onFieldHarvest(ctx, agent, o, got);
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
      o.kind !== 'dock'
        ? `I found no ${label}.`
        : conditionLevel(state, 'storm') >= 0.5
          ? 'The river was too rough to fish in the storm.'
          : 'I fished but caught nothing.',
    );
  }
}

// ------------------------------------------------------------------ senses

/** Update what the agent knows from what it can see right now. */
export function look(state: WorldState, agent: Agent): void {
  if (!agent.alive || agent.asleep || agent.indoorsId) return;
  const radius =
    isNight(state.tick) || conditionLevel(state, 'storm') >= 0.5 ? VISION_NIGHT : VISION_DAY;
  for (const o of objectsNear(state.map, agent, radius)) {
    const r = state.resources[o.id];
    const seenBefore = agent.knowledge[o.id]?.lastSeenTick ?? -1;
    if (o.burntTick !== undefined && seenBefore >= 0 && seenBefore < o.burntTick) {
      // Coming upon a building that burnt down while they were away.
      const mine = agent.homeId === o.id || state.owners[o.id]?.includes(agent.id);
      const name = o.name ?? OBJECT_LABELS[o.kind];
      remember(agent, state.tick, `${mine ? 'My home' : name} has burnt down!`, mine ? 9 : 5);
      if (mine && !agent.awaiting)
        agent.awaiting = { kind: 'world_event', description: `${name} has burnt down.` };
    }
    agent.knowledge[o.id] = {
      lastSeenTick: state.tick,
      lastSeenAmount: r ? Math.floor(r.amount) : undefined,
      ...(o.kind === 'stall' ? { lastSeenForSale: stallListing(state, o.id) } : {}),
      ...(o.kind === 'pen' ? { lastSeenAnimals: penAnimals(state, o.id) } : {}),
    };
    if (o.kind === 'market' && distanceToObject(o, agent) <= 3) {
      seePrices(state, agent);
      readNoticeBoard(state, agent);
    }
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

// ------------------------------------------------------------------ work & trade

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

type ApproachIntent = Extract<Intent, { tries?: number }>;

/**
 * Walk to within `range` of another person. Returns true when close enough to act right now;
 * otherwise it has either started walking (and will retry the intent on arrival) or failed.
 */
export function approach(
  ctx: Ctx,
  agent: Agent,
  other: Agent,
  intent: ApproachIntent,
  range: number,
  verb: string,
): boolean {
  const who = nameAsKnown(agent, other);
  if (!other.alive) {
    fail(ctx, agent, `I wanted to ${verb} ${who}, but they are dead.`);
    return false;
  }
  const dist = cheb(agent, other);
  if (dist <= range && !other.indoorsId) return true;
  if (other.indoorsId) {
    // Knock at the door: someone awake inside comes out to answer.
    const building = mapCache(ctx.state.map).byId.get(other.indoorsId);
    if (other.asleep || !building?.door || other.age < 1) {
      fail(
        ctx,
        agent,
        `I wanted to ${verb} ${who}, but they are ${other.asleep ? 'asleep ' : ''}indoors.`,
      );
      return false;
    }
    if (cheb(agent, building.door) <= Math.max(1, range)) {
      other.indoorsId = null;
      remember(
        other,
        ctx.state.tick,
        `${nameAsKnown(other, agent)} knocked at the door.`,
        2,
        'experience',
        [agent.id],
      );
      return true;
    }
  }
  if (dist > 60) {
    fail(ctx, agent, `${who} is too far away to reach.`);
    return false;
  }
  const tries = intent.tries ?? 0;
  if (tries >= 3) {
    fail(ctx, agent, `I couldn't catch up with ${who}.`);
    return false;
  }
  const { map } = ctx.state;
  const goals: Point[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && isWalkable(map, other.x + dx, other.y + dy))
        goals.push({ x: other.x + dx, y: other.y + dy });
    }
  }
  if (goals.length === 0) goals.push({ x: other.x, y: other.y });
  else {
    const others = crowd(ctx.state, agent);
    const free = goals.filter((g) => !others.taken(g.x, g.y));
    if (free.length > 0) goals.splice(0, goals.length, ...free);
  }
  walkTo(ctx, agent, goals, { ...intent, tries: tries + 1 } as Intent, who);
  return false;
}

function normBundle(b: Bundle | undefined): Bundle {
  const out: Bundle = {};
  if (b?.item && (b.quantity ?? 0) > 0) {
    out.item = b.item;
    out.quantity = Math.floor(b.quantity!);
  }
  if ((b?.coins ?? 0) > 0) out.coins = Math.floor(b!.coins!);
  return out;
}

const isEmpty = (b: Bundle) => !(b.item && b.quantity) && !b.coins;

function hasBundle(a: Agent, b: Bundle): boolean {
  if (b.item && (a.inventory[b.item] ?? 0) < (b.quantity ?? 0)) return false;
  return a.money >= (b.coins ?? 0);
}

function moveBundle(from: Agent, to: Agent, b: Bundle): void {
  if (b.item && b.quantity) {
    from.inventory[b.item] = (from.inventory[b.item] ?? 0) - b.quantity;
    if (!from.inventory[b.item]) delete from.inventory[b.item];
    to.inventory[b.item] = (to.inventory[b.item] ?? 0) + b.quantity;
  }
  if (b.coins) {
    from.money -= b.coins;
    to.money += b.coins;
  }
}

/** Carrying tools improves yields; each use has a small chance of breaking them. */
export function useTools(ctx: Ctx, agent: Agent): boolean {
  if ((agent.inventory.tools ?? 0) <= 0) return false;
  if (ctx.rng.chance(0.03)) {
    agent.inventory.tools! -= 1;
    if (!agent.inventory.tools) delete agent.inventory.tools;
    remember(agent, ctx.state.tick, 'My tools broke.', 3);
  }
  return true;
}

function seePrices(state: WorldState, agent: Agent): void {
  agent.priceKnowledge = { tick: state.tick, prices: allQuotes(state.market) };
}

function startChop(ctx: Ctx, agent: Agent, objectId: string | undefined, arrived: boolean): void {
  const { state } = ctx;
  const { map } = state;
  const cache = mapCache(map);
  const woodLeft = (id: string) => resourceAmount(state, id) ?? 0;
  let tree = objectId ? cache.byId.get(objectId) : undefined;
  if (tree && tree.kind !== 'tree') tree = undefined;
  if (!tree) {
    let best: { o: (typeof map.objects)[number]; d: number } | null = null;
    for (const o of treesNear(map, agent, 25)) {
      const d = Math.abs(o.x - agent.x) + Math.abs(o.y - agent.y);
      if (d > 25 || woodLeft(o.id) < 1 || (best && d >= best.d)) continue;
      if (interactionTiles(map, o).length === 0) continue;
      best = { o, d };
    }
    tree = best?.o;
  }
  if (!tree) return fail(ctx, agent, "I couldn't find a tree with wood to chop nearby.");
  if (woodLeft(tree.id) < 1) return fail(ctx, agent, 'That tree has been chopped bare for now.');
  const tiles = interactionTiles(map, tree);
  if (!arrived && !isAt(agent, tiles)) {
    walkTo(ctx, agent, tiles, { type: 'chop_wood', objectId: tree.id }, 'a tree');
    return;
  }
  agent.facing = facingTo(agent, tree);
  agent.action = { type: 'chop', objectId: tree.id, until: state.tick + 30 };
}

function finishChop(ctx: Ctx, agent: Agent, treeId: string): void {
  const { state } = ctx;
  agent.action = null;
  const r = (state.resources[treeId] ??= {
    amount: TREE_WOOD,
    max: TREE_WOOD,
    regenPerDay: 1,
    item: 'wood',
  });
  const tools = useTools(ctx, agent);
  const got = Math.min(2 + (tools ? 1 : 0), Math.floor(r.amount));
  if (got <= 0) return fail(ctx, agent, 'That tree had no more wood worth taking.');
  r.amount -= got;
  agent.inventory.wood = (agent.inventory.wood ?? 0) + got;
  train(agent, 'building', 0.1);
  emit(ctx, 'gathered', [agent.id], `${fullName(agent)} chopped ${got} wood.`, 1);
  remember(agent, state.tick, `I chopped ${got} wood.`);
}

function startCraft(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'craft' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const { map } = state;
  const recipe = RECIPES[intent.recipe];
  if (!recipe) return fail(ctx, agent, "I don't know how to make that.");
  const workplaces = map.objects.filter((o) => o.kind === recipe.place && usable(state, o.id));
  const here = workplaces.find((o) => isAt(agent, interactionTiles(map, o)));
  if (!here) {
    if (arrived) return fail(ctx, agent, `I couldn't get into the ${recipe.place}.`);
    const known = workplaces.filter((o) => agent.knowledge[o.id]);
    if (known.length === 0) {
      const ruined = map.objects.some((o) => o.kind === recipe.place && !usable(state, o.id));
      return fail(
        ctx,
        agent,
        ruined
          ? `The ${recipe.place} can't be used — it needs rebuilding.`
          : `I don't know where a ${recipe.place} is.`,
      );
    }
    walkTo(
      ctx,
      agent,
      known.flatMap((o) => interactionTiles(map, o)),
      intent,
      `the ${recipe.place}`,
    );
    return;
  }
  if (intent.recipe === 'tools' && agent.skills.building < 15) {
    return fail(ctx, agent, "I don't have the skill to make tools yet.");
  }
  for (const [item, n] of Object.entries(recipe.inputs)) {
    if ((agent.inventory[item as ItemName] ?? 0) < n!) {
      return fail(
        ctx,
        agent,
        `I need ${describeBundle({ item: item as ItemName, quantity: n })} to make ${intent.recipe}.`,
      );
    }
  }
  const speedUp = 1 - Math.min(0.5, agent.skills[recipe.skill] / 200);
  agent.action = {
    type: 'craft',
    recipe: intent.recipe,
    until: state.tick + Math.round(recipe.minutes * speedUp),
  };
}

function finishCraft(ctx: Ctx, agent: Agent, name: keyof typeof RECIPES): void {
  const { state } = ctx;
  agent.action = null;
  const recipe = RECIPES[name];
  for (const [item, n] of Object.entries(recipe.inputs)) {
    if ((agent.inventory[item as ItemName] ?? 0) < n!)
      return fail(ctx, agent, `I ran out of ${item} while making ${name}.`);
  }
  for (const [item, n] of Object.entries(recipe.inputs)) {
    agent.inventory[item as ItemName]! -= n!;
    if (!agent.inventory[item as ItemName]) delete agent.inventory[item as ItemName];
  }
  const made: string[] = [];
  for (const [item, n] of Object.entries(recipe.outputs)) {
    const bonus =
      name !== 'tools' && name !== 'clothes' && agent.skills[recipe.skill] >= 50 ? 1 : 0;
    agent.inventory[item as ItemName] = (agent.inventory[item as ItemName] ?? 0) + n! + bonus;
    made.push(describeBundle({ item: item as ItemName, quantity: n! + bonus }));
  }
  train(agent, recipe.skill, 0.5);
  observeWork(state, agent, recipe.skill);
  const where = recipe.place === 'bakery' ? 'the bakery' : 'the workshop';
  emit(ctx, 'crafted', [agent.id], `${fullName(agent)} made ${made.join(', ')} at ${where}.`, 2);
  remember(agent, state.tick, `I made ${made.join(', ')} at ${where}.`, 2);
}

function marketTrade(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'buy' | 'sell' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const market = state.map.objects.find((o) => o.kind === 'market');
  if (!market) return fail(ctx, agent, 'There is no market here.');
  const tiles = interactionTiles(state.map, market);
  if (!isAt(agent, tiles) && cheb(agent, { x: market.x + 1, y: market.y }) > 2) {
    if (arrived) return fail(ctx, agent, "I couldn't reach the market stall.");
    if (!agent.knowledge[market.id]) return fail(ctx, agent, "I don't know where the market is.");
    walkTo(ctx, agent, tiles, intent, 'the market');
    return;
  }
  seePrices(state, agent);
  const item = intent.item;
  const label = ITEM_LABELS[item].toLowerCase();
  const q = quote(state.market, item);
  const wanted = Math.max(1, Math.floor(intent.quantity));
  if (intent.type === 'buy') {
    const stock = state.market.stock[item] ?? 0;
    const qty = Math.min(wanted, stock, Math.floor(agent.money / q.buy));
    if (qty <= 0) {
      return fail(
        ctx,
        agent,
        stock <= 0
          ? `The market had no ${label}.`
          : `I couldn't afford ${label} (${q.buy} coins each; I have ${agent.money}).`,
      );
    }
    agent.money -= qty * q.buy;
    state.market.stock[item] = stock - qty;
    agent.inventory[item] = (agent.inventory[item] ?? 0) + qty;
    emit(
      ctx,
      'traded',
      [agent.id],
      `${fullName(agent)} bought ${qty} ${label} at the market for ${qty * q.buy} coins.`,
      2,
    );
    remember(
      agent,
      state.tick,
      `I bought ${qty} ${label} at the market for ${qty * q.buy} coins (${q.buy} each).`,
      2,
    );
  } else {
    const room = Math.max(0, MARKET_TARGET[item] * 3 - (state.market.stock[item] ?? 0));
    const qty = Math.min(wanted, agent.inventory[item] ?? 0, room);
    if ((agent.inventory[item] ?? 0) <= 0) return fail(ctx, agent, `I had no ${label} to sell.`);
    if (qty <= 0)
      return fail(ctx, agent, `The market won't take any more ${label} — it's overflowing.`);
    agent.inventory[item]! -= qty;
    if (!agent.inventory[item]) delete agent.inventory[item];
    agent.money += qty * q.sell;
    state.market.stock[item] = (state.market.stock[item] ?? 0) + qty;
    emit(
      ctx,
      'traded',
      [agent.id],
      `${fullName(agent)} sold ${qty} ${label} at the market for ${qty * q.sell} coins.`,
      2,
    );
    remember(
      agent,
      state.tick,
      `I sold ${qty} ${label} at the market for ${qty * q.sell} coins (${q.sell} each).`,
      2,
    );
  }
  agent.action = { type: 'rest', until: state.tick + 5 };
}

/** Awake people within earshot who aren't part of the exchange. */
export function witnesses(state: WorldState, a: Agent, b: Agent): Agent[] {
  return state.agents.filter(
    (o) =>
      o !== a && o !== b && o.alive && !o.asleep && !o.indoorsId && cheb(o, a) <= OVERHEAR_RANGE,
  );
}

function personAction(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'give' | 'offer_trade' | 'respond_offer' | 'steal' | 'attack' }>,
): void {
  const { state } = ctx;
  const tick = state.tick;

  if (intent.type === 'respond_offer') {
    const offer = state.offers.find((o) => o.id === intent.offerId && o.to === agent.id);
    if (!offer) return fail(ctx, agent, 'That offer is no longer open.');
    const from = findAgent(state, offer.from)!;
    const who = nameAsKnown(agent, from);
    const terms = `${describeBundle(offer.give)} for ${describeBundle(offer.ask)}`;
    const answer = (accepted: boolean) => {
      state.offers = state.offers.filter((o) => o !== offer);
      if (from.alive && !from.asleep) {
        remember(
          from,
          tick,
          `${nameAsKnown(from, agent)} ${accepted ? 'accepted' : 'turned down'} my offer of ${terms}.`,
          4,
          'conversation',
          [agent.id],
        );
        if (!from.awaiting)
          from.awaiting = {
            kind: 'offer_answered',
            offerId: offer.id,
            byName: nameAsKnown(from, agent),
            accepted,
          };
      }
    };
    if (!intent.accept) {
      answer(false);
      remember(agent, tick, `I turned down ${who}'s offer of ${terms}.`, 3, 'conversation', [
        from.id,
      ]);
      emit(
        ctx,
        'offer',
        [agent.id, from.id],
        `${fullName(agent)} declined ${fullName(from)}'s offer.`,
        2,
      );
      return;
    }
    if (!approach(ctx, agent, from, intent, TALK_RANGE + 1, 'trade with')) return;
    if (!hasBundle(from, offer.give) || !hasBundle(agent, offer.ask)) {
      answer(false);
      return fail(
        ctx,
        agent,
        `The trade with ${who} fell through — one of us no longer had the goods.`,
      );
    }
    moveBundle(from, agent, offer.give);
    moveBundle(agent, from, offer.ask);
    feel(agent, from, tick, { trust: 3 });
    feel(from, agent, tick, { trust: 3 });
    answer(true);
    meet(agent, from, tick, true);
    meet(from, agent, tick, true);
    emit(
      ctx,
      'traded',
      [from.id, agent.id],
      `${fullName(from)} traded ${describeBundle(offer.give)} to ${fullName(agent)} for ${describeBundle(offer.ask)}.`,
      3,
    );
    remember(
      agent,
      tick,
      `I traded with ${who}: I got ${describeBundle(offer.give)} for ${describeBundle(offer.ask)}.`,
      4,
      'conversation',
      [from.id],
    );
    return;
  }

  const other = findAgent(state, intent.agentId);
  if (!other || other === agent) return fail(ctx, agent, "The person I meant isn't here.");
  const who = nameAsKnown(agent, other);

  switch (intent.type) {
    case 'give': {
      const gift = normBundle(intent.gift);
      if (isEmpty(gift)) return fail(ctx, agent, 'I meant to give something but chose nothing.');
      if (!hasBundle(agent, gift))
        return fail(ctx, agent, `I don't have ${describeBundle(gift)} to give.`);
      if (!approach(ctx, agent, other, intent, 1, 'give something to')) return;
      moveBundle(agent, other, gift);
      meet(other, agent, tick, true);
      feel(other, agent, tick, { affection: 6, trust: 4 });
      other.people[agent.id]!.familiarity = Math.min(100, other.people[agent.id]!.familiarity + 5);
      emit(
        ctx,
        'gave',
        [agent.id, other.id],
        `${fullName(agent)} gave ${describeBundle(gift)} to ${fullName(other)}.`,
        3,
      );
      remember(agent, tick, `I gave ${describeBundle(gift)} to ${who}.`, 3, 'experience', [
        other.id,
      ]);
      if (!other.asleep)
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} gave me ${describeBundle(gift)}.`,
          5,
          'experience',
          [agent.id],
        );
      agent.action = { type: 'rest', until: tick + 2 };
      return;
    }
    case 'offer_trade': {
      const give = normBundle(intent.give);
      const ask = normBundle(intent.ask);
      if (isEmpty(give) && isEmpty(ask)) return fail(ctx, agent, 'My offer had nothing in it.');
      if (!hasBundle(agent, give))
        return fail(ctx, agent, `I can't offer ${describeBundle(give)} — I don't have it.`);
      if (!approach(ctx, agent, other, intent, TALK_RANGE, 'trade with')) return;
      const offer = {
        id: `o${state.nextOfferNum++}`,
        from: agent.id,
        to: other.id,
        give,
        ask,
        createdTick: tick,
        expiresTick: tick + 120,
      };
      state.offers.push(offer);
      const terms = `${describeBundle(give)} for ${describeBundle(ask)}`;
      agent.speech = {
        text: `I'll give you ${describeBundle(give)} for ${describeBundle(ask)}.`,
        until: tick + 30,
      };
      emit(
        ctx,
        'offer',
        [agent.id, other.id],
        `${fullName(agent)} offered ${fullName(other)} ${terms}.`,
        2,
      );
      remember(agent, tick, `I offered ${who} ${terms}.`, 3, 'conversation', [other.id]);
      meet(agent, other, tick, false);
      if (!other.asleep) {
        meet(other, agent, tick, true);
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} offered me ${terms} (offer ${offer.id}).`,
          4,
          'conversation',
          [agent.id],
        );
        if (!other.awaiting) {
          other.awaiting = {
            kind: 'offer_received',
            offerId: offer.id,
            fromId: agent.id,
            fromName: nameAsKnown(other, agent),
            text: terms,
          };
        }
      }
      agent.action = { type: 'rest', until: tick + 3 };
      return;
    }
    case 'steal': {
      if (!approach(ctx, agent, other, intent, 1, 'get close to')) return;
      let taken: Bundle;
      if (intent.item && (other.inventory[intent.item] ?? 0) > 0) {
        taken = {
          item: intent.item,
          quantity: Math.max(1, Math.floor((other.inventory[intent.item] ?? 0) / 2)),
        };
      } else if (other.money > 0) {
        taken = { coins: Math.min(10, Math.max(1, Math.floor(other.money / 2))) };
      } else {
        return fail(ctx, agent, `${who} had nothing worth taking.`);
      }
      const success = ctx.rng.chance(other.asleep ? 0.9 : 0.6);
      if (success) moveBundle(other, agent, taken);
      const victimNoticed = !success || ctx.rng.chance(other.asleep ? 0.1 : 0.5);
      const seenBy = witnesses(state, agent, other).filter(() => ctx.rng.chance(0.5));
      const what = describeBundle(taken);
      const hidden = !victimNoticed && seenBy.length === 0 ? ' Nobody noticed.' : '';
      emit(
        ctx,
        'stole',
        [agent.id, other.id],
        success
          ? `${fullName(agent)} stole ${what} from ${fullName(other)}.${hidden}`
          : `${fullName(agent)} tried to steal from ${fullName(other)} and was caught.`,
        4,
      );
      remember(
        agent,
        tick,
        success ? `I stole ${what} from ${who}.` : `I tried to steal from ${who} and got caught.`,
        6,
        'experience',
        [other.id],
      );
      if (victimNoticed) {
        feel(other, agent, tick, { trust: -40, affection: -25 });
        if (other.asleep) wake(ctx, other, false);
        const thief = nameAsKnown(other, agent);
        remember(
          other,
          tick,
          success ? `${thief} stole ${what} from me!` : `${thief} tried to rob me!`,
          8,
          'experience',
          [agent.id],
        );
        if (!other.awaiting)
          other.awaiting = {
            kind: 'robbed',
            byId: agent.id,
            byName: thief,
            what: success ? what : 'nothing (I caught them)',
          };
      } else if (success) {
        remember(other, tick, `Some of my belongings went missing: ${what}.`, 5);
        if (!other.asleep && !other.awaiting)
          other.awaiting = { kind: 'robbed', byId: null, byName: 'someone', what };
      }
      for (const w of seenBy) {
        feel(w, agent, tick, { trust: -20, affection: -10 });
        remember(
          w,
          tick,
          `I saw ${nameAsKnown(w, agent)} ${success ? 'steal from' : 'try to steal from'} ${nameAsKnown(w, other)}.`,
          7,
          'experience',
          [agent.id, other.id],
        );
      }
      agent.action = { type: 'rest', until: tick + 2 };
      return;
    }
    case 'attack': {
      if (!approach(ctx, agent, other, intent, 1, 'attack')) return;
      const armed = (agent.inventory.tools ?? 0) > 0;
      const damage = 8 + ctx.rng.int(0, 17) + (armed ? 5 : 0);
      if (other.asleep) wake(ctx, other, false);
      other.health = clamp(other.health - damage);
      feel(other, agent, tick, { trust: -60, affection: -50 });
      for (const w of witnesses(state, agent, other))
        feel(w, agent, tick, { trust: -30, affection: -20 });
      agent.facing = facingTo(agent, other);
      const seen = witnesses(state, agent, other);
      emit(
        ctx,
        'attacked',
        [agent.id, other.id],
        `${fullName(agent)} attacked ${fullName(other)}${armed ? ' with a tool' : ''}.`,
        5,
      );
      remember(agent, tick, `I attacked ${who}.`, 7, 'experience', [other.id]);
      remember(other, tick, `${nameAsKnown(other, agent)} attacked me!`, 9, 'experience', [
        agent.id,
      ]);
      for (const w of seen)
        remember(
          w,
          tick,
          `I saw ${nameAsKnown(w, agent)} attack ${nameAsKnown(w, other)}!`,
          8,
          'experience',
          [agent.id, other.id],
        );
      if (other.health <= 0) {
        die(ctx, other, `violence (killed by ${fullName(agent)})`);
        remember(agent, tick, `I killed ${who}.`, 10, 'experience', [other.id]);
        for (const w of seen)
          remember(
            w,
            tick,
            `I saw ${nameAsKnown(w, agent)} kill ${nameAsKnown(w, other)}.`,
            10,
            'experience',
            [agent.id, other.id],
          );
      } else if (!other.awaiting) {
        other.awaiting = { kind: 'attacked', byId: agent.id, byName: nameAsKnown(other, agent) };
        other.plan = [];
        other.action = null;
      }
      agent.action = { type: 'rest', until: tick + 2 };
      return;
    }
  }
}

/** Unanswered offers lapse after two hours; offers involving the dead vanish. */
function expireOffers(ctx: Ctx): void {
  const { state } = ctx;
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  state.offers = state.offers.filter((o) => {
    const from = byId.get(o.from);
    const to = byId.get(o.to);
    if (!from?.alive || !to?.alive) return false;
    if (state.tick < o.expiresTick) return true;
    remember(
      from,
      state.tick,
      `${nameAsKnown(from, to)} never answered my offer of ${describeBundle(o.give)} for ${describeBundle(o.ask)}.`,
      2,
      'conversation',
      [to.id],
    );
    return false;
  });
}
