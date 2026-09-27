import type { Sex } from '@aw/shared';
import type { AgentSpec } from './cast.ts';
import { Rng } from './rng.ts';

const FIRST: Record<Sex, string[]> = {
  female: [
    'Agnes',
    'Brida',
    'Cora',
    'Dagny',
    'Edda',
    'Frieda',
    'Gerda',
    'Hedda',
    'Ingrid',
    'Johanna',
    'Kaja',
    'Lotte',
    'Magda',
    'Nelle',
    'Odile',
    'Petra',
    'Runa',
    'Sigrid',
    'Thea',
    'Ulla',
    'Vera',
    'Wilma',
  ],
  male: [
    'Albrecht',
    'Bastian',
    'Conrad',
    'Detlef',
    'Emil',
    'Friedrich',
    'Gustav',
    'Harald',
    'Ingo',
    'Jakob',
    'Knut',
    'Lorenz',
    'Magnus',
    'Niklas',
    'Otto',
    'Paul',
    'Rolf',
    'Sven',
    'Theo',
    'Ulrich',
    'Viktor',
    'Wendel',
  ],
};
const FAMILY = [
  'Ashby',
  'Brandt',
  'Carrow',
  'Dahl',
  'Eske',
  'Fairweather',
  'Grimm',
  'Hask',
  'Ivers',
  'Jessop',
  'Kell',
  'Lind',
  'Mott',
  'Norrell',
  'Oakes',
  'Pell',
  'Quist',
  'Rook',
  'Stave',
  'Thorne',
];
const OCCUPATIONS = [
  'farmer',
  'fisherman',
  'baker',
  'carpenter',
  'herbalist',
  'forager',
  'woodcutter',
  'trader',
  'weaver',
  'odd-jobber',
  'midwife',
  'shepherd',
];
const TRAITS = [
  'patient',
  'hot-tempered',
  'generous',
  'stingy',
  'curious',
  'suspicious of strangers',
  'cheerful',
  'gloomy',
  'hard-working',
  'lazy',
  'proud',
  'humble',
  'gossipy',
  'secretive',
  'kind to children',
  'ambitious',
  'pious',
  'sharp-tongued',
  'soft-spoken',
  'stubborn',
];

export interface GenerateOptions {
  adults: number;
  children: number;
}

/**
 * A random but plausible starting population from a seed: couples and single adults in their
 * own households, and children placed with parents old enough to have them.
 */
export function generateCast(seed: string, { adults, children }: GenerateOptions): AgentSpec[] {
  const rng = Rng.fromSeed(`${seed}:cast`);
  const used = new Set<string>();
  const name = (sex: Sex) => {
    for (let i = 0; i < 50; i++) {
      const n = rng.pick(FIRST[sex]);
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    return `${rng.pick(FIRST[sex])} ${used.size}`;
  };
  const specs: AgentSpec[] = [];
  const households: { members: AgentSpec[]; family: string; parents: AgentSpec[] }[] = [];
  let remaining = Math.max(1, adults);
  while (remaining > 0) {
    const family =
      rng.pick(FAMILY.filter((f) => !households.some((h) => h.family === f))) ?? rng.pick(FAMILY);
    const couple = remaining >= 2 && rng.chance(0.65);
    const members: AgentSpec[] = [];
    const firstSex: Sex = rng.chance(0.5) ? 'female' : 'male';
    const age = rng.int(20, 62);
    members.push(makeAdult(rng, name(firstSex), family, firstSex, age, households.length));
    if (couple) {
      const sex: Sex = firstSex === 'female' ? 'male' : 'female';
      const partner = makeAdult(
        rng,
        name(sex),
        family,
        sex,
        Math.max(18, age + rng.int(-6, 6)),
        households.length,
      );
      partner.partner = members[0]!.name;
      members[0]!.partner = partner.name;
      members.push(partner);
    }
    remaining -= members.length;
    households.push({ members, family, parents: [...members] });
    specs.push(...members);
  }
  for (let c = 0; c < children; c++) {
    const childAge = Math.round(rng.range(0.3, 15) * 10) / 10;
    const options = households.filter(
      (h) =>
        Math.min(...h.parents.map((p) => p.age)) >= childAge + 18 &&
        Math.min(...h.parents.map((p) => p.age)) - childAge <= 45,
    );
    const home = options.length ? rng.pick(options) : households[0]!;
    const sex: Sex = rng.chance(0.5) ? 'female' : 'male';
    const kid: AgentSpec = {
      name: name(sex),
      familyName: home.family,
      sex,
      age: childAge,
      household: households.indexOf(home),
      parents: home.parents.map((p) => p.name),
      occupation: childAge < 1 ? 'baby' : childAge < 3 ? 'toddler' : 'child',
      background: `Child of ${home.parents.map((p) => p.name).join(' and ')}.`,
    };
    specs.push(kid);
  }
  return specs;
}

function makeAdult(
  rng: Rng,
  name: string,
  family: string,
  sex: Sex,
  age: number,
  household: number,
): AgentSpec {
  const occupation = rng.pick(OCCUPATIONS);
  const traits = [rng.pick(TRAITS), rng.pick(TRAITS)].filter((t, i, a) => a.indexOf(t) === i);
  const skillFor: Record<string, keyof NonNullable<AgentSpec['skills']>> = {
    farmer: 'farming',
    fisherman: 'fishing',
    baker: 'cooking',
    carpenter: 'building',
    woodcutter: 'building',
    herbalist: 'foraging',
    forager: 'foraging',
    trader: 'trading',
    midwife: 'caregiving',
  };
  const skill = skillFor[occupation];
  return {
    name,
    familyName: family,
    sex,
    age,
    household,
    occupation,
    traits: `${traits.join(', ').replace(/^./, (c) => c.toUpperCase())}.`,
    background: `Has lived in the village for ${age > 30 ? 'most of their life' : 'a few years'} and works as a ${occupation}.`,
    money: rng.int(5, 80),
    skills: skill ? { [skill]: rng.int(35, 70) } : {},
    inventory: rng.chance(0.5) ? { bread: rng.int(1, 3) } : { vegetables: rng.int(1, 4) },
  };
}
