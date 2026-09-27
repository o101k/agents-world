/**
 * The contract between the simulation and an agent's brain.
 * The sim builds a Perception (only what this agent senses and knows) and asks for a Decision.
 */
import { z } from 'zod';
import type { EffortLevel, NeedName, Needs, Personality, Sex } from './agent.ts';
import type { MapObjectKind, Point } from './map.ts';

export type DecisionTrigger =
  | { kind: 'spawned' }
  | { kind: 'woke_up' }
  | { kind: 'plan_done' }
  | { kind: 'action_failed'; reason: string }
  | { kind: 'urgent_need'; need: NeedName }
  | { kind: 'spoken_to'; fromId: string; fromName: string; message: string }
  | { kind: 'offer_received'; offerId: string; fromId: string; fromName: string; text: string }
  | { kind: 'offer_answered'; offerId: string; byName: string; accepted: boolean }
  | { kind: 'robbed'; byId: string | null; byName: string; what: string }
  | { kind: 'attacked'; byId: string; byName: string }
  | { kind: 'check_in' };

export type ItemName =
  'berries' | 'vegetables' | 'fish' | 'bread' | 'wheat' | 'wood' | 'planks' | 'tools';

export interface ItemInfo {
  label: string;
  /** Hunger points restored when eaten (0 = not food). */
  nutrition: number;
  /** Market reference price in coins. */
  basePrice: number;
}

export const ITEMS: Record<ItemName, ItemInfo> = {
  berries: { label: 'Berries', nutrition: 8, basePrice: 2 },
  vegetables: { label: 'Vegetables', nutrition: 18, basePrice: 4 },
  fish: { label: 'Fish', nutrition: 25, basePrice: 6 },
  bread: { label: 'Bread', nutrition: 30, basePrice: 8 },
  wheat: { label: 'Wheat', nutrition: 0, basePrice: 2 },
  wood: { label: 'Wood', nutrition: 0, basePrice: 2 },
  planks: { label: 'Planks', nutrition: 0, basePrice: 6 },
  tools: { label: 'Tools', nutrition: 0, basePrice: 24 },
};
export const ITEM_NAMES = Object.keys(ITEMS) as ItemName[];
export const FOOD_ITEMS = ITEM_NAMES.filter((i) => ITEMS[i].nutrition > 0);
export const ITEM_LABELS = Object.fromEntries(ITEM_NAMES.map((i) => [i, ITEMS[i].label])) as Record<
  ItemName,
  string
>;

export type RecipeName = 'bread' | 'planks' | 'tools';

export interface Recipe {
  inputs: Partial<Record<ItemName, number>>;
  outputs: Partial<Record<ItemName, number>>;
  /** Where it's made. */
  place: 'bakery' | 'workshop';
  minutes: number;
  skill: 'cooking' | 'building';
}

export const RECIPES: Record<RecipeName, Recipe> = {
  bread: {
    inputs: { wheat: 3 },
    outputs: { bread: 2 },
    place: 'bakery',
    minutes: 30,
    skill: 'cooking',
  },
  planks: {
    inputs: { wood: 2 },
    outputs: { planks: 2 },
    place: 'workshop',
    minutes: 40,
    skill: 'building',
  },
  tools: {
    inputs: { planks: 3 },
    outputs: { tools: 1 },
    place: 'workshop',
    minutes: 60,
    skill: 'building',
  },
};
export const RECIPE_NAMES = Object.keys(RECIPES) as RecipeName[];

/** Goods and/or coins in a trade offer or gift. */
export interface Bundle {
  item?: ItemName;
  quantity?: number;
  coins?: number;
}

export function describeBundle(b: Bundle): string {
  const parts: string[] = [];
  if (b.item && (b.quantity ?? 0) > 0)
    parts.push(`${b.quantity} ${ITEM_LABELS[b.item].toLowerCase()}`);
  if ((b.coins ?? 0) > 0) parts.push(`${b.coins} coin${b.coins === 1 ? '' : 's'}`);
  return parts.join(' and ') || 'nothing';
}

/** One step of a plan. The body carries it out; the sim validates it. */
export type Intent =
  | { type: 'go_to'; target: { objectId: string } | Point }
  | { type: 'gather'; objectId: string }
  | { type: 'eat'; item: ItemName }
  | { type: 'drink'; sourceId?: string }
  | { type: 'sleep' }
  | { type: 'rest'; minutes: number }
  | { type: 'explore' }
  | {
      type: 'talk_to';
      agentId: string;
      message: string;
      /** internal: catch-up attempts */ tries?: number;
    }
  | { type: 'chop_wood'; objectId?: string }
  | { type: 'craft'; recipe: RecipeName }
  | { type: 'buy'; item: ItemName; quantity: number }
  | { type: 'sell'; item: ItemName; quantity: number }
  | { type: 'give'; agentId: string; gift: Bundle; tries?: number }
  | { type: 'offer_trade'; agentId: string; give: Bundle; ask: Bundle; tries?: number }
  | { type: 'respond_offer'; offerId: string; accept: boolean; tries?: number }
  | { type: 'steal'; agentId: string; item?: ItemName; tries?: number }
  | { type: 'attack'; agentId: string; tries?: number };

export interface Decision {
  /** Inner monologue shown to the observer. */
  thought: string;
  /** Current goal in a few words. */
  goal: string;
  plan: Intent[];
  /** Something the agent wants to remember, with importance 1–10. */
  remember?: { text: string; importance: number };
}

export interface PerceivedAgent {
  id: string;
  name: string;
  x: number;
  y: number;
  distance: number;
  activity: string;
}

export interface KnownPlace {
  id: string;
  kind: MapObjectKind;
  name: string;
  x: number;
  y: number;
  distance: number;
  /** Resource amount when last seen (berries on a bush, crops in a field). */
  lastSeenAmount?: number;
  /** What grows there (fields: wheat or vegetables). */
  produce?: ItemName;
  /** Who owns it, as the agent knows them ('you' for their own). */
  owner?: string;
  lastSeenTick: number;
}

export interface OfferView {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  give: Bundle;
  ask: Bundle;
  expiresTick: number;
}

export interface Perception {
  agentId: string;
  tick: number;
  clock: { day: number; hour: number; minute: number; isNight: boolean };
  trigger: DecisionTrigger;
  self: {
    name: string;
    age: number;
    sex: Sex;
    occupation: string;
    traits: string;
    background: string;
    needs: Needs;
    health: number;
    inventory: Partial<Record<ItemName, number>>;
    money: number;
    position: Point;
    homeId: string | null;
    asleep: boolean;
    indoors: boolean;
  };
  /** A short description of where the agent is. */
  location: string;
  visibleAgents: PerceivedAgent[];
  knownPlaces: KnownPlace[];
  /** The agent's own recent experiences, newest last. */
  recent: string[];
  /** Older memories that come to mind now (most relevant first). */
  memories: string[];
  /** People this agent knows by name, with how well. */
  knownPeople: { id: string; name: string; familiarity: number; lastSeenTick: number }[];
  /** Personality traits (0–100) for the prompt. */
  personality: Personality;
  /** The agent's thinking budget level. */
  effort: EffortLevel;
  /** Plan steps still queued from the previous decision. */
  remainingPlan: Intent[];
  /** Market prices as last seen at the market (null if never been). */
  marketPrices: {
    tick: number;
    prices: Partial<Record<ItemName, { buy: number; sell: number }>>;
  } | null;
  /** Trade offers waiting for this agent's answer, and ones they made. */
  offers: OfferView[];
  /** Trees within sight (for chopping wood). */
  treesNearby: number;
}

export interface DecisionRequest {
  agentId: string;
  tick: number;
  perception: Perception;
}

// ---- Validation (used for AI output and by the simulation to reject malformed plans) ----

const ItemSchema = z.enum([
  'berries',
  'vegetables',
  'fish',
  'bread',
  'wheat',
  'wood',
  'planks',
  'tools',
]);
const Qty = z.number().int().min(1).max(999);
const BundleSchema = z.object({
  item: ItemSchema.optional(),
  quantity: z.number().int().min(0).max(999).optional(),
  coins: z.number().int().min(0).max(100000).optional(),
});
const PointSchema = z.object({ x: z.number().int(), y: z.number().int() });

export const IntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('go_to'),
    target: z.union([z.object({ objectId: z.string() }), PointSchema]),
  }),
  z.object({ type: z.literal('gather'), objectId: z.string() }),
  z.object({ type: z.literal('eat'), item: ItemSchema }),
  z.object({ type: z.literal('drink'), sourceId: z.string().optional() }),
  z.object({ type: z.literal('sleep') }),
  z.object({ type: z.literal('rest'), minutes: z.number().min(1).max(600) }),
  z.object({ type: z.literal('explore') }),
  z.object({
    type: z.literal('talk_to'),
    agentId: z.string(),
    message: z.string().min(1).max(600),
  }),
  z.object({ type: z.literal('chop_wood'), objectId: z.string().optional() }),
  z.object({ type: z.literal('craft'), recipe: z.enum(['bread', 'planks', 'tools']) }),
  z.object({ type: z.literal('buy'), item: ItemSchema, quantity: Qty }),
  z.object({ type: z.literal('sell'), item: ItemSchema, quantity: Qty }),
  z.object({ type: z.literal('give'), agentId: z.string(), gift: BundleSchema }),
  z.object({
    type: z.literal('offer_trade'),
    agentId: z.string(),
    give: BundleSchema,
    ask: BundleSchema,
  }),
  z.object({ type: z.literal('respond_offer'), offerId: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('steal'), agentId: z.string(), item: ItemSchema.optional() }),
  z.object({ type: z.literal('attack'), agentId: z.string() }),
]);

export const DecisionSchema = z.object({
  thought: z.string().max(2000).default(''),
  goal: z.string().max(300).default(''),
  plan: z.array(z.unknown()).max(20).default([]),
  remember: z.object({ text: z.string().max(500), importance: z.number() }).optional(),
});

/** Human-readable one-liner for an intent, e.g. for the inspector. */
export function describeIntent(intent: Intent, names: (id: string) => string = (id) => id): string {
  switch (intent.type) {
    case 'go_to':
      return 'objectId' in intent.target
        ? `Go to ${names(intent.target.objectId)}`
        : `Go to (${intent.target.x}, ${intent.target.y})`;
    case 'gather':
      return `Gather at ${names(intent.objectId)}`;
    case 'eat':
      return `Eat ${intent.item}`;
    case 'drink':
      return intent.sourceId ? `Drink at ${names(intent.sourceId)}` : 'Drink water';
    case 'sleep':
      return 'Sleep';
    case 'rest':
      return `Rest ${intent.minutes} min`;
    case 'explore':
      return 'Explore';
    case 'talk_to':
      return `Say to ${names(intent.agentId)}: “${intent.message}”`;
    case 'chop_wood':
      return 'Chop wood';
    case 'craft':
      return `Make ${intent.recipe}`;
    case 'buy':
      return `Buy ${intent.quantity} ${intent.item} at the market`;
    case 'sell':
      return `Sell ${intent.quantity} ${intent.item} at the market`;
    case 'give':
      return `Give ${describeBundle(intent.gift)} to ${names(intent.agentId)}`;
    case 'offer_trade':
      return `Offer ${names(intent.agentId)} ${describeBundle(intent.give)} for ${describeBundle(intent.ask)}`;
    case 'respond_offer':
      return `${intent.accept ? 'Accept' : 'Decline'} offer ${intent.offerId}`;
    case 'steal':
      return `Steal ${intent.item ?? 'coins'} from ${names(intent.agentId)}`;
    case 'attack':
      return `Attack ${names(intent.agentId)}`;
  }
}
