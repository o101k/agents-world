import {
  ITEM_NAMES,
  RECIPE_NAMES,
  type Bundle,
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
            description: 'For eat / buy / sell / give / steal: which item.',
          },
          quantity: { type: 'integer', description: 'For buy / sell / give: how many.' },
          coins: { type: 'integer', description: 'For give: coins to hand over.' },
          minutes: { type: 'integer', description: 'For rest: how long (1–600).' },
          message: { type: 'string', description: 'For talk_to: exactly what you say out loud.' },
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
          accept: { type: 'boolean', description: 'For respond_offer.' },
        },
        required: ['action'],
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
}

const asItem = (v: unknown): ItemName | undefined =>
  typeof v === 'string' && (ITEMS as string[]).includes(v) ? (v as ItemName) : undefined;
const asCount = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0;
};
function bundle(item: unknown, quantity: unknown, coins: unknown): Bundle {
  const b: Bundle = {};
  const i = asItem(item);
  const q = asCount(quantity) || (i ? 1 : 0);
  if (i && q) {
    b.item = i;
    b.quantity = q;
  }
  const c = asCount(coins);
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
        if (item) plan.push({ type: action, item, quantity: asCount(step.quantity) || 1 });
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
    }
  }
  if (plan.length === 0) plan.push({ type: 'rest', minutes: 20 });
  const decision: Decision = { thought, goal, plan };
  const r = obj.remember as { text?: unknown; importance?: unknown } | undefined;
  if (r && typeof r.text === 'string' && r.text.trim()) {
    decision.remember = {
      text: r.text.trim().slice(0, 500),
      importance: Math.min(10, Math.max(1, Number(r.importance) || 3)),
    };
  }
  return decision;
}

/** Pull a JSON object out of free text (for models that answer in text instead of calling the tool). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
