import type {
  Appearance,
  BrainConfig,
  DecisionTrigger,
  Facing,
  Intent,
  ItemName,
  Needs,
  Personality,
  Point,
  Sex,
  SkillName,
} from '@aw/shared';

export interface KnownPlaceState {
  lastSeenTick: number;
  lastSeenAmount?: number;
}

/** What the body is doing right now. Multi-tick; plans are made of these. */
export type ActionState =
  | { type: 'walk'; path: Point[]; step: number; then: Intent | null }
  | { type: 'gather'; objectId: string; until: number }
  | { type: 'eat'; item: ItemName; until: number }
  | { type: 'drink'; until: number }
  | { type: 'sleep'; since: number }
  | { type: 'rest'; until: number };

export interface Agent {
  id: string;
  name: string;
  familyName: string;
  sex: Sex;
  /** Age in years, accumulated tick by tick (see settings.daysPerYear). */
  age: number;
  bornTick: number;
  alive: boolean;
  death?: { tick: number; cause: string };

  appearance: Appearance;
  personality: Personality;
  traits: string;
  background: string;
  occupation: string;

  homeId: string | null;
  x: number;
  y: number;
  facing: Facing;

  needs: Needs;
  health: number;
  inventory: Partial<Record<ItemName, number>>;
  money: number;
  skills: Record<SkillName, number>;

  /** Places this agent has seen or been told about, by object id. No omniscience. */
  knowledge: Record<string, KnownPlaceState>;

  brain: BrainConfig;
  thought: string;
  goal: string;
  plan: Intent[];
  action: ActionState | null;
  /** A decision has been requested and not yet received. */
  awaiting: DecisionTrigger | null;
  asleep: boolean;
  indoorsId: string | null;
  /** Needs that have already raised an alert since they last recovered (keys: need or `${need}_zero`). */
  alerted: Record<string, boolean>;
  /** Next tick at which an awake, busy agent gets a routine check-in decision. */
  nextCheckIn: number;
  /** Short memory of the agent's own recent experiences (full memory system arrives in Phase 2). */
  recent: { tick: number; text: string }[];
}

export const RECENT_LIMIT = 12;

export function remember(agent: Agent, tick: number, text: string): void {
  agent.recent.push({ tick, text });
  if (agent.recent.length > RECENT_LIMIT)
    agent.recent.splice(0, agent.recent.length - RECENT_LIMIT);
}

export function fullName(agent: Agent): string {
  return agent.familyName ? `${agent.name} ${agent.familyName}` : agent.name;
}
