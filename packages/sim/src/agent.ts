import type {
  Aptitude,
  FamilyRole,
  LifeStage,
  RecipeName,
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

export type { MemoryKind } from '@aw/shared';
import type { MemoryKind } from '@aw/shared';

/** One long-term memory. Importance 1 (trivial) – 10 (life-changing). */
export interface Memory {
  tick: number;
  text: string;
  importance: number;
  kind: MemoryKind;
  /** People involved (agent ids), used for recall. */
  people: string[];
  /** How vivid it is (starts at importance; fades nightly unless important; forgotten below 1). */
  strength: number;
  /** Formed in the first three years of life (these mostly fade: childhood amnesia). */
  early?: boolean;
}

/** What remains of a forgotten memory (for the observer only; the person no longer has it). */
export interface ForgottenMemory {
  tick: number;
  text: string;
  importance: number;
  kind: MemoryKind;
}

export interface PersonKnowledge {
  /** Name as known to this agent (null = not introduced yet). */
  name: string | null;
  /** Grows with every conversation (0–100). */
  familiarity: number;
  /** Liking (−100…100). */
  affection: number;
  /** Trust (−100…100). */
  trust: number;
  /** Romantic interest (0–100). */
  romance: number;
  role?: FamilyRole;
  lastSeenTick: number;
}

export interface KnownPlaceState {
  lastSeenTick: number;
  lastSeenAmount?: number;
  /** Last time the agent tried and failed to find a way there. */
  unreachableTick?: number;
  /** A market stall's goods when last seen. */
  lastSeenForSale?: { item: ItemName; quantity: number; price: number }[];
  /** An animal pen's animals when last seen. */
  lastSeenAnimals?: { hens: number; sheep: number };
}

/** Longer jobs done at a place: clearing land, sowing, quarrying, tending animals. */
export type TaskKind = 'clear_field' | 'sow' | 'quarry' | 'tend_animals';

/** What the body is doing right now. Multi-tick; plans are made of these. */
export type ActionState =
  | {
      type: 'walk';
      path: Point[];
      step: number;
      then: Intent | null;
      /** Where the walk was headed (all acceptable end tiles), kept for re-routing around people. */
      goals?: Point[];
      /** Ticks in a row that someone was standing in the way. */
      blocked?: number;
    }
  | { type: 'gather'; objectId: string; until: number }
  | { type: 'chop'; objectId: string; until: number }
  | { type: 'craft'; recipe: RecipeName; until: number }
  | { type: 'build'; objectId: string; until: number }
  | { type: 'task'; task: TaskKind; objectId: string; until: number; item?: ItemName }
  | { type: 'eat'; item: ItemName; until: number }
  | { type: 'drink'; until: number }
  | { type: 'sleep'; since: number }
  | { type: 'rest'; until: number };

export type TaskAction = Extract<ActionState, { type: 'task' }>;

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
  /** Working memory: the agent's last few experiences, always in the prompt. */
  recent: { tick: number; text: string }[];
  /** Long-term memory stream (bounded; see MEMORY_LIMIT). */
  memories: Memory[];
  /** People this agent has met, by agent id. */
  people: Record<string, PersonKnowledge>;
  /** Words said recently (shown as a speech bubble until `until`). */
  speech: { text: string; until: number } | null;
  /** Conversation turn counters by partner id, to wind long chats down. */
  convo: Record<string, { turns: number; lastTick: number }>;
  /**
   * Cost of this agent's AI decisions (USD; Claude-plan calls at their API-price value) and number
   * of decisions.
   */
  spentUsd: number;
  decisions: number;
  /** Consecutive failed actions; after a few, the agent pauses before deciding again (saves AI calls). */
  failStreak: number;

  // ---- Life cycle (Phase 4)
  motherId: string | null;
  fatherId: string | null;
  /** Birth children and adopted children alike. */
  childrenIds: string[];
  /** People who adopted this person (the birth parents stay in motherId/fatherId). */
  adoptiveParentIds: string[];
  partnerId: string | null;
  /** Inborn learning speed by skill kind (inherited). */
  aptitude: Aptitude;
  /** Inborn hardiness (0.8–1.2): health recovery and lifespan (inherited). */
  constitution: number;
  /** Pregnancy progress in years (birth at 0.75); `known` once the mother notices. */
  pregnancy: { fatherId: string; progress: number; known: boolean } | null;
  will: { heirId: string } | null;
  /** Newborns are unnamed until a parent names them. */
  named: boolean;
  /** Stage at the last check, to notice growing up. */
  lastStage: LifeStage;
  /** Last tick this person tried for a child (once per in-game day). */
  lastChildTry: number;

  // ---- A long life (Phase 5)
  /** Forgotten memories, kept (capped) only so the observer can see what faded. */
  forgotten: ForgottenMemory[];
  /** In-game day of the last nightly reflection. */
  lastReflectDay: number;
  /** Age (whole years) of the last yearly life chapter. */
  lastChapterAge: number;
  sickness: { severity: number; since: number; known: boolean; tended: number } | null;
  /** Can't catch the same sickness again until this tick. */
  immuneUntil: number;
  // ---- Growing the village (state v9)
  /** Meetings this person has heard called (ids in `state.meetings`). */
  knownMeetings: string[];
  /** The market notice board (rules, leader, purse) as last read. */
  noticeBoard: {
    tick: number;
    ruleIds: string[];
    leaderId: string | null;
    treasury: number;
    taxPerDay: number;
  } | null;

  /** Market prices as last seen in person. */
  priceKnowledge: {
    tick: number;
    prices: Partial<Record<ItemName, { buy: number; sell: number }>>;
  } | null;
}

/** Hard cap on active long-term memories per person (the faintest are forgotten first). */
export const MEMORY_LIMIT = 500;
/** How many forgotten memories are kept for the observer. */
export const FORGOTTEN_LIMIT = 100;

export const RECENT_LIMIT = 12;

/**
 * Record an experience. Everything goes into working memory; anything above trivial also goes
 * into the long-term stream, which is capped by forgetting the faintest (see `forgetMemory`).
 */
export function remember(
  agent: Agent,
  tick: number,
  text: string,
  importance = 1,
  kind: MemoryKind = 'experience',
  people: string[] = [],
): void {
  agent.recent.push({ tick, text });
  if (agent.recent.length > RECENT_LIMIT)
    agent.recent.splice(0, agent.recent.length - RECENT_LIMIT);
  if (importance < 2) return;
  const imp = Math.max(1, Math.min(10, Math.round(importance)));
  const memory: Memory = { tick, text, importance: imp, kind, people, strength: imp };
  if (agent.age < 3) memory.early = true;
  agent.memories.push(memory);
  trimMemories(agent);
}

/** Enforce MEMORY_LIMIT by forgetting the faintest non-chapter memories first. */
export function trimMemories(agent: Agent): void {
  while (agent.memories.length > MEMORY_LIMIT) {
    let weakest = -1;
    let weakestScore = Infinity;
    for (let i = 0; i < agent.memories.length; i++) {
      const m = agent.memories[i]!;
      if (m.kind === 'chapter') continue;
      // the faintest goes first; the older one loses ties
      const score = m.strength * 1e3 + m.importance + m.tick / 1e9;
      if (score < weakestScore) {
        weakestScore = score;
        weakest = i;
      }
    }
    if (weakest < 0) break;
    forgetMemory(agent, weakest);
  }
}

/** Drop a memory from the person's mind (a trace is kept for the observer). */
export function forgetMemory(agent: Agent, index: number): void {
  const [m] = agent.memories.splice(index, 1);
  if (!m) return;
  agent.forgotten.push({ tick: m.tick, text: m.text, importance: m.importance, kind: m.kind });
  if (agent.forgotten.length > FORGOTTEN_LIMIT)
    agent.forgotten.splice(0, agent.forgotten.length - FORGOTTEN_LIMIT);
}

export function fullName(agent: Agent): string {
  const first = agent.name || 'Baby';
  return agent.familyName ? `${first} ${agent.familyName}` : first;
}
