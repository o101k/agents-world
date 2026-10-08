import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DecisionRequest, Perception } from '@aw/shared';
import { AnthropicProvider } from './anthropic.ts';
import {
  checkClaudeCli,
  ClaudePlanProvider,
  findClaudeCli,
  parseResetTime,
  planUsage,
} from './claudeCli.ts';
import { mockDecide } from './mock.ts';
import { toRateLimitError } from './limits.ts';
import { OpenAIProvider } from './openai.ts';
import { DEFAULT_PRICES, costOf } from './pricing.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { BrainRouter, PrioritySemaphore, instinctApplies, priorityOf } from './router.ts';
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
      skills: {
        foraging: 20,
        fishing: 10,
        farming: 32,
        cooking: 5,
        building: 8,
        trading: 0,
        caregiving: 0,
        language: 40,
      },
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
      {
        id: 'house-1',
        kind: 'house',
        name: 'House 1',
        x: 1,
        y: 1,
        distance: 4,
        owner: 'you',
        lastSeenTick: 500,
      },
      {
        id: 'field-1',
        kind: 'field',
        name: 'Field 1',
        x: 3,
        y: 9,
        distance: 5,
        produce: 'wheat',
        lastSeenAmount: 12,
        lastSeenTick: 500,
      },
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
    conditions: [],
    sick: false,
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
    expect(user).toContain('House 1 [house-1], 4 steps, owned by you');
    expect(user).toContain('Field 1 (wheat) [field-1]');
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

  it('serves queued requests by priority: conversation replies first, reflection last', async () => {
    const sem = new PrioritySemaphore(1);
    const order: string[] = [];
    let release!: () => void;
    const first = sem.run(() => new Promise<void>((r) => (release = r)));
    const queued = (
      [
        ['check_in', priorityOf({ kind: 'check_in' })],
        ['reflect', priorityOf({ kind: 'reflect', scope: 'day' })],
        ['reply', priorityOf({ kind: 'spoken_to', fromId: 'a2', fromName: 'T', message: 'hi' })],
        ['hungry', priorityOf({ kind: 'urgent_need', need: 'food' })],
      ] as const
    ).map(([name, prio]) => sem.run(async () => void order.push(name), prio));
    expect(sem.waiting).toBe(4);
    release();
    await Promise.all([first, ...queued]);
    expect(order).toEqual(['reply', 'hungry', 'check_in', 'reflect']);
  });

  it('never sends a request that timed out while waiting in the queue', async () => {
    let calls = 0;
    const slow = {
      id: 'openai_compatible' as const,
      decide: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 120));
        return { decision: { thought: '', goal: '', plan: [] } };
      },
    };
    const router = new BrainRouter([slow]);
    const config = {
      provider: 'openai_compatible' as const,
      model: 'm',
      effort: 'standard' as const,
    };
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => router.decide(request(perception()), config, 40)),
    );
    expect(results.every((r) => r.timedOut)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(2); // the provider's concurrency; the queued two were dropped
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

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const anthropicReply = (stop_reason: string) =>
    (async () =>
      json({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        stop_reason,
        content: [{ type: 'text', text: 'I would rather not say.' }],
        usage: { input_tokens: 4000, output_tokens: 300 },
      })) as unknown as typeof fetch;

  it('Anthropic: a reply with no decision is still counted and paid for', async () => {
    const provider = new AnthropicProvider('k', 'claude-haiku-4-5', () => DEFAULT_PRICES, {
      fetch: anthropicReply('end_turn'),
    });
    const r = await new BrainRouter([provider]).decide(request(perception()), {
      provider: 'anthropic',
      model: '',
      effort: 'standard',
    });
    expect(r.error).toMatch(/did not return a decision/);
    expect(r.result?.decision.plan).toEqual([{ type: 'rest', minutes: 15 }]);
    expect(r.result?.usage?.inputTokens).toBe(4000);
    expect(r.result?.usage?.outputTokens).toBe(300);
    expect(r.result?.usage?.costUsd).toBeCloseTo((4000 * 1 + 300 * 5) / 1e6);
  });

  it('Anthropic: a refusal is still counted and paid for', async () => {
    const provider = new AnthropicProvider('k', 'claude-haiku-4-5', () => DEFAULT_PRICES, {
      fetch: anthropicReply('refusal'),
    });
    const r = await new BrainRouter([provider]).decide(request(perception()), {
      provider: 'anthropic',
      model: '',
      effort: 'standard',
    });
    expect(r.error).toMatch(/^Refused/);
    expect(r.result?.usage?.inputTokens).toBe(4000);
    expect(r.result?.usage?.costUsd).toBeGreaterThan(0);
  });

  it('OpenAI-compatible: no tool call, or a refusal, is still counted and paid for', async () => {
    const reply = (message: Record<string, unknown>) =>
      (async () =>
        json({
          id: 'c2',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } },
          ],
          usage: { prompt_tokens: 2000, completion_tokens: 150, total_tokens: 2150 },
        })) as unknown as typeof fetch;
    for (const [message, error] of [
      [{ content: 'Hmm, hard to say.' }, /did not return a decision/],
      [{ content: null, refusal: 'No.' }, /^Refused/],
    ] as const) {
      const provider = new OpenAIProvider(
        'openai_compatible',
        '',
        'http://localhost:11434/v1',
        'gpt-4o-mini',
        () => DEFAULT_PRICES,
        { fetch: reply(message) },
      );
      const r = await new BrainRouter([provider]).decide(request(perception()), {
        provider: 'openai_compatible',
        model: '',
        effort: 'standard',
      });
      expect(r.error).toMatch(error);
      expect(r.result?.usage?.inputTokens).toBe(2000);
      expect(r.result?.usage?.outputTokens).toBe(150);
      expect(r.result?.usage?.costUsd).toBeGreaterThan(0);
    }
  });
});

describe('a long life: reflection, sickness and world events', () => {
  const reflecting = (scope: 'day' | 'year') =>
    perception({
      trigger: { kind: 'reflect', scope },
      clock: { day: 3, hour: 22, minute: 0, isNight: true },
      self: { ...perception().self, asleep: true },
      reflectOn: [
        '[Day 3 09:00] I ate bread.',
        '[Day 3 11:00] Tobias Holt said to me: “The river is low.”',
        '[Day 3 15:00] I sold 4 vegetables at the market for 12 coins (3 each).',
      ],
      lifeChapters: ['My 34th year: Lise was born.'],
      beliefs: ['Hard work keeps us fed.'],
    });

  it('asks for a diary entry at night, from what the person remembers', () => {
    const prompt = userPrompt(reflecting('day'));
    expect(prompt).toContain('think back over your day');
    expect(prompt).toContain('The river is low');
    expect(prompt).toContain('My 34th year: Lise was born.');
    expect(prompt).toContain('Hard work keeps us fed.');
    expect(userPrompt(reflecting('year'))).toContain('past year of your life');
  });

  it('parses a reflection: diary and beliefs, and never a plan', () => {
    const d = parseDecision(
      {
        thought: 'Sleepy.',
        goal: 'Fish tomorrow',
        plan: [{ action: 'explore' }],
        diary: 'A good day at the market.',
        beliefs: ['Tobias worries too much.', '', 42],
      },
      reflecting('day'),
    );
    expect(d.plan).toEqual([]);
    expect(d.diary).toBe('A good day at the market.');
    expect(d.beliefs).toEqual(['Tobias worries too much.']);
  });

  it('frugal people write their nightly diary by instinct, but their yearly chapter with AI', () => {
    const frugal = (scope: 'day' | 'year') => ({ ...reflecting(scope), effort: 'frugal' as const });
    expect(instinctApplies(frugal('day'))).toBe(true);
    expect(instinctApplies(frugal('year'))).toBe(false);
    expect(instinctApplies({ ...reflecting('day'), effort: 'standard' })).toBe(false);
    const d = mockDecide(frugal('day'));
    expect(d.plan).toEqual([]);
    expect(d.diary).toContain('The river is low');
    expect(d.diary).not.toContain('I ate bread');
  });

  it('mock brain: rests when ill, shelters from storms, and nurses the sick', () => {
    const ill = mockDecide(perception({ sick: true, trigger: { kind: 'unwell' } }));
    expect(ill.plan.map((i) => i.type)).toEqual(['go_to', 'rest']);
    const storm = mockDecide(
      perception({
        conditions: ['A storm is raging: wind and cold rain. Staying outside will chill you.'],
      }),
    );
    expect(storm.goal).toBe('Shelter from the storm');
    let tended = false;
    for (let tick = 600; tick < 640 && !tended; tick++) {
      const d = mockDecide(
        perception({
          tick,
          self: { ...perception().self, occupation: 'herbalist' },
          visibleAgents: [
            {
              id: 'a2',
              name: 'Tobias Holt',
              x: 6,
              y: 5,
              distance: 1,
              activity: 'resting (looks ill)',
            },
          ],
        }),
      );
      tended = d.plan.some((i) => i.type === 'tend' && i.agentId === 'a2');
    }
    expect(tended).toBe(true);
  });

  it('mock brain drinks at the well when the river has dried up', () => {
    const d = mockDecide(
      perception({
        self: { ...perception().self, needs: { food: 80, water: 20, energy: 80, warmth: 100 } },
        conditions: ['The river has dried to cracked mud — only the well has water.'],
      }),
    );
    expect(d.plan[0]).toEqual({ type: 'drink', sourceId: 'well-1' });
  });
});

describe('adoption', () => {
  const orphaned = (tick: number) =>
    perception({
      tick,
      trigger: { kind: 'orphaned', childId: 'a9', childName: 'Mira Venn' },
    });

  it('parses adopt_child and respond_adoption', () => {
    const d = parseDecision(
      {
        plan: [
          { action: 'adopt_child', target: 'a9' },
          { action: 'respond_adoption', target: 'a2', accept: 'true' },
          { action: 'adopt_child' },
        ],
      },
      perception(),
    );
    expect(d.plan).toEqual([
      { type: 'adopt_child', childId: 'a9' },
      { type: 'respond_adoption', fromId: 'a2', accept: true },
    ]);
  });

  it('tells the person about an orphan and about an adoption offer', () => {
    expect(userPrompt(orphaned(600))).toContain('Mira Venn [a9] has lost their last parent');
    const offer = perception({
      trigger: { kind: 'adoption_offer', fromId: 'a2', fromName: 'Tobias Holt' },
      requests: [{ kind: 'adoption', fromId: 'a2', fromName: 'Tobias Holt' }],
    });
    expect(userPrompt(offer)).toContain('respond_adoption');
    expect(userPrompt(offer)).toContain('has offered to adopt you');
    expect(priorityOf(offer.trigger)).toBe(0);
  });

  it('mock brain: a grown-up with a home sometimes takes an orphan in', () => {
    let adopted = false;
    for (let tick = 600; tick < 640 && !adopted; tick++) {
      adopted = mockDecide(orphaned(tick)).plan.some(
        (i) => i.type === 'adopt_child' && i.childId === 'a9',
      );
    }
    expect(adopted).toBe(true);
  });
});

/**
 * A stand-in for the `claude` command: records how it was called, then answers like
 * `claude -p --output-format json` would (FAKE_MODE: ok | no_total | max_turns | limit | logged_out |
 * api_key).
 */
function fakeClaude(): { dir: string; command: string; calls: () => Record<string, unknown>[] } {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fake-claude-'));
  const log = join(dir, 'calls.jsonl');
  const command = join(dir, 'claude');
  writeFileSync(
    command,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE || 'ok';
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input, apiKey: process.env.ANTHROPIC_API_KEY ?? null }) + '\\n');
  if (args[0] === '--version') return console.log('2.1.300 (Claude Code)');
  if (args[0] === 'auth') {
    const loggedIn = mode !== 'logged_out';
    console.log(JSON.stringify({ loggedIn, authMethod: !loggedIn ? 'none' : mode === 'api_key' ? 'api_key' : 'claude.ai' }));
    process.exit(loggedIn ? 0 : 1);
  }
  if (mode === 'limit') {
    console.log(JSON.stringify({ type: 'result', is_error: true, subtype: 'success', result: 'Claude AI usage limit reached|1759780800' }));
    process.exit(1);
  }
  // Like Claude Code: the top-level usage is the main loop only; modelUsage has every model.
  const modelUsage = {
    'claude-haiku-4-5-20251001': { inputTokens: 2900, outputTokens: 180, cacheReadInputTokens: 800, cacheCreationInputTokens: 300, webSearchRequests: 0, costUSD: 0.0044, contextWindow: 200000, maxOutputTokens: 32000 },
    'claude-sonnet-4-5-20250929': { inputTokens: 150, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.000325, contextWindow: 200000, maxOutputTokens: 32000 },
  };
  const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 };
  if (mode === 'max_turns') {
    console.log(JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, duration_ms: 1200, num_turns: 3,
      session_id: 'fake-session', errors: [], total_cost_usd: 0.0031, usage, modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 2000, outputTokens: 60, cacheReadInputTokens: 500, cacheCreationInputTokens: 0, costUSD: 0.0031 } },
    }));
    process.exit(1);
  }
  const cost = mode === 'no_total' ? {} : { total_cost_usd: 0.004725 };
  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', duration_ms: 1500,
    num_turns: 2, session_id: 'fake-session', result: '', usage,
    ...cost,
    modelUsage,
    structured_output: { thought: 'Thirsty.', goal: 'Drink', plan: [{ action: 'drink' }] },
  }));
});
`,
  );
  chmodSync(command, 0o755);
  const calls = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { dir, command, calls };
}

describe('Claude subscription (Claude Code CLI)', () => {
  const baseEnv = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-should-not-be-used' };

  it('decides through `claude -p` with no tools, the decide schema and no API key', async () => {
    const fake = fakeClaude();
    const provider = new ClaudePlanProvider(fake.command, 'haiku', baseEnv);
    const p = perception();
    const res = await provider.decide(request(p), {
      provider: 'claude_plan',
      model: '',
      effort: 'frugal',
    });
    expect(res.decision.goal).toBe('Drink');
    // Tokens and cost come from modelUsage (both models), not the main-loop usage.
    expect(res.usage).toEqual({
      inputTokens: 4150,
      outputTokens: 200,
      cachedInputTokens: 800,
      costUsd: 0.004725,
      coveredByPlan: true,
    });
    expect(res.trace?.model).toBe('claude-haiku-4-5-20251001');
    const [call] = fake.calls();
    const args = call!.args as string[];
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1]!)).toHaveProperty('properties.plan');
    expect(args).not.toContain('--effort'); // Haiku has none
    expect(call!.input).toBe(userPrompt(p));
    expect(call!.apiKey).toBeNull(); // so the CLI uses the subscription, not an API key
  });

  it('passes the chosen model and maps effort levels to Claude effort', async () => {
    const fake = fakeClaude();
    const provider = new ClaudePlanProvider(fake.command, 'haiku', baseEnv);
    await provider.decide(request(perception()), {
      provider: 'claude_plan',
      model: 'sonnet',
      effort: 'deep',
    });
    const args = fake.calls()[0]!.args as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('costs a call without total_cost_usd by summing the per-model costs', async () => {
    const fake = fakeClaude();
    const provider = new ClaudePlanProvider(fake.command, 'haiku', {
      ...baseEnv,
      FAKE_MODE: 'no_total',
    });
    const res = await provider.decide(request(perception()), {
      provider: 'claude_plan',
      model: '',
      effort: 'frugal',
    });
    expect(res.usage?.costUsd).toBeCloseTo(0.004725, 6);
    expect(res.usage?.coveredByPlan).toBe(true);
  });

  it('keeps the tokens and cost of a call that ran but gave no answer', async () => {
    const fake = fakeClaude();
    const provider = new ClaudePlanProvider(fake.command, 'haiku', {
      ...baseEnv,
      FAKE_MODE: 'max_turns',
    });
    const router = new BrainRouter([provider]);
    const out = await router.decide(request(perception()), {
      provider: 'claude_plan',
      model: '',
      effort: 'frugal',
    });
    expect(out.result?.decision.goal).toBe('Pause'); // the fallback decision
    expect(out.error).toContain('error_max_turns');
    expect(out.error).not.toContain('{');
    expect(out.result?.usage).toEqual({
      inputTokens: 2500,
      outputTokens: 60,
      cachedInputTokens: 500,
      costUsd: 0.0031,
      coveredByPlan: true,
    });
  });

  it('reports a used-up plan limit to the router with its reset time', async () => {
    const fake = fakeClaude();
    const provider = new ClaudePlanProvider(fake.command, 'haiku', {
      ...baseEnv,
      FAKE_MODE: 'limit',
    });
    const router = new BrainRouter([provider]);
    const out = await router.decide(request(perception()), {
      provider: 'claude_plan',
      model: '',
      effort: 'standard',
    });
    expect(out.result).toBeNull();
    expect(out.limit?.resetsAt).toBe(1759780800_000);
    expect(out.limit?.limit).toBe('plan usage limit');
  });

  it('checks that Claude Code is installed and signed in with a Claude account', async () => {
    const fake = fakeClaude();
    expect((await checkClaudeCli(fake.command, baseEnv)).usesPlan).toBe(true);
    const keyed = await checkClaudeCli(fake.command, { ...baseEnv, FAKE_MODE: 'api_key' });
    expect(keyed.usesPlan).toBe(false);
    expect(keyed.message).toMatch(/API key/);
    const out = await checkClaudeCli(fake.command, { ...baseEnv, FAKE_MODE: 'logged_out' });
    expect(out.loggedIn).toBe(false);
    expect((await checkClaudeCli(null, baseEnv)).message).toMatch(/not installed/);
    expect(findClaudeCli({ PATH: fake.dir })).toBe(fake.command);
    expect(findClaudeCli({})).toBeNull();
  });

  it('reads reset times from the limit message', () => {
    const now = new Date(2026, 9, 3, 18, 30);
    expect(parseResetTime('Claude AI usage limit reached|1759780800', now)).toBe(1759780800_000);
    const at = new Date(parseResetTime("You've hit your limit · resets 9pm", now)!);
    expect([at.getDate(), at.getHours()]).toEqual([3, 21]);
    const tomorrow = new Date(parseResetTime('resets 5:15am', now)!);
    expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([4, 5, 15]);
    expect(parseResetTime('Something else went wrong', now)).toBeUndefined();
  });
});

describe('Claude plan usage', () => {
  it('falls back to the main-loop usage and costs nothing without per-model totals', () => {
    expect(
      planUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 2,
        },
      }),
    ).toEqual({
      inputTokens: 107,
      outputTokens: 10,
      cachedInputTokens: 5,
      costUsd: 0,
      coveredByPlan: true,
    });
  });
});

describe('rate limits', () => {
  const tooMany = (body: unknown, headers: Record<string, string>) => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify(body), {
        status: 429,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }) as unknown as typeof fetch;
    return { fetchFn, calls: () => calls };
  };

  it('turns an Anthropic 429 into a limit with which limit ran out and when, without retrying', async () => {
    const fake = tooMany(
      {
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Input tokens per minute exceeded' },
      },
      {
        'retry-after': '17',
        'anthropic-ratelimit-requests-remaining': '40',
        'anthropic-ratelimit-input-tokens-remaining': '0',
        'anthropic-ratelimit-input-tokens-reset': '2026-10-06T23:00:00Z',
      },
    );
    const provider = new AnthropicProvider('k', 'claude-haiku-4-5', () => DEFAULT_PRICES, {
      fetch: fake.fetchFn,
    });
    const before = Date.now();
    const out = await new BrainRouter([provider]).decide(request(perception()), {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      effort: 'frugal',
    });
    expect(fake.calls()).toBe(1); // the SDK didn't sleep and retry; the world handles it
    expect(out.result).toBeNull();
    expect(out.limit).toMatchObject({
      status: 429,
      limit: 'input tokens per minute',
      retryAfterSec: 17,
      message: 'Input tokens per minute exceeded',
    });
    expect(out.limit!.resetsAt).toBeGreaterThanOrEqual(before + 17_000);
    expect(out.error).toMatch(/Rate limit \(429\)/);
  });

  it('reports an OpenAI quota error with no retry time', async () => {
    const fake = tooMany(
      {
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      },
      {},
    );
    const provider = new OpenAIProvider(
      'openai',
      'k',
      undefined,
      'gpt-5-mini',
      () => DEFAULT_PRICES,
      {
        fetch: fake.fetchFn,
      },
    );
    const out = await new BrainRouter([provider]).decide(request(perception()), {
      provider: 'openai',
      model: 'gpt-5-mini',
      effort: 'frugal',
    });
    expect(fake.calls()).toBe(1);
    expect(out.limit).toMatchObject({
      status: 429,
      limit: 'quota used up (check billing)',
      message: 'You exceeded your current quota',
    });
    expect(out.limit!.resetsAt).toBeUndefined();
  });

  it('reads OpenAI and OpenRouter reset headers', () => {
    const now = 1_000_000_000_000;
    const err = (headers: Record<string, string>) =>
      toRateLimitError(
        { status: 429, headers: new Headers(headers), message: 'slow down' },
        now,
      ) as {
        details: { resetsAt?: number; limit?: string };
      };
    const openai = err({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '6m0s' });
    expect(openai.details).toMatchObject({ limit: 'token limit', resetsAt: now + 360_000 });
    const router = err({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now + 5_000) });
    expect(router.details.resetsAt).toBe(now + 5_000);
    expect(toRateLimitError(new Error('boom'))).toBeInstanceOf(Error);
    expect(toRateLimitError({ status: 500 })).toEqual({ status: 500 });
  });
});
