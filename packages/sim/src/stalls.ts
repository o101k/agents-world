import { ITEM_LABELS, type Intent, type ItemName, type MapObject } from '@aw/shared';
import { fullName, remember, type Agent } from './agent.ts';
import { usable } from './conditions.ts';
import { emit, fail, objName, type Ctx } from './engine.ts';
import { train } from './life.ts';
import { nameAsKnown } from './perception.ts';
import { interactionTiles, isAt, mapCache } from './spatial.ts';
import { findAgent, type WorldState } from './world.ts';

/**
 * Villagers' own market stalls (feature 5 of docs/plans/growing-the-village.md).
 * A stall is a 2×1 `stall` object with no door. Its goods live in `state.stalls[id].stock`.
 */

export type StallIntent = Extract<
  Intent,
  { type: 'stock_stall' | 'take_from_stall' | 'buy_from_stall' }
>;

/** The first usable stall this agent owns, if any. */
function ownStall(state: WorldState, agent: Agent): MapObject | undefined {
  return state.map.objects.find(
    (o) => o.kind === 'stall' && state.owners[o.id]?.includes(agent.id) && usable(state, o.id),
  );
}

/** The stall's stock record, created lazily. */
function stockOf(state: WorldState, stallId: string): WorldState['stalls'][string] {
  state.stalls[stallId] ??= { stock: {} };
  return state.stalls[stallId]!;
}

function refreshSeen(state: WorldState, agent: Agent, stallId: string): void {
  agent.knowledge[stallId] = {
    ...agent.knowledge[stallId],
    lastSeenTick: state.tick,
    lastSeenForSale: stallListing(state, stallId),
  };
}

/** Walk to a stall's interaction tiles if needed. Returns true when the agent is there. */
function goToStall(
  ctx: Ctx,
  agent: Agent,
  intent: StallIntent,
  arrived: boolean,
  stall: MapObject,
  failText: string,
): boolean {
  const { state } = ctx;
  const tiles = interactionTiles(state.map, stall);
  if (!arrived && !isAt(agent, tiles)) {
    ctx.walkTo(agent, tiles, intent, objName(state, stall.id));
    return false;
  }
  if (!isAt(agent, tiles)) {
    fail(ctx, agent, failText);
    return false;
  }
  return true;
}

export function stallAction(ctx: Ctx, agent: Agent, intent: StallIntent, arrived: boolean): void {
  switch (intent.type) {
    case 'stock_stall':
      return stockStall(ctx, agent, intent, arrived);
    case 'take_from_stall':
      return takeFromStall(ctx, agent, intent, arrived);
    case 'buy_from_stall':
      return buyFromStall(ctx, agent, intent, arrived);
  }
}

function stockStall(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<StallIntent, { type: 'stock_stall' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const stall = ownStall(state, agent);
  if (!stall) return fail(ctx, agent, 'I have no market stall.');
  if (!goToStall(ctx, agent, intent, arrived, stall, "I couldn't reach my stall.")) return;

  const item = intent.item;
  const label = ITEM_LABELS[item].toLowerCase();
  const wanted = Math.max(1, Math.floor(intent.quantity));
  const qty = Math.min(wanted, agent.inventory[item] ?? 0);
  if (qty <= 0) return fail(ctx, agent, `I have no ${label} to put on the stall.`);
  const price = Math.max(1, Math.round(intent.price));

  agent.inventory[item]! -= qty;
  if (!agent.inventory[item]) delete agent.inventory[item];
  const stock = stockOf(state, stall.id).stock;
  stock[item] = { quantity: (stock[item]?.quantity ?? 0) + qty, price };

  emit(
    ctx,
    'stall',
    [agent.id],
    `${fullName(agent)} put ${qty} ${label} on their stall at ${price} coins each.`,
    2,
  );
  remember(agent, state.tick, `I put ${qty} ${label} on my stall at ${price} coins each.`, 2);
  refreshSeen(state, agent, stall.id);
  agent.action = { type: 'rest', until: state.tick + 5 };
}

function takeFromStall(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<StallIntent, { type: 'take_from_stall' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const stall = ownStall(state, agent);
  if (!stall) return fail(ctx, agent, 'I have no market stall.');
  if (!goToStall(ctx, agent, intent, arrived, stall, "I couldn't reach my stall.")) return;

  const item = intent.item;
  const label = ITEM_LABELS[item].toLowerCase();
  const stock = stockOf(state, stall.id).stock;
  const have = stock[item]?.quantity ?? 0;
  const qty = Math.min(Math.max(1, Math.floor(intent.quantity)), have);
  if (qty <= 0) return fail(ctx, agent, `There is no ${label} on my stall.`);

  const entry = stock[item]!;
  entry.quantity -= qty;
  if (entry.quantity <= 0) delete stock[item];
  agent.inventory[item] = (agent.inventory[item] ?? 0) + qty;

  emit(ctx, 'stall', [agent.id], `${fullName(agent)} took ${qty} ${label} back from their stall.`, 1);
  remember(agent, state.tick, `I took ${qty} ${label} back from my stall.`, 1);
  refreshSeen(state, agent, stall.id);
  agent.action = { type: 'rest', until: state.tick + 5 };
}

function buyFromStall(
  ctx: Ctx,
  agent: Agent,
  intent: Extract<StallIntent, { type: 'buy_from_stall' }>,
  arrived: boolean,
): void {
  const { state } = ctx;
  const stall = mapCache(state.map).byId.get(intent.objectId);
  if (!stall || stall.kind !== 'stall') return fail(ctx, agent, "There's no stall there.");
  if (!usable(state, stall.id)) return fail(ctx, agent, "That stall can't be used now.");
  if (state.owners[stall.id]?.includes(agent.id)) return fail(ctx, agent, "That's my own stall.");
  if (!goToStall(ctx, agent, intent, arrived, stall, "I couldn't reach that stall.")) return;

  const item = intent.item;
  const label = ITEM_LABELS[item].toLowerCase();
  const stock = stockOf(state, stall.id).stock;
  const entry = stock[item];
  if (!entry || entry.quantity <= 0) return fail(ctx, agent, `The stall had no ${label}.`);

  const wanted = Math.max(1, Math.floor(intent.quantity));
  const qty = Math.min(wanted, entry.quantity, Math.floor(agent.money / entry.price));
  if (qty <= 0) {
    return fail(
      ctx,
      agent,
      `I couldn't afford ${label} (${entry.price} coins each; I have ${agent.money}).`,
    );
  }

  const seller = (state.owners[stall.id] ?? [])
    .map((id) => findAgent(state, id))
    .find((a): a is Agent => Boolean(a?.alive));
  if (!seller) return fail(ctx, agent, 'Nobody minds that stall any more.');

  const total = qty * entry.price;
  agent.money -= total;
  seller.money += total;
  agent.inventory[item] = (agent.inventory[item] ?? 0) + qty;
  entry.quantity -= qty;
  if (entry.quantity <= 0) delete stock[item];

  remember(
    seller,
    state.tick,
    `${nameAsKnown(seller, agent)} bought ${qty} ${label} at my stall for ${total} coins.`,
    3,
    'experience',
    [agent.id],
  );
  train(seller, 'trading', 0.2);
  remember(
    agent,
    state.tick,
    `I bought ${qty} ${label} at ${nameAsKnown(agent, seller)}'s stall for ${total} coins.`,
    2,
  );
  emit(
    ctx,
    'stall',
    [agent.id],
    `${fullName(agent)} bought ${qty} ${label} at ${fullName(seller)}'s stall for ${total} coins.`,
    2,
  );
  refreshSeen(state, agent, stall.id);
  agent.action = { type: 'rest', until: state.tick + 5 };
}

/** What a stall has for sale right now, item by item. */
export function stallListing(
  state: WorldState,
  stallId: string,
): { item: ItemName; quantity: number; price: number }[] {
  const stock = state.stalls[stallId]?.stock ?? {};
  return (Object.keys(stock) as ItemName[])
    .filter((item) => (stock[item]?.quantity ?? 0) > 0)
    .sort()
    .map((item) => ({ item, quantity: stock[item]!.quantity, price: stock[item]!.price }));
}
