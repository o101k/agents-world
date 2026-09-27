import {
  ITEM_LABELS,
  type Decision,
  type Intent,
  type ItemName,
  type Perception,
} from '@aw/shared';

const ITEMS = Object.keys(ITEM_LABELS) as ItemName[];
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
          item: { type: 'string', enum: ITEMS, description: 'For eat: which food.' },
          minutes: { type: 'integer', description: 'For rest: how long (1–600).' },
          message: { type: 'string', description: 'For talk_to: exactly what you say out loud.' },
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
  minutes?: unknown;
  message?: unknown;
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
