import type {
  BrainConfig,
  Decision,
  DecisionRequest,
  Intent,
  ItemName,
  KnownPlace,
  Perception,
} from '@aw/shared';
import type { BrainProvider, BrainResult } from './types.ts';

const NUTRITION: Record<ItemName, number> = { bread: 30, fish: 25, vegetables: 18, berries: 8 };

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

  const known = (kinds: string[]) => p.knownPlaces.filter((k) => kinds.includes(k.kind));
  const home = p.self.homeId ? p.knownPlaces.find((k) => k.id === p.self.homeId) : undefined;
  const foodInBag = (Object.keys(NUTRITION) as ItemName[])
    .filter((i) => (inventory[i] ?? 0) > 0)
    .sort((a, b) => NUTRITION[b] - NUTRITION[a]);
  const foodUnits = foodInBag.reduce((s, i) => s + (inventory[i] ?? 0), 0);
  const foodSources = (): KnownPlace[] => {
    const sources = known(['berry_bush', 'field']).filter((k) => (k.lastSeenAmount ?? 1) >= 1);
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

  // Thirst first: it kills fastest.
  if (needs.water < 45) {
    const source = known(['well', 'dock']).sort((a, b) => a.distance - b.distance)[0];
    const riverCloser = !source || source.distance > 15;
    plan.push(riverCloser ? { type: 'drink' } : { type: 'drink', sourceId: source.id });
    thoughts.push(needs.water < 20 ? "I'm parched — I need water now." : "I'm thirsty.");
    goal = 'Get a drink';
  }

  // Hunger.
  if (needs.food < 50) {
    if (foodInBag.length > 0) {
      plan.push({ type: 'eat', item: foodInBag[0]! });
      thoughts.push(`Time to eat some ${foodInBag[0]}.`);
      goal ||= 'Eat something';
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

  // Daytime: stock up on food, otherwise wander or rest.
  if (foodUnits < 4 && gatherPlan()) {
    return {
      thought: `My food stores are low. ${thoughts.join(' ')}`,
      goal: 'Stock up on food',
      plan,
    };
  }
  if (roll < 0.35) {
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

export class MockBrain implements BrainProvider {
  readonly id = 'mock' as const;

  async decide(request: DecisionRequest, _config: BrainConfig): Promise<BrainResult> {
    return {
      decision: mockDecide(request.perception),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }
}
