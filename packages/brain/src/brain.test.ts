import { describe, expect, it } from 'vitest';
import type { DecisionRequest, Perception } from '@aw/shared';
import { AnthropicProvider } from './anthropic.ts';
import { mockDecide } from './mock.ts';
import { OpenAIProvider } from './openai.ts';
import { DEFAULT_PRICES, costOf } from './pricing.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { BrainRouter, instinctApplies } from './router.ts';
import { IntentSchema } from '@aw/shared';
import { ACTIONS, parseDecision } from './schema.ts';

function perception(over: Partial<Perception> = {}): Perception {
  return {
    agentId: 'a1',
    tick: 600,
    clock: { day: 1, hour: 10, minute: 0, isNight: false },
    trigger: { kind: 'plan_done' },
    self: {
      name: 'Maren Holt',
      age: 34,
      sex: 'female',
      occupation: 'farmer',
      traits: 'Practical.',
      background: 'Grew up here.',
      needs: { food: 80, water: 80, energy: 80, warmth: 100 },
      health: 100,
      inventory: { bread: 1 },
      money: 10,
      position: { x: 5, y: 5 },
      homeId: 'house-1',
      asleep: false,
      indoors: false,
    },
    location: 'near Village well',
    visibleAgents: [
      { id: 'a2', name: 'Tobias Holt', x: 6, y: 5, distance: 1, activity: 'walking' },
    ],
    knownPlaces: [
      {
        id: 'well-1',
        kind: 'well',
        name: 'Village well',
        x: 5,
        y: 4,
        distance: 1,
        lastSeenTick: 500,
      },
      { id: 'house-1', kind: 'house', name: 'House 1', x: 1, y: 1, distance: 4, lastSeenTick: 500 },
      {
        id: 'berry_bush-3',
        kind: 'berry_bush',
        name: 'Berry bush',
        x: 9,
        y: 9,
        distance: 4,
        lastSeenAmount: 3,
        lastSeenTick: 500,
      },
    ],
    recent: ['[Day 1 09:00] I drank water.'],
    memories: ['[Day 1 07:00] Tobias said to me: “Morning!”'],
    knownPeople: [
      {
        id: 'a2',
        name: 'Tobias Holt',
        familiarity: 90,
        affection: 70,
        trust: 60,
        romance: 60,
        role: 'partner',
        lastSeenTick: 590,
      },
    ],
    personality: {
      openness: 45,
      conscientiousness: 82,
      extraversion: 35,
      agreeableness: 60,
      neuroticism: 40,
    },
    effort: 'frugal',
    remainingPlan: [],
    marketPrices: null,
    offers: [],
    treesNearby: 3,
    stage: 'adult',
    canDo: [
      'go_to',
      'gather',
      'eat',
      'drink',
      'sleep',
      'rest',
      'explore',
      'talk_to',
      'feed',
      'name_child',
    ],
    family: { partner: { id: 'a2', name: 'Tobias Holt' }, children: [], parents: [] },
    pregnant: false,
    language: 100,
    requests: [],
    ...over,
  };
}

const request = (p: Perception): DecisionRequest => ({
  agentId: p.agentId,
  tick: p.tick,
  perception: p,
});

describe('prompts', () => {
  it('describes only what the agent perceives', () => {
    const p = perception();
    const sys = systemPrompt(p);
    const user = userPrompt(p);
    expect(sys).toContain('You are Maren Holt');
    expect(sys).toContain('disciplined');
    expect(user).toContain('Tobias Holt [a2]');
    expect(user).toContain('Village well [well-1]');
    expect(user).toContain('last time you saw 3 to gather');
    expect(user).toContain('Memories that come to mind');
  });

  it('explains being spoken to', () => {
    const p = perception({
      trigger: {
        kind: 'spoken_to',
        fromId: 'a2',
        fromName: 'Tobias Holt',
        message: 'Fancy a fish?',
      },
    });
    expect(userPrompt(p)).toContain('Tobias Holt (a2) just said to you: “Fancy a fish?”');
  });
});

describe('decide tool schema', () => {
  it('offers every action the simulation understands', () => {
    const simActions = IntentSchema.options.map((o) => o.shape.type.value).sort();
    expect([...ACTIONS].sort()).toEqual(simActions);
  });
});

describe('parseDecision', () => {
  it('maps flat steps to intents and drops junk', () => {
    const d = parseDecision(
      {
        thought: 'Hungry.',
        goal: 'Eat',
        plan: [
          { action: 'gather', target: 'berry_bush-3' },
          { action: 'eat', item: 'berries' },
          { action: 'eat', item: 'cake' },
          { action: 'go_to', target: '12, 7' },
          { action: 'go_to', target: 'a2' },
          { action: 'talk_to', target: 'a2', message: 'Hello!' },
          { action: 'fly' },
          { action: 'rest', minutes: 9999 },
        ],
        remember: { text: 'Bush by the river has berries', importance: 4 },
      },
      perception(),
    );
    expect(d.plan).toEqual([
      { type: 'gather', objectId: 'berry_bush-3' },
      { type: 'eat', item: 'berries' },
      { type: 'go_to', target: { x: 12, y: 7 } },
      { type: 'go_to', target: { x: 6, y: 5 } },
      { type: 'talk_to', agentId: 'a2', message: 'Hello!' },
      { type: 'rest', minutes: 600 },
    ]);
    expect(d.remember).toEqual({ text: 'Bush by the river has berries', importance: 4 });
  });

  it('maps economy and conflict actions', () => {
    const d = parseDecision(
      {
        thought: '',
        goal: '',
        plan: [
          { action: 'chop_wood' },
          { action: 'craft', recipe: 'planks' },
          { action: 'buy', item: 'bread', quantity: 2 },
          { action: 'sell', item: 'wood' },
          { action: 'give', target: 'a2', coins: 5 },
          {
            action: 'offer_trade',
            target: 'a2',
            give_item: 'fish',
            give_quantity: 2,
            ask_coins: 10,
          },
          { action: 'respond_offer', offer_id: 'o3', accept: true },
          { action: 'steal', target: 'a2' },
        ],
      },
      perception(),
    );
    expect(d.plan).toEqual([
      { type: 'chop_wood' },
      { type: 'craft', recipe: 'planks' },
      { type: 'buy', item: 'bread', quantity: 2 },
      { type: 'sell', item: 'wood', quantity: 1 },
      { type: 'give', agentId: 'a2', gift: { coins: 5 } },
      {
        type: 'offer_trade',
        agentId: 'a2',
        give: { item: 'fish', quantity: 2 },
        ask: { coins: 10 },
      },
      { type: 'respond_offer', offerId: 'o3', accept: true },
      { type: 'steal', agentId: 'a2' },
    ]);
    const d2 = parseDecision(
      {
        plan: [
          { action: 'attack', target: 'a2' },
          { action: 'craft', recipe: 'cake' },
        ],
      },
      perception(),
    );
    expect(d2.plan).toEqual([{ type: 'attack', agentId: 'a2' }]);
  });

  it('never returns an empty plan', () => {
    expect(parseDecision({ thought: 'hmm' }, perception()).plan).toEqual([
      { type: 'rest', minutes: 20 },
    ]);
  });
});

describe('instinct and routing', () => {
  it('handles routine needs for frugal agents without an AI call', async () => {
    const p = perception({
      trigger: { kind: 'urgent_need', need: 'water' },
      self: { ...perception().self, needs: { food: 80, water: 15, energy: 80, warmth: 100 } },
    });
    expect(instinctApplies(p)).toBe(true);
    expect(instinctApplies({ ...p, effort: 'standard' })).toBe(false);
    const router = new BrainRouter();
    const r = await router.decide(request(p), {
      provider: 'anthropic',
      model: '',
      effort: 'frugal',
    });
    expect(r.instinct).toBe(true);
    expect(r.result?.decision.plan[0]?.type).toBe('drink');
  });

  it('falls back to the mock brain when a provider is not configured', async () => {
    const r = await new BrainRouter().decide(request(perception()), {
      provider: 'openai',
      model: 'x',
      effort: 'standard',
    });
    expect(r.fallback).toBe(true);
    expect(r.result?.decision.plan.length).toBeGreaterThan(0);
  });

  it('turns provider errors into a short hesitation, never a stall', async () => {
    const failing = {
      id: 'anthropic' as const,
      decide: async () => Promise.reject(new Error('boom')),
    };
    const r = await new BrainRouter([failing]).decide(request(perception()), {
      provider: 'anthropic',
      model: 'm',
      effort: 'standard',
    });
    expect(r.error).toContain('boom');
    expect(r.result?.decision.plan).toEqual([{ type: 'rest', minutes: 15 }]);
  });

  it('mock brain replies when spoken to', () => {
    const d = mockDecide(
      perception({
        trigger: {
          kind: 'spoken_to',
          fromId: 'a2',
          fromName: 'Tobias Holt',
          message: 'How are you?',
        },
      }),
    );
    expect(d.plan[0]).toMatchObject({ type: 'talk_to', agentId: 'a2' });
  });
});

describe('pricing', () => {
  it('prices known models and flags unknown ones as estimates', () => {
    const known = costOf('claude-haiku-4-5', { input: 1_000_000, output: 100_000 }, DEFAULT_PRICES);
    expect(known.costUsd).toBeCloseTo(1 + 0.5);
    expect(known.estimated).toBe(false);
    expect(costOf('mystery-model', { input: 1000, output: 0 }, DEFAULT_PRICES).estimated).toBe(
      true,
    );
  });
});

describe('providers (fake HTTP)', () => {
  it('Anthropic: sends a cached system prompt, auto tool choice, and parses the decide call', async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'decide',
              input: {
                thought: 'Water first.',
                goal: 'Drink',
                plan: [{ action: 'drink', target: 'well-1' }],
              },
            },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const provider = new AnthropicProvider('test-key', 'claude-haiku-4-5', () => DEFAULT_PRICES, {
      fetch: fakeFetch,
    });
    const r = await provider.decide(request(perception()), {
      provider: 'anthropic',
      model: '',
      effort: 'frugal',
    });
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.output_config).toBeUndefined(); // Haiku 4.5 doesn't take effort
    expect((body.system as { cache_control?: unknown }[])[0]?.cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(r.decision.plan).toEqual([{ type: 'drink', sourceId: 'well-1' }]);
    expect(r.usage?.costUsd).toBeCloseTo((1000 * 1 + 100 * 5) / 1e6);

    await provider.decide(request(perception()), {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      effort: 'deep',
    });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('OpenAI-compatible: calls the decide function and parses arguments', async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 0,
          model: 'local-model',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'x',
                    type: 'function',
                    function: {
                      name: 'decide',
                      arguments: JSON.stringify({
                        thought: 'Nap.',
                        goal: 'Rest',
                        plan: [{ action: 'sleep' }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const provider = new OpenAIProvider(
      'openai_compatible',
      '',
      'http://localhost:11434/v1',
      'local-model',
      () => DEFAULT_PRICES,
      { fetch: fakeFetch },
    );
    const r = await provider.decide(request(perception()), {
      provider: 'openai_compatible',
      model: '',
      effort: 'standard',
    });
    expect(body.max_tokens).toBe(3000);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'decide' } });
    expect(r.decision.plan).toEqual([{ type: 'sleep' }]);
    expect(r.usage?.estimated).toBe(true);
  });
});
