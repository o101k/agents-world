import type { BrainConfig, PersonDigest, RecordEntry } from '@aw/shared';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUESTION, askAboutPerson, interviewPrompt, mockInterview } from './interview.ts';
import { BrainRouter } from './router.ts';
import {
  NoDecisionError,
  RateLimitError,
  RefusalError,
  type BrainProvider,
  type GenerateRequest,
  type GenerateResult,
} from './types.ts';

// Tick 1440 = Day 2, 00:00. Day 4 09:12 = (3 * 1440) + 9 * 60 + 12.
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (day - 1) * 1440 + h! * 60 + m!;
};

function entry(
  partial: Partial<RecordEntry> & Pick<RecordEntry, 'tick' | 'kind' | 'text'>,
): RecordEntry {
  return { importance: 3, ...partial };
}

function digestFixture(overrides: Partial<PersonDigest> = {}): PersonDigest {
  return {
    agentId: 'a1',
    name: 'Anna Miller',
    firstName: 'Anna',
    sex: 'female',
    age: 34,
    stage: 'adult',
    alive: true,
    occupation: 'baker',
    traits: 'warm, practical',
    background: 'Born at the mill, she learned bread from her aunt.',
    temperament: 'very curious, outgoing',
    home: 'House 3',
    money: 12,
    skills: ['farming 34', 'cooking 20'],
    family: ['Partner: Tom Miller'],
    relationships: ['Tom Miller: loves, trusts', 'Edda Holt: dislikes'],
    chapters: ['Year 30: opened the bakery.', 'Year 31: married Tom.'],
    beliefs: ['The river floods in spring.'],
    period: {
      fromTick: at(3, '07:00'),
      toTick: at(5, '14:00'),
      label: 'Day 3, 07:00 – Day 5, 14:00',
      wholeLife: false,
      endsNow: false,
    },
    activity: [
      { kind: 'gathered', label: 'gathering', count: 34 },
      { kind: 'ate', label: 'eating', count: 8 },
      { kind: 'traded', label: 'trading', count: 5 },
    ],
    companions: [
      { name: 'Tom Miller', count: 12 },
      { name: 'Edda Holt', count: 3 },
    ],
    entries: [
      entry({
        tick: at(3, '07:12'),
        kind: 'thought',
        text: 'Bread is low. (Goal: sell bread at the market)',
        importance: 2,
      }),
      entry({
        tick: at(4, '09:12'),
        kind: 'event',
        text: 'Anna sold a loaf to Edda Holt.',
        importance: 4,
        eventKind: 'traded',
      }),
      entry({
        tick: at(4, '18:00'),
        kind: 'diary',
        text: 'I wish the river had not flooded the field.',
        importance: 6,
        eventKind: 'reflected',
      }),
      entry({
        tick: at(4, '20:00'),
        kind: 'thought',
        text: 'I must tend the oven again. (Goal: sell bread at the market)',
        importance: 2,
      }),
      entry({
        tick: at(5, '10:00'),
        kind: 'event',
        text: 'Anna was attacked by a stranger at the well.',
        importance: 8,
        eventKind: 'attacked',
      }),
    ],
    total: 5,
    omitted: 0,
    ...overrides,
  };
}

const emptyDigest = (): PersonDigest =>
  digestFixture({
    entries: [],
    activity: [],
    companions: [],
    total: 0,
    period: {
      fromTick: at(3, '07:00'),
      toTick: at(3, '08:00'),
      label: 'Day 3, 07:00 – Day 3, 08:00',
      wholeLife: false,
      endsNow: false,
    },
  });

const brain = (provider: BrainConfig['provider'] = 'anthropic'): BrainConfig => ({
  provider,
  model: 'test-model',
  effort: 'frugal',
});

/** A provider whose `generate` is a stub. `decide` is never used by the interview code. */
function fakeProvider(
  id: BrainProvider['id'],
  generate: (req: GenerateRequest, signal?: AbortSignal) => Promise<GenerateResult>,
): BrainProvider {
  return {
    id,
    decide: async () => {
      throw new Error('not used');
    },
    generate,
  };
}

describe('mockInterview', () => {
  it('says nothing is recorded when the period is empty', () => {
    expect(mockInterview(emptyDigest(), 'What did she do?')).toBe(
      'Nothing is recorded about Anna in this period (Day 3, 07:00 – Day 3, 08:00).',
    );
  });

  it('answers what she did, with routine counts and notable events', () => {
    const text = mockInterview(digestFixture(), 'What did she do?');
    expect(text).toContain('From Day 3, 07:00 to Day 5, 14:00, Anna spent most of her time');
    expect(text).toContain('gathering (34 times), eating (8) and trading (5)');
    expect(text).toContain('On Day 4 at 09:12, Anna sold a loaf to Edda Holt.');
  });

  it('uses the right pronouns for a man', () => {
    const digest = digestFixture({ sex: 'male', firstName: 'Hugo', name: 'Hugo Brenner' });
    const text = mockInterview(digest, 'What did he do?');
    expect(text).toContain('Hugo spent most of his time');
  });

  it('answers feelings from the diary and latest thought', () => {
    const text = mockInterview(digestFixture(), 'How does she feel?');
    expect(text.startsWith('In her diary on Day 4 she wrote: “I wish the river')).toBe(true);
    expect(text).toContain('Lately she has been thinking: “I must tend the oven again.”');
    expect(text).not.toContain('(Goal:');
  });

  it('answers who she spends time with', () => {
    const text = mockInterview(digestFixture(), 'Who does she spend time with?');
    expect(text).toContain('Anna dealt most with Tom Miller (12 times) and Edda Holt (3).');
    expect(text).toContain(
      'How she feels about others: Tom Miller: loves, trusts; Edda Holt: dislikes.',
    );
    expect(text).toContain('Family: Partner: Tom Miller.');
  });

  it('answers what she wants from her goals', () => {
    const text = mockInterview(digestFixture(), 'What does she want?');
    expect(text).toContain('Her goals lately: sell bread at the market.');
  });

  it('answers trouble from the troubling events, or says nothing went wrong', () => {
    const text = mockInterview(digestFixture(), 'Did anything go wrong?');
    expect(text).toContain('On Day 5 at 10:00, Anna was attacked by a stranger at the well.');

    const calm = digestFixture({
      entries: [
        entry({
          tick: at(4, '09:12'),
          kind: 'event',
          text: 'Anna sold a loaf.',
          importance: 3,
          eventKind: 'traded',
        }),
      ],
    });
    expect(mockInterview(calm, 'Was she ever in trouble?')).toContain(
      'Nothing went badly wrong for her in this period, as far as the record shows.',
    );
  });

  it('tells the whole life story, with chapters', () => {
    const text = mockInterview(digestFixture(), 'Tell me her life story');
    expect(text).toContain('Born at the mill');
    expect(text).toContain(
      'Looking back on her life, she wrote: “Year 30: opened the bakery.” “Year 31: married Tom.”',
    );
  });

  it('gives a non-empty answer for an unknown question', () => {
    const text = mockInterview(digestFixture(), 'Zzz');
    expect(text).toContain('gathering (34 times)');
  });
});

describe('interviewPrompt', () => {
  it('describes the person, period and record, and includes the question', () => {
    const { system, user } = interviewPrompt(digestFixture(), 'What did she do?', [], 'frugal');
    expect(system).toContain('150 words');
    expect(user).toContain('About Anna Miller (Anna): female, 34, Adult, baker. Alive.');
    expect(user).toContain('Period asked about: Day 3, 07:00 – Day 5, 14:00');
    expect(user).toMatch(/\[Day 4, 09:12\] happened: Anna sold a loaf/);
    expect(user).toContain('Question: What did she do?');
  });

  it('uses the default question when the box was empty', () => {
    const { user } = interviewPrompt(digestFixture(), '  ', [], 'frugal');
    expect(user).toContain(`Question: ${DEFAULT_QUESTION}`);
  });

  it('includes earlier answers as context', () => {
    const { user } = interviewPrompt(
      digestFixture(),
      'And then?',
      [{ question: 'What did she do?', answer: 'She baked bread.' }],
      'frugal',
    );
    expect(user).toContain('Earlier in this conversation:');
    expect(user).toContain('Q: What did she do?');
    expect(user).toContain('A: She baked bread.');
  });

  it('changes the word budget with effort', () => {
    const frugal = interviewPrompt(digestFixture(), 'q', [], 'frugal').system;
    const standard = interviewPrompt(digestFixture(), 'q', [], 'standard').system;
    const deep = interviewPrompt(digestFixture(), 'q', [], 'deep').system;
    expect(frugal).toContain('150 words');
    expect(standard).toContain('250 words');
    expect(deep).toContain('400 words');
  });
});

describe('askAboutPerson', () => {
  it('uses the free summary for the Mock brain', async () => {
    const router = new BrainRouter([]);
    const r = await askAboutPerson(router, brain('mock'), digestFixture(), 'What did she do?');
    expect(r.provider).toBe('mock');
    expect(r.fallback).toBe('mock_brain');
    expect(r.note).toBeUndefined();
  });

  it('explains when the provider is not set up', async () => {
    const r = await askAboutPerson(new BrainRouter([]), brain('anthropic'), digestFixture(), 'q');
    expect(r.fallback).toBe('not_set_up');
    expect(r.note).toContain("Anna's brain (Anthropic API) isn't set up");
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('does not call the AI when the spending cap is reached', async () => {
    const generate = vi.fn();
    const router = new BrainRouter([fakeProvider('anthropic', generate)]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q', { capReached: true });
    expect(generate).not.toHaveBeenCalled();
    expect(r.fallback).toBe('cap_reached');
    expect(r.note).toContain('spending cap is reached');
  });

  it('takes the answer from the tool output', async () => {
    const generate = vi.fn(async (req: GenerateRequest) => ({
      output: { answer: 'Anna baked bread.' },
      model: req.model,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
    }));
    const router = new BrainRouter([fakeProvider('anthropic', generate)]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'What did she do?');
    expect(r.answer).toBe('Anna baked bread.');
    expect(r.provider).toBe('anthropic');
    expect(r.model).toBe('test-model');
    expect(r.usage?.costUsd).toBe(0.01);
    expect(r.fallback).toBeUndefined();
    expect(r.trace?.prompt).toContain('Question: What did she do?');
    expect(generate.mock.calls[0]![0].toolName).toBe('answer');
  });

  it('takes the answer from plain text when the model skips the tool', async () => {
    const router = new BrainRouter([
      fakeProvider('anthropic', async (req) => ({
        output: null,
        text: 'She was busy baking.',
        model: req.model,
      })),
    ]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q');
    expect(r.answer).toBe('She was busy baking.');
    expect(r.fallback).toBeUndefined();
  });

  it('falls back with the rate limit message and keeps usage', async () => {
    const router = new BrainRouter([
      fakeProvider('anthropic', async () => {
        throw new RateLimitError('Too many requests per minute', {
          status: 429,
          limit: 'requests per minute',
        });
      }),
    ]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q');
    expect(r.fallback).toBe('rate_limit');
    expect(r.note).toContain('requests per minute');
    expect(r.answer.length).toBeGreaterThan(0);
  });

  it('falls back on refusal and keeps the cost of the refused call', async () => {
    const usage = { inputTokens: 100, outputTokens: 0, costUsd: 0.002 };
    const router = new BrainRouter([
      fakeProvider('anthropic', async () => {
        throw new RefusalError('declined', usage);
      }),
    ]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q');
    expect(r.fallback).toBe('refused');
    expect(r.usage).toEqual(usage);
  });

  it('keeps the cost of a call that gave no answer', async () => {
    const usage = { inputTokens: 100, outputTokens: 20, costUsd: 0.003 };
    const router = new BrainRouter([
      fakeProvider('anthropic', async () => {
        throw new NoDecisionError('nothing', usage);
      }),
    ]);
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q');
    expect(r.fallback).toBe('error');
    expect(r.usage).toEqual(usage);
  });

  it('times out a call that never resolves and answers quickly', async () => {
    const router = new BrainRouter([fakeProvider('anthropic', () => new Promise(() => {}))]);
    const started = Date.now();
    const r = await askAboutPerson(router, brain(), digestFixture(), 'q', { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.fallback).toBe('error');
    expect(r.note).toContain('timed out');
  });
});

describe('BrainRouter.generate', () => {
  it('returns notSetUp for an unknown provider without calling anything', async () => {
    const router = new BrainRouter([]);
    const r = await router.generate(
      { provider: 'openai', model: 'm', effort: 'frugal' },
      {
        model: 'm',
        system: 's',
        user: 'u',
        toolName: 't',
        toolDescription: 'd',
        schema: {},
        maxTokens: 10,
      },
    );
    expect(r.notSetUp).toBe(true);
    expect(r.output).toBeNull();
  });
});
