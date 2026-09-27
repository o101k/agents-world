import {
  SKILL_NAMES,
  type Appearance,
  type BrainConfig,
  type ItemName,
  type Personality,
  type Point,
  type Sex,
  type SkillName,
} from '@aw/shared';
import type { Agent } from './agent.ts';
import type { Rng } from './rng.ts';

/** Description of a person to create (starting cast, observer spawn, and later births). */
export interface AgentSpec {
  name: string;
  familyName?: string;
  sex: Sex;
  age: number;
  occupation?: string;
  traits?: string;
  background?: string;
  personality?: Partial<Personality>;
  appearance?: Partial<Appearance>;
  money?: number;
  inventory?: Partial<Record<ItemName, number>>;
  skills?: Partial<Record<SkillName, number>>;
  /** Index into the map's houses for the starting cast (same index = same household). */
  household?: number;
  /** Explicit home (object id). */
  homeId?: string | null;
  /** Where the person appears. Defaults to their home door, or the edge of the map. */
  position?: Point;
  brain?: BrainConfig;
  /** Knows the village layout (true for residents, false for newcomers). */
  knowsVillage?: boolean;
}

export const SKIN_TONES = ['#f5d0b0', '#ecc19c', '#d9a57a', '#b8835a', '#8d5a3a', '#603c24'];
export const HAIR_COLORS = [
  '#2a1a10',
  '#4a2e1a',
  '#7a4a24',
  '#b07a3a',
  '#d8b870',
  '#a8402a',
  '#1a1a1a',
];
export const GREY_HAIR = ['#9a9a9a', '#c8c8c8', '#e6e6e6'];
export const SHIRT_COLORS = [
  '#c0504d',
  '#4f81bd',
  '#9bbb59',
  '#8064a2',
  '#f79646',
  '#4bacc6',
  '#d8c8a0',
  '#6a8a5a',
  '#a05a8a',
  '#5a6a8a',
  '#c8a040',
  '#8a4a3a',
];
export const PANTS_COLORS = ['#3a3a4a', '#5a4a3a', '#4a5a6a', '#6a5a4a', '#2a3a2a', '#4a3a4a'];

export const DEFAULT_BRAIN: BrainConfig = { provider: 'mock', model: '', effort: 'frugal' };

export function randomAppearance(rng: Rng, sex: Sex, age: number): Appearance {
  const grey = age >= 55 && rng.chance(Math.min(0.9, (age - 45) / 25));
  return {
    skin: rng.pick(SKIN_TONES),
    hair: grey ? rng.pick(GREY_HAIR) : rng.pick(HAIR_COLORS),
    shirt: rng.pick(SHIRT_COLORS),
    pants: rng.pick(PANTS_COLORS),
    hairStyle: sex === 'female' ? (rng.chance(0.8) ? 1 : 0) : age > 50 && rng.chance(0.4) ? 2 : 0,
  };
}

function randomPersonality(rng: Rng): Personality {
  const t = () =>
    Math.round(Math.min(95, Math.max(5, 50 + (rng.next() + rng.next() + rng.next() - 1.5) * 45)));
  return {
    openness: t(),
    conscientiousness: t(),
    extraversion: t(),
    agreeableness: t(),
    neuroticism: t(),
  };
}

export function createAgent(
  spec: AgentSpec,
  opts: { id: string; tick: number; rng: Rng; position: Point; homeId: string | null },
): Agent {
  const { rng } = opts;
  const skills = Object.fromEntries(SKILL_NAMES.map((s) => [s, 0])) as Record<SkillName, number>;
  if (spec.age >= 16) {
    for (const s of SKILL_NAMES) skills[s] = Math.round(rng.range(5, 20));
    skills.foraging = Math.round(rng.range(15, 35));
  }
  Object.assign(skills, spec.skills);
  return {
    id: opts.id,
    name: spec.name,
    familyName: spec.familyName ?? '',
    sex: spec.sex,
    age: spec.age,
    bornTick: opts.tick,
    alive: true,
    appearance: { ...randomAppearance(rng, spec.sex, spec.age), ...spec.appearance },
    personality: { ...randomPersonality(rng), ...spec.personality },
    traits: spec.traits ?? '',
    background: spec.background ?? '',
    occupation: spec.occupation ?? 'villager',
    homeId: opts.homeId,
    x: opts.position.x,
    y: opts.position.y,
    facing: 'down',
    needs: {
      food: rng.range(65, 90),
      water: rng.range(65, 90),
      energy: rng.range(75, 95),
      warmth: 100,
    },
    health: 100,
    inventory: { ...spec.inventory },
    money: spec.money ?? 0,
    skills,
    knowledge: {},
    brain: spec.brain ?? { ...DEFAULT_BRAIN },
    thought: '',
    goal: '',
    plan: [],
    action: null,
    awaiting: null,
    asleep: false,
    indoorsId: null,
    alerted: {},
    nextCheckIn: opts.tick + 240,
    recent: [],
  };
}

/**
 * The sample cast: four households of adults in a small village.
 * (Babies and children join in the life-cycle phase.)
 */
export const SAMPLE_CAST: AgentSpec[] = [
  {
    name: 'Maren',
    familyName: 'Holt',
    sex: 'female',
    age: 34,
    household: 0,
    occupation: 'farmer',
    traits: 'Practical, stubborn, quietly kind. Hates waste.',
    background:
      'Grew up on the fields east of the village and took them over when her father died. Married to Tobias for twelve years.',
    personality: { conscientiousness: 82, agreeableness: 60, extraversion: 35 },
    skills: { farming: 60, foraging: 40, cooking: 35 },
    money: 40,
    inventory: { vegetables: 4, bread: 1 },
  },
  {
    name: 'Tobias',
    familyName: 'Holt',
    sex: 'male',
    age: 36,
    household: 0,
    occupation: 'fisherman',
    traits: 'Cheerful, loud, generous with others, careless with money.',
    background:
      'The best fisherman on the river, and he knows it. Likes a drink and a story more than hard work.',
    personality: { extraversion: 85, conscientiousness: 30, agreeableness: 70 },
    skills: { fishing: 65 },
    money: 12,
    inventory: { fish: 2 },
  },
  {
    name: 'Elsbeth',
    familyName: 'Crane',
    sex: 'female',
    age: 52,
    household: 1,
    occupation: 'baker',
    traits: 'Warm, generous, a terrible gossip. Up before dawn every day.',
    background:
      'Has run the village bakery for thirty years. Widowed five winters ago; raised her son Jory alone since then.',
    personality: { extraversion: 75, agreeableness: 78, conscientiousness: 70 },
    skills: { cooking: 70, trading: 45 },
    money: 85,
    inventory: { bread: 4 },
  },
  {
    name: 'Jory',
    familyName: 'Crane',
    sex: 'male',
    age: 19,
    household: 1,
    occupation: "baker's apprentice",
    traits: 'Restless, clever, impatient. Dreams of leaving the village.',
    background:
      "Elsbeth's son. Helps at the bakery but resents it; spends his free time exploring the forest and the far bank.",
    personality: { openness: 85, conscientiousness: 35, neuroticism: 60 },
    skills: { cooking: 25, foraging: 35 },
    money: 6,
    inventory: { bread: 1 },
  },
  {
    name: 'Aldric',
    familyName: 'Venn',
    sex: 'male',
    age: 45,
    household: 2,
    occupation: 'carpenter',
    traits: 'Quiet, honest to a fault, slow to anger and slow to forgive.',
    background: 'Built half the houses in the village. Runs the workshop. Married to Wenna.',
    personality: { conscientiousness: 80, extraversion: 25, agreeableness: 55 },
    skills: { building: 70 },
    money: 60,
    inventory: { bread: 2 },
  },
  {
    name: 'Wenna',
    familyName: 'Venn',
    sex: 'female',
    age: 41,
    household: 2,
    occupation: 'herbalist',
    traits: 'Curious, sharp-tongued, knows every plant in the forest.',
    background:
      'Came from a river town downstream twenty years ago and married Aldric. Treats the sick.',
    personality: { openness: 80, agreeableness: 45, neuroticism: 40 },
    skills: { foraging: 65, caregiving: 55 },
    money: 30,
    inventory: { berries: 5 },
  },
  {
    name: 'Piet',
    familyName: 'Morrow',
    sex: 'male',
    age: 28,
    household: 3,
    occupation: 'odd-jobber',
    traits: 'Charming, secretive, opportunistic. Always owes someone money.',
    background:
      'Arrived in the village two years ago from nobody knows where. Rents the small house by the road and does whatever work pays.',
    personality: { extraversion: 70, agreeableness: 35, conscientiousness: 30, openness: 65 },
    skills: { trading: 50 },
    money: 3,
  },
  {
    name: 'Ida',
    familyName: 'Fenwick',
    sex: 'female',
    age: 67,
    household: 4,
    occupation: 'retired midwife',
    traits: 'Wise, patient, frail. Remembers everything about everyone.',
    background:
      'Delivered almost every person born in the village for forty years. Lives alone since her husband died.',
    personality: { agreeableness: 80, conscientiousness: 65, neuroticism: 30 },
    skills: { caregiving: 80, foraging: 35 },
    money: 55,
    inventory: { vegetables: 2, bread: 1 },
  },
];
