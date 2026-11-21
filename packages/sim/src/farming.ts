import {
  ITEM_LABELS,
  Tile,
  type Intent,
  type ItemName,
  type MapObject,
  type Point,
} from '@aw/shared';
import { fullName, remember, type Agent, type TaskAction } from './agent.ts';
import { cheb, emit, fail, facingTo, objName, useTools, type Ctx } from './engine.ts';
import { feel, observeWork, train } from './life.ts';
import { clearPlot, findFreePlot, nextObjectId } from './land.ts';
import { nameAsKnown } from './perception.ts';
import { interactionTiles, invalidateMapCaches, isAt, isWalkable, mapCache } from './spatial.ts';
import { findAgent } from './world.ts';

/**
 * Clearing new fields and sowing them (feature 1 of docs/plans/growing-the-village.md).
 */

const MAX_OWN_FIELDS = 2;
const FIELD_W = 4;
const FIELD_H = 3;
const WOOD_PER_TREE = 2;
const MAX_WOOD_FROM_CLEARING = 8;

/** Whether the person owns this field (common land has no owners). */
function ownsField(ctx: Ctx, field: MapObject, agentId: string): boolean {
  return ctx.state.owners[field.id]?.includes(agentId) ?? false;
}

/** Walkable tiles on a field (or around its 1-tile perimeter if every tile is currently wooded). */
function clearableApproachTiles(ctx: Ctx, field: MapObject): Point[] {
  const { map } = ctx.state;
  const inside = interactionTiles(map, field).filter((t) => isWalkable(map, t.x, t.y));
  if (inside.length > 0) return inside;
  const border: Point[] = [];
  for (let x = field.x - 1; x <= field.x + field.w; x++) {
    if (isWalkable(map, x, field.y - 1)) border.push({ x, y: field.y - 1 });
    if (isWalkable(map, x, field.y + field.h)) border.push({ x, y: field.y + field.h });
  }
  for (let y = field.y; y < field.y + field.h; y++) {
    if (isWalkable(map, field.x - 1, y)) border.push({ x: field.x - 1, y });
    if (isWalkable(map, field.x + field.w, y)) border.push({ x: field.x + field.w, y });
  }
  return border;
}

export function startClearField(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'clear_field' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const { map } = state;
  const cache = mapCache(map);
  const fields = cache.byKind.get('field') ?? [];
  // Carry on with an unfinished field of one's own before clearing new land.
  let field = fields.find((o) => o.progress !== undefined && ownsField(ctx, o, agent.id));
  let created = false;
  if (!field) {
    const mine = fields.filter((o) => ownsField(ctx, o, agent.id));
    if (mine.length >= MAX_OWN_FIELDS)
      return fail(ctx, agent, 'I already have two fields of my own to look after.');
    const home = agent.homeId ? cache.byId.get(agent.homeId) : undefined;
    const near = home ? { x: home.x, y: home.y } : { x: agent.x, y: agent.y };
    const spot = findFreePlot(state, near, FIELD_W, FIELD_H, false);
    if (!spot) return fail(ctx, agent, "There's no free land near here to clear.");

    const id = nextObjectId(state, 'field');
    const partner = agent.partnerId ? findAgent(state, agent.partnerId) : undefined;
    field = {
      id,
      kind: 'field',
      x: spot.x,
      y: spot.y,
      w: FIELD_W,
      h: FIELD_H,
      name: `Field ${id.split('-')[1]}`,
      progress: 0,
    };
    const tiles = clearableApproachTiles(ctx, field);
    if (tiles.length === 0) return fail(ctx, agent, "There's no free land near here to clear.");
    map.objects.push(field);
    state.owners[id] = [agent.id];
    if (partner?.alive) state.owners[id]!.push(partner.id);
    agent.knowledge[id] = { lastSeenTick: state.tick };
    invalidateMapCaches(map);
    state.mapVersion += 1;
    created = true;
  }

  const tiles = clearableApproachTiles(ctx, field);
  if (!arrived && !isAt(agent, tiles)) {
    const ok = ctx.walkTo(agent, tiles, intent, objName(state, field.id));
    if (!ok && created) {
      map.objects = map.objects.filter((o) => o !== field);
      delete state.owners[field.id];
      delete agent.knowledge[field.id];
      invalidateMapCaches(map);
      state.mapVersion += 1;
      return;
    }
    if (created) {
      emit(ctx, 'farmed', [agent.id], `${fullName(agent)} started clearing land for a field.`, 3, [
        field.id,
      ]);
      remember(
        agent,
        state.tick,
        `I started clearing land for a field of my own (${field.name}).`,
        5,
      );
    }
    return;
  }
  if (!isAt(agent, tiles)) return fail(ctx, agent, `I couldn't reach ${objName(state, field.id)}.`);
  if (created) {
    emit(ctx, 'farmed', [agent.id], `${fullName(agent)} started clearing land for a field.`, 3, [
      field.id,
    ]);
    remember(
      agent,
      state.tick,
      `I started clearing land for a field of my own (${field.name}).`,
      5,
    );
  }
  // Only clear trees/bushes/rocks and grant wood once the agent has actually arrived at the plot.
  if (field.progress === 0) {
    const removed = clearPlot(state, { x: field.x, y: field.y }, field.w, field.h);
    if (removed.length > 0) {
      const trees = removed.filter((o) => o.kind === 'tree').length;
      const wood = Math.min(MAX_WOOD_FROM_CLEARING, trees * WOOD_PER_TREE);
      if (wood > 0) agent.inventory.wood = (agent.inventory.wood ?? 0) + wood;
      state.mapVersion += 1;
    }
  }
  agent.facing = facingTo(agent, field);
  agent.action = { type: 'task', task: 'clear_field', objectId: field.id, until: state.tick + 60 };
}

export function startSow(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<Intent, { type: 'sow' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const { map } = state;
  const { item } = intent;
  const cache = mapCache(map);
  let field: MapObject | undefined;
  if (intent.objectId !== undefined) {
    field = cache.byId.get(intent.objectId);
    if (!field || field.kind !== 'field') return fail(ctx, agent, "I don't know of that field.");
  } else {
    let best: { o: MapObject; d: number } | null = null;
    for (const o of cache.byKind.get('field') ?? []) {
      if (o.progress !== undefined || !ownsField(ctx, o, agent.id)) continue;
      const d = cheb(agent, o);
      if (!best || d < best.d) best = { o, d };
    }
    field = best?.o;
    if (!field) return fail(ctx, agent, "I don't have a finished field of my own to sow.");
  }
  const name = objName(state, field.id);
  if (field.progress !== undefined) return fail(ctx, agent, `${name} isn't finished yet.`);
  const owners = state.owners[field.id];
  if (!owners?.length) return fail(ctx, agent, 'Common fields grow by themselves.');
  if (!owners.includes(agent.id)) return fail(ctx, agent, "That field isn't mine to sow.");
  if ((agent.inventory[item] ?? 0) < 2) return fail(ctx, agent, `I need 2 ${item} to sow.`);

  const tiles = interactionTiles(map, field);
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, { ...intent, objectId: field.id }, name);
    return;
  }
  if (!isAt(agent, tiles)) return fail(ctx, agent, `I couldn't reach ${name}.`);
  agent.facing = facingTo(agent, field);
  agent.action = { type: 'task', task: 'sow', objectId: field.id, until: state.tick + 40, item };
}

/** A `clear_field` or `sow` task has run its time. */
export function finishFarmingTask(ctx: Ctx, agent: Agent, action: TaskAction): void {
  agent.action = null;
  if (action.task === 'clear_field') return finishClearing(ctx, agent, action.objectId);
  if (action.task === 'sow' && action.item)
    return finishSowing(ctx, agent, action.objectId, action.item);
}

function finishClearing(ctx: Ctx, agent: Agent, fieldId: string): void {
  const { state } = ctx;
  const { map } = state;
  const field = mapCache(map).byId.get(fieldId);
  if (!field || field.kind !== 'field' || field.progress === undefined) return;
  const tools = useTools(ctx, agent);
  let gain = 0.25 * (0.6 + (agent.skills.farming ?? 0) / 100);
  if (tools) gain += 0.1;
  field.progress = Math.min(1, field.progress + gain);
  train(agent, 'farming', 0.5);
  observeWork(state, agent, 'farming');
  state.mapVersion += 1;

  const name = objName(state, field.id);
  if (field.progress >= 1) {
    delete field.progress;
    for (let y = field.y; y < field.y + field.h; y++)
      for (let x = field.x; x < field.x + field.w; x++)
        map.tiles[y * map.width + x] = Tile.Farmland;
    invalidateMapCaches(map);
    emit(ctx, 'farmed', [agent.id], `${fullName(agent)} cleared a new field (${name}).`, 4, [
      field.id,
    ]);
    remember(agent, state.tick, `I cleared a field of my own (${name}). Now it needs sowing.`, 7);
  } else {
    const pct = Math.round(field.progress * 100);
    emit(
      ctx,
      'farmed',
      [agent.id],
      `${fullName(agent)} cleared land for ${name} (${pct}% done).`,
      2,
      [field.id],
    );
    remember(agent, state.tick, `I cleared more land for my field (${pct}% done).`, 2);
  }
}

function finishSowing(ctx: Ctx, agent: Agent, fieldId: string, item: ItemName): void {
  const { state } = ctx;
  const field = mapCache(state.map).byId.get(fieldId);
  if (!field || field.kind !== 'field' || field.progress !== undefined)
    return fail(ctx, agent, "I can't sow that field any more.");
  if (!ownsField(ctx, field, agent.id)) return fail(ctx, agent, "That field isn't mine to sow.");
  if ((agent.inventory[item] ?? 0) < 2) return fail(ctx, agent, `I need 2 ${item} to sow.`);

  agent.inventory[item] = (agent.inventory[item] ?? 0) - 2;
  if (!agent.inventory[item]) delete agent.inventory[item];
  const size = field.w * field.h;
  state.resources[field.id] = { amount: 0, max: size * 1.2, regenPerDay: size * 0.5, item };
  ctx.changed.add(field.id);
  train(agent, 'farming', 0.4);

  const name = objName(state, field.id);
  const label = ITEM_LABELS[item].toLowerCase();
  emit(ctx, 'farmed', [agent.id], `${fullName(agent)} sowed ${name} with ${label}.`, 2, [field.id]);
  remember(agent, state.tick, `I sowed ${name} with ${label}.`, 4);
}

/** Someone just took `got` units of crop from a field (the owner may notice a stranger). */
export function onFieldHarvest(ctx: Ctx, agent: Agent, field: MapObject, got: number): void {
  const { state } = ctx;
  const ownerIds = state.owners[field.id];
  if (!ownerIds?.length || ownerIds.includes(agent.id)) return;
  const owners = ownerIds
    .map((id) => findAgent(state, id))
    .filter((o): o is Agent => o !== undefined);
  // Housemates of an owner and active contracted workers may harvest without penalty.
  if (agent.homeId && owners.some((o) => o.homeId === agent.homeId)) return;
  if (
    state.contracts.some(
      (c) =>
        c.worker === agent.id &&
        c.endTick > state.tick &&
        ownerIds.includes(c.employer) &&
        findAgent(state, c.employer)?.alive,
    )
  )
    return;

  const item = state.resources[field.id]?.item ?? 'vegetables';
  const label = ITEM_LABELS[item].toLowerCase();

  for (const owner of owners) {
    if (!owner.alive || owner.asleep || owner.indoorsId || cheb(owner, agent) > 8) continue;
    feel(owner, agent, state.tick, { trust: -10, affection: -5 });
    remember(
      owner,
      state.tick,
      `I saw ${nameAsKnown(owner, agent)} take ${got} ${label} from my field.`,
      6,
      'experience',
      [agent.id],
    );
  }
  const names = owners.map((o) => nameAsKnown(agent, o)).join(' and ');
  remember(
    agent,
    state.tick,
    `I took ${got} ${label} from ${names || 'someone'}'s field.`,
    3,
    'experience',
    ownerIds,
  );
}
