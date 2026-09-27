/**
 * The contract between the simulation and an agent's brain.
 * The sim builds a Perception (only what this agent senses and knows) and asks for a Decision.
 */
import { z } from 'zod';
import type { NeedName, Needs, Sex } from './agent.ts';
import type { MapObjectKind, Point } from './map.ts';

export type DecisionTrigger =
  | { kind: 'spawned' }
  | { kind: 'woke_up' }
  | { kind: 'plan_done' }
  | { kind: 'action_failed'; reason: string }
  | { kind: 'urgent_need'; need: NeedName }
  | { kind: 'check_in' };

export type ItemName = 'berries' | 'vegetables' | 'fish' | 'bread';

export const ITEM_LABELS: Record<ItemName, string> = {
  berries: 'Berries',
  vegetables: 'Vegetables',
  fish: 'Fish',
  bread: 'Bread',
};

/** One step of a plan. The body carries it out; the sim validates it. */
export type Intent =
  | { type: 'go_to'; target: { objectId: string } | Point }
  | { type: 'gather'; objectId: string }
  | { type: 'eat'; item: ItemName }
  | { type: 'drink'; sourceId?: string }
  | { type: 'sleep' }
  | { type: 'rest'; minutes: number }
  | { type: 'explore' };

export interface Decision {
  /** Inner monologue shown to the observer. */
  thought: string;
  /** Current goal in a few words. */
  goal: string;
  plan: Intent[];
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
  lastSeenTick: number;
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
  /** Plan steps still queued from the previous decision. */
  remainingPlan: Intent[];
}

export interface DecisionRequest {
  agentId: string;
  tick: number;
  perception: Perception;
}

// ---- Validation (used for AI output and by the simulation to reject malformed plans) ----

const ItemSchema = z.enum(['berries', 'vegetables', 'fish', 'bread']);
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
]);

export const DecisionSchema = z.object({
  thought: z.string().max(2000).default(''),
  goal: z.string().max(300).default(''),
  plan: z.array(z.unknown()).max(20).default([]),
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
  }
}
