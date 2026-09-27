import {
  NEED_LABELS,
  ITEM_LABELS,
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
export function systemPrompt(p: Perception): string {
  const s = p.self;
  return [
    `You are ${s.name}, a ${s.age}-year-old ${s.sex === 'female' ? 'woman' : 'man'} living in a small pre-industrial village. Your occupation: ${s.occupation}.`,
    s.traits ? `Your nature: ${s.traits}` : '',
    `Your temperament: ${describePersonality(p.personality)}.`,
    s.background ? `Your story: ${s.background}` : '',
    '',
    'You are a real person living your life, not an assistant and not a narrator. Think and act as yourself, with your own wants, fears, habits and relationships. Nobody is watching you. You only know what you have seen, done, or been told — never invent knowledge of places or people you have not encountered.',
    '',
    'How life works here:',
    '- Time passes minute by minute. You need food, water, sleep and warmth. If any runs out your health fails, and you can die.',
    '- Food: berries from bushes (they regrow slowly), vegetables from fields, fish at the fishing dock (you do not always catch one). Gathered food goes into your bag; eat it with the eat action.',
    '- Water: drink at the well or at the river.',
    '- Sleep at night. Sleeping at home is warmer and more restful than sleeping outside, and nights outdoors are cold.',
    '- You can talk to anyone within a few steps (talk_to). They may answer. People nearby can overhear.',
    '',
    'Actions for your plan (steps run in order):',
    '- go_to {target: place id or person id}',
    '- gather {target: berry bush, field or fishing dock id}',
    '- eat {item: berries | vegetables | fish | bread}',
    '- drink {target: well or dock id, or omit to find the nearest water}',
    '- sleep',
    '- rest {minutes}',
    '- explore (wander somewhere new)',
    '- talk_to {target: person id, message: what you say out loud}',
    '',
    'Answer by calling the decide tool once. Plan the next few hours in 2–6 concrete steps (include rests if you want to idle); you will decide again when the plan is done or something happens, such as someone speaking to you.',
  ]
    .filter((l) => l !== null)
    .join('\n');
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
    case 'check_in':
      return 'A few hours have passed. Take stock of your situation.';
  }
}

/** The per-decision message: everything the agent senses, knows and remembers right now. */
export function userPrompt(p: Perception): string {
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
  lines.push(`Your body: ${needs}; health ${Math.round(s.health)}/100.`);
  const bag = Object.entries(s.inventory)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${ITEM_LABELS[k as keyof typeof ITEM_LABELS].toLowerCase()}`);
  lines.push(
    `You carry: ${bag.length ? bag.join(', ') : 'nothing to eat'}. Money: ${s.money} coins.`,
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
    for (const k of p.knownPlaces.slice(0, 24)) {
      const amount =
        k.lastSeenAmount !== undefined ? `, last time you saw ${k.lastSeenAmount} to gather` : '';
      lines.push(`- ${k.name} [${k.id}], ${k.distance} steps${amount}`);
    }
  } else {
    lines.push('You do not know any places here yet.');
  }
  if (p.knownPeople.length) {
    lines.push('');
    lines.push(`People you know: ${p.knownPeople.map((k) => `${k.name} [${k.id}]`).join(', ')}.`);
  }
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
