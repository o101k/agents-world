import type { BrainConfig, Personality, Sex, SpawnRequest } from '@aw/shared';
import type { BrainRouter } from './router.ts';
import type { Usage } from './types.ts';

/** The fields of a new person that an AI (or the fallback) fills in from a description. */
export interface PersonDraft {
  name: string;
  familyName: string;
  sex: Sex;
  age: number;
  occupation: string;
  traits: string;
  background: string;
  personality: Personality;
}

const PERSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'First name, fitting a pre-industrial village.' },
    family_name: { type: 'string' },
    sex: { type: 'string', enum: ['female', 'male'] },
    age: { type: 'integer', description: '16–90' },
    occupation: { type: 'string' },
    traits: { type: 'string', description: 'One or two sentences on their character.' },
    background: {
      type: 'string',
      description: 'Two or three sentences of life story, in the third person.',
    },
    openness: { type: 'integer', description: '0–100' },
    conscientiousness: { type: 'integer', description: '0–100' },
    extraversion: { type: 'integer', description: '0–100' },
    agreeableness: { type: 'integer', description: '0–100' },
    neuroticism: { type: 'integer', description: '0–100' },
  },
  required: ['name', 'family_name', 'sex', 'age', 'occupation', 'traits', 'background'],
};

const FIRST = {
  female: [
    'Agnes',
    'Brida',
    'Cora',
    'Edda',
    'Freya',
    'Greta',
    'Hilde',
    'Isolde',
    'Lena',
    'Mira',
    'Nell',
    'Rosa',
  ],
  male: [
    'Anselm',
    'Bram',
    'Conrad',
    'Dietrich',
    'Emil',
    'Gunnar',
    'Hugo',
    'Jonas',
    'Leopold',
    'Matthis',
    'Oskar',
    'Rolf',
  ],
};
const FAMILY = [
  'Ashdown',
  'Brenner',
  'Coldwell',
  'Dunmore',
  'Everly',
  'Farrow',
  'Graves',
  'Hollin',
  'Kessler',
  'Marsh',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

/** Offline fallback: invent the basics and keep the description as their story. */
export function draftPersonOffline(req: SpawnRequest): PersonDraft {
  const h = hash(req.description);
  const sex: Sex = req.sex ?? (h % 2 ? 'female' : 'male');
  return {
    name: req.name || FIRST[sex][h % FIRST[sex].length]!,
    familyName: FAMILY[(h >>> 4) % FAMILY.length]!,
    sex,
    age: req.age ?? 20 + (h % 40),
    occupation: 'traveller',
    traits: req.description.slice(0, 300),
    background: req.description,
    personality: {
      openness: 50,
      conscientiousness: 50,
      extraversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    },
  };
}

/**
 * Turn the observer's description into a full person using the world's default AI.
 * Falls back to the offline draft if no AI is configured or the call fails.
 */
export async function draftPerson(
  req: SpawnRequest,
  brain: BrainConfig,
  router: BrainRouter,
): Promise<{ draft: PersonDraft; usage?: Usage; model?: string; error?: string }> {
  const offline = draftPersonOffline(req);
  const hints = [
    req.name && `Name: ${req.name}`,
    req.sex && `Sex: ${req.sex}`,
    req.age && `Age: ${req.age}`,
  ]
    .filter(Boolean)
    .join('\n');
  const r = await router.generate(brain, {
    model: brain.model,
    system:
      'You create characters for a life simulation set in a small pre-industrial village (farms, a river, a bakery, a workshop, a market). Stay faithful to the description; fill gaps plausibly.',
    user: `Create this person:\n${req.description}\n${hints}\n\nCall create_person with the details.`,
    toolName: 'create_person',
    toolDescription: 'Define the new person.',
    schema: PERSON_SCHEMA,
    maxTokens: 1500,
  });
  if (r.notSetUp) return { draft: offline };
  if (r.error || r.timedOut || r.refused || r.limit || !r.output || typeof r.output !== 'object') {
    return {
      draft: offline,
      usage: r.usage,
      model: r.model,
      error: r.error ?? 'The model did not return a person.',
    };
  }
  const o = r.output as Record<string, unknown>;
  const sex: Sex = req.sex ?? (o.sex === 'male' || o.sex === 'female' ? o.sex : offline.sex);
  const nonEmpty = (v: unknown, max: number, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
  const draft: PersonDraft = {
    name: req.name || nonEmpty(o.name, 40, offline.name),
    familyName: nonEmpty(o.family_name, 40, offline.familyName),
    sex,
    age: req.age ?? clamp(o.age, 16, 90, offline.age),
    occupation: nonEmpty(o.occupation, 60, offline.occupation),
    traits: nonEmpty(o.traits, 400, offline.traits),
    background: nonEmpty(o.background, 1200, offline.background),
    personality: {
      openness: clamp(o.openness, 0, 100, 50),
      conscientiousness: clamp(o.conscientiousness, 0, 100, 50),
      extraversion: clamp(o.extraversion, 0, 100, 50),
      agreeableness: clamp(o.agreeableness, 0, 100, 50),
      neuroticism: clamp(o.neuroticism, 0, 100, 50),
    },
  };
  return { draft, usage: r.usage, model: r.model };
}
