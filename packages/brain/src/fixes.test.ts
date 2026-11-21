import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionRequest, Perception, PersonDigest } from '@aw/shared';
import { ClaudePlanProvider, findClaudeCli, parseResetTime } from './claudeCli.ts';
import { askAboutPerson, mockInterview } from './interview.ts';
import { toRateLimitError } from './limits.ts';
import { mockDecide } from './mock.ts';
import * as animals from './mockVillage/animals.ts';
import * as farming from './mockVillage/farming.ts';
import * as governance from './mockVillage/governance.ts';
import * as jobs from './mockVillage/jobs.ts';
import * as quarry from './mockVillage/quarry.ts';
import { OpenAIProvider, isReasoningModel } from './openai.ts';
import { draftPerson } from './person.ts';
import { DEFAULT_PRICES, costOf, priceFor } from './pricing.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { BrainRouter, PrioritySemaphore, priorityOf } from './router.ts';
import { DECIDE_SCHEMA, extractJson, parseDecision } from './schema.ts';
import {
  NoDecisionError,
  RateLimitError,
  RefusalError,
  type BrainProvider,
  type GenerateRequest,
  type GenerateResult,
} from './types.ts';

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
    ],
    recent: [],
    memories: [],
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
    effort: 'standard',
    remainingPlan: [],
    marketPrices: null,
    offers: [],
    treesNearby: 3,
    stage: 'adult',
    canDo: ['go_to', 'gather', 'eat', 'drink', 'sleep', 'rest', 'explore', 'talk_to', 'feed'],
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

describe('router & PrioritySemaphore fixes', () => {
  it('transfers semaphore slots directly without exceeding concurrency or allowing barging', async () => {
    const sem = new PrioritySemaphore(1);
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = sem.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push('first');
      await new Promise<void>((r) => (releaseFirst = r));
      running--;
    }, 2);

    const queued = sem.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push('queued');
      await new Promise((r) => setTimeout(r, 10));
      running--;
    }, 1);

    releaseFirst();
    // Synchronously submit another task immediately after releasing: it must NOT barge ahead of `queued`
    // or run concurrently with `queued`.
    const barger = sem.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push('barger');
      running--;
    }, 2);

    await Promise.all([first, queued, barger]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['first', 'queued', 'barger']);
  });

  it('removes aborted waiters immediately from PrioritySemaphore queue without invoking fn', async () => {
    const sem = new PrioritySemaphore(1);
    let release!: () => void;
    const hold = sem.run(() => new Promise<void>((r) => (release = r)));

    const ac = new AbortController();
    const fn = vi.fn(async () => 'never');
    const waiter = sem.run(fn, 1, ac.signal);
    expect(sem.waiting).toBe(1);

    ac.abort();
    expect(sem.waiting).toBe(0);
    await expect(waiter).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();

    // Already-aborted signal rejects immediately too.
    await expect(sem.run(fn, 1, ac.signal)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();

    release();
    await hold;
  });

  it('supports external AbortSignal on BrainRouter.decide and BrainRouter.generate', async () => {
    let decideSignalAborted = false;
    let generateSignalAborted = false;
    const hanging: BrainProvider = {
      id: 'anthropic',
      decide: (_req, _cfg, signal) =>
        new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => {
            decideSignalAborted = true;
            rej(new Error('aborted'));
          });
        }),
      generate: (_req, signal) =>
        new Promise((_res, rej) => {
          signal?.addEventListener('abort', () => {
            generateSignalAborted = true;
            rej(new Error('aborted'));
          });
        }),
    };
    const router = new BrainRouter([hanging]);
    const cfg = { provider: 'anthropic' as const, model: 'cfg-model', effort: 'standard' as const };

    const ac1 = new AbortController();
    const p1 = router.decide(request(perception()), cfg, 60_000, ac1.signal);
    ac1.abort();
    const r1 = await p1;
    expect(decideSignalAborted).toBe(true);
    expect(r1.result).toBeNull();
    expect(r1.timedOut).toBeUndefined();
    expect(r1.error).toBe('aborted');

    const ac2 = new AbortController();
    const p2 = router.generate(
      cfg,
      {
        model: 'override-model',
        system: 's',
        user: 'u',
        toolName: 't',
        toolDescription: 'd',
        schema: {},
        maxTokens: 10,
      },
      { timeoutMs: 60_000, signal: ac2.signal },
    );
    ac2.abort();
    const r2 = await p2;
    expect(generateSignalAborted).toBe(true);
    expect(r2.output).toBeNull();
    expect(r2.model).toBe('override-model');
    expect(r2.timedOut).toBeUndefined();
    expect(r2.error).toBe('aborted');
  });

  it('prioritizes job_offer, meeting_open, and rule_proposed at 0 or 1', () => {
    expect(
      priorityOf({ kind: 'job_offer', fromId: 'a2', fromName: 'T', wage: 5, days: 3 }),
    ).toBeLessThanOrEqual(1);
    expect(priorityOf({ kind: 'meeting_open', topic: 'Wells' })).toBeLessThanOrEqual(1);
    expect(
      priorityOf({ kind: 'rule_proposed', proposalId: 'p1', byName: 'T', text: 'Tax 1' }),
    ).toBeLessThanOrEqual(1);
  });

  it('returns req.model || config.model on all generate() failure paths', async () => {
    const req: GenerateRequest = {
      model: 'req-model',
      system: 's',
      user: 'u',
      toolName: 't',
      toolDescription: 'd',
      schema: {},
      maxTokens: 10,
    };
    const cfg = { provider: 'anthropic' as const, model: 'cfg-model', effort: 'standard' as const };
    const mk = (fn: (r: GenerateRequest) => Promise<GenerateResult>) =>
      new BrainRouter([
        {
          id: 'anthropic',
          decide: async () => {
            throw new Error('unused');
          },
          generate: fn,
        },
      ]);

    const rate = await mk(async () => {
      throw new RateLimitError('limit', { status: 429 });
    }).generate(cfg, req);
    expect(rate.model).toBe('req-model');

    const refused = await mk(async () => {
      throw new RefusalError('no');
    }).generate(cfg, req);
    expect(refused.model).toBe('req-model');

    const noDec = await mk(async () => {
      throw new NoDecisionError('empty');
    }).generate(cfg, req);
    expect(noDec.model).toBe('req-model');

    const generic = await mk(async () => {
      throw new Error('boom');
    }).generate(cfg, req);
    expect(generic.model).toBe('req-model');

    const timed = await mk(() => new Promise(() => {})).generate(cfg, req, { timeoutMs: 25 });
    expect(timed.timedOut).toBe(true);
    expect(timed.model).toBe('req-model');
  });
});

describe('pricing fixes', () => {
  it('matches longest delimiter-bounded model prefix and strips provider prefixes', () => {
    expect(priceFor('openai/gpt-4o-mini-2024-07-18', DEFAULT_PRICES)).toEqual({
      price: DEFAULT_PRICES['gpt-4o-mini'],
      estimated: false,
    });
    expect(priceFor('anthropic/claude-opus-5-5-20260101', DEFAULT_PRICES)).toEqual({
      price: DEFAULT_PRICES['claude-opus-5-5'],
      estimated: false,
    });
    expect(priceFor('gpt-4o-mini:latest', DEFAULT_PRICES)).toEqual({
      price: DEFAULT_PRICES['gpt-4o-mini'],
      estimated: false,
    });
    expect(priceFor('gpt-50', DEFAULT_PRICES).estimated).toBe(true);
    expect(priceFor('custom-claude-haiku-4-5', DEFAULT_PRICES).estimated).toBe(true);
  });

  it('includes default prices for OpenAI and additional Anthropic models', () => {
    for (const model of [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'gpt-4o',
      'gpt-4o-mini',
      'o3',
      'o4-mini',
    ]) {
      const p = priceFor(model, DEFAULT_PRICES);
      expect(p.estimated).toBe(false);
      expect(p.price.cachedInput).toBeGreaterThan(0);
    }
    for (const model of [
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-fable-5',
      'claude-mythos-5',
      'claude-mythos-5-1',
    ]) {
      expect(priceFor(model, DEFAULT_PRICES).estimated).toBe(false);
    }
  });
});

describe('claudeCli fixes', () => {
  it('ignores directories named claude and checks USERPROFILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-find-cli-'));
    // Directory named `claude` must NOT be returned.
    mkdirSync(join(dir, 'claude'));
    expect(findClaudeCli({ PATH: dir })).toBeNull();

    const profile = mkdtempSync(join(tmpdir(), 'aw-profile-'));
    const localBin = join(profile, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    const bin = join(localBin, 'claude');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    expect(findClaudeCli({ USERPROFILE: profile })).toBe(bin);
  });

  it('parses UTC/GMT reset times and ignores date tokens like 10/15', () => {
    const now = new Date('2026-10-03T18:30:00Z');
    const utcEvening = parseResetTime('Limit reached · resets 9pm (UTC)', now);
    expect(utcEvening).toBe(Date.UTC(2026, 9, 3, 21, 0, 0, 0));

    const gmtNextDay = parseResetTime('Limit resets at 14:30 GMT', now);
    expect(gmtNextDay).toBe(Date.UTC(2026, 9, 4, 14, 30, 0, 0));

    expect(parseResetTime('Usage resets 10/15', now)).toBeUndefined();
  });

  it('detects rate limits in errors/stderr when out.result is empty, caps output at 4 MiB, and uses 0o700 workDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fake-cli-'));
    const command = join(dir, 'claude');
    const cwdLog = join(dir, 'cwd.txt');
    writeFileSync(
      command,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(cwdLog)}, process.cwd());
const mode = process.env.MODE;
if (mode === 'empty_result_errors') {
  console.log(JSON.stringify({ is_error: true, result: '', errors: ['You hit your usage limit · resets 9pm (UTC)'] }));
  process.exit(1);
}
if (mode === 'stderr_limit') {
  console.log(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: '', errors: [] }));
  console.error('Error: rate limit exceeded');
  process.exit(1);
}
if (mode === 'huge') {
  process.stdout.end('x'.repeat(5 * 1024 * 1024));
}
`,
    );
    chmodSync(command, 0o755);

    const p1 = new ClaudePlanProvider(command, 'haiku', {
      PATH: process.env.PATH,
      MODE: 'empty_result_errors',
    });
    await expect(
      p1.decide(request(perception()), {
        provider: 'claude_plan',
        model: 'haiku',
        effort: 'frugal',
      }),
    ).rejects.toThrow(RateLimitError);

    // Check workDir permissions (0o700) and private prefix.
    const usedCwd = await import('node:fs').then((m) => m.readFileSync(cwdLog, 'utf8'));
    expect(usedCwd).toMatch(/agents-world-claude-.+/);
    expect(statSync(usedCwd).mode & 0o777).toBe(0o700);

    const p2 = new ClaudePlanProvider(command, 'haiku', {
      PATH: process.env.PATH,
      MODE: 'stderr_limit',
    });
    await expect(
      p2.decide(request(perception()), {
        provider: 'claude_plan',
        model: 'haiku',
        effort: 'frugal',
      }),
    ).rejects.toThrow(RateLimitError);

    const p3 = new ClaudePlanProvider(command, 'haiku', { PATH: process.env.PATH, MODE: 'huge' });
    await expect(
      p3.decide(request(perception()), {
        provider: 'claude_plan',
        model: 'haiku',
        effort: 'frugal',
      }),
    ).rejects.toThrow(/4 MiB/);
  });
});

describe('openai fixes', () => {
  it('excludes -chat variants from isReasoningModel', () => {
    expect(isReasoningModel('gpt-5')).toBe(true);
    expect(isReasoningModel('gpt-5-mini')).toBe(true);
    expect(isReasoningModel('openai/o4-mini')).toBe(true);
    expect(isReasoningModel('gpt-5-chat')).toBe(false);
    expect(isReasoningModel('gpt-5-chat-latest')).toBe(false);
    expect(isReasoningModel('openai/gpt-5-chat-2025-08-07')).toBe(false);
    expect(isReasoningModel('gpt-4o')).toBe(false);
  });

  it('generate() requires a model, checks refusal with cached-token usage, and filters by toolName', async () => {
    const emptyModelProvider = new OpenAIProvider(
      'openai',
      'k',
      undefined,
      '',
      () => DEFAULT_PRICES,
      {
        fetch: vi.fn() as unknown as typeof fetch,
      },
    );
    await expect(
      emptyModelProvider.generate({
        model: '',
        system: 's',
        user: 'u',
        toolName: 'answer',
        toolDescription: 'd',
        schema: {},
        maxTokens: 100,
      }),
    ).rejects.toThrow(/No model chosen/);

    const refusalFetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: null, refusal: 'Nope.' },
            },
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 20,
            total_tokens: 1020,
            prompt_tokens_details: { cached_tokens: 1200 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const pRefusal = new OpenAIProvider(
      'openai',
      'k',
      undefined,
      'gpt-4o-mini',
      () => DEFAULT_PRICES,
      {
        fetch: refusalFetch,
      },
    );
    let caught: unknown;
    try {
      await pRefusal.generate({
        model: 'gpt-4o-mini',
        system: 's',
        user: 'u',
        toolName: 'answer',
        toolDescription: 'd',
        schema: {},
        maxTokens: 100,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RefusalError);
    expect((caught as RefusalError).usage?.cachedInputTokens).toBe(1200);
    // Clamped non-negative uncached input tokens.
    expect((caught as RefusalError).usage?.costUsd).toBeCloseTo(
      costOf('gpt-4o-mini', { input: 0, output: 20, cacheRead: 1200 }, DEFAULT_PRICES).costUsd,
    );

    const multiToolFetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'c2',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: '1',
                    type: 'function',
                    function: { name: 'wrong_tool', arguments: '{"answer":"wrong"}' },
                  },
                  {
                    id: '2',
                    type: 'function',
                    function: { name: 'answer', arguments: '{"answer":"right"}' },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 500,
            completion_tokens: 50,
            total_tokens: 550,
            prompt_tokens_details: { cached_tokens: 200 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const pTool = new OpenAIProvider(
      'openai',
      'k',
      undefined,
      'gpt-4o-mini',
      () => DEFAULT_PRICES,
      {
        fetch: multiToolFetch,
      },
    );
    const out = await pTool.generate({
      model: 'gpt-4o-mini',
      system: 's',
      user: 'u',
      toolName: 'answer',
      toolDescription: 'd',
      schema: {},
      maxTokens: 100,
    });
    expect(out.output).toEqual({ answer: 'right' });
    expect(out.usage.cachedInputTokens).toBe(200);
    expect(out.usage.inputTokens).toBe(500);
  });
});

describe('limits fixes', () => {
  it('clears resetsAt and retryAfterSec on insufficient_quota even when headers are present', () => {
    const err = toRateLimitError(
      {
        status: 429,
        code: 'insufficient_quota',
        headers: new Headers({
          'retry-after': '30',
          'x-ratelimit-reset': String(Date.now() + 60_000),
        }),
        message: 'Quota exceeded',
      },
      1_000_000,
    ) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.details.limit).toBe('quota used up (check billing)');
    expect(err.details.resetsAt).toBeUndefined();
    expect(err.details.retryAfterSec).toBeUndefined();
  });

  it('strictly validates retry-after-ms after trimming', () => {
    const now = 1_000_000;
    const blank = toRateLimitError(
      {
        status: 429,
        headers: new Headers({ 'retry-after-ms': '   ', 'retry-after': '12' }),
        message: 'slow',
      },
      now,
    ) as RateLimitError;
    expect(blank.details.retryAfterSec).toBe(12);

    const negative = toRateLimitError(
      {
        status: 429,
        headers: new Headers({ 'retry-after-ms': '-500' }),
        message: 'slow',
      },
      now,
    ) as RateLimitError;
    expect(negative.details.retryAfterSec).toBeUndefined();

    const valid = toRateLimitError(
      {
        status: 429,
        headers: new Headers({ 'retry-after-ms': ' 2500 ' }),
        message: 'slow',
      },
      now,
    ) as RateLimitError;
    expect(valid.details.retryAfterSec).toBe(3);
    expect(valid.details.resetsAt).toBe(now + 2500);
  });
});

describe('person.ts fixes', () => {
  it('routes draftPerson through router.generate, preserves refusal usage, and trims blank fields', async () => {
    const usage = { inputTokens: 120, outputTokens: 15, costUsd: 0.002 };
    const refusedRouter = new BrainRouter([
      {
        id: 'anthropic',
        decide: async () => {
          throw new Error('unused');
        },
        generate: async () => {
          throw new RefusalError('nope', usage);
        },
      },
    ]);
    const refused = await draftPerson(
      { description: 'A quiet miller' },
      { provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'standard' },
      refusedRouter,
    );
    expect(refused.usage).toEqual(usage);
    expect(refused.error).toMatch(/Refused/);
    expect(refused.draft.occupation).toBe('traveller');

    const blankFieldsRouter = new BrainRouter([
      {
        id: 'anthropic',
        decide: async () => {
          throw new Error('unused');
        },
        generate: async (req) => ({
          output: {
            name: '  ',
            family_name: '   ',
            occupation: '\t',
            traits: '',
            background: '  ',
            sex: 'female',
            age: 30,
          },
          model: req.model,
          usage,
        }),
      },
    ]);
    const drafted = await draftPerson(
      { description: 'A quiet miller' },
      { provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'standard' },
      blankFieldsRouter,
    );
    expect(drafted.draft.name.trim().length).toBeGreaterThan(0);
    expect(drafted.draft.familyName.trim().length).toBeGreaterThan(0);
    expect(drafted.draft.occupation).toBe('traveller');
    expect(drafted.draft.traits).toBe('A quiet miller');
    expect(drafted.draft.background).toBe('A quiet miller');
  });
});

describe('schema, prompt, and interview fixes', () => {
  it('schema: caps coins at 100000, guards feelings, mentions feed, and improves extractJson', () => {
    expect(DECIDE_SCHEMA.properties.plan.items.properties.item.description).toContain('feed');

    const d = parseDecision(
      {
        thought: 'Pay big.',
        goal: 'Pay',
        plan: [
          { action: 'give', target: 'a2', coins: 2500 },
          { action: 'pay_from_treasury', target: 'a2', coins: 250_000 },
        ],
        feelings: [
          { target: '   ', affection: 2 },
          { target: 'a2', affection: Infinity, trust: -10, romance: NaN },
        ],
      },
      perception(),
    );
    expect(d.plan).toEqual([
      { type: 'give', agentId: 'a2', gift: { coins: 2500 } },
      { type: 'pay_from_treasury', agentId: 'a2', coins: 100_000 },
    ]);
    expect(d.feelings).toEqual([{ agentId: 'a2', affection: 0, trust: -3, romance: 0 }]);

    expect(
      extractJson('Here you go:\n```json\n{"thought":"ok","plan":[]}\n```\n{trailing}'),
    ).toEqual({
      thought: 'ok',
      plan: [],
    });
    expect(extractJson('Note {aside} then {"msg":"hello {world}","n":1} and {end}')).toEqual({
      msg: 'hello {world}',
      n: 1,
    });
  });

  it('prompt: gates meeting actions on canDo, fixes carry/elder/go_to/stonework text', () => {
    const sys = systemPrompt(
      perception({
        canDo: ['go_to', 'build'],
      }),
    );
    expect(sys).toContain('go_to {target: place id or visible person id}');
    expect(sys).toContain('2 extra stone in at least half of the stretches makes it stonework');

    const noVote = userPrompt(
      perception({
        trigger: { kind: 'meeting_open', topic: 'Tax' },
        canDo: ['rest'],
      }),
    );
    expect(noVote).not.toContain('propose_rule');
    expect(noVote).not.toContain('vote on proposals');

    const noVoteRule = userPrompt(
      perception({
        trigger: { kind: 'rule_proposed', proposalId: 'p1', byName: 'Tobias', text: 'Tax 1' },
        canDo: ['rest'],
      }),
    );
    expect(noVoteRule).not.toContain('Vote with vote');

    const emptyBagElder = userPrompt(
      perception({
        trigger: { kind: 'grew_up', stage: 'elder' },
        self: { ...perception().self, inventory: {} },
      }),
    );
    expect(emptyBagElder).toContain('you are now an elder.');
    expect(emptyBagElder).toContain('You carry: nothing.');
  });

  it('interview: prefers structured output in trace.response, uses singular 1 time, and omits "so far" when dead', async () => {
    const digest: PersonDigest = {
      agentId: 'a1',
      name: 'Anna Miller',
      firstName: 'Anna',
      sex: 'female',
      age: 72,
      stage: 'elder',
      alive: false,
      death: 'Died of old age.',
      occupation: 'baker',
      traits: 'kind',
      background: 'Baked bread.',
      temperament: 'calm',
      home: 'House 1',
      money: 0,
      skills: [],
      family: [],
      relationships: [],
      chapters: [],
      beliefs: [],
      period: {
        fromTick: 0,
        toTick: 1440,
        label: 'Whole life',
        wholeLife: true,
        endsNow: false,
      },
      activity: [{ kind: 'ate', label: 'eating', count: 1 }],
      companions: [],
      entries: [],
      total: 0,
      omitted: 0,
    };

    const summary = mockInterview(digest, 'What did she do?');
    expect(summary).toContain('Over her whole life, Anna spent most of her time eating (1 time).');
    expect(summary).not.toContain('so far');
    expect(summary).not.toContain('1 times');

    const router = new BrainRouter([
      {
        id: 'anthropic',
        decide: async () => {
          throw new Error('unused');
        },
        generate: async (req) => ({
          output: { answer: 'She baked for forty years.' },
          text: 'Let me check the chronicle...',
          model: req.model,
        }),
      },
    ]);
    const res = await askAboutPerson(
      router,
      { provider: 'anthropic', model: 'm', effort: 'frugal' },
      digest,
      'What did she do?',
    );
    expect(res.trace?.response).toBe(JSON.stringify({ answer: 'She baked for forty years.' }));
  });
});

describe('mock & mockVillage fixes', () => {
  it('gates governance, farming, jobs, quarry, and burnt-ruin build_house on canDo and reachability', () => {
    expect(
      governance.reply(
        perception({
          trigger: { kind: 'rule_proposed', proposalId: 'p1', byName: 'T', text: 'Rule' },
          canDo: ['rest'],
        }),
        0.1,
      ),
    ).toBeNull();

    expect(
      farming.plan(
        perception({
          knownPlaces: [
            {
              id: 'f1',
              kind: 'field',
              name: 'F1',
              x: 1,
              y: 1,
              distance: 2,
              owner: 'you',
              progress: 0.5,
              lastSeenTick: 500,
            },
          ],
          canDo: ['rest'],
        }),
        0.1,
      ),
    ).toBeNull();

    expect(
      farming.plan(
        perception({
          knownPlaces: [
            {
              id: 'f1',
              kind: 'field',
              name: 'F1',
              x: 1,
              y: 1,
              distance: 2,
              owner: 'you',
              unreachable: true,
              progress: 0.5,
              lastSeenTick: 500,
            },
          ],
          canDo: ['clear_field', 'sow'],
        }),
        0.01,
      ),
    ).toBeNull();

    expect(
      jobs.reply(
        perception({
          trigger: { kind: 'job_offer', fromId: 'a2', fromName: 'T', wage: 5, days: 3 },
          canDo: ['rest'],
        }),
        0.1,
      ),
    ).toBeNull();

    expect(
      quarry.plan(
        perception({
          self: { ...perception().self, occupation: 'carpenter', inventory: {} },
          rocksNearby: 3,
          canDo: ['rest'],
        }),
        0.01,
      ),
    ).toBeNull();

    // Burnt ruin is ignored when build_house is not in canDo.
    const dNoBuild = mockDecide(
      perception({
        tick: 601,
        self: {
          ...perception().self,
          occupation: 'odd-jobber',
          inventory: { bread: 6, planks: 5 },
        },
        knownPlaces: [
          {
            id: 'house-1',
            kind: 'house',
            name: 'House 1',
            x: 1,
            y: 1,
            distance: 2,
            owner: 'you',
            burnt: true,
            lastSeenTick: 500,
          },
        ],
        canDo: ['rest', 'explore'],
      }),
    );
    expect(dNoBuild.plan.some((i) => i.type === 'build_house')).toBe(false);
  });

  it('animals.ts checks burnt/unreachable and stocks an empty pen with carried hens/sheep', () => {
    const burntPen = animals.plan(
      perception({
        self: { ...perception().self, inventory: { hen: 2 } },
        knownPlaces: [
          {
            id: 'pen-1',
            kind: 'pen',
            name: 'Pen',
            x: 2,
            y: 2,
            distance: 2,
            owner: 'you',
            burnt: true,
            animals: { hens: 0, sheep: 0 },
            lastSeenTick: 500,
          },
        ],
        canDo: ['tend_animals', 'buy'],
      }),
      0.1,
    );
    expect(burntPen).toBeNull();

    const stockCarried = animals.plan(
      perception({
        self: { ...perception().self, inventory: { sheep: 1 } },
        knownPlaces: [
          {
            id: 'pen-1',
            kind: 'pen',
            name: 'Pen',
            x: 2,
            y: 2,
            distance: 2,
            owner: 'you',
            animals: { hens: 0, sheep: 0 },
            lastSeenTick: 500,
          },
        ],
        canDo: ['tend_animals'],
      }),
      0.9,
    );
    expect(stockCarried?.plan).toEqual([{ type: 'tend_animals', objectId: 'pen-1' }]);
  });

  it('mock.ts: baker never returns empty plan when bread overflows, checks bread price/stock for child, and varies replies', () => {
    // Baker with >4 bread and overflowing market must still return a non-empty plan.
    for (let tick = 600; tick < 640; tick++) {
      const d = mockDecide(
        perception({
          tick,
          self: { ...perception().self, occupation: 'baker', inventory: { bread: 6 } },
          recent: ["The market won't take any more bread right now."],
        }),
      );
      expect(d.plan.length).toBeGreaterThan(0);
    }

    // Hungry child: don't try to buy 2 bread if money < 2 * bread price or market had no bread.
    const childPerception = (money: number, recent: string[]) =>
      perception({
        self: { ...perception().self, money, inventory: {} },
        family: {
          partner: null,
          parents: [],
          children: [
            {
              id: 'c1',
              name: 'Baby',
              age: 0,
              nearby: true,
              needs: { food: 10, water: 80, energy: 80, warmth: 80 },
            },
          ],
        },
        knownPlaces: [
          {
            id: 'market-1',
            kind: 'market',
            name: 'Market',
            x: 3,
            y: 3,
            distance: 2,
            lastSeenTick: 500,
          },
        ],
        marketPrices: { tick: 590, prices: { bread: { buy: 10, sell: 6 } } },
        recent,
        canDo: ['buy', 'feed', 'rest', 'explore'],
      });

    expect(mockDecide(childPerception(12, [])).plan.some((i) => i.type === 'buy')).toBe(false);
    expect(
      mockDecide(childPerception(30, ['The market had no bread.'])).plan.some(
        (i) => i.type === 'buy',
      ),
    ).toBe(false);
    expect(mockDecide(childPerception(30, [])).plan[0]).toEqual({
      type: 'buy',
      item: 'bread',
      quantity: 2,
    });

    // Varied replies to questions that don't endlessly end with '?'.
    const seen = new Set<string>();
    for (let tick = 600; tick < 660; tick++) {
      const d = mockDecide(
        perception({
          tick,
          trigger: {
            kind: 'spoken_to',
            fromId: 'a2',
            fromName: 'Tobias Holt',
            message: 'How are you?',
          },
        }),
      );
      const talk = d.plan[0];
      expect(talk?.type).toBe('talk_to');
      if (talk?.type === 'talk_to') {
        seen.add(talk.message);
        expect(talk.message.endsWith('?')).toBe(false);
      }
    }
    expect(seen.size).toBeGreaterThan(2);
  });
});
