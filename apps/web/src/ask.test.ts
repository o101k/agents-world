import { describe, expect, it } from 'vitest';
import type { InterviewView } from '@aw/shared';
import {
  answerBlocks,
  answerSource,
  groupByDay,
  periodLabel,
  periodPresets,
  pronounsFor,
  RECORD_KIND_LABELS,
  suggestionsFor,
} from './ask.ts';

const DAY = 1440;

describe('pronouns and suggestions', () => {
  it('picks pronouns by sex', () => {
    expect(pronounsFor('female')).toEqual({ subj: 'she', obj: 'her', poss: 'her' });
    expect(pronounsFor('male')).toEqual({ subj: 'he', obj: 'him', poss: 'his' });
  });

  it('writes the suggestions with the right pronouns', () => {
    const s = suggestionsFor('Tom', 'male');
    expect(s).toHaveLength(6);
    expect(s[0]?.text).toBe('What did he do?');
    expect(s[4]?.text).toBe('What went wrong for him?');
    expect(s[5]).toEqual({ text: 'Tell me his life story.', period: 'life' });
    expect(suggestionsFor('Anna', 'female')[5]?.text).toBe('Tell me her life story.');
  });
});

describe('periodPresets', () => {
  // Born at tick 0; now is day 3 at 07:00.
  const now = 2 * DAY + 7 * 60;
  const presets = periodPresets(now, 0, 10 * DAY, 4);
  const byId = (id: string) => presets.find((p) => p.id === id)!;

  it('computes the periods from now', () => {
    expect(byId('hour')).toMatchObject({ from: now - 60, to: now, available: true });
    expect(byId('today')).toMatchObject({ from: 2 * DAY, to: now });
    expect(byId('yesterday')).toMatchObject({ from: DAY, to: 2 * DAY - 1 });
    expect(byId('3days')).toMatchObject({ from: 0, to: now });
    expect(byId('year')).toMatchObject({ from: 0, to: now });
    expect(byId('life')).toMatchObject({ from: 0, to: 10 * DAY });
  });

  it('clamps to the life and marks empty periods unavailable', () => {
    const newborn = periodPresets(DAY + 100, DAY + 100, 10 * DAY, 4);
    expect(newborn.find((p) => p.id === 'yesterday')!.available).toBe(false);
    const hour = newborn.find((p) => p.id === 'hour')!;
    expect(hour.from).toBe(DAY + 100);
    expect(newborn.find((p) => p.id === '3days')!.from).toBe(DAY + 100);
  });

  it('does not look past the end of a dead person', () => {
    const dead = periodPresets(9 * DAY, 0, 4 * DAY + 30, 4);
    expect(dead.find((p) => p.id === 'today')).toMatchObject({
      from: 4 * DAY,
      to: 4 * DAY + 30,
    });
  });
});

describe('periodLabel', () => {
  const lifeFrom = 0;
  const lifeTo = 10 * DAY;

  it('names the whole life and whole days', () => {
    expect(periodLabel(0, lifeTo, lifeFrom, lifeTo)).toBe('Whole life');
    expect(periodLabel(3 * DAY, 4 * DAY - 1, lifeFrom, lifeTo)).toBe('Day 4');
  });

  it('shows clock times within a day and across days', () => {
    const from = 2 * DAY + 7 * 60;
    expect(periodLabel(from, 2 * DAY + 14 * 60, lifeFrom, lifeTo)).toBe('Day 3, 07:00 – 14:00');
    expect(periodLabel(from, 4 * DAY + 14 * 60, lifeFrom, lifeTo)).toBe(
      'Day 3, 07:00 – Day 5, 14:00',
    );
  });
});

describe('answerBlocks', () => {
  it('joins lines into paragraphs and splits on blank lines', () => {
    expect(answerBlocks('Anna\nspent the day.\n\nShe was tired.')).toEqual([
      { kind: 'p', text: 'Anna spent the day.' },
      { kind: 'p', text: 'She was tired.' },
    ]);
  });

  it('turns a block of dash or star lines into a list', () => {
    expect(answerBlocks('Lead.\n\n- one\n* two\n- three')).toEqual([
      { kind: 'p', text: 'Lead.' },
      { kind: 'ul', items: ['one', 'two', 'three'] },
    ]);
  });

  it('splits a lead line and its bullets, and drops markdown bold', () => {
    expect(
      answerBlocks('Key moments:\n- **Day 2**: sowed wheat\n• Day 3: sold it\nThen rest.'),
    ).toEqual([
      { kind: 'p', text: 'Key moments:' },
      { kind: 'ul', items: ['Day 2: sowed wheat', 'Day 3: sold it'] },
      { kind: 'p', text: 'Then rest.' },
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(answerBlocks('  \n\n ')).toEqual([]);
  });
});

describe('labels and grouping', () => {
  it('labels every record kind', () => {
    expect(RECORD_KIND_LABELS).toEqual({
      event: 'Happened',
      said: 'Said',
      thought: 'Thoughts',
      diary: 'Diary',
      memory: 'Memories',
    });
  });

  it('groups entries by day in input order', () => {
    const e = (tick: number, text: string) => ({
      tick,
      kind: 'event' as const,
      text,
      importance: 3,
    });
    const groups = groupByDay([e(3 * DAY + 5, 'a'), e(3 * DAY + 1, 'b'), e(DAY, 'c')]);
    expect(groups.map((g) => g.day)).toEqual([4, 2]);
    expect(groups[0]?.entries.map((x) => x.text)).toEqual(['a', 'b']);
  });
});

describe('answerSource', () => {
  const base: InterviewView = {
    id: 1,
    agentId: 'a',
    askedTick: 0,
    fromTick: 0,
    toTick: 1,
    question: '',
    answer: '',
    provider: 'mock',
    model: '',
    costUsd: 0,
    plan: false,
    recordCount: 40,
    usedCount: 12,
    createdAt: '',
  };

  it('describes the free summary', () => {
    expect(answerSource(base)).toBe('Free summary · read 12 of 40 lines');
    expect(answerSource({ ...base, fallback: 'mock_brain' })).toBe(
      'Free summary · Mock brain · read 12 of 40 lines',
    );
  });

  it('describes a paid answer with its cost and plan', () => {
    const paid: InterviewView = {
      ...base,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      costUsd: 0.0123,
    };
    expect(answerSource(paid, 'Anthropic (Claude)')).toBe(
      'Anthropic · claude-haiku-4-5 · $0.01 · read 12 of 40 lines',
    );
    expect(answerSource({ ...paid, plan: true, costUsd: 0 }, 'Claude subscription (Pro/Max)')).toBe(
      'Claude subscription · claude-haiku-4-5 · $0 (plan) · read 12 of 40 lines',
    );
  });
});
