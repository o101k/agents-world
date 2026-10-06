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
  | 'foraging'
  | 'fishing'
  | 'farming'
  | 'cooking'
  | 'building'
  | 'trading'
  | 'caregiving'
  | 'language';
export const SKILL_NAMES: SkillName[] = [
  'foraging',
  'fishing',
  'farming',
  'cooking',
  'building',
  'trading',
  'caregiving',
  'language',
];

/** Inborn learning speed (0.7–1.3) by kind of skill; inherited from parents. */
export interface Aptitude {
  physical: number;
  craft: number;
  social: number;
  intellectual: number;
}

export const SKILL_APTITUDE: Record<SkillName, keyof Aptitude> = {
  foraging: 'physical',
  fishing: 'physical',
  farming: 'physical',
  cooking: 'craft',
  building: 'craft',
  trading: 'social',
  caregiving: 'social',
  language: 'intellectual',
};

export type LifeStage = 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'elder';

export function stageOf(age: number): LifeStage {
  if (age < 1) return 'infant';
  if (age < 3) return 'toddler';
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 60) return 'adult';
  return 'elder';
}

export const STAGE_LABELS: Record<LifeStage, string> = {
  infant: 'Baby',
  toddler: 'Toddler',
  child: 'Child',
  teen: 'Teenager',
  adult: 'Adult',
  elder: 'Elder',
};

export type FamilyRole = 'mother' | 'father' | 'child' | 'sibling' | 'partner' | 'former partner';

/** How one person feels about another (affection/trust −100…100; familiarity/romance 0…100). */
export interface RelationshipView {
  id: string;
  name: string;
  familiarity: number;
  affection: number;
  trust: number;
  romance: number;
  role?: FamilyRole;
  lastSeenTick: number;
}

export type ProviderId = 'mock' | 'anthropic' | 'openai' | 'openai_compatible' | 'claude_plan';
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
  | 'sick'
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
  /** The building they're inside, when indoors (drawn inside it). */
  indoorsId?: string;
  alive: boolean;
  sex: Sex;
  age: number;
  appearance: Appearance;
  /** Words said in the last few in-game minutes (speech bubble). */
  speech?: string;
  stage: LifeStage;
  sick?: boolean;
}

export type MemoryKind =
  'experience' | 'conversation' | 'thought' | 'told' | 'diary' | 'chapter' | 'belief';

export interface MemoryView {
  tick: number;
  text: string;
  importance: number;
  kind: MemoryKind;
  /** 0–10: how vivid it still is (it fades unless important). */
  strength?: number;
  forgotten?: boolean;
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
  people: RelationshipView[];
  family: {
    mother: { id: string; name: string; alive: boolean } | null;
    father: { id: string; name: string; alive: boolean } | null;
    partner: { id: string; name: string; alive: boolean } | null;
    children: { id: string; name: string; alive: boolean; adopted?: boolean }[];
    adoptiveParents: { id: string; name: string; alive: boolean }[];
  };
  aptitude: Aptitude;
  constitution: number;
  pregnancy: { fatherName: string; progress: number } | null;
  will: { heirName: string } | null;
  sickness: { severity: number; since: number } | null;
  forgotten: MemoryView[];
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
