import {
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  type Intent,
  type ItemName,
  type MapObject,
} from '@aw/shared';
import { fullName, remember, type Agent, type TaskAction } from './agent.ts';
import { emit, fail, objName, type Ctx } from './engine.ts';
import { train, observeWork } from './life.ts';
import { mapCache, interactionTiles, isAt } from './spatial.ts';
import { usable } from './conditions.ts';
import { findAgent, type PenState, type WorldState } from './world.ts';

/**
 * Animal pens (hens, sheep), eggs, wool and warm clothes (feature 4 of
 * docs/plans/growing-the-village.md).
 */

const PEN_CAPACITY = 8;
const TEND_TICKS = 30;
const FEED_GAP = 6 * TICKS_PER_HOUR;
const DAY = TICKS_PER_DAY;
const MORNING = 6 * TICKS_PER_HOUR;
const FODDER: ItemName[] = ['berries', 'vegetables', 'wheat'];

/** The pen's record, created the first time anyone tends it. */
function ensurePen(state: WorldState, id: string): PenState {
  // Never tended before, so the first visit always brings something.
  state.pens[id] ??= { hens: 0, sheep: 0, wool: 0, lastTendedTick: state.tick - FEED_GAP };
  return state.pens[id]!;
}

/** Owners, people living with an owner, and people hired by an owner may tend a pen. */
function canTend(state: WorldState, agent: Agent, penId: string): boolean {
  const owners = state.owners[penId] ?? [];
  if (owners.includes(agent.id)) return true;
  if (agent.homeId && owners.some((id) => findAgent(state, id)?.homeId === agent.homeId))
    return true;
  return state.contracts.some(
    (c) => c.worker === agent.id && c.endTick > state.tick && owners.includes(c.employer),
  );
}

function take(agent: Agent, item: ItemName, n: number): void {
  if (n <= 0) return;
  const left = (agent.inventory[item] ?? 0) - n;
  if (left > 0) agent.inventory[item] = left;
  else delete agent.inventory[item];
}

function give(agent: Agent, item: ItemName, n: number): void {
  if (n > 0) agent.inventory[item] = (agent.inventory[item] ?? 0) + n;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function startTendAnimals(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'tend_animals' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const { map } = state;
  const pens = map.objects.filter((o) => o.kind === 'pen');
  let pen: MapObject | undefined;
  if (intent.objectId) {
    pen = pens.find((o) => o.id === intent.objectId);
    if (!pen) return fail(ctx, agent, 'I have no animal pen.');
    if (!canTend(state, agent, pen.id)) return fail(ctx, agent, "That pen isn't mine to tend.");
    if (!usable(state, pen.id)) return fail(ctx, agent, "That pen can't be used right now.");
  } else {
    pen = pens.find((o) => usable(state, o.id) && canTend(state, agent, o.id));
    if (!pen) return fail(ctx, agent, 'I have no animal pen.');
  }
  const tiles = interactionTiles(map, pen);
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, { type: 'tend_animals', objectId: pen.id }, objName(state, pen.id));
    return;
  }
  if (!isAt(agent, tiles)) return fail(ctx, agent, `I couldn't reach ${objName(state, pen.id)}.`);
  agent.action = {
    type: 'task',
    task: 'tend_animals',
    objectId: pen.id,
    until: state.tick + TEND_TICKS,
  };
}

export function finishTendAnimals(ctx: Ctx, agent: Agent, action: TaskAction): void {
  const { state } = ctx;
  agent.action = null;
  const o = mapCache(state.map).byId.get(action.objectId);
  if (!o || o.kind !== 'pen' || !usable(state, o.id))
    return fail(ctx, agent, "The pen can't be used any more.");
  const pen = ensurePen(state, o.id);
  const name = objName(state, o.id);

  // Put animals from the bag into the pen, up to its capacity.
  const hensIn = Math.min(agent.inventory.hen ?? 0, PEN_CAPACITY - pen.hens - pen.sheep);
  pen.hens += hensIn;
  take(agent, 'hen', hensIn);
  const sheepIn = Math.min(agent.inventory.sheep ?? 0, PEN_CAPACITY - pen.hens - pen.sheep);
  pen.sheep += sheepIn;
  take(agent, 'sheep', sheepIn);
  const moved = [
    hensIn > 0 ? plural(hensIn, 'hen', 'hens') : '',
    sheepIn > 0 ? plural(sheepIn, 'sheep', 'sheep') : '',
  ].filter(Boolean);
  if (moved.length > 0) remember(agent, state.tick, `I put ${moved.join(' and ')} in the pen.`, 2);

  if (pen.hens + pen.sheep === 0)
    return fail(ctx, agent, 'The pen is empty — I need hens or sheep from the market.');

  let produce = '';
  if (state.tick - pen.lastTendedTick >= FEED_GAP) {
    const fodder = FODDER.find((item) => (agent.inventory[item] ?? 0) > 0);
    const fed = fodder !== undefined;
    if (fodder) take(agent, fodder, 1);
    let eggs = 0;
    for (let i = 0; i < pen.hens; i++) if (ctx.rng.chance(fed ? 0.7 : 0.35)) eggs++;
    pen.wool += pen.sheep * (fed ? 0.35 : 0.15);
    const wool = Math.floor(pen.wool);
    pen.wool -= wool;
    give(agent, 'eggs', eggs);
    give(agent, 'wool', wool);
    produce = [
      eggs > 0 ? plural(eggs, 'egg', 'eggs') : '',
      wool > 0 ? plural(wool, 'wool', 'wool') : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
  if (produce) remember(agent, state.tick, `I tended the animals at ${name}: ${produce}.`, 2);
  else remember(agent, state.tick, 'The animals were already seen to.', 1);

  pen.lastTendedTick = state.tick;
  train(agent, 'farming', 0.3);
  observeWork(state, agent, 'farming');
  const who = fullName(agent);
  emit(
    ctx,
    'animals',
    [agent.id],
    produce
      ? `${who} tended the animals at ${name}: ${produce}.`
      : `${who} tended the animals at ${name}.`,
    1,
    [o.id],
  );
}

/** Once a tick: pens' daily upkeep (strays, breeding) and clothes wearing out. */
export function animalsTick(ctx: Ctx): void {
  const { state } = ctx;
  if (state.tick % DAY !== MORNING) return;
  const byId = mapCache(state.map).byId;

  for (const id of Object.keys(state.pens).sort()) {
    const pen = state.pens[id]!;
    const o = byId.get(id);
    if (!o || o.kind !== 'pen') continue;
    const name = objName(state, id);
    const total = pen.hens + pen.sheep;
    const idle = state.tick - pen.lastTendedTick;
    const owners = state.owners[id] ?? [];

    if (idle > 2 * DAY) {
      if (total === 0) continue;
      const sheepStray = ctx.rng.chance(pen.sheep / total);
      if (sheepStray) pen.sheep -= 1;
      else pen.hens -= 1;
      const kind = sheepStray ? 'sheep' : 'hen';
      for (const ownerId of owners) {
        const owner = findAgent(state, ownerId);
        if (owner?.alive) remember(owner, state.tick, `One of my ${kind} strayed from ${name}.`, 5);
      }
      emit(ctx, 'animals', owners, `A ${kind} strayed from ${name}.`, 2, [id]);
    } else if (idle <= DAY) {
      if (pen.hens >= 2 && pen.hens + pen.sheep < PEN_CAPACITY && ctx.rng.chance(0.25)) {
        pen.hens += 1;
        emit(ctx, 'animals', owners, `A new hen hatched at ${name}.`, 1, [id]);
      }
      if (pen.sheep >= 2 && pen.hens + pen.sheep < PEN_CAPACITY && ctx.rng.chance(0.15)) {
        pen.sheep += 1;
        emit(ctx, 'animals', owners, `A lamb was born at ${name}.`, 1, [id]);
      }
    }
  }

  for (const a of state.agents) {
    if (!a.alive || !a.inventory.clothes) continue;
    if (ctx.rng.chance(0.04)) {
      take(a, 'clothes', 1);
      remember(a, state.tick, 'My warm clothes wore out.', 3);
    }
  }
}

/** How much of the cold reaches this person (1 = all of it; warm clothes lower it). */
export function clothingWarmth(agent: Agent): number {
  return (agent.inventory.clothes ?? 0) > 0 ? 0.6 : 1;
}

/** The animals in a pen right now. */
export function penAnimals(state: WorldState, penId: string): { hens: number; sheep: number } {
  const pen = state.pens[penId];
  return pen ? { hens: pen.hens, sheep: pen.sheep } : { hens: 0, sheep: 0 };
}
