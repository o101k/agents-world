import {
  FOOD_ITEMS,
  ITEMS,
  type Bundle,
  type BrainConfig,
  type Decision,
  type DecisionRequest,
  type Intent,
  type ItemName,
  type KnownPlace,
  type Perception,
} from '@aw/shared';
import { villagePlan, villageReply } from './mockVillage/index.ts';
import type { BrainProvider, BrainResult } from './types.ts';

const NUTRITION = Object.fromEntries(FOOD_ITEMS.map((i) => [i, ITEMS[i].nutrition])) as Record<
  ItemName,
  number
>;
const value = (b: Bundle) =>
  (b.coins ?? 0) + (b.item ? ITEMS[b.item].basePrice * (b.quantity ?? 0) : 0);

/** What a person would pay at the market, as far as they know. */
function knownBuyPrice(p: Perception, item: ItemName): number {
  return p.marketPrices?.prices[item]?.buy ?? Math.ceil(ITEMS[item].basePrice * 1.2);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * A free, offline "brain": a small rulebook that keeps villagers alive using only what they
 * perceive and know. Used for testing, for running worlds at zero cost, and as the fallback when
 * an AI provider is unavailable. Deterministic for a given perception.
 */
export function mockDecide(p: Perception): Decision {
  const { needs, inventory } = p.self;
  const { hour, isNight } = p.clock;
  const plan: Intent[] = [];
  const thoughts: string[] = [];
  let goal = '';
  const roll = hash(`${p.agentId}:${p.tick}`);

  if (p.trigger.kind === 'reflect') return mockReflect(p);
  if (p.trigger.kind === 'world_event' || p.trigger.kind === 'unwell') {
    const why = p.trigger.kind === 'unwell' ? 'I feel ill.' : p.trigger.description;
    const rest = mockDecide({ ...p, trigger: { kind: 'plan_done' } });
    return { ...rest, thought: `${why} ${rest.thought}` };
  }

  const life = lifePlan(p, roll);
  if (life) return life;
  const answer = villageReply(p, roll);
  if (answer) return answer;

  // Someone spoke to us: answer briefly (unless we're in real trouble), then carry on.
  if (p.trigger.kind === 'spoken_to') {
    const t = p.trigger;
    const firstName = t.fromName.startsWith('a stranger') ? 'stranger' : t.fromName.split(' ')[0];
    const replies = [
      `Good day, ${firstName}.`,
      `Ah, ${firstName}. All well with you?`,
      `Can't talk long, ${firstName} — lots to do.`,
      `Nice to see you, ${firstName}.`,
      `Mm. If you say so, ${firstName}.`,
    ];
    const asked = t.message.trim().endsWith('?');
    const reply = asked
      ? `I'm getting by, ${firstName}. And you?`
      : replies[Math.floor(roll * replies.length)]!;
    const rest = mockDecide({ ...p, trigger: { kind: 'plan_done' } });
    const chatty = p.personality.extraversion > 40 || asked;
    if (needs.water < 15 || needs.food < 10 || !chatty) {
      return {
        ...rest,
        thought: `${t.fromName} is talking to me, but I have other things on my mind. ${rest.thought}`,
      };
    }
    return {
      thought: `${t.fromName} said something to me. ${rest.thought}`,
      goal: rest.goal || 'Chat',
      plan: [{ type: 'talk_to', agentId: t.fromId, message: reply }, ...rest.plan],
    };
  }

  const known = (kinds: string[]) =>
    p.knownPlaces.filter((k) => kinds.includes(k.kind) && !k.unreachable);
  const home = p.self.homeId ? p.knownPlaces.find((k) => k.id === p.self.homeId) : undefined;
  const foodInBag = FOOD_ITEMS.filter((i) => (inventory[i] ?? 0) > 0).sort(
    (a, b) => NUTRITION[b] - NUTRITION[a],
  );
  const foodUnits = foodInBag.reduce((s, i) => s + (inventory[i] ?? 0), 0);
  const foodSources = (): KnownPlace[] => {
    const sources = known(['berry_bush', 'field']).filter(
      (k) => (k.lastSeenAmount ?? 1) >= 1 && k.produce !== 'wheat',
    );
    const docks = known(['dock']);
    const occ = p.self.occupation.toLowerCase();
    const prefer = (k: KnownPlace) =>
      k.distance -
      (occ.includes('fish') && k.kind === 'dock' ? 30 : 0) -
      (occ.includes('farm') && k.kind === 'field' ? 20 : 0) -
      (k.kind === 'field' ? 6 : 0);
    return [...sources, ...docks].sort((a, b) => prefer(a) - prefer(b));
  };
  const gatherPlan = (): boolean => {
    const src = foodSources()[0];
    if (!src) return false;
    plan.push({ type: 'gather', objectId: src.id });
    const what =
      src.kind === 'dock'
        ? 'fish at the dock'
        : src.kind === 'field'
          ? `vegetables from ${src.name}`
          : 'berries nearby';
    thoughts.push(`I'll get ${what}.`);
    return true;
  };

  if (p.trigger.kind === 'offer_received') {
    const t = p.trigger;
    const offer = p.offers.find((o) => o.id === t.offerId);
    const rest = mockDecide({ ...p, trigger: { kind: 'plan_done' } });
    if (!offer) return rest;
    const fair = value(offer.give) >= value(offer.ask) * 0.9;
    return {
      thought: fair
        ? `${t.fromName}'s offer seems fair. I'll take it.`
        : `${t.fromName} wants too much. No deal.`,
      goal: rest.goal,
      plan: [{ type: 'respond_offer', offerId: offer.id, accept: fair }, ...rest.plan],
    };
  }
  if (p.trigger.kind === 'robbed' && p.trigger.byId) {
    return {
      thought: `${p.trigger.byName} robbed me! I won't let that pass quietly.`,
      goal: 'Confront the thief',
      plan: [
        { type: 'talk_to', agentId: p.trigger.byId, message: 'Thief! Give back what you took!' },
      ],
      remember: { text: `${p.trigger.byName} is a thief.`, importance: 8 },
    };
  }
  if (p.trigger.kind === 'attacked') {
    const flee: Intent[] = home
      ? [
          { type: 'go_to', target: { objectId: home.id } },
          { type: 'rest', minutes: 30 },
        ]
      : [{ type: 'explore' }];
    return {
      thought: `${p.trigger.byName} hurt me! I need to get away.`,
      goal: 'Get to safety',
      plan: [{ type: 'talk_to', agentId: p.trigger.byId, message: 'Stop! Help!' }, ...flee],
      remember: { text: `${p.trigger.byName} attacked me. They are dangerous.`, importance: 9 },
    };
  }

  // Thirst first: it kills fastest.
  if (needs.water < 45) {
    const riverDry = (p.conditions ?? []).some((c) => c.includes('only the well'));
    const source = known(riverDry ? ['well'] : ['well', 'dock']).sort(
      (a, b) => a.distance - b.distance,
    )[0];
    const riverCloser = !riverDry && (!source || source.distance > 15);
    plan.push(riverCloser || !source ? { type: 'drink' } : { type: 'drink', sourceId: source.id });
    thoughts.push(needs.water < 20 ? "I'm parched — I need water now." : "I'm thirsty.");
    goal = 'Get a drink';
  }

  // Hunger.
  if (needs.food < 50) {
    if (foodInBag.length > 0) {
      plan.push({ type: 'eat', item: foodInBag[0]! });
      thoughts.push(`Time to eat some ${foodInBag[0]}.`);
      goal ||= 'Eat something';
    } else if (
      known(['market']).length > 0 &&
      !p.recent.some((r) => r.includes('market had no')) &&
      p.self.money >= knownBuyPrice(p, 'bread') &&
      (roll < 0.5 || foodSources().length === 0)
    ) {
      const item: ItemName = p.self.money >= knownBuyPrice(p, 'bread') * 2 ? 'bread' : 'vegetables';
      plan.push({ type: 'buy', item, quantity: 2 }, { type: 'eat', item });
      thoughts.unshift("I'm hungry. I'll buy something at the market.");
      goal ||= 'Buy food';
    } else if (
      p.personality.agreeableness < 30 &&
      needs.food < 20 &&
      p.visibleAgents.length > 0 &&
      roll < 0.4
    ) {
      const mark = p.visibleAgents[0]!;
      plan.push({ type: 'steal', agentId: mark.id, item: 'bread' }, { type: 'eat', item: 'bread' });
      thoughts.unshift(`I'm starving and ${mark.name} surely has food. Nobody needs to know.`);
      goal ||= 'Take some food';
    } else if (gatherPlan()) {
      const last = plan[plan.length - 1] as { objectId: string };
      const src = p.knownPlaces.find((k) => k.id === last.objectId)!;
      plan.push({
        type: 'eat',
        item: src.kind === 'dock' ? 'fish' : src.kind === 'field' ? 'vegetables' : 'berries',
      });
      thoughts.unshift(
        needs.food < 20 ? "I'm starving." : "I'm getting hungry and my bag is empty.",
      );
      goal ||= 'Find food';
    } else {
      plan.push({ type: 'explore' });
      thoughts.push("I'm hungry and don't know where to find food. I'll look around.");
      goal ||= 'Search for food';
    }
  }

  // Illness: rest it off at home.
  if (p.sick && plan.length === 0) {
    if (home && home.distance > 0) plan.push({ type: 'go_to', target: { objectId: home.id } });
    plan.push(needs.energy < 70 ? { type: 'sleep' } : { type: 'rest', minutes: 120 });
    return {
      thought: 'I feel wretched. I need to lie down and rest until this passes.',
      goal: 'Rest until I am well',
      plan,
    };
  }

  // Sleep.
  const bedtime = isNight || hour >= 21;
  if (needs.energy < 25 || (bedtime && needs.energy < 85) || needs.warmth < 25) {
    if (home && home.distance > 0) plan.push({ type: 'go_to', target: { objectId: home.id } });
    plan.push({ type: 'sleep' });
    thoughts.push(
      needs.energy < 25
        ? "I'm exhausted."
        : bedtime
          ? "It's late; time for bed."
          : "I'm cold. I'll warm up at home.",
    );
    goal ||= 'Go to bed';
    return { thought: thoughts.join(' '), goal, plan };
  }

  if (plan.length > 0) return { thought: thoughts.join(' '), goal, plan };

  // Take shelter from a storm.
  const stormy = (p.conditions ?? []).some((c) => c.includes('storm is raging:'));
  if (stormy && home) {
    return {
      thought: 'This storm is no joke. I am going inside until it blows over.',
      goal: 'Shelter from the storm',
      plan: [
        ...(home.distance > 0 ? [{ type: 'go_to' as const, target: { objectId: home.id } }] : []),
        { type: 'rest', minutes: 90 },
      ],
    };
  }

  // Daytime: stock up on food first (more of it when winter is coming).
  const lean = p.season === 'autumn' || p.season === 'winter';
  if (foodUnits < (lean ? 8 : 4) && gatherPlan()) {
    return {
      thought: `My food stores are low. ${thoughts.join(' ')}`,
      goal: 'Stock up on food',
      plan,
    };
  }
  const nearby = p.visibleAgents.find((a) => a.distance <= 6 && a.activity !== 'sleeping');
  const social = p.personality.extraversion / 100;
  if (nearby && roll < 0.04 + 0.12 * social) {
    const name = nearby.name.startsWith('a stranger') ? 'there' : nearby.name.split(' ')[0];
    const greetings = [
      `Hello, ${name}!`,
      `Morning, ${name}. How are you keeping?`,
      `${name}! Any news?`,
      `Fine weather, isn't it, ${name}?`,
      `Good to see you, ${name}.`,
    ];
    return {
      thought: `There's ${nearby.name}. I'll stop for a chat.`,
      goal: 'Chat with a neighbour',
      plan: [
        {
          type: 'talk_to',
          agentId: nearby.id,
          message: greetings[Math.floor(roll * 50) % greetings.length]!,
        },
      ],
    };
  }
  const grow = villagePlan(p, roll);
  if (grow) return grow;
  const work = workPlan(p, roll);
  if (work) return work;
  if (roll < 0.15) {
    return {
      thought: 'Nothing pressing. I feel like wandering.',
      goal: 'Explore',
      plan: [{ type: 'explore' }],
    };
  }
  const plaza = known(['market', 'well'])[0];
  if (roll < 0.6 && plaza) {
    return {
      thought: 'I might see someone in the square.',
      goal: 'Spend time in the square',
      plan: [
        { type: 'go_to', target: { objectId: plaza.id } },
        { type: 'rest', minutes: 45 },
      ],
    };
  }
  return {
    thought: 'A quiet moment to rest.',
    goal: 'Rest',
    plan:
      home && home.distance > 0
        ? [
            { type: 'go_to', target: { objectId: home.id } },
            { type: 'rest', minutes: 60 },
          ]
        : [{ type: 'rest', minutes: 60 }],
  };
}

const BABY_NAMES = {
  female: ['Alma', 'Clara', 'Elin', 'Fenna', 'Hanne', 'Ilse', 'Liesel', 'Marta', 'Nora', 'Tilde'],
  male: ['Anton', 'Bertil', 'Claus', 'Ebbe', 'Falk', 'Hauke', 'Jannik', 'Kaspar', 'Mats', 'Ruben'],
};

/** Babies, children and family life: care, naming, courtship, children, teaching, wills. */
function lifePlan(p: Perception, roll: number): Decision | null {
  const t = p.trigger;
  const needs = p.self.needs;
  const inv = p.self.inventory;
  const food = FOOD_ITEMS.filter((i) => (inv[i] ?? 0) > 0).sort(
    (a, b) => NUTRITION[b] - NUTRITION[a],
  )[0];

  if (p.stage === 'infant') {
    const carer = p.visibleAgents[0];
    if (needs.food < 45 || needs.water < 45) {
      return {
        thought: 'Hungry… want milk…',
        goal: 'Be fed',
        plan: carer
          ? [
              { type: 'talk_to', agentId: carer.id, message: 'Waaah!' },
              { type: 'rest', minutes: 20 },
            ]
          : [{ type: 'rest', minutes: 20 }],
      };
    }
    if (needs.energy < 60 || p.clock.isNight)
      return { thought: 'Sleepy…', goal: 'Sleep', plan: [{ type: 'sleep' }] };
    return {
      thought: 'Warm. Faces. Nice.',
      goal: 'Look around',
      plan:
        carer && roll < 0.4
          ? [
              { type: 'talk_to', agentId: carer.id, message: 'goo!' },
              { type: 'rest', minutes: 60 },
            ]
          : [{ type: 'rest', minutes: 60 }],
    };
  }
  if (p.stage === 'toddler') {
    if (needs.water < 45)
      return { thought: 'Thirsty. Water!', goal: 'Drink', plan: [{ type: 'drink' }] };
    if (needs.food < 50 && food)
      return { thought: 'Yum.', goal: 'Eat', plan: [{ type: 'eat', item: food }] };
    if (needs.food < 40) {
      const parent = p.visibleAgents.find((a) => p.family.parents.some((q) => q.id === a.id));
      return {
        thought: 'Tummy hurts. Want food.',
        goal: 'Ask for food',
        plan: parent
          ? [
              { type: 'talk_to', agentId: parent.id, message: 'Hungry!' },
              { type: 'rest', minutes: 20 },
            ]
          : [{ type: 'rest', minutes: 30 }],
      };
    }
    if (needs.energy < 40 || p.clock.isNight || p.clock.hour >= 20) {
      const home = p.knownPlaces.find((k) => k.id === p.self.homeId);
      return {
        thought: 'Sleepy.',
        goal: 'Sleep',
        plan: [
          ...(home && home.distance > 0
            ? [{ type: 'go_to' as const, target: { objectId: home.id } }]
            : []),
          { type: 'sleep' },
        ],
      };
    }
    const parent = p.visibleAgents.find((a) => p.family.parents.some((q) => q.id === a.id));
    if (parent && roll < 0.5) {
      return {
        thought: 'Where Mama going?',
        goal: 'Follow',
        plan: [
          { type: 'go_to', target: { x: parent.x, y: parent.y } },
          { type: 'rest', minutes: 20 },
        ],
      };
    }
    return { thought: 'Play!', goal: 'Play', plan: [{ type: 'rest', minutes: 40 }] };
  }

  // Grown-ups (and children answering what they can).
  if (t.kind === 'child_born') {
    const sex =
      p.family.children.find((c) => c.id === t.childId) && t.childLabel.includes('girl')
        ? 'female'
        : 'male';
    const name = BABY_NAMES[sex][Math.floor(roll * BABY_NAMES[sex].length)]!;
    return {
      thought: `Our baby is here! We'll call them ${name}.`,
      goal: 'Welcome the baby',
      plan: [
        { type: 'name_child', childId: t.childId, name },
        { type: 'rest', minutes: 60 },
      ],
    };
  }
  if (t.kind === 'proposal' && p.stage !== 'child') {
    const who = p.knownPeople.find((k) => k.id === t.fromId);
    const yes = !p.family.partner && (who?.affection ?? 0) >= 15 && roll < 0.8;
    return {
      thought: yes
        ? `${t.fromName} wants to be with me. Yes!`
        : `${t.fromName}? No, I don't feel that way.`,
      goal: yes ? 'Say yes' : 'Let them down gently',
      plan: [{ type: 'respond_proposal', fromId: t.fromId, accept: yes }],
    };
  }
  if (t.kind === 'child_request') {
    const yes = p.family.children.length < 4 && roll < 0.8;
    return {
      thought: yes ? 'A child of our own… yes.' : 'Not now. We have enough to manage.',
      goal: yes ? 'Try for a child' : 'Decline for now',
      plan: [{ type: 'respond_child_request', fromId: t.fromId, accept: yes }],
    };
  }
  if (t.kind === 'adoption_offer') {
    const who = p.knownPeople.find((k) => k.id === t.fromId);
    const yes = (who?.trust ?? 0) >= -10 && roll < 0.85;
    return {
      thought: yes
        ? `${t.fromName} wants to give me a home. Yes, please.`
        : "I'm not ready for that.",
      goal: yes ? 'Join a new family' : 'Stay on my own',
      plan: [{ type: 'respond_adoption', fromId: t.fromId, accept: yes }],
    };
  }
  // A kind grown-up with a home may take in a child who has lost their parents.
  if (
    t.kind === 'orphaned' &&
    (p.stage === 'adult' || p.stage === 'elder') &&
    p.self.homeId &&
    p.family.children.filter((c) => c.age < 18).length < 4 &&
    roll < 0.3 + p.personality.agreeableness / 200
  ) {
    return {
      thought: `${t.childName} has nobody now. We'll take them in.`,
      goal: `Adopt ${t.childName}`,
      plan: [{ type: 'adopt_child', childId: t.childId }],
    };
  }
  // Feed hungry children we can see (or were told about).
  const hungryChild =
    p.family.children.find(
      (c) => c.age < 13 && c.needs && (c.needs.food < 45 || c.needs.water < 45),
    ) ?? (t.kind === 'child_needs' ? p.family.children.find((c) => c.id === t.childId) : undefined);
  // Look after yourself first: a parent who collapses can't feed anyone.
  const selfOk = needs.water >= 30 && needs.food >= 25 && needs.energy >= 15;
  if (hungryChild && p.stage !== 'child' && selfOk) {
    if (food) {
      return {
        thought: `${hungryChild.name} needs feeding.`,
        goal: 'Feed my child',
        plan: [
          { type: 'feed', agentId: hungryChild.id, item: food },
          ...((inv[food] ?? 0) >= 2
            ? [{ type: 'feed' as const, agentId: hungryChild.id, item: food }]
            : []),
        ],
      };
    }
    const market = p.knownPlaces.find((k) => k.kind === 'market');
    if (market && p.self.money >= 8) {
      return {
        thought: `${hungryChild.name} is hungry and I have nothing. To the market.`,
        goal: 'Get food for my child',
        plan: [
          { type: 'buy', item: 'bread', quantity: 2 },
          { type: 'feed', agentId: hungryChild.id, item: 'bread' },
        ],
      };
    }
  }
  // Nurse the sick: family, or anyone if caring for people is your calling.
  const carer = /herb|midwife|heal|nurse/.test(p.self.occupation.toLowerCase());
  const family = new Set(
    [
      p.family.partner?.id,
      ...p.family.children.map((c) => c.id),
      ...p.family.parents.map((q) => q.id),
    ].filter(Boolean),
  );
  const patient = p.visibleAgents.find(
    (a) => a.activity.includes('looks ill') && (carer || family.has(a.id)),
  );
  if (patient && selfOk && !p.sick && p.stage !== 'child' && roll < (carer ? 0.8 : 0.5)) {
    return {
      thought: `${patient.name} looks terribly ill. I'll see to them.`,
      goal: 'Nurse the sick',
      plan: [{ type: 'tend', agentId: patient.id }],
    };
  }
  if (p.stage === 'child' || p.stage === 'teen') return null;

  // Initiatives, now and then.
  const partner = p.family.partner;
  if (!partner && p.self.age >= 18 && p.self.age <= 50 && roll < 0.04) {
    const crush = p.knownPeople.find((k) => {
      const seen = p.visibleAgents.find((v) => v.id === k.id);
      return !k.role && k.affection >= 25 && seen && k.romance >= 0;
    });
    if (crush) {
      return {
        thought: `I've grown fond of ${crush.name}. I'll ask.`,
        goal: 'Ask for partnership',
        plan: [{ type: 'propose_partnership', agentId: crush.id }],
      };
    }
  }
  if (
    partner &&
    p.self.sex === 'female' &&
    p.self.age >= 18 &&
    p.self.age <= 40 &&
    !p.pregnant &&
    p.family.children.filter((c) => c.age < 13).length < 2 &&
    p.family.children.length < 4 &&
    (p.clock.hour >= 17 || p.clock.hour < 7) &&
    p.visibleAgents.some((v) => v.id === partner.id && v.distance <= 4) &&
    roll < 0.35
  ) {
    return {
      thought: `Perhaps it's time for another little one.`,
      goal: 'Talk about children',
      plan: [{ type: 'try_for_child', agentId: partner.id }],
    };
  }
  const pupil = p.family.children.find((c) => c.nearby && c.age >= 5 && c.age < 18);
  if (pupil && roll < 0.12) {
    const occ = p.self.occupation.toLowerCase();
    const skill = occ.includes('fish')
      ? 'fishing'
      : occ.includes('farm')
        ? 'farming'
        : occ.includes('bak')
          ? 'cooking'
          : occ.includes('carp')
            ? 'building'
            : 'foraging';
    return {
      thought: `${pupil.name} should learn a thing or two.`,
      goal: 'Teach my child',
      plan: [{ type: 'teach', agentId: pupil.id, skill }],
    };
  }
  if (p.stage === 'elder' && roll < 0.05) {
    const heir =
      p.family.children[0] ?? (partner ? { id: partner.id, name: partner.name } : undefined);
    if (heir)
      return {
        thought: `I should settle my affairs. ${heir.name} will have it all.`,
        goal: 'Make a will',
        plan: [{ type: 'declare_will', agentId: heir.id }],
      };
  }
  return null;
}

/** A day's work by occupation, then selling the surplus at the market. */
function workPlan(p: Perception, roll: number): Decision | null {
  if (roll > 0.75) return null; // everyone needs some time off
  const inv = p.self.inventory;
  const have = (i: ItemName) => inv[i] ?? 0;
  // A burnt home (or workplace) of our own comes first: wood → planks → rebuild.
  const ruin = p.knownPlaces.find((k) => k.burnt && k.owner === 'you');
  if (ruin && p.stage !== 'child') {
    if (have('planks') >= 3)
      return {
        thought: `${ruin.name} won't rebuild itself.`,
        goal: `Rebuild ${ruin.name}`,
        plan: [{ type: 'build_house' }],
      };
    if (have('wood') >= 2)
      return {
        thought: 'Planks for the rebuilding.',
        goal: 'Make planks',
        plan: [
          { type: 'craft', recipe: 'planks' },
          ...(have('wood') >= 4 ? [{ type: 'craft' as const, recipe: 'planks' as const }] : []),
        ],
      };
    if (p.self.money >= knownBuyPrice(p, 'planks') * 3 && roll < 0.5)
      return {
        thought: 'I will buy planks and get on with rebuilding.',
        goal: `Rebuild ${ruin.name}`,
        plan: [{ type: 'buy', item: 'planks', quantity: 3 }, { type: 'build_house' }],
      };
    return {
      thought: `I need timber to rebuild ${ruin.name}.`,
      goal: 'Gather wood for rebuilding',
      plan: [{ type: 'chop_wood' }, { type: 'chop_wood' }],
    };
  }
  const occ = p.self.occupation.toLowerCase();
  const place = (kind: string, produce?: ItemName) =>
    p.knownPlaces
      .filter(
        (k) =>
          k.kind === kind &&
          !k.unreachable &&
          (!produce || k.produce === produce) &&
          (k.lastSeenAmount ?? 1) >= 1,
      )
      .sort((a, b) => a.distance - b.distance)[0];
  const overflowing = (item: ItemName) =>
    p.recent.some((r) => r.includes(`won't take any more ${ITEMS[item].label.toLowerCase()}`));
  const sellSurplus = (item: ItemName, keep: number): Intent[] =>
    overflowing(item) ? [] : sellRaw(item, keep);
  const sellRaw = (item: ItemName, keep: number): Intent[] =>
    have(item) > keep ? [{ type: 'sell', item, quantity: have(item) - keep }] : [];

  if (occ.includes('fish')) {
    const dock = place('dock');
    if (!dock) return null;
    return {
      thought: 'The fish are biting today, I can feel it.',
      goal: 'Fish and sell the catch',
      plan: [
        { type: 'gather', objectId: dock.id },
        { type: 'gather', objectId: dock.id },
        { type: 'gather', objectId: dock.id },
        ...sellSurplus('fish', 2),
      ],
    };
  }
  if (occ.includes('baker')) {
    if (have('wheat') >= 3) {
      return {
        thought: 'Time to bake.',
        goal: 'Bake bread',
        plan: [{ type: 'craft', recipe: 'bread' }, ...sellSurplus('bread', 3)],
      };
    }
    if (have('bread') > 4) {
      return {
        thought: 'I have more bread than I can eat. To the market.',
        goal: 'Sell bread',
        plan: sellSurplus('bread', 3),
      };
    }
    const marketOut = p.recent.some((r) => r.includes('market had no wheat'));
    if (p.self.money >= knownBuyPrice(p, 'wheat') * 3 && roll < 0.4 && !marketOut) {
      return {
        thought: "I'm out of wheat. I'll buy some and bake.",
        goal: 'Buy wheat and bake',
        plan: [
          { type: 'buy', item: 'wheat', quantity: 3 },
          { type: 'craft', recipe: 'bread' },
        ],
      };
    }
    const field = place('field', 'wheat');
    if (field) {
      return {
        thought: "I'll fetch wheat myself.",
        goal: 'Gather wheat',
        plan: [
          { type: 'gather', objectId: field.id },
          { type: 'gather', objectId: field.id },
          { type: 'craft', recipe: 'bread' },
        ],
      };
    }
  }
  if (occ.includes('farm')) {
    const field = place('field', roll < 0.35 ? 'wheat' : 'vegetables') ?? place('field');
    if (!field) return null;
    const crop: ItemName = field.produce ?? 'vegetables';
    return {
      thought: 'The fields need tending.',
      goal: 'Harvest and sell',
      plan: [
        { type: 'gather', objectId: field.id },
        { type: 'gather', objectId: field.id },
        ...sellSurplus(crop, crop === 'wheat' ? 0 : 4),
      ],
    };
  }
  if (occ.includes('carpenter') || occ.includes('odd') || occ.includes('travel')) {
    if (occ.includes('carpenter') && have('planks') >= 3 && have('tools') === 0) {
      return {
        thought: 'I should make myself some proper tools.',
        goal: 'Make tools',
        plan: [{ type: 'craft', recipe: 'tools' }],
      };
    }
    if (occ.includes('carpenter') && have('wood') >= 2) {
      return {
        thought: 'Good timber. Into planks with it.',
        goal: 'Make planks',
        plan: [{ type: 'craft', recipe: 'planks' }, ...sellSurplus('planks', 3)],
      };
    }
    return {
      thought: 'There is always a need for wood.',
      goal: 'Chop wood',
      plan: [
        { type: 'chop_wood' },
        { type: 'chop_wood' },
        ...(occ.includes('carpenter') ? [] : sellSurplus('wood', 0)),
      ],
    };
  }
  // Everyone else forages and sells a little.
  const bush = p.knownPlaces.find(
    (k) => k.kind === 'berry_bush' && !k.unreachable && (k.lastSeenAmount ?? 1) >= 2,
  );
  if (bush && roll < 0.4) {
    return {
      thought: 'I will pick berries.',
      goal: 'Forage',
      plan: [{ type: 'gather', objectId: bush.id }, ...sellSurplus('berries', 6)],
    };
  }
  return null;
}

const ROUTINE = /^I (ate|drank|gathered|chopped|went to sleep|fished|found no|made a note|woke)/;
const CHATTER = /said to me|^I said to|^I overheard|knocked at the door/;
const BIG =
  /born|died|partner|stole|attack|fire|burn|storm|ill|sick|nursed|built|child|baby|inherit|drought|kill|grow/i;

/** A plain, free nightly reflection: the day's notable moments become a short diary entry. */
export function mockReflect(p: Perception): Decision {
  const scope = p.trigger.kind === 'reflect' ? p.trigger.scope : 'day';
  const lines = [
    ...new Set(
      (p.reflectOn ?? [])
        .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').replace(/^Diary:\s*/, ''))
        .filter((l) => !ROUTINE.test(l)),
    ),
  ];
  // What mattered most, then what was done, then (only if nothing else) who said what.
  const rank = (l: string) => (BIG.test(l) ? 0 : CHATTER.test(l) ? 2 : 1);
  const pick = [...lines]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, scope === 'year' ? 4 : 3)
    .sort((a, b) => lines.indexOf(a) - lines.indexOf(b));
  const body = pick.length ? pick.join(' ') : 'A quiet day of ordinary work.';
  const mood =
    p.sick || p.self.health < 50
      ? ' I feel poorly.'
      : p.self.needs.food < 30
        ? ' I went to bed hungry.'
        : '';
  const diary = `${body}${mood}`;
  return {
    thought: scope === 'year' ? 'Another year gone.' : 'Time to sleep.',
    goal: '',
    plan: [],
    diary: diary.slice(0, 600),
  };
}

export class MockBrain implements BrainProvider {
  readonly id = 'mock' as const;

  async decide(request: DecisionRequest, _config: BrainConfig): Promise<BrainResult> {
    return {
      decision: mockDecide(request.perception),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }
}
