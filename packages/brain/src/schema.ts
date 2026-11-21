import {
  BUILDING_KINDS,
  CROP_ITEMS,
  ITEM_NAMES,
  RECIPE_NAMES,
  SKILL_NAMES,
  type SkillName,
  type Bundle,
  type BuildingKind,
  type CropItem,
  type Decision,
  type Intent,
  type ItemName,
  type Perception,
  type RecipeName,
} from '@aw/shared';

const ITEMS = ITEM_NAMES;
export const ACTIONS = [
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
  'propose_partnership',
  'respond_proposal',
  'end_partnership',
  'try_for_child',
  'respond_child_request',
  'name_child',
  'adopt_child',
  'respond_adoption',
  'declare_will',
  'build_house',
  'tend',
  'build',
  'clear_field',
  'sow',
  'quarry',
  'tend_animals',
  'stock_stall',
  'take_from_stall',
  'buy_from_stall',
  'hire',
  'respond_job',
  'end_job',
  'call_meeting',
  'propose_rule',
  'vote',
  'pay_from_treasury',
] as const;

/**
 * JSON Schema for the `decide` tool. Deliberately flat (one step shape with optional fields) so
 * small and local models can fill it in reliably; parseDecision() maps it to typed intents.
 */
export const DECIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    thought: {
      type: 'string',
      description:
        'Your private inner thoughts right now, in first person, 1–3 sentences, in character.',
    },
    goal: { type: 'string', description: 'What you are trying to do, in a few words.' },
    plan: {
      type: 'array',
      description: 'The next steps, in order (1–6 steps). They run one after another until done.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: [...ACTIONS] },
          target: {
            type: 'string',
            description:
              'Id of a place (e.g. "well-1", "berry_bush-12") or person (e.g. "a3"). Omit if not needed.',
          },
          item: {
            type: 'string',
            enum: ITEMS,
            description:
              'For eat / feed / buy / sell / give / steal / sow / stock_stall / take_from_stall / buy_from_stall: which item.',
          },
          quantity: {
            type: 'integer',
            description:
              'For buy / sell / give / stock_stall / take_from_stall / buy_from_stall: how many.',
          },
          coins: {
            type: 'integer',
            description: 'For give / pay_from_treasury: coins to hand over.',
          },
          minutes: { type: 'integer', description: 'For rest: how long (1–600).' },
          message: {
            type: 'string',
            description:
              'For talk_to: exactly what you say out loud. For call_meeting: what the meeting is about. For propose_rule: the rule you propose.',
          },
          building: {
            type: 'string',
            enum: BUILDING_KINDS,
            description: 'For build: what to build.',
          },
          price: {
            type: 'integer',
            description: 'For stock_stall: your asking price, coins each.',
          },
          wage: { type: 'integer', description: 'For hire: coins a day you will pay.' },
          days: { type: 'integer', description: 'For hire: for how many days (1–30).' },
          tax: {
            type: 'integer',
            description:
              'For propose_rule: a daily levy each grown-up pays into the village purse (0 ends any levy). Omit for other rules.',
          },
          leader: {
            type: 'string',
            description: 'For propose_rule: person id to elect village leader. Omit otherwise.',
          },
          proposal_id: { type: 'string', description: 'For vote: which proposal.' },
          recipe: { type: 'string', enum: RECIPE_NAMES, description: 'For craft.' },
          give_item: {
            type: 'string',
            enum: ITEMS,
            description: 'For offer_trade: item you give.',
          },
          give_quantity: { type: 'integer' },
          give_coins: { type: 'integer' },
          ask_item: { type: 'string', enum: ITEMS, description: 'For offer_trade: item you want.' },
          ask_quantity: { type: 'integer' },
          ask_coins: { type: 'integer' },
          offer_id: { type: 'string', description: 'For respond_offer.' },
          accept: {
            type: 'boolean',
            description:
              'For respond_offer / respond_proposal / respond_child_request / respond_adoption / respond_job / vote (true = yes).',
          },
          skill: { type: 'string', enum: [...SKILL_NAMES], description: 'For teach.' },
          name: { type: 'string', description: 'For name_child: the first name you give.' },
        },
        required: ['action'],
      },
    },
    feelings: {
      type: 'array',
      description: 'Optional: how your feelings toward people changed just now (each −3…3).',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', description: 'Person id.' },
          affection: { type: 'integer' },
          trust: { type: 'integer' },
          romance: { type: 'integer' },
        },
        required: ['target'],
      },
    },
    remember: {
      type: 'object',
      additionalProperties: false,
      description:
        'Optional: something you want to remember for later, and how important it is (1–10).',
      properties: { text: { type: 'string' }, importance: { type: 'integer' } },
      required: ['text', 'importance'],
    },
    diary: {
      type: 'string',
      description:
        'Only when asked to reflect at night: your diary entry (first person, in your own voice).',
    },
    beliefs: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Only when reflecting: up to 3 short things you now believe (about people, the village, life).',
    },
  },
  required: ['thought', 'goal', 'plan'],
} as const;

export const DECIDE_DESCRIPTION =
  'Decide what you think and do next. Always call this tool exactly once with your thoughts and plan.';

interface RawStep {
  action?: unknown;
  target?: unknown;
  item?: unknown;
  quantity?: unknown;
  coins?: unknown;
  minutes?: unknown;
  message?: unknown;
  recipe?: unknown;
  give_item?: unknown;
  give_quantity?: unknown;
  give_coins?: unknown;
  ask_item?: unknown;
  ask_quantity?: unknown;
  ask_coins?: unknown;
  offer_id?: unknown;
  accept?: unknown;
  skill?: unknown;
  name?: unknown;
  building?: unknown;
  price?: unknown;
  wage?: unknown;
  days?: unknown;
  tax?: unknown;
  leader?: unknown;
  proposal_id?: unknown;
}

const asItem = (v: unknown): ItemName | undefined =>
  typeof v === 'string' && (ITEMS as string[]).includes(v) ? (v as ItemName) : undefined;
const asCount = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
};
const asCoins = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 0;
};
const asDelta = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-3, Math.min(3, n)) : 0;
};
function bundle(item: unknown, quantity: unknown, coins: unknown): Bundle {
  const b: Bundle = {};
  const i = asItem(item);
  const q = asCount(quantity) || (i ? 1 : 0);
  if (i && q) {
    b.item = i;
    b.quantity = q;
  }
  const c = asCoins(coins);
  if (c) b.coins = c;
  return b;
}

/** Map the model's raw tool input to a Decision. Unusable steps are dropped, never guessed. */
export function parseDecision(raw: unknown, perception: Perception): Decision {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const thought = typeof obj.thought === 'string' ? obj.thought.slice(0, 2000) : '';
  const goal = typeof obj.goal === 'string' ? obj.goal.slice(0, 300) : '';
  const steps = Array.isArray(obj.plan) ? (obj.plan as RawStep[]).slice(0, 8) : [];
  const plan: Intent[] = [];
  const people = new Map(perception.visibleAgents.map((a) => [a.id, a]));
  for (const step of steps) {
    const action = typeof step?.action === 'string' ? step.action : '';
    const target = typeof step?.target === 'string' ? step.target.trim() : '';
    switch (action) {
      case 'go_to': {
        const m = /^\(?\s*(\d+)\s*,\s*(\d+)\s*\)?$/.exec(target);
        const person = people.get(target);
        if (m) plan.push({ type: 'go_to', target: { x: Number(m[1]), y: Number(m[2]) } });
        else if (person) plan.push({ type: 'go_to', target: { x: person.x, y: person.y } });
        else if (target) plan.push({ type: 'go_to', target: { objectId: target } });
        break;
      }
      case 'gather':
        if (target) plan.push({ type: 'gather', objectId: target });
        break;
      case 'eat':
        if (typeof step.item === 'string' && (ITEMS as string[]).includes(step.item)) {
          plan.push({ type: 'eat', item: step.item as ItemName });
        }
        break;
      case 'drink':
        plan.push(target ? { type: 'drink', sourceId: target } : { type: 'drink' });
        break;
      case 'sleep':
        plan.push({ type: 'sleep' });
        break;
      case 'rest': {
        const minutes = Math.round(Number(step.minutes) || 30);
        plan.push({ type: 'rest', minutes: Math.min(600, Math.max(1, minutes)) });
        break;
      }
      case 'explore':
        plan.push({ type: 'explore' });
        break;
      case 'talk_to':
        if (target && typeof step.message === 'string' && step.message.trim()) {
          plan.push({
            type: 'talk_to',
            agentId: target,
            message: step.message.trim().slice(0, 600),
          });
        }
        break;
      case 'chop_wood':
        plan.push(target ? { type: 'chop_wood', objectId: target } : { type: 'chop_wood' });
        break;
      case 'craft':
        if (typeof step.recipe === 'string' && (RECIPE_NAMES as string[]).includes(step.recipe)) {
          plan.push({ type: 'craft', recipe: step.recipe as RecipeName });
        }
        break;
      case 'buy':
      case 'sell': {
        const item = asItem(step.item);
        const quantity = asCount(step.quantity) || 1;
        if (item)
          plan.push(
            action === 'buy' ? { type: 'buy', item, quantity } : { type: 'sell', item, quantity },
          );
        break;
      }
      case 'give': {
        const gift = bundle(step.item, step.quantity, step.coins);
        if (target && (gift.item || gift.coins)) plan.push({ type: 'give', agentId: target, gift });
        break;
      }
      case 'offer_trade': {
        const give = bundle(step.give_item, step.give_quantity, step.give_coins);
        const ask = bundle(step.ask_item, step.ask_quantity, step.ask_coins);
        if (target && (give.item || give.coins || ask.item || ask.coins)) {
          plan.push({ type: 'offer_trade', agentId: target, give, ask });
        }
        break;
      }
      case 'respond_offer': {
        const offerId =
          typeof step.offer_id === 'string' && step.offer_id.trim() ? step.offer_id.trim() : target;
        if (offerId)
          plan.push({
            type: 'respond_offer',
            offerId,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      }
      case 'steal': {
        const item = asItem(step.item);
        if (target)
          plan.push(
            item ? { type: 'steal', agentId: target, item } : { type: 'steal', agentId: target },
          );
        break;
      }
      case 'attack':
        if (target) plan.push({ type: 'attack', agentId: target });
        break;
      case 'feed': {
        const item = asItem(step.item);
        if (target && item) plan.push({ type: 'feed', agentId: target, item });
        break;
      }
      case 'teach':
        if (
          target &&
          typeof step.skill === 'string' &&
          (SKILL_NAMES as string[]).includes(step.skill)
        ) {
          plan.push({ type: 'teach', agentId: target, skill: step.skill as SkillName });
        }
        break;
      case 'propose_partnership':
        if (target) plan.push({ type: 'propose_partnership', agentId: target });
        break;
      case 'respond_proposal':
        if (target)
          plan.push({
            type: 'respond_proposal',
            fromId: target,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      case 'end_partnership':
        plan.push({ type: 'end_partnership' });
        break;
      case 'try_for_child':
        if (target) plan.push({ type: 'try_for_child', agentId: target });
        break;
      case 'respond_child_request':
        if (target)
          plan.push({
            type: 'respond_child_request',
            fromId: target,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      case 'name_child':
        if (target && typeof step.name === 'string' && step.name.trim()) {
          plan.push({ type: 'name_child', childId: target, name: step.name.trim().slice(0, 40) });
        }
        break;
      case 'adopt_child':
        if (target) plan.push({ type: 'adopt_child', childId: target });
        break;
      case 'respond_adoption':
        if (target)
          plan.push({
            type: 'respond_adoption',
            fromId: target,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      case 'declare_will':
        if (target) plan.push({ type: 'declare_will', agentId: target });
        break;
      case 'build_house':
        plan.push({ type: 'build_house' });
        break;
      case 'tend':
        if (target) plan.push({ type: 'tend', agentId: target });
        break;
      case 'build':
        if (
          typeof step.building === 'string' &&
          (BUILDING_KINDS as string[]).includes(step.building)
        )
          plan.push({ type: 'build', building: step.building as BuildingKind });
        break;
      case 'clear_field':
        plan.push({ type: 'clear_field' });
        break;
      case 'sow': {
        const crop = asItem(step.item);
        if (crop && (CROP_ITEMS as readonly string[]).includes(crop))
          plan.push(
            target
              ? { type: 'sow', item: crop as CropItem, objectId: target }
              : { type: 'sow', item: crop as CropItem },
          );
        break;
      }
      case 'quarry':
        plan.push(target ? { type: 'quarry', objectId: target } : { type: 'quarry' });
        break;
      case 'tend_animals':
        plan.push(target ? { type: 'tend_animals', objectId: target } : { type: 'tend_animals' });
        break;
      case 'stock_stall': {
        const item = asItem(step.item);
        const price = asCount(step.price);
        if (item && price)
          plan.push({ type: 'stock_stall', item, quantity: asCount(step.quantity) || 1, price });
        break;
      }
      case 'take_from_stall': {
        const item = asItem(step.item);
        if (item)
          plan.push({ type: 'take_from_stall', item, quantity: asCount(step.quantity) || 1 });
        break;
      }
      case 'buy_from_stall': {
        const item = asItem(step.item);
        if (target && item)
          plan.push({
            type: 'buy_from_stall',
            objectId: target,
            item,
            quantity: asCount(step.quantity) || 1,
          });
        break;
      }
      case 'hire': {
        const wage = asCount(step.wage);
        if (target && wage)
          plan.push({
            type: 'hire',
            agentId: target,
            wage,
            days: Math.min(30, asCount(step.days) || 3),
          });
        break;
      }
      case 'respond_job':
        if (target)
          plan.push({
            type: 'respond_job',
            fromId: target,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      case 'end_job':
        if (target) plan.push({ type: 'end_job', agentId: target });
        break;
      case 'call_meeting':
        if (typeof step.message === 'string' && step.message.trim())
          plan.push({ type: 'call_meeting', topic: step.message.trim().slice(0, 200) });
        break;
      case 'propose_rule':
        if (typeof step.message === 'string' && step.message.trim()) {
          const rule: Extract<Intent, { type: 'propose_rule' }> = {
            type: 'propose_rule',
            text: step.message.trim().slice(0, 300),
          };
          const tax = Math.floor(Number(step.tax));
          if (step.tax !== undefined && step.tax !== null && Number.isFinite(tax))
            rule.tax = Math.min(100, Math.max(0, tax));
          if (typeof step.leader === 'string' && step.leader.trim())
            rule.leaderId = step.leader.trim();
          plan.push(rule);
        }
        break;
      case 'vote': {
        const proposalId =
          typeof step.proposal_id === 'string' && step.proposal_id.trim()
            ? step.proposal_id.trim()
            : target;
        if (proposalId)
          plan.push({
            type: 'vote',
            proposalId,
            accept: step.accept === true || step.accept === 'true',
          });
        break;
      }
      case 'pay_from_treasury': {
        const coins = asCoins(step.coins);
        if (target && coins) plan.push({ type: 'pay_from_treasury', agentId: target, coins });
        break;
      }
    }
  }
  const reflecting = perception.trigger.kind === 'reflect';
  if (reflecting)
    plan.length = 0; // a night's reflection changes the mind, not the body
  else if (plan.length === 0) plan.push({ type: 'rest', minutes: 20 });
  const decision: Decision = { thought, goal, plan };
  if (typeof obj.diary === 'string' && obj.diary.trim())
    decision.diary = obj.diary.trim().slice(0, 1500);
  if (Array.isArray(obj.beliefs)) {
    const beliefs = (obj.beliefs as unknown[])
      .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
      .slice(0, 3)
      .map((b) => b.trim().slice(0, 300));
    if (beliefs.length) decision.beliefs = beliefs;
  }
  if (Array.isArray(obj.feelings)) {
    const feelings = (obj.feelings as Record<string, unknown>[])
      .filter((f) => f && typeof f.target === 'string' && f.target.trim().length > 0)
      .slice(0, 10)
      .map((f) => ({
        agentId: String(f.target).trim(),
        affection: asDelta(f.affection),
        trust: asDelta(f.trust),
        romance: asDelta(f.romance),
      }));
    if (feelings.length) decision.feelings = feelings;
  }
  const r = obj.remember as { text?: unknown; importance?: unknown } | undefined;
  if (r && typeof r.text === 'string' && r.text.trim()) {
    const imp = Number(r.importance);
    decision.remember = {
      text: r.text.trim().slice(0, 500),
      importance: Number.isFinite(imp) ? Math.min(10, Math.max(1, imp)) : 3,
    };
  }
  return decision;
}

function tryParseObject(s: string): unknown {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Pull a JSON object out of free text (for models that answer in text instead of calling the tool). */
export function extractJson(text: string): unknown {
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryParseObject(m[1]!.trim());
    if (parsed) return parsed;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    if (text.indexOf('}', i) < 0) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j]!;
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const parsed = tryParseObject(text.slice(i, j + 1));
          if (parsed) return parsed;
          break;
        }
      }
    }
  }
  return null;
}
