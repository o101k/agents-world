import {
  formatClock,
  type InterviewView,
  type RecordEntry,
  type RecordKind,
  type Sex,
} from '@aw/shared';

/** Pure helpers for asking about a villager (no React, so they're unit-tested in node). */

const TICKS_PER_DAY = 1440;

export function pronounsFor(sex: Sex): { subj: string; obj: string; poss: string } {
  return sex === 'female'
    ? { subj: 'she', obj: 'her', poss: 'her' }
    : { subj: 'he', obj: 'him', poss: 'his' };
}

export interface Suggestion {
  text: string;
  /** 'life' switches the period to their whole life before asking. */
  period?: 'life';
}

/** Suggested questions. The questions use pronouns, so the name is not needed in the text. */
export function suggestionsFor(_firstName: string, sex: Sex): Suggestion[] {
  const { subj, obj, poss } = pronounsFor(sex);
  return [
    { text: `What did ${subj} do?` },
    { text: `Who did ${subj} spend time with?` },
    { text: `How has ${subj} been feeling?` },
    { text: `What does ${subj} want most?` },
    { text: `What went wrong for ${obj}?` },
    { text: `Tell me ${poss} life story.`, period: 'life' },
  ];
}

export const PERIOD_PRESETS = [
  { id: 'hour', label: 'Last hour' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '3days', label: '3 days' },
  { id: 'year', label: 'A year' },
  { id: 'life', label: 'Whole life' },
] as const;
export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]['id'];

export interface PeriodPreset {
  id: PeriodPresetId;
  label: string;
  from: number;
  to: number;
  /** False when the period lies entirely outside their life (e.g. yesterday for a newborn). */
  available: boolean;
}

/** The period presets, clamped to the person's life. `now` never passes their end. */
export function periodPresets(
  nowTick: number,
  lifeFrom: number,
  lifeTo: number,
  daysPerYear: number,
): PeriodPreset[] {
  const now = Math.min(nowTick, lifeTo);
  const dayStart = now - (now % TICKS_PER_DAY);
  const raw: Record<PeriodPresetId, [number, number]> = {
    hour: [now - 60, now],
    today: [dayStart, now],
    yesterday: [dayStart - TICKS_PER_DAY, dayStart - 1],
    '3days': [now - 3 * TICKS_PER_DAY, now],
    year: [now - daysPerYear * TICKS_PER_DAY, now],
    life: [lifeFrom, lifeTo],
  };
  return PERIOD_PRESETS.map((p) => {
    const [a, b] = raw[p.id];
    const from = Math.max(a, lifeFrom);
    const to = Math.min(b, lifeTo);
    return { id: p.id, label: p.label, from, to, available: to >= from };
  });
}

/** "Whole life", "Day 4", "Day 3, 07:00 – 14:00" or "Day 3, 07:00 – Day 5, 14:00". */
export function periodLabel(from: number, to: number, lifeFrom: number, lifeTo: number): string {
  if (from <= lifeFrom && to >= lifeTo) return 'Whole life';
  const dayFrom = Math.floor(from / TICKS_PER_DAY);
  const dayTo = Math.floor(to / TICKS_PER_DAY);
  if (dayFrom === dayTo) {
    if (from % TICKS_PER_DAY === 0 && to % TICKS_PER_DAY === TICKS_PER_DAY - 1) {
      return `Day ${dayFrom + 1}`;
    }
    return `${formatClock(from)} – ${formatClock(to).replace(/^Day \d+, /, '')}`;
  }
  return `${formatClock(from)} – ${formatClock(to)}`;
}

export type AnswerBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

/** Paragraphs split on blank lines; a block of "- " or "* " lines is a bullet list. */
export function answerBlocks(text: string): AnswerBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0)
    .map((lines): AnswerBlock => {
      const isList = lines.every((line) => line.startsWith('- ') || line.startsWith('* '));
      return isList
        ? { kind: 'ul', items: lines.map((line) => line.slice(2).trim()) }
        : { kind: 'p', text: lines.join(' ') };
    });
}

export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  event: 'Happened',
  said: 'Said',
  thought: 'Thoughts',
  diary: 'Diary',
  memory: 'Memories',
};

/** Entries grouped by in-game day, keeping the input order. */
export function groupByDay(entries: RecordEntry[]): { day: number; entries: RecordEntry[] }[] {
  const byDay = new Map<number, RecordEntry[]>();
  for (const entry of entries) {
    const day = Math.floor(entry.tick / TICKS_PER_DAY) + 1;
    const list = byDay.get(day);
    if (list) list.push(entry);
    else byDay.set(day, [entry]);
  }
  return [...byDay].map(([day, list]) => ({ day, entries: list }));
}

/** Same rule as the spending meter: tiny amounts keep four decimals so they don't read as $0. */
function formatUsd(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** Footer for an answer: who wrote it, what it cost and how much of the record it was written from. */
export function answerSource(interview: InterviewView, providerLabel?: string): string {
  let head: string;
  if (interview.provider === 'mock') {
    head = 'Free summary';
    if (interview.fallback === 'mock_brain') head += ' · Mock brain';
    // A paid call that failed still cost money; say so.
    if (interview.costUsd > 0) head += ` · ${formatUsd(interview.costUsd)} spent`;
  } else {
    const model = interview.model || 'default model';
    head = `${providerLabel ?? interview.provider} · ${model} · ${formatUsd(interview.costUsd)}`;
    if (interview.plan) head += ' (plan)';
  }
  return `${head} · read ${interview.usedCount} of ${interview.recordCount} lines`;
}
