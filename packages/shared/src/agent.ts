/** Agent-related types shared by the simulation, the brain layer and the UI. */

export type Sex = 'female' | 'male';
export type Facing = 'down' | 'up' | 'left' | 'right';

export type NeedName = 'food' | 'water' | 'energy' | 'warmth';
/** 100 = fully satisfied, 0 = critical. */
export type Needs = Record<NeedName, number>;

export const NEED_LABELS: Record<NeedName, string> = {
  food: 'Food',
  water: 'Water',
  energy: 'Energy',
  warmth: 'Warmth',
};

export interface Appearance {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  /** 0 = short, 1 = long, 2 = bald/very short */
  hairStyle: number;
}

/** Big Five personality traits, 0–100. */
export interface Personality {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export type SkillName =
  'foraging' | 'fishing' | 'farming' | 'cooking' | 'building' | 'trading' | 'caregiving';
export const SKILL_NAMES: SkillName[] = [
  'foraging',
  'fishing',
  'farming',
  'cooking',
  'building',
  'trading',
  'caregiving',
];

export type ProviderId = 'mock' | 'anthropic' | 'openai' | 'openai_compatible';
export type EffortLevel = 'frugal' | 'standard' | 'deep';

export interface BrainConfig {
  provider: ProviderId;
  /** Model id for the provider ('' = provider default). */
  model: string;
  effort: EffortLevel;
}

export type Activity =
  | 'idle'
  | 'walking'
  | 'sleeping'
  | 'eating'
  | 'drinking'
  | 'gathering'
  | 'resting'
  | 'working'
  | 'thinking'
  | 'dead';

/** What the map needs to draw one person. Sent every frame. */
export interface AgentView {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  activity: Activity;
  indoors: boolean;
  alive: boolean;
  sex: Sex;
  age: number;
  appearance: Appearance;
  /** Words said in the last few in-game minutes (speech bubble). */
  speech?: string;
}

export interface MemoryView {
  tick: number;
  text: string;
  importance: number;
  kind: 'experience' | 'conversation' | 'thought' | 'told';
}

export interface KnownPlaceView {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  lastSeenAmount?: number;
  lastSeenTick: number;
}

/** Everything the observer can inspect about one person. */
export interface AgentDetail extends AgentView {
  familyName: string;
  occupation: string;
  traits: string;
  background: string;
  personality: Personality;
  needs: Needs;
  health: number;
  money: number;
  inventory: Record<string, number>;
  skills: Record<SkillName, number>;
  homeId: string | null;
  homeName: string | null;
  brain: BrainConfig;
  thought: string;
  goal: string;
  plan: string[];
  currentAction: string | null;
  awaitingDecision: boolean;
  knownPlaces: number;
  recent: { tick: number; text: string }[];
  memories: MemoryView[];
  people: { id: string; name: string; familiarity: number; lastSeenTick: number }[];
  death?: { tick: number; cause: string };
  bornTick: number;
  spentUsd: number;
  decisions: number;
  /** Buildings they own (or co-own). */
  owns: { id: string; name: string }[];
}

/** One exchange with a brain, for the mind inspector. */
export interface LlmCallView {
  id: number;
  tick: number;
  provider: string;
  model: string;
  trigger: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  prompt: string | null;
  response: string | null;
  error: string | null;
}
