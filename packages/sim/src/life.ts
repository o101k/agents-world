import {
  ITEMS,
  SKILL_APTITUDE,
  SKILL_NAMES,
  STAGE_LABELS,
  TICKS_PER_DAY,
  isFoodItem,
  stageOf,
  type Appearance,
  type Intent,
  type LifeStage,
  type NeedName,
  type Personality,
  type SkillName,
} from '@aw/shared';
import { fullName, remember, type Agent, type PersonKnowledge } from './agent.ts';
import { GREY_HAIR, HAIR_COLORS, PANTS_COLORS, SHIRT_COLORS, languageBaseline } from './cast.ts';
import { usable } from './conditions.ts';
import { approach, emit, fail, meet, type Ctx } from './engine.ts';
import { nameAsKnown } from './perception.ts';
import { mapCache } from './spatial.ts';
import { findAgent, type WorldState } from './world.ts';

// ------------------------------------------------------------------ stages & abilities

type IntentType = Intent['type'];

const INFANT: IntentType[] = ['rest', 'sleep', 'talk_to'];
const TODDLER: IntentType[] = [...INFANT, 'go_to', 'explore', 'eat', 'drink', 'gather', 'give'];
const ADULT_ONLY: IntentType[] = [
  'propose_partnership',
  'respond_proposal',
  'end_partnership',
  'try_for_child',
  'respond_child_request',
  'declare_will',
  'build_house',
  'name_child',
  'adopt_child',
];
const ALL: IntentType[] = [
  'go_to',
  'gather',
  'eat',
  'drink',
  'sleep',
  'rest',
  'explore',
  'talk_to',
  'chop_wood',
  'craft',
  'buy',
  'sell',
  'give',
  'offer_trade',
  'respond_offer',
  'steal',
  'attack',
  'feed',
  'teach',
  'tend',
  'respond_adoption',
  ...ADULT_ONLY,
];

/** What a body at each stage can do. */
export const ABILITIES: Record<LifeStage, IntentType[]> = {
  infant: INFANT,
  toddler: TODDLER,
  child: ALL.filter(
    (t) => !ADULT_ONLY.includes(t) && t !== 'craft' && t !== 'attack' && t !== 'teach',
  ),
  teen: ALL.filter((t) => !ADULT_ONLY.includes(t) || t === 'respond_proposal'),
  adult: ALL,
  elder: ALL,
};

export function canDo(agent: Agent, type: IntentType): boolean {
  return ABILITIES[stageOf(agent.age)].includes(type);
}

export function tooYoung(agent: Agent, type: IntentType): string {
  const stage = stageOf(agent.age);
  return stage === 'infant' || stage === 'toddler'
    ? `I'm only little — I can't ${type.replace(/_/g, ' ')} yet.`
    : `I'm too young to ${type.replace(/_/g, ' ')}.`;
}

/** Toddlers and the very old walk at half speed. */
export function walksSlowly(agent: Agent): boolean {
  const s = stageOf(agent.age);
  return s === 'toddler' || agent.age >= 75;
}

// ------------------------------------------------------------------ language

const BABBLE = ['ba-ba', 'ma-ma!', 'da!', 'goo', 'waaah!', 'ah-ah', 'mm-mm'];

/** What a young speaker actually manages to say. */
export function simplifySpeech(ctx: Ctx, speaker: Agent, message: string): string {
  const lang = speaker.skills.language ?? 100;
  if (lang >= 60) return message;
  if (lang < 15) return ctx.rng.pick(BABBLE);
  const words = message
    .replace(/[^\p{L}\p{N}\s'!?]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  const keep = lang < 35 ? 2 : 4;
  return `${words.slice(0, keep).join(' ')}${lang < 35 ? '!' : '.'}`.toLowerCase();
}

/** What a listener with limited language understands (unknown words become "…"). */
export function garble(ctx: Ctx, listener: Agent, message: string): string {
  const lang = listener.skills.language ?? 100;
  if (lang >= 60) return message;
  const keep = Math.max(0.05, lang / 60);
  const words = message.split(/\s+/).map((w) => (ctx.rng.chance(keep) ? w : '…'));
  const text = words.join(' ').replace(/(… ?)+/g, '… ');
  return lang < 10 ? '[warm voice] … ' : text;
}

/** Children pick up language from what they hear. */
export function hearSpeech(listener: Agent): void {
  if (listener.age < 18 && (listener.skills.language ?? 100) < 100) {
    listener.skills.language = Math.min(
      100,
      listener.skills.language + 0.4 * listener.aptitude.intellectual,
    );
  }
}

// ------------------------------------------------------------------ skills

/** Skill practice, scaled by inborn aptitude. */
export function train(agent: Agent, skill: SkillName, amount: number): void {
  const apt = agent.aptitude?.[SKILL_APTITUDE[skill]] ?? 1;
  agent.skills[skill] = Math.min(100, (agent.skills[skill] ?? 0) + amount * apt);
}

/** Young people nearby learn a little by watching someone work. */
export function observeWork(state: WorldState, worker: Agent, skill: SkillName): void {
  for (const other of state.agents) {
    if (other === worker || !other.alive || other.asleep || other.age >= 18 || other.age < 3)
      continue;
    if (Math.max(Math.abs(other.x - worker.x), Math.abs(other.y - worker.y)) > 3) continue;
    if ((other.skills[skill] ?? 0) < (worker.skills[skill] ?? 0)) train(other, skill, 0.08);
  }
}

// ------------------------------------------------------------------ relationships

export function relation(viewer: Agent, other: Agent, tick: number): PersonKnowledge {
  return (viewer.people[other.id] ??= {
    name: null,
    familiarity: 0,
    affection: 0,
    trust: 0,
    romance: 0,
    lastSeenTick: tick,
  });
}

const clampRel = (v: number, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));

export function feel(
  viewer: Agent,
  other: Agent,
  tick: number,
  d: { affection?: number; trust?: number; romance?: number },
) {
  const r = relation(viewer, other, tick);
  if (d.affection) r.affection = clampRel(r.affection + d.affection);
  if (d.trust) r.trust = clampRel(r.trust + d.trust);
  if (d.romance) r.romance = clampRel(r.romance + d.romance, 0, 100);
}

/** Apply the feelings an agent's brain reported (each unit ≈ 5 points). */
export function applyFeelings(
  state: WorldState,
  agent: Agent,
  feelings: { agentId: string; affection?: number; trust?: number; romance?: number }[],
): void {
  const k = (v: unknown) => Math.max(-3, Math.min(3, Number(v) || 0)) * 5;
  for (const f of feelings.slice(0, 10)) {
    const other = findAgent(state, f.agentId);
    if (!other || other === agent || !agent.people[other.id]) continue;
    feel(agent, other, state.tick, {
      affection: k(f.affection),
      trust: k(f.trust),
      romance: k(f.romance),
    });
  }
}

// ------------------------------------------------------------------ per-tick life

const byId = (state: WorldState, id: string | null) => (id ? findAgent(state, id) : undefined);

/** Annual chance of dying of old age. */
export function oldAgeRisk(age: number, constitution: number): number {
  if (age < 50) return 0;
  return (0.003 * Math.pow(2, (age - 50) / 8)) / Math.max(0.5, constitution);
}

/** Everything about growing, being cared for, carrying a child and growing old. Runs every tick. */
export function lifeTick(ctx: Ctx, agent: Agent, ageStep: number): void {
  const { state } = ctx;
  const stage = stageOf(agent.age);

  // Growing up
  if (stage !== agent.lastStage) {
    agent.lastStage = stage;
    const big = stage === 'adult' || stage === 'elder';
    emit(
      ctx,
      'grew_up',
      [agent.id],
      `${fullName(agent)} is now ${stage === 'adult' ? 'an adult' : `a ${STAGE_LABELS[stage].toLowerCase()}`}.`,
      big ? 4 : 3,
    );
    remember(
      agent,
      state.tick,
      `I am growing up: I'm ${stage === 'adult' ? 'an adult' : `a ${STAGE_LABELS[stage].toLowerCase()}`} now.`,
      big ? 7 : 5,
    );
    if (
      stage === 'elder' &&
      !agent.appearance.hair.startsWith('#9') &&
      !agent.appearance.hair.startsWith('#c') &&
      !agent.appearance.hair.startsWith('#e')
    ) {
      agent.appearance = { ...agent.appearance, hair: ctx.rng.pick(GREY_HAIR) };
    }
    if (stage !== 'toddler' && !agent.awaiting) agent.awaiting = { kind: 'grew_up', stage };
  }
  // Daily: language comes with age
  if (state.tick % TICKS_PER_DAY === 0 && agent.skills.language < languageBaseline(agent.age)) {
    agent.skills.language = languageBaseline(agent.age);
  }

  // Babies stay at home, indoors.
  if (stage === 'infant') {
    const home = agent.homeId ? mapCache(state.map).byId.get(agent.homeId) : undefined;
    if (home?.door) {
      // A burnt (or burning) home gives no shelter: the baby is outside on the doorstep.
      agent.indoorsId = usable(state, home.id) ? home.id : null;
      // Indoors the baby is "at the door"; outdoors it only needs to stay near it (the
      // separation pass keeps people off each other's tiles, so don't fight it every tick).
      if (
        agent.indoorsId ||
        Math.max(Math.abs(agent.x - home.door.x), Math.abs(agent.y - home.door.y)) > 1
      ) {
        agent.x = home.door.x;
        agent.y = home.door.y;
      }
    }
    agent.action =
      agent.action?.type === 'sleep'
        ? agent.action
        : agent.action?.type === 'rest'
          ? agent.action
          : null;
    agent.plan = agent.plan.filter((i) => INFANT.includes(i.type));
  }

  // Little ones cry when hungry or thirsty; caretakers within earshot notice.
  if (stage === 'infant' || stage === 'toddler') {
    const low = agent.needs.food < 35 ? 'food' : agent.needs.water < 35 ? 'water' : null;
    if (low && !agent.asleep) {
      if (state.tick % 30 === 0)
        agent.speech = { text: stage === 'infant' ? 'Waaah!' : 'Hungry!', until: state.tick + 10 };
      if (!agent.alerted.cry) {
        agent.alerted.cry = true;
        callCaretakers(ctx, agent, low);
      }
    } else if (agent.needs.food > 60 && agent.needs.water > 60) {
      delete agent.alerted.cry;
    }
  }

  // Pregnancy
  if (agent.pregnancy) {
    agent.pregnancy.progress += ageStep;
    if (!agent.pregnancy.known && agent.pregnancy.progress >= 0.1) {
      agent.pregnancy.known = true;
      const father = byId(state, agent.pregnancy.fatherId);
      emit(
        ctx,
        'pregnant',
        [agent.id, agent.pregnancy.fatherId],
        `${fullName(agent)} is expecting a child${father ? ` with ${fullName(father)}` : ''}.`,
        4,
      );
      remember(
        agent,
        state.tick,
        `I'm with child!${father ? ` The father is ${nameAsKnown(agent, father)}.` : ''}`,
        9,
        'experience',
        father ? [father.id] : [],
      );
    }
    if (agent.pregnancy.progress >= 0.75) giveBirth(ctx, agent);
  }

  // Old age
  const risk = oldAgeRisk(agent.age, agent.constitution);
  if (risk > 0 && ctx.rng.chance(risk * ageStep)) {
    ctx.die(agent, 'old age');
  }
}

/** Parents and housemates nearby (or at home with the child) hear a hungry child. */
function callCaretakers(ctx: Ctx, child: Agent, need: NeedName): void {
  const { state } = ctx;
  for (const other of state.agents) {
    if (other === child || !other.alive || other.asleep || other.age < 13) continue;
    const family =
      child.motherId === other.id ||
      child.fatherId === other.id ||
      child.adoptiveParentIds.includes(other.id) ||
      (child.homeId && other.homeId === child.homeId);
    // A child with no parents left cries for anyone grown-up who can hear.
    if (!family && !(other.age >= 18 && isOrphan(state, child))) continue;
    const together =
      (child.indoorsId && other.x === child.x && other.y === child.y) ||
      Math.max(Math.abs(other.x - child.x), Math.abs(other.y - child.y)) <= 8;
    if (!together) continue;
    remember(
      other,
      state.tick,
      `${nameAsKnown(other, child)} is crying — ${need === 'food' ? 'hungry' : 'thirsty'}.`,
      4,
      'experience',
      [child.id],
    );
    if (!other.awaiting)
      other.awaiting = {
        kind: 'child_needs',
        childId: child.id,
        childName: nameAsKnown(other, child),
        need,
      };
  }
}

// ------------------------------------------------------------------ birth & inheritance

const FIRST_NAMES = {
  female: [
    'Alma',
    'Bett',
    'Clara',
    'Dora',
    'Elin',
    'Fenna',
    'Grete',
    'Hanne',
    'Ilse',
    'Jutta',
    'Liesel',
    'Marta',
    'Nora',
    'Rike',
    'Sanne',
    'Tilde',
  ],
  male: [
    'Anton',
    'Bertil',
    'Claus',
    'Dirk',
    'Ebbe',
    'Falk',
    'Gerd',
    'Hauke',
    'Ivo',
    'Jannik',
    'Kaspar',
    'Lukas',
    'Mats',
    'Nils',
    'Pieter',
    'Ruben',
  ],
};

function mixColor(a: string, b: string): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (sh: number) => Math.round((((pa >> sh) & 255) + ((pb >> sh) & 255)) / 2);
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, '0')}`;
}

/** Genes: appearance, temperament, aptitude and constitution, blended from both parents with some chance. */
export function inherit(
  ctx: Ctx,
  mother: Agent,
  father: Agent | undefined,
  sex: 'female' | 'male',
) {
  const { rng } = ctx;
  const f = father ?? mother;
  const skinRoll = rng.next();
  const appearance: Appearance = {
    skin:
      skinRoll < 0.45
        ? mother.appearance.skin
        : skinRoll < 0.9
          ? f.appearance.skin
          : mixColor(mother.appearance.skin, f.appearance.skin),
    hair: rng.chance(0.05)
      ? rng.pick(HAIR_COLORS)
      : GREY_HAIR.includes(mother.appearance.hair) && GREY_HAIR.includes(f.appearance.hair)
        ? rng.pick(HAIR_COLORS)
        : rng.pick(
            [mother.appearance.hair, f.appearance.hair]
              .filter((h) => !GREY_HAIR.includes(h))
              .concat(rng.pick(HAIR_COLORS)),
          ),
    shirt: rng.pick(SHIRT_COLORS),
    pants: rng.pick(PANTS_COLORS),
    hairStyle: sex === 'female' ? (rng.chance(0.8) ? 1 : 0) : 0,
  };
  const trait = (k: keyof Personality) => {
    const avg = (mother.personality[k] + f.personality[k]) / 2;
    return Math.round(Math.min(95, Math.max(5, avg * 0.75 + 50 * 0.25 + rng.range(-12, 12))));
  };
  const personality: Personality = {
    openness: trait('openness'),
    conscientiousness: trait('conscientiousness'),
    extraversion: trait('extraversion'),
    agreeableness: trait('agreeableness'),
    neuroticism: trait('neuroticism'),
  };
  const apt = (k: keyof Agent['aptitude']) =>
    Math.round(
      Math.min(
        1.3,
        Math.max(0.7, (mother.aptitude[k] + f.aptitude[k]) / 2 + rng.range(-0.08, 0.08)),
      ) * 100,
    ) / 100;
  return {
    appearance,
    personality,
    aptitude: {
      physical: apt('physical'),
      craft: apt('craft'),
      social: apt('social'),
      intellectual: apt('intellectual'),
    },
    constitution:
      Math.round(
        Math.min(
          1.2,
          Math.max(0.8, (mother.constitution + f.constitution) / 2 + rng.range(-0.05, 0.05)),
        ) * 100,
      ) / 100,
  };
}

function giveBirth(ctx: Ctx, mother: Agent): void {
  const { state, rng } = ctx;
  const father = byId(state, mother.pregnancy!.fatherId);
  mother.pregnancy = null;
  const sex = rng.chance(0.5) ? 'female' : 'male';
  const genes = inherit(ctx, mother, father, sex);
  const familyName =
    father && father.partnerId === mother.id
      ? father.familyName || mother.familyName
      : mother.familyName || father?.familyName || '';
  const child = ctx.addPerson({
    name: '',
    familyName,
    sex,
    age: 0,
    occupation: 'baby',
    background: `Born to ${fullName(mother)}${father ? ` and ${fullName(father)}` : ''}.`,
    personality: genes.personality,
    appearance: genes.appearance,
    aptitude: genes.aptitude,
    constitution: genes.constitution,
    homeId: mother.homeId ?? father?.homeId ?? null,
    position: { x: mother.x, y: mother.y },
    knowsVillage: true,
    money: 0,
  });
  child.named = false;
  child.motherId = mother.id;
  child.fatherId = father?.id ?? null;
  child.needs = { food: 80, water: 80, energy: 80, warmth: 100 };
  child.awaiting = null; // babies sleep first
  child.asleep = true;
  child.action = { type: 'sleep', since: state.tick };
  const parents = [mother, father].filter((p): p is Agent => Boolean(p));
  for (const p of parents) {
    p.childrenIds.push(child.id);
    const r = relation(p, child, state.tick);
    Object.assign(r, {
      name: fullName(child),
      familiarity: 50,
      affection: 75,
      trust: 50,
      role: 'child' as const,
    });
    const c = relation(child, p, state.tick);
    Object.assign(c, {
      name: fullName(p),
      familiarity: 60,
      affection: 60,
      trust: 80,
      role: p === mother ? ('mother' as const) : ('father' as const),
    });
  }
  for (const sib of state.agents) {
    if (sib === child || !sib.alive) continue;
    if (
      (sib.motherId && sib.motherId === child.motherId) ||
      (sib.fatherId && sib.fatherId === child.fatherId)
    ) {
      Object.assign(relation(sib, child, state.tick), {
        name: fullName(child),
        familiarity: 30,
        affection: 35,
        role: 'sibling' as const,
      });
      Object.assign(relation(child, sib, state.tick), {
        name: fullName(sib),
        familiarity: 30,
        affection: 35,
        role: 'sibling' as const,
      });
    }
  }
  const label = `a baby ${sex === 'female' ? 'girl' : 'boy'}`;
  emit(
    ctx,
    'born',
    [child.id, mother.id, ...(father ? [father.id] : [])],
    `${fullName(mother)}${father ? ` and ${fullName(father)}` : ''} had ${label}!`,
    5,
  );
  // Childbirth is hard.
  mother.needs.energy = Math.max(0, mother.needs.energy - 40);
  if (rng.chance(0.03)) mother.health = Math.max(1, mother.health - 50);
  for (const p of parents) {
    remember(p, state.tick, `Our child was born — ${label}!`, 10, 'experience', [
      child.id,
      ...parents.filter((q) => q !== p).map((q) => q.id),
    ]);
    if (!p.awaiting) p.awaiting = { kind: 'child_born', childId: child.id, childLabel: label };
  }
}

/** Babies nobody names within a day get a name anyway (the village has to call them something). */
export function autoName(ctx: Ctx, agent: Agent): void {
  if (agent.named || ctx.state.tick - agent.bornTick < TICKS_PER_DAY) return;
  setName(ctx, agent, ctx.rng.pick(FIRST_NAMES[agent.sex]), null);
}

function setName(ctx: Ctx, child: Agent, name: string, by: Agent | null): void {
  const { state } = ctx;
  child.name = name.trim().slice(0, 40);
  child.named = true;
  const full = fullName(child);
  for (const a of state.agents) {
    const r = a.people[child.id];
    if (r && r.name) r.name = full;
  }
  emit(
    ctx,
    'named',
    [child.id, ...(by ? [by.id] : [])],
    by ? `${fullName(by)} named their baby ${full}.` : `The baby is called ${full}.`,
    4,
  );
  if (by) remember(by, state.tick, `We named our baby ${child.name}.`, 7, 'experience', [child.id]);
}

// ------------------------------------------------------------------ actions

type LifeIntent = Extract<
  Intent,
  {
    type:
      | 'feed'
      | 'teach'
      | 'propose_partnership'
      | 'respond_proposal'
      | 'end_partnership'
      | 'try_for_child'
      | 'respond_child_request'
      | 'name_child'
      | 'adopt_child'
      | 'respond_adoption'
      | 'declare_will';
  }
>;

/** Fertility by the mother's age (1 = most fertile). */
export function fertility(age: number): number {
  if (age < 18 || age > 45) return 0;
  if (age <= 35) return 1;
  return Math.max(0.2, 1 - (age - 35) * 0.08);
}

export function lifeAction(ctx: Ctx, agent: Agent, intent: LifeIntent): void {
  const { state, rng } = ctx;
  const tick = state.tick;
  const other =
    'agentId' in intent
      ? byId(state, intent.agentId)
      : 'fromId' in intent
        ? byId(state, intent.fromId)
        : 'childId' in intent
          ? byId(state, intent.childId)
          : undefined;

  switch (intent.type) {
    case 'feed': {
      if (!other || other === agent)
        return fail(ctx, agent, "I tried to feed someone who isn't here.");
      if (!isFoodItem(intent.item))
        return fail(ctx, agent, `${ITEMS[intent.item].label} isn't food.`);
      if ((agent.inventory[intent.item] ?? 0) <= 0)
        return fail(ctx, agent, `I have no ${intent.item} to feed ${nameAsKnown(agent, other)}.`);
      // Babies are fed at home: stand in the doorway.
      if (other.indoorsId) {
        const home = mapCache(state.map).byId.get(other.indoorsId);
        if (home?.door && (agent.x !== home.door.x || agent.y !== home.door.y)) {
          ctx.walkTo(agent, [home.door], intent, 'home');
          return;
        }
      } else if (!approach(ctx, agent, other, intent, 1, 'feed')) return;
      agent.inventory[intent.item]! -= 1;
      if (!agent.inventory[intent.item]) delete agent.inventory[intent.item];
      other.needs.food = Math.min(100, other.needs.food + ITEMS[intent.item].nutrition * 1.5);
      // Babies are nursed (milk covers thirst too); little ones get a drink with their food.
      const st = stageOf(other.age);
      other.needs.water = Math.max(
        other.needs.water,
        st === 'infant' ? 100 : st === 'toddler' ? 75 : other.needs.water,
      );
      train(agent, 'caregiving', 0.5);
      feel(other, agent, tick, { affection: 3, trust: 2 });
      emit(ctx, 'fed', [agent.id, other.id], `${fullName(agent)} fed ${fullName(other)}.`, 2);
      remember(agent, tick, `I fed ${nameAsKnown(agent, other)}.`, 3, 'experience', [other.id]);
      remember(other, tick, `${nameAsKnown(other, agent)} fed me.`, 3, 'experience', [agent.id]);
      agent.action = { type: 'rest', until: tick + 10 };
      return;
    }
    case 'teach': {
      if (!other || other === agent)
        return fail(ctx, agent, "The person I wanted to teach isn't here.");
      if (!approach(ctx, agent, other, intent, 2, 'teach')) return;
      const skill = SKILL_NAMES.includes(intent.skill) ? intent.skill : 'foraging';
      const mine = agent.skills[skill] ?? 0;
      const theirs = other.skills[skill] ?? 0;
      const who = nameAsKnown(agent, other);
      if (mine <= theirs + 2)
        return fail(ctx, agent, `${who} already knows as much about ${skill} as I do.`);
      train(other, skill, (mine - theirs) * 0.08);
      if (skill !== 'language') hearSpeech(other);
      train(agent, 'caregiving', 0.2);
      feel(other, agent, tick, { affection: 2, trust: 2 });
      emit(
        ctx,
        'taught',
        [agent.id, other.id],
        `${fullName(agent)} taught ${fullName(other)} about ${skill}.`,
        2,
      );
      remember(agent, tick, `I taught ${who} about ${skill}.`, 3, 'experience', [other.id]);
      remember(
        other,
        tick,
        `${nameAsKnown(other, agent)} taught me about ${skill}.`,
        4,
        'experience',
        [agent.id],
      );
      agent.action = { type: 'rest', until: tick + 30 };
      other.action = other.action ?? { type: 'rest', until: tick + 30 };
      return;
    }
    case 'propose_partnership': {
      if (!other || other === agent)
        return fail(ctx, agent, "The person I wanted to ask isn't here.");
      const who = nameAsKnown(agent, other);
      if (agent.partnerId === other.id)
        return fail(ctx, agent, `${who} and I are already partners.`);
      if (agent.partnerId) return fail(ctx, agent, 'I already have a partner.');
      if (other.age < 16) return fail(ctx, agent, `${who} is far too young.`);
      if (!approach(ctx, agent, other, intent, 2, 'speak with')) return;
      state.requests = state.requests.filter(
        (r) => !(r.kind === 'proposal' && r.from === agent.id && r.to === other.id),
      );
      state.requests.push({ kind: 'proposal', from: agent.id, to: other.id, tick });
      agent.speech = { text: `${other.name}, will you be my partner?`, until: tick + 30 };
      emit(
        ctx,
        'said',
        [agent.id, other.id],
        `${fullName(agent)} asked ${fullName(other)} to be partners.`,
        3,
      );
      remember(agent, tick, `I asked ${who} to be my partner.`, 6, 'conversation', [other.id]);
      meet(other, agent, tick, true);
      if (!other.asleep) {
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} asked me to be their partner.`,
          7,
          'conversation',
          [agent.id],
        );
        if (!other.awaiting)
          other.awaiting = {
            kind: 'proposal',
            fromId: agent.id,
            fromName: nameAsKnown(other, agent),
          };
      }
      agent.action = { type: 'rest', until: tick + 3 };
      return;
    }
    case 'respond_proposal': {
      const req = state.requests.find(
        (r) => r.kind === 'proposal' && r.from === intent.fromId && r.to === agent.id,
      );
      if (!req || !other?.alive) return fail(ctx, agent, 'That proposal is no longer open.');
      state.requests = state.requests.filter((r) => r !== req);
      const who = nameAsKnown(agent, other);
      if (!intent.accept || agent.partnerId || other.partnerId) {
        remember(agent, tick, `I turned down ${who}'s proposal.`, 5, 'conversation', [other.id]);
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} turned down my proposal.`,
          6,
          'conversation',
          [agent.id],
        );
        feel(other, agent, tick, { romance: -10 });
        emit(
          ctx,
          'said',
          [agent.id, other.id],
          `${fullName(agent)} turned down ${fullName(other)}'s proposal.`,
          3,
        );
        if (!other.awaiting && !other.asleep)
          other.awaiting = {
            kind: 'proposal_answered',
            byName: nameAsKnown(other, agent),
            accepted: false,
          };
        return;
      }
      agent.partnerId = other.id;
      other.partnerId = agent.id;
      for (const [a, b] of [
        [agent, other],
        [other, agent],
      ] as const) {
        const r = relation(a, b, tick);
        r.role = 'partner';
        r.romance = Math.max(r.romance, 50);
        r.affection = clampRel(r.affection + 15);
        r.trust = clampRel(r.trust + 10);
        if (!r.name) r.name = fullName(b);
      }
      // Moving in together: whoever has no home joins the other's.
      moveIn(state, agent, other);
      emit(
        ctx,
        'partnered',
        [other.id, agent.id],
        `${fullName(other)} and ${fullName(agent)} are now partners.`,
        5,
      );
      remember(agent, tick, `${who} and I are partners now.`, 9, 'experience', [other.id]);
      remember(
        other,
        tick,
        `${nameAsKnown(other, agent)} said yes — we're partners now.`,
        9,
        'experience',
        [agent.id],
      );
      if (!other.awaiting && !other.asleep)
        other.awaiting = {
          kind: 'proposal_answered',
          byName: nameAsKnown(other, agent),
          accepted: true,
        };
      return;
    }
    case 'end_partnership': {
      const partner = byId(state, agent.partnerId);
      if (!partner) return fail(ctx, agent, "I don't have a partner.");
      agent.partnerId = null;
      if (partner.partnerId === agent.id) partner.partnerId = null;
      relation(agent, partner, tick).role = 'former partner';
      relation(partner, agent, tick).role = 'former partner';
      feel(partner, agent, tick, { affection: -25, trust: -20, romance: -40 });
      feel(agent, partner, tick, { romance: -30 });
      emit(
        ctx,
        'separated',
        [agent.id, partner.id],
        `${fullName(agent)} and ${fullName(partner)} have separated.`,
        5,
      );
      remember(
        agent,
        tick,
        `I ended things with ${nameAsKnown(agent, partner)}.`,
        8,
        'experience',
        [partner.id],
      );
      if (partner.alive) {
        remember(
          partner,
          tick,
          `${nameAsKnown(partner, agent)} ended our partnership.`,
          9,
          'experience',
          [agent.id],
        );
        if (!partner.awaiting && !partner.asleep)
          partner.awaiting = { kind: 'partnership_ended', byName: nameAsKnown(partner, agent) };
      }
      return;
    }
    case 'try_for_child': {
      if (!other || other === agent) return fail(ctx, agent, "My partner isn't here.");
      const who = nameAsKnown(agent, other);
      if (agent.partnerId !== other.id || other.partnerId !== agent.id)
        return fail(ctx, agent, `${who} and I aren't partners.`);
      if (!approach(ctx, agent, other, intent, 1, 'be with')) return;
      state.requests = state.requests.filter(
        (r) => !(r.kind === 'child_request' && r.from === agent.id),
      );
      state.requests.push({ kind: 'child_request', from: agent.id, to: other.id, tick });
      remember(agent, tick, `I asked ${who} if we might try for a child.`, 5, 'conversation', [
        other.id,
      ]);
      if (!other.asleep) {
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} asked if we might try for a child.`,
          6,
          'conversation',
          [agent.id],
        );
        if (!other.awaiting)
          other.awaiting = {
            kind: 'child_request',
            fromId: agent.id,
            fromName: nameAsKnown(other, agent),
          };
      }
      agent.action = { type: 'rest', until: tick + 5 };
      return;
    }
    case 'respond_child_request': {
      const req = state.requests.find(
        (r) => r.kind === 'child_request' && r.from === intent.fromId && r.to === agent.id,
      );
      if (!req || !other?.alive) return fail(ctx, agent, "That question isn't open any more.");
      state.requests = state.requests.filter((r) => r !== req);
      const who = nameAsKnown(agent, other);
      if (!intent.accept) {
        remember(
          agent,
          tick,
          `I told ${who} I'm not ready to try for a child.`,
          5,
          'conversation',
          [other.id],
        );
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} isn't ready to try for a child.`,
          5,
          'conversation',
          [agent.id],
        );
        return;
      }
      if (Math.max(Math.abs(other.x - agent.x), Math.abs(other.y - agent.y)) > 2) {
        return fail(ctx, agent, `${who} had gone off by the time I answered.`);
      }
      // Off-screen: both agreed. Conception is up to chance, bodies and ages.
      agent.lastChildTry = tick;
      other.lastChildTry = tick;
      feel(agent, other, tick, { affection: 5, romance: 5 });
      feel(other, agent, tick, { affection: 5, romance: 5 });
      emit(
        ctx,
        'partnered',
        [agent.id, other.id],
        `${fullName(agent)} and ${fullName(other)} spent the night together.`,
        3,
      );
      remember(agent, tick, `${who} and I agreed to try for a child.`, 7, 'experience', [other.id]);
      remember(
        other,
        tick,
        `${nameAsKnown(other, agent)} and I agreed to try for a child.`,
        7,
        'experience',
        [agent.id],
      );
      const mother = agent.sex === 'female' ? agent : other.sex === 'female' ? other : null;
      const father = mother === agent ? other : agent;
      if (!mother || father.sex !== 'male' || mother.pregnancy) return;
      const chance =
        (0.35 *
          fertility(mother.age) *
          (father.age > 60 ? 0.5 : 1) *
          Math.min(mother.health, father.health)) /
        100;
      if (rng.chance(chance)) mother.pregnancy = { fatherId: father.id, progress: 0, known: false };
      agent.action = { type: 'sleep', since: tick };
      agent.asleep = true;
      return;
    }
    case 'name_child': {
      if (!other) return fail(ctx, agent, "I can't find that child.");
      if (
        other.motherId !== agent.id &&
        other.fatherId !== agent.id &&
        !other.adoptiveParentIds.includes(agent.id)
      )
        return fail(ctx, agent, `${nameAsKnown(agent, other)} isn't my child to name.`);
      if (other.named) return fail(ctx, agent, `Our child already has a name: ${other.name}.`);
      setName(ctx, other, intent.name, agent);
      return;
    }
    case 'adopt_child': {
      if (!other || other === agent) return fail(ctx, agent, "I can't find that child.");
      const who = nameAsKnown(agent, other);
      if (!other.alive) return fail(ctx, agent, `${who} has died.`);
      if (other.age >= 18) return fail(ctx, agent, `${who} is grown up and can't be adopted.`);
      if (!isOrphan(state, other))
        return fail(ctx, agent, `${who} still has a parent to look after them.`);
      if (!agent.homeId) return fail(ctx, agent, `I have no home to take ${who} into.`);
      const stage = stageOf(other.age);
      const little = stage === 'infant' || stage === 'toddler';
      if (little && other.indoorsId) {
        // Little ones indoors are fetched from their door, asleep or not.
        const home = mapCache(state.map).byId.get(other.indoorsId);
        if (!home?.door) return fail(ctx, agent, `I can't get to ${who}.`);
        if (Math.max(Math.abs(agent.x - home.door.x), Math.abs(agent.y - home.door.y)) > 1) {
          ctx.walkTo(agent, [home.door], intent, 'their home');
          return;
        }
      } else if (!approach(ctx, agent, other, intent, 2, 'speak with')) return;
      if (little) {
        // Too little to be asked: whoever takes them in becomes their family.
        adopt(ctx, agent, other);
        return;
      }
      state.requests = state.requests.filter(
        (r) => !(r.kind === 'adoption' && r.from === agent.id && r.to === other.id),
      );
      state.requests.push({ kind: 'adoption', from: agent.id, to: other.id, tick });
      agent.speech = {
        text: `${other.name}, would you like to come and live with us?`,
        until: tick + 30,
      };
      emit(
        ctx,
        'said',
        [agent.id, other.id],
        `${fullName(agent)} offered to adopt ${fullName(other)}.`,
        3,
      );
      remember(agent, tick, `I offered to take ${who} in as my own child.`, 6, 'conversation', [
        other.id,
      ]);
      meet(other, agent, tick, true);
      if (!other.asleep) {
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} offered to take me in as their child.`,
          7,
          'conversation',
          [agent.id],
        );
        if (!other.awaiting)
          other.awaiting = {
            kind: 'adoption_offer',
            fromId: agent.id,
            fromName: nameAsKnown(other, agent),
          };
      }
      agent.action = { type: 'rest', until: tick + 3 };
      return;
    }
    case 'respond_adoption': {
      const req = state.requests.find(
        (r) => r.kind === 'adoption' && r.from === intent.fromId && r.to === agent.id,
      );
      if (!req || !other?.alive) return fail(ctx, agent, 'That offer is no longer open.');
      state.requests = state.requests.filter((r) => r !== req);
      const who = nameAsKnown(agent, other);
      if (!isOrphan(state, agent)) return fail(ctx, agent, 'I already have a family.');
      if (intent.accept && !other.homeId)
        return fail(ctx, agent, `${who} has no home to take me into any more.`);
      if (!intent.accept) {
        remember(agent, tick, `I told ${who} I don't want to be adopted.`, 6, 'conversation', [
          other.id,
        ]);
        remember(
          other,
          tick,
          `${nameAsKnown(other, agent)} didn't want me to adopt them.`,
          6,
          'conversation',
          [agent.id],
        );
        emit(
          ctx,
          'said',
          [agent.id, other.id],
          `${fullName(agent)} turned down ${fullName(other)}'s offer to adopt them.`,
          3,
        );
        if (!other.awaiting && !other.asleep)
          other.awaiting = {
            kind: 'adoption_answered',
            childName: nameAsKnown(other, agent),
            accepted: false,
          };
        return;
      }
      adopt(ctx, other, agent);
      if (!other.awaiting && !other.asleep)
        other.awaiting = {
          kind: 'adoption_answered',
          childName: nameAsKnown(other, agent),
          accepted: true,
        };
      return;
    }
    case 'declare_will': {
      if (!other || other === agent) return fail(ctx, agent, "I don't know who that is.");
      agent.will = { heirId: other.id };
      emit(
        ctx,
        'said',
        [agent.id, other.id],
        `${fullName(agent)} declared that ${fullName(other)} will inherit everything.`,
        3,
      );
      remember(
        agent,
        tick,
        `I've decided ${nameAsKnown(agent, other)} will inherit everything I own.`,
        6,
        'thought',
        [other.id],
      );
      return;
    }
  }
}

// ------------------------------------------------------------------ orphans & adoption

/** A person's living parents: birth parents and adoptive parents. */
export function livingParents(state: WorldState, child: Agent): Agent[] {
  const out: Agent[] = [];
  for (const id of [child.motherId, child.fatherId, ...child.adoptiveParentIds]) {
    const p = byId(state, id);
    if (p?.alive && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Under 18 with no living parent, birth or adoptive. */
export function isOrphan(state: WorldState, child: Agent): boolean {
  return child.alive && child.age < 18 && livingParents(state, child).length === 0;
}

/**
 * Take a child in as one's own. The adopter's partner becomes a parent too; the child moves into
 * their home and their children become the child's brothers and sisters. Birth parents stay on
 * record (genes and the family tree), and the child keeps their name.
 */
function adopt(ctx: Ctx, adopter: Agent, child: Agent): void {
  const { state } = ctx;
  const tick = state.tick;
  const partner = byId(state, adopter.partnerId);
  const parents = [adopter];
  if (partner?.alive && partner.partnerId === adopter.id && partner.age >= 18)
    parents.push(partner);
  // Brothers and sisters before the child joins, so the child isn't their own sibling.
  const siblings: Agent[] = [];
  for (const p of parents)
    for (const id of p.childrenIds) {
      const s = byId(state, id);
      if (s?.alive && s !== child && !siblings.includes(s)) siblings.push(s);
    }
  for (const p of parents) {
    if (!p.childrenIds.includes(child.id)) p.childrenIds.push(child.id);
    if (!child.adoptiveParentIds.includes(p.id)) child.adoptiveParentIds.push(p.id);
    const r = relation(p, child, tick);
    Object.assign(r, {
      name: fullName(child),
      familiarity: Math.max(r.familiarity, 40),
      affection: clampRel(Math.max(r.affection, 40) + 20),
      trust: Math.max(r.trust, 40),
      role: 'child' as const,
    });
    const c = relation(child, p, tick);
    Object.assign(c, {
      name: fullName(p),
      familiarity: Math.max(c.familiarity, 40),
      affection: clampRel(Math.max(c.affection, 30) + 20),
      trust: clampRel(Math.max(c.trust, 40) + 10),
      role: p.sex === 'female' ? ('mother' as const) : ('father' as const),
    });
  }
  for (const s of siblings) {
    for (const [a, b] of [
      [s, child],
      [child, s],
    ] as const) {
      const r = relation(a, b, tick);
      if (!r.role) r.role = 'sibling';
      r.name ??= fullName(b);
      r.familiarity = Math.max(r.familiarity, 20);
      r.affection = Math.max(r.affection, 20);
    }
  }
  // A new home. Babies are carried there (the infant rule keeps them indoors at home).
  child.homeId = adopter.homeId;
  if (adopter.homeId) child.knowledge[adopter.homeId] = { lastSeenTick: tick };
  if (child.indoorsId && child.indoorsId !== adopter.homeId) child.indoorsId = null;
  state.requests = state.requests.filter((r) => !(r.kind === 'adoption' && r.to === child.id));

  const names = parents.map((p) => fullName(p)).join(' and ');
  emit(
    ctx,
    'adopted',
    [child.id, ...parents.map((p) => p.id)],
    `${names} adopted ${fullName(child)}.`,
    5,
  );
  for (const p of parents) {
    remember(
      p,
      tick,
      `We took ${nameAsKnown(p, child)} in: they are our child now.`,
      9,
      'experience',
      [child.id, ...parents.filter((q) => q !== p).map((q) => q.id)],
    );
  }
  remember(
    child,
    tick,
    `${parents.map((p) => nameAsKnown(child, p)).join(' and ')} took me in. I have a family again.`,
    9,
    'experience',
    parents.map((p) => p.id),
  );
}

/**
 * When someone dies, any child of theirs left with no parent at all is an orphan. The child
 * knows; the household, the child's grown-up relatives and grown-ups nearby hear of it.
 */
export function noticeOrphans(ctx: Ctx, dead: Agent): void {
  const { state } = ctx;
  for (const id of dead.childrenIds) {
    const child = byId(state, id);
    if (!child || !isOrphan(state, child)) continue;
    emit(ctx, 'orphaned', [child.id, dead.id], `${fullName(child)} has lost their last parent.`, 4);
    remember(child, state.tick, 'I have no mother or father any more.', 9, 'experience', [dead.id]);
    for (const other of state.agents) {
      if (other === child || other === dead || !other.alive || other.age < 18) continue;
      const household =
        (dead.homeId && other.homeId === dead.homeId) ||
        (child.homeId && other.homeId === child.homeId);
      const relative = Boolean(other.people[child.id]?.role);
      const near = (p: Agent) => Math.max(Math.abs(other.x - p.x), Math.abs(other.y - p.y)) <= 8;
      const nearby = !other.asleep && (near(dead) || near(child));
      if (!household && !relative && !nearby) continue;
      const name = nameAsKnown(other, child);
      remember(
        other,
        state.tick,
        `${name} has no parents left to look after them.`,
        6,
        'experience',
        [child.id, dead.id],
      );
      if (!other.awaiting && !other.asleep)
        other.awaiting = { kind: 'orphaned', childId: child.id, childName: name };
    }
  }
}

/** Partners share a home: a homeless partner (or the one in a crowded house) moves in. */
function moveIn(state: WorldState, a: Agent, b: Agent): void {
  if (a.homeId === b.homeId && a.homeId) return;
  const crowd = (id: string | null) =>
    id ? state.agents.filter((x) => x.alive && x.homeId === id).length : 99;
  const [mover, host] = !a.homeId
    ? [a, b]
    : !b.homeId
      ? [b, a]
      : crowd(a.homeId) >= crowd(b.homeId)
        ? [a, b]
        : [b, a];
  if (!host.homeId) return;
  mover.homeId = host.homeId;
  const owners = (state.owners[host.homeId] ??= []);
  if (!owners.includes(mover.id)) owners.push(mover.id);
  mover.knowledge[host.homeId] = { lastSeenTick: state.tick };
}

/** Requests nobody answered within two hours lapse. */
export function expireRequests(state: WorldState): void {
  state.requests = state.requests.filter(
    (r) => state.tick - r.tick < 120 && byId(state, r.from)?.alive && byId(state, r.to)?.alive,
  );
}

/** A death touches those nearby and the family at home. */
export function mournDeath(ctx: Ctx, dead: Agent): void {
  const { state } = ctx;
  const partner = byId(state, dead.partnerId);
  if (partner && partner.partnerId === dead.id) partner.partnerId = null;
  for (const other of state.agents) {
    if (other === dead || !other.alive) continue;
    const r = other.people[dead.id];
    const family = r?.role && r.role !== 'former partner';
    const nearby =
      !other.asleep && Math.max(Math.abs(other.x - dead.x), Math.abs(other.y - dead.y)) <= 8;
    const household = dead.homeId && other.homeId === dead.homeId;
    if (!nearby && !household) continue;
    remember(
      other,
      state.tick,
      `${nameAsKnown(other, dead)} has died (${dead.death?.cause}).`,
      family ? 10 : 6,
      'experience',
      [dead.id],
    );
  }
}

/**
 * Estate: the will's heir if alive, else the partner, else the children equally, else housemates.
 * Money is split, goods dealt out in turn, and buildings pass to the heirs as co-owners.
 */
export function settleEstate(ctx: Ctx, dead: Agent): void {
  const { state } = ctx;
  const alive = (id: string | null | undefined) => {
    const a = id ? byId(state, id) : undefined;
    return a?.alive ? a : undefined;
  };
  let heirs: Agent[];
  const willHeir = alive(dead.will?.heirId);
  const partner =
    alive(dead.partnerId) ??
    (state.agents.find((a) => a.alive && a.partnerId === dead.id) as Agent | undefined);
  if (willHeir) heirs = [willHeir];
  else if (partner) heirs = [partner];
  else heirs = dead.childrenIds.map(alive).filter((a): a is Agent => Boolean(a));
  if (heirs.length === 0 && dead.homeId)
    heirs = state.agents.filter((a) => a.alive && a !== dead && a.homeId === dead.homeId);

  const owned = Object.entries(state.owners)
    .filter(([, ids]) => ids.includes(dead.id))
    .map(([id]) => id);
  for (const id of owned) {
    const next = state.owners[id]!.filter((x) => x !== dead.id);
    for (const h of heirs) if (!next.includes(h.id)) next.push(h.id);
    state.owners[id] = next;
  }
  if (heirs.length === 0) return;
  const share = Math.floor(dead.money / heirs.length);
  let remainder = dead.money - share * heirs.length;
  for (const h of heirs) {
    h.money += share + (remainder-- > 0 ? 1 : 0);
  }
  dead.money = 0;
  let turn = 0;
  for (const [item, n] of Object.entries(dead.inventory)) {
    for (let k = 0; k < (n ?? 0); k++) {
      const h = heirs[turn++ % heirs.length]!;
      h.inventory[item as keyof Agent['inventory']] =
        (h.inventory[item as keyof Agent['inventory']] ?? 0) + 1;
    }
  }
  dead.inventory = {};
  const names = heirs.map((h) => fullName(h)).join(', ');
  const buildings = owned.length
    ? ` and ${owned.length} building${owned.length > 1 ? 's' : ''}`
    : '';
  emit(
    ctx,
    'inherited',
    [dead.id, ...heirs.map((h) => h.id)],
    `${names} inherited what ${fullName(dead)} left${buildings}.`,
    4,
  );
  for (const h of heirs) {
    remember(h, state.tick, `I inherited what ${nameAsKnown(h, dead)} left me.`, 7, 'experience', [
      dead.id,
    ]);
    if (
      !h.homeId &&
      owned.some((id) => state.map.objects.find((o) => o.id === id)?.kind === 'house')
    ) {
      h.homeId = owned.find((id) => state.map.objects.find((o) => o.id === id)?.kind === 'house')!;
    }
  }
}
