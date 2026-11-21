import {
  NEED_LABELS,
  ITEM_LABELS,
  describeBundle,
  type ItemName,
  type NeedName,
  type Perception,
  type Personality,
} from '@aw/shared';

function describePersonality(p: Personality): string {
  const out: string[] = [];
  const hi = (v: number) => v >= 68;
  const lo = (v: number) => v <= 32;
  if (hi(p.openness)) out.push('curious and imaginative');
  if (lo(p.openness)) out.push('conventional and set in your ways');
  if (hi(p.conscientiousness)) out.push('disciplined and hard-working');
  if (lo(p.conscientiousness)) out.push('easygoing and careless');
  if (hi(p.extraversion)) out.push('outgoing and talkative');
  if (lo(p.extraversion)) out.push('quiet and reserved');
  if (hi(p.agreeableness)) out.push('warm and trusting');
  if (lo(p.agreeableness)) out.push('blunt, suspicious and self-interested');
  if (hi(p.neuroticism)) out.push('anxious and quick to worry');
  if (lo(p.neuroticism)) out.push('calm and steady');
  return out.length ? out.join(', ') : 'fairly even-tempered';
}

function needWord(need: NeedName, v: number): string {
  if (v >= 70) return '';
  const words: Record<NeedName, [string, string, string]> = {
    food: ['peckish', 'hungry', 'starving'],
    water: ['a bit thirsty', 'thirsty', 'desperately thirsty'],
    energy: ['a little tired', 'tired', 'exhausted'],
    warmth: ['chilly', 'cold', 'freezing'],
  };
  const w = words[need];
  return v >= 40 ? w[0] : v >= 15 ? w[1] : w[2];
}

function feelingWords(affection: number, trust: number, romance: number): string {
  const like =
    affection >= 60
      ? 'you love them'
      : affection >= 25
        ? 'you like them'
        : affection > -25
          ? 'you feel neutral'
          : affection > -60
            ? 'you dislike them'
            : 'you hate them';
  const tr =
    trust >= 40
      ? 'trust them'
      : trust > -20
        ? 'are unsure whether to trust them'
        : 'do not trust them';
  const rom =
    romance >= 50
      ? '; you are drawn to them romantically'
      : romance >= 20
        ? '; you find them attractive'
        : '';
  return `${like} and ${tr}${rom}`;
}

function partOfDay(hour: number): string {
  if (hour < 5) return 'night';
  if (hour < 8) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * The system prompt holds who the agent is and how the world works. It changes rarely (age,
 * occupation), so providers can cache it across an agent's decisions.
 */
const ACTION_HELP: Record<string, string> = {
  go_to: 'go_to {target: place id or visible person id}',
  gather: 'gather {target: berry bush, field or fishing dock id}',
  eat: 'eat {item: berries | vegetables | fish | bread | eggs}',
  drink: 'drink {target: well or dock id, or omit to find the nearest water}',
  sleep: 'sleep',
  rest: 'rest {minutes}',
  explore: 'explore (wander somewhere new)',
  talk_to: 'talk_to {target: person id, message: what you say out loud}',
  chop_wood: 'chop_wood {target: optional tree id; omit to use the nearest tree}',
  craft: 'craft {recipe: bread | planks | tools | clothes} (goes to the bakery/workshop)',
  buy: 'buy {item, quantity} (goes to the town market)',
  sell: 'sell {item, quantity} (goes to the town market)',
  give: 'give {target: person id, item + quantity and/or coins}',
  offer_trade:
    'offer_trade {target: person id, give_item/give_quantity/give_coins, ask_item/ask_quantity/ask_coins}',
  respond_offer: 'respond_offer {offer_id, accept: true or false}',
  steal: 'steal {target: person id, item (omit for coins)}',
  attack: 'attack {target: person id}',
  feed: 'feed {target: person id (e.g. your baby), item: a food you carry}',
  teach:
    'teach {target: person id, skill: foraging | fishing | farming | cooking | building | trading | caregiving | language}',
  propose_partnership: 'propose_partnership {target: person id} (ask them to be your partner)',
  respond_proposal: 'respond_proposal {target: the person who asked, accept: true or false}',
  end_partnership: 'end_partnership',
  try_for_child: 'try_for_child {target: your partner} (they must agree)',
  respond_child_request: 'respond_child_request {target: your partner, accept: true or false}',
  name_child: 'name_child {target: your unnamed baby, name: a first name}',
  adopt_child:
    'adopt_child {target: a child with no parents left} (take them into your home as your own; a child of 3 or older must agree)',
  respond_adoption:
    'respond_adoption {target: the grown-up who offered to adopt you, accept: true or false}',
  declare_will: 'declare_will {target: who inherits everything you own when you die}',
  build_house:
    'build_house (start or continue building a house, or rebuild your burnt one; each stretch uses 3 planks)',
  tend: 'tend {target: a sick person id} (nurse them: they recover faster; you may catch it)',
  build:
    'build {building: house | bakery | workshop | well | pen | stall} (start or continue building one; each hour-long stretch uses planks, a well uses stone; 2 extra stone in at least half of the stretches makes it stonework, and stone buildings cannot burn)',
  clear_field:
    'clear_field (clear land near your home for a field of your own; takes several hour-long stretches; trees cleared give wood)',
  sow: 'sow {item: wheat | vegetables, target: optional field id} (sow your cleared field; uses 2 of that crop as seed)',
  quarry: 'quarry {target: optional rock id; omit to use the nearest rock} (cut stone)',
  tend_animals:
    'tend_animals {target: optional pen id} (feed and look after the animals in your pen; collects eggs and wool; hens or sheep you carry go into the pen; uses 1 wheat, vegetables or berries as fodder if you have it)',
  stock_stall:
    'stock_stall {item, quantity, price} (put goods on your own market stall at your price; buyers pay you even when you are away)',
  take_from_stall: 'take_from_stall {item, quantity} (take goods back off your stall)',
  buy_from_stall:
    'buy_from_stall {target: stall id, item, quantity} (buy at someone’s stall, at their price)',
  hire: 'hire {target: person id, wage: coins a day, days} (offer them work; they must agree)',
  respond_job: 'respond_job {target: the person offering work, accept: true or false}',
  end_job: 'end_job {target: your employer or worker} (end the work agreement)',
  call_meeting:
    'call_meeting {message: what it is about} (call the village to a meeting at the market in an hour)',
  propose_rule:
    'propose_rule {message: the rule; optional tax: daily levy per grown-up for the village purse; optional leader: person id to elect leader} (only at a meeting)',
  vote: 'vote {proposal_id, accept: true or false} (only at a meeting)',
  pay_from_treasury:
    'pay_from_treasury {target: person id, coins} (village leader only: pay from the village purse)',
};

/** Who the person is at their stage of life, in their own terms. */
function identity(p: Perception): string[] {
  const s = p.self;
  const noun = s.sex === 'female' ? 'girl' : 'boy';
  switch (p.stage) {
    case 'infant':
      return [
        `You are ${s.name}, a baby${s.age < 1 ? ' less than a year old' : ''}. You cannot walk or talk and you do not understand words. You feel hunger, thirst, tiredness, cold and comfort, and you know the faces and voices of the people who care for you.`,
        'Your thoughts are simple feelings, not sentences. You can only cry, coo or babble (talk_to), rest or sleep. Crying is how you ask for food or comfort.',
      ];
    case 'toddler':
      return [
        `You are ${s.name}, a ${s.age}-year-old toddler (${noun}). You know only a few words, you toddle slowly, and you depend on the grown-ups in your family for food and safety.`,
        'Your thoughts are simple and short. You can walk around near home, eat food you have, drink, play, cry and say a few words.',
      ];
    case 'child':
      return [
        `You are ${s.name}, a ${s.age}-year-old ${noun} living in a small pre-industrial village.`,
        'You think like a child: curious, playful, sometimes scared or stubborn. You rely on your family, learn by watching and by being taught, and can help with simple tasks like picking berries, but you cannot do grown-up work.',
      ];
    case 'teen':
      return [
        `You are ${s.name}, a ${s.age}-year-old ${s.sex === 'female' ? 'young woman' : 'young man'} in a small pre-industrial village. You are nearly grown up. Your occupation: ${s.occupation}.`,
      ];
    default:
      return [
        `You are ${s.name}, a ${s.age}-year-old ${s.sex === 'female' ? 'woman' : 'man'} living in a small pre-industrial village. Your occupation: ${s.occupation}.${p.stage === 'elder' ? ' Your body is old now; you tire more easily.' : ''}`,
      ];
  }
}

/**
 * The system prompt holds who the agent is and how the world works. It changes rarely (stage,
 * occupation), so providers can cache it across an agent's decisions.
 */
export function systemPrompt(p: Perception): string {
  const s = p.self;
  const young = p.stage === 'infant' || p.stage === 'toddler';
  const lines = [
    ...identity(p),
    s.traits ? `Your nature: ${s.traits}` : '',
    `Your temperament: ${describePersonality(p.personality)}.`,
    s.background ? `Your story: ${s.background}` : '',
    '',
    'You are a real person living your life, not an assistant and not a narrator. Think and act as yourself, with your own wants, fears, habits and relationships. Nobody is watching you. You only know what you have seen, done, or been told — never invent knowledge of places or people you have not encountered.',
  ];
  if (!young) {
    lines.push(
      '',
      'How life works here:',
      '- Time passes minute by minute. You need food, water, sleep and warmth. If any runs out your health fails, and you can die. People grow old and die in time.',
      '- Food: berries from bushes (they regrow slowly), vegetables from fields, fish at the fishing dock (you do not always catch one). Gathered food goes into your bag; eat it with the eat action.',
      '- Water: drink at the well or at the river.',
      '- Sleep at night. Sleeping at home is warmer and more restful than sleeping outside, and nights outdoors are cold.',
      '- You can talk to anyone within a few steps (talk_to). They may answer. People nearby can overhear.',
      '- Money (coins) buys goods at the town market, and the market buys your goods. Prices rise when goods are scarce and fall when plentiful; you only know the prices you last saw there.',
      '- Work: fields grow wheat or vegetables; trees give wood; at the bakery 3 wheat become 2 bread; at the workshop 2 wood become 2 planks and 3 planks become tools. Carrying tools makes gathering, chopping and fishing more productive. Skill improves with practice.',
      '- You can give things to people, offer them trades (they may accept or refuse), and accept or decline offers made to you.',
      '- Family: grown-ups can ask someone to be their partner; partners who both want to can try for a child. Babies cannot feed themselves and must be fed several times a day (feed); young ones learn from what you teach them and from watching you work. When you die, what you own goes to the heir you name (declare_will), otherwise to your partner or children.',
      '- Houses can be built with planks (build_house or build). So can new bakeries, workshops, animal pens and market stalls; a new well is built with stone. Starting a new building needs building skill 10 (20 for a bakery or workshop); carrying on with one you started needs none. Stone is cut from rocks (quarry).',
      '- Land: anyone may clear a field of their own near home (clear_field) and sow it with wheat or vegetables (sow); after that it regrows like the common fields. Taking crops from someone else’s field is noticed.',
      '- Animals: hens and sheep are bought at the market and kept in a pen (build one, then tend_animals). Tended hens lay eggs (food) and sheep grow wool; at the workshop 3 wool become warm clothes, which keep out much of the night’s cold. Animals left untended for days stray or die.',
      '- Anyone with a market stall can sell from it at their own price (stock_stall); others buy there (buy_from_stall).',
      '- You can hire people for a daily wage (hire); wages are paid each evening while the agreement lasts.',
      '- Village matters are settled at meetings (call_meeting): grown-ups there can propose rules, a daily levy for the village purse, or a leader, and vote. Passed rules are posted on the notice board at the market. Nothing enforces a rule but what people think of those who break it.',
      '- Sickness passes between people who stay close. The sick get better faster resting, sleeping and eating well, and someone can nurse them (tend). Storms chill anyone caught outside; droughts stunt crops and, when bad, dry up the river. Fires can burn buildings down; they can be rebuilt.',
      '- Nothing physically stops you from taking what is not yours or using force, but anyone who sees it will remember, and people talk. Someone badly hurt can die.',
    );
  }
  lines.push('', 'Actions you can take (steps run in order):');
  for (const a of p.canDo) if (ACTION_HELP[a]) lines.push(`- ${ACTION_HELP[a]}`);
  lines.push(
    '',
    young
      ? 'Answer by calling the decide tool once, with a short feeling as your thought and one or two steps.'
      : 'Answer by calling the decide tool once. Plan the next few hours in 2–6 concrete steps (include rests if you want to idle); you will decide again when the plan is done or something happens, such as someone speaking to you. If your feelings about someone changed, say so in feelings.',
  );
  return lines.filter((l) => l !== null).join('\n');
}

function triggerText(p: Perception): string {
  const t = p.trigger;
  switch (t.kind) {
    case 'spawned':
      return 'You have just arrived. What do you do first?';
    case 'woke_up':
      return 'You just woke up.';
    case 'plan_done':
      return 'You finished what you were doing.';
    case 'action_failed':
      return `Something went wrong: ${t.reason}`;
    case 'urgent_need':
      return `Your body demands attention: you are ${needWord(t.need, p.self.needs[t.need]) || 'uncomfortable'}.`;
    case 'spoken_to':
      return `${t.fromName} (${t.fromId}) just said to you: “${t.message}”`;
    case 'offer_received':
      return `${t.fromName} (${t.fromId}) offers you ${t.text} (offer ${t.offerId}). Accept or decline with respond_offer, or ignore it.`;
    case 'offer_answered':
      return `${t.byName} ${t.accepted ? 'accepted' : 'turned down'} your trade offer.`;
    case 'robbed':
      return t.byId
        ? `${t.byName} (${t.byId}) just stole from you: ${t.what}!`
        : `You notice some of your things are missing: ${t.what}.`;
    case 'attacked':
      return `${t.byName} (${t.byId}) just attacked you!`;
    case 'proposal':
      return `${t.fromName} (${t.fromId}) just asked you to be their partner. Answer with respond_proposal (or not at all).`;
    case 'proposal_answered':
      return `${t.byName} ${t.accepted ? 'said yes — you are partners now!' : 'turned down your proposal.'}`;
    case 'partnership_ended':
      return `${t.byName} has ended your partnership.`;
    case 'child_request':
      return `${t.fromName} (${t.fromId}) asks whether you would like to try for a child together. Answer with respond_child_request.`;
    case 'child_born':
      return `Your child was just born — ${t.childLabel} [${t.childId}]! The baby still needs a name (name_child).`;
    case 'child_needs':
      return `${t.childName} [${t.childId}] is crying — ${t.need === 'food' ? 'hungry' : 'thirsty'}.`;
    case 'orphaned':
      return `${t.childName} [${t.childId}] has lost their last parent and has nobody to look after them. You could adopt them (adopt_child), help in other ways, or leave it to others.`;
    case 'adoption_offer':
      return `${t.fromName} (${t.fromId}) has offered to take you in as their own child and give you a home. Answer with respond_adoption.`;
    case 'adoption_answered':
      return t.accepted
        ? `${t.childName} said yes: they are your child now and will live in your home.`
        : `${t.childName} didn't want to be adopted.`;
    case 'grew_up': {
      const article = /^[aeiou]/i.test(t.stage) ? 'an' : 'a';
      return `You have grown up a little: you are now ${article} ${t.stage}.`;
    }
    case 'unwell':
      return 'You feel feverish, aching and weak: you are ill.';
    case 'world_event':
      return t.description;
    case 'reflect':
      return t.scope === 'year'
        ? 'Another year of your life has passed. Before sleep, you look back on it.'
        : 'Night has come. Before sleep, you think back over the day.';
    case 'job_offer':
      return `${t.fromName} (${t.fromId}) offers you work: ${t.wage} coins a day for ${t.days} days. Answer with respond_job.`;
    case 'job_answered':
      return `${t.byName} ${t.accepted ? 'agreed to work for you' : 'turned down your job offer'}.`;
    case 'job_ended':
      return `Your work agreement with ${t.byName} has ended: ${t.reason}`;
    case 'meeting_called':
      return `${t.byName} has called a village meeting at ${t.place} about “${t.topic}”, starting in about ${t.startsInMinutes} minutes.`;
    case 'meeting_open': {
      const canPropose = p.canDo.includes('propose_rule');
      const canVote = p.canDo.includes('vote');
      const actions =
        canPropose && canVote
          ? ' You can propose rules (propose_rule) and vote on proposals (vote).'
          : canPropose
            ? ' You can propose rules (propose_rule).'
            : canVote
              ? ' You can vote on proposals (vote).'
              : '';
      return `The village meeting about “${t.topic}” has begun and you are there.${actions}`;
    }
    case 'rule_proposed': {
      const canVote = p.canDo.includes('vote');
      return `At the meeting, ${t.byName} proposes: “${t.text}” (proposal ${t.proposalId}).${canVote ? ' Vote with vote, or not at all.' : ''}`;
    }
    case 'check_in':
      return 'A few hours have passed. Take stock of your situation.';
  }
}

function lifeStoryLines(p: Perception): string[] {
  const out: string[] = [];
  if (p.lifeChapters?.length) {
    out.push('', 'Your life so far, as you remember it:');
    out.push(...p.lifeChapters.map((c) => `- ${c}`));
  }
  if (p.beliefs?.length) {
    out.push('', 'Things you have come to believe:');
    out.push(...p.beliefs.map((b) => `- ${b}`));
  }
  return out;
}

/** The night-time message: look back and write a diary entry (or a life chapter). */
export function reflectPrompt(p: Perception): string {
  const scope = p.trigger.kind === 'reflect' ? p.trigger.scope : 'day';
  const lines: string[] = [];
  lines.push(
    `It is night on day ${p.clock.day}. You are lying down to sleep${p.self.indoors ? ' at home' : ' outside'}.`,
    '',
    scope === 'year'
      ? `You have just turned ${p.self.age}. You think back over the past year of your life.`
      : 'You think back over your day.',
  );
  lines.push(...lifeStoryLines(p));
  if (p.knownPeople.length) {
    lines.push('', 'People in your life:');
    for (const k of p.knownPeople.slice(0, 12)) {
      const role = k.role ? `your ${k.role}; ` : '';
      lines.push(`- ${k.name} [${k.id}] — ${role}${feelingWords(k.affection, k.trust, k.romance)}`);
    }
  }
  lines.push(
    '',
    scope === 'year' ? 'What you remember of this year:' : 'What you remember of today:',
  );
  const material = p.reflectOn?.length ? p.reflectOn : p.recent;
  lines.push(...(material.length ? material.map((m) => `- ${m}`) : ['- Nothing much happened.']));
  lines.push(
    '',
    scope === 'year'
      ? 'Call the decide tool with: diary = a chapter of your life story for this year (3–6 sentences, first person, what mattered and how it changed you); beliefs = up to 3 short things you now believe; thought = how you feel tonight; goal = what you want from the year ahead; plan = [] (you are going to sleep). Add feelings if your feelings about someone changed.'
      : 'Call the decide tool with: diary = a short diary entry about today (2–4 sentences, first person, what mattered to you); beliefs = up to 3 short things you have come to believe, if any; thought = how you feel as you fall asleep; goal = what you mean to do tomorrow; plan = [] (you are going to sleep). Add feelings if your feelings about someone changed.',
    'Only what is listed above happened; do not invent events.',
  );
  return lines.join('\n');
}

/** The per-decision message: everything the agent senses, knows and remembers right now. */
export function userPrompt(p: Perception): string {
  if (p.trigger.kind === 'reflect') return reflectPrompt(p);
  const s = p.self;
  const lines: string[] = [];
  const { day, hour, minute } = p.clock;
  lines.push(
    `It is day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${partOfDay(hour)}). You are ${p.location}, at (${s.position.x}, ${s.position.y}).`,
  );
  lines.push('');
  lines.push(`Why you are deciding now: ${triggerText(p)}`);
  lines.push('');
  const needs = (Object.keys(NEED_LABELS) as NeedName[])
    .map(
      (n) =>
        `${NEED_LABELS[n].toLowerCase()} ${Math.round(s.needs[n])}/100${needWord(n, s.needs[n]) ? ` (${needWord(n, s.needs[n])})` : ''}`,
    )
    .join(', ');
  lines.push(
    `Your body: ${needs}; health ${Math.round(s.health)}/100.${p.sick ? ' You are ill.' : ''}`,
  );
  if (p.conditions?.length) {
    lines.push('');
    lines.push('Around you:');
    for (const c of p.conditions) lines.push(`- ${c}`);
  }
  const bag = Object.entries(s.inventory)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${ITEM_LABELS[k as keyof typeof ITEM_LABELS].toLowerCase()}`);
  lines.push(`You carry: ${bag.length ? bag.join(', ') : 'nothing'}. Money: ${s.money} coins.`);
  lines.push(
    `Your skills (0–100): ${Object.entries(s.skills)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`,
  );
  lines.push('');
  if (p.visibleAgents.length) {
    lines.push('People you can see:');
    for (const a of p.visibleAgents)
      lines.push(`- ${a.name} [${a.id}], ${a.distance} steps away, ${a.activity}`);
  } else {
    lines.push('Nobody else is in sight.');
  }
  lines.push('');
  if (p.knownPlaces.length) {
    lines.push('Places you know (nearest first):');
    // Home, one's own places and the village's landmarks always; then the nearest others.
    const vital = (k: (typeof p.knownPlaces)[number]) =>
      k.id === s.homeId ||
      k.owner === 'you' ||
      ['market', 'well', 'bakery', 'workshop', 'dock'].includes(k.kind);
    const places = [
      ...p.knownPlaces.filter(vital),
      ...p.knownPlaces.filter((k) => !vital(k)).slice(0, 20),
    ].sort((a, b) => a.distance - b.distance);
    for (const k of places) {
      const produce = k.produce ? ` (${ITEM_LABELS[k.produce].toLowerCase()})` : '';
      const amount =
        k.lastSeenAmount !== undefined ? `, last time you saw ${k.lastSeenAmount} to gather` : '';
      const owner = k.owner ? `, owned by ${k.owner}` : '';
      const burnt =
        (k.burnt ? ' (burnt down — needs rebuilding)' : '') +
        (k.progress !== undefined ? ` (unfinished, ${Math.round(k.progress * 100)}% done)` : '') +
        (k.unreachable ? " (you couldn't find a way there)" : '');
      const sale = k.forSale
        ? k.forSale.length
          ? `; for sale: ${k.forSale.map((f) => `${f.quantity} ${ITEM_LABELS[f.item].toLowerCase()} at ${f.price}`).join(', ')}`
          : '; nothing for sale'
        : '';
      const animals = k.animals ? `; ${k.animals.hens} hens, ${k.animals.sheep} sheep` : '';
      lines.push(
        `- ${k.name}${produce}${burnt} [${k.id}], ${k.distance} steps${amount}${owner}${sale}${animals}`,
      );
    }
  } else {
    lines.push('You do not know any places here yet.');
  }
  const inSight = (n: number, one: string) =>
    n === 1 ? `There is 1 ${one} within sight.` : `There are ${n} ${one}s within sight.`;
  if (p.treesNearby > 0) lines.push(inSight(p.treesNearby, 'tree'));
  if ((p.rocksNearby ?? 0) > 0) lines.push(inSight(p.rocksNearby!, 'rock'));
  if (p.marketPrices) {
    const d = p.clock.day - Math.floor(p.marketPrices.tick / 1440) - 1;
    const when = d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
    const list = Object.entries(p.marketPrices.prices)
      .map(([i, q]) => `${ITEM_LABELS[i as ItemName].toLowerCase()} buy ${q!.buy}/sell ${q!.sell}`)
      .join('; ');
    lines.push('');
    lines.push(
      `Market prices you saw ${when} (coins each; buy = what you pay, sell = what you get): ${list}.`,
    );
  }
  if (p.offers.length) {
    lines.push('');
    lines.push('Open trade offers:');
    for (const o of p.offers) {
      lines.push(
        o.toName === 'you'
          ? `- [${o.id}] ${o.fromName} offers you ${describeBundle(o.give)} for your ${describeBundle(o.ask)}.`
          : `- [${o.id}] you offered ${o.toName} ${describeBundle(o.give)} for ${describeBundle(o.ask)} (waiting).`,
      );
    }
  }
  const fam = p.family;
  if (fam.partner || fam.children.length || fam.parents.length || p.pregnant) {
    lines.push('');
    lines.push('Your family:');
    if (fam.partner) lines.push(`- Partner: ${fam.partner.name} [${fam.partner.id}]`);
    for (const par of fam.parents)
      lines.push(
        `- ${par.adoptive ? 'Adoptive parent' : 'Parent'}: ${par.name} [${par.id}]${par.alive ? '' : ' (dead)'}`,
      );
    for (const c of fam.children) {
      const needs = c.needs
        ? ` — right now: food ${Math.round(c.needs.food)}, water ${Math.round(c.needs.water)}${c.needs.food < 40 || c.needs.water < 40 ? ' (needs feeding!)' : ''}`
        : c.nearby
          ? ''
          : ' — not with you';
      lines.push(`- Child: ${c.name} [${c.id}], ${c.age < 1 ? 'a baby' : `age ${c.age}`}${needs}`);
    }
    if (p.pregnant) lines.push('- You are with child.');
  }
  if (p.requests.length) {
    lines.push('');
    for (const r of p.requests) {
      lines.push(
        r.kind === 'proposal'
          ? `${r.fromName} [${r.fromId}] has asked you to be their partner and is waiting for your answer.`
          : r.kind === 'adoption'
            ? `${r.fromName} [${r.fromId}] has offered to adopt you and is waiting for your answer.`
            : r.kind === 'job'
              ? `${r.fromName} [${r.fromId}] has offered you work${r.terms ? ` (${r.terms.wage} coins a day for ${r.terms.days} days)` : ''} and is waiting for your answer.`
              : `${r.fromName} [${r.fromId}] has asked whether you would like to try for a child and is waiting for your answer.`,
      );
    }
  }
  if (p.jobs?.length) {
    lines.push('');
    lines.push('Work agreements:');
    for (const j of p.jobs)
      lines.push(
        j.role === 'employer'
          ? `- ${j.otherName} [${j.otherId}] works for you for ${j.wage} coins a day, until day ${j.untilDay}.`
          : `- You work for ${j.otherName} [${j.otherId}] for ${j.wage} coins a day, until day ${j.untilDay}.`,
      );
  }
  const v = p.village;
  if (v) {
    lines.push('');
    lines.push('The village:');
    if (v.leader) lines.push(`- Leader: ${v.leader.name} [${v.leader.id}]`);
    for (const r of v.rules) lines.push(`- Rule: ${r}`);
    if (v.treasury !== null)
      lines.push(
        `- The village purse held ${v.treasury} coins when you last read the notice board${v.taxPerDay ? `; every grown-up pays ${v.taxPerDay} coins a day into it` : ''}.`,
      );
    for (const m of v.meetings)
      lines.push(
        m.open
          ? `- A meeting about “${m.topic}” is under way at ${m.place} [${m.placeId}].`
          : `- A meeting about “${m.topic}” at ${m.place} [${m.placeId}] starts in about ${m.startsInMinutes} minutes.`,
      );
    for (const pr of v.proposals) {
      const extra =
        (pr.tax !== undefined ? ` (levy: ${pr.tax} coins a day)` : '') +
        (pr.leaderName ? ` (leader: ${pr.leaderName})` : '');
      lines.push(
        `- Proposal [${pr.id}] by ${pr.byName}: “${pr.text}”${extra}${pr.voted ? ' — you have voted' : ''}`,
      );
    }
  }
  if (p.knownPeople.length) {
    lines.push('');
    lines.push('People you know, and how you feel about them:');
    for (const k of p.knownPeople.slice(0, 16)) {
      const role = k.role ? `your ${k.role}; ` : '';
      lines.push(`- ${k.name} [${k.id}] — ${role}${feelingWords(k.affection, k.trust, k.romance)}`);
    }
  }
  if (p.language < 60 && p.stage !== 'infant')
    lines.push('', 'You only know a few words; keep what you say very short and simple.');
  lines.push(...lifeStoryLines(p));
  lines.push('');
  lines.push('What happened recently:');
  lines.push(...(p.recent.length ? p.recent.map((r) => `- ${r}`) : ['- Nothing much.']));
  if (p.memories.length) {
    lines.push('');
    lines.push('Memories that come to mind:');
    lines.push(...p.memories.map((m) => `- ${m}`));
  }
  if (p.remainingPlan.length) {
    lines.push('');
    lines.push(`You were planning to: ${p.remainingPlan.map((i) => i.type).join(', then ')}.`);
  }
  lines.push('');
  lines.push('What do you think, and what do you do next?');
  return lines.join('\n');
}
