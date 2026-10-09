import { z } from 'zod';
import type { LifeStage, MemoryKind, ProviderId, Sex } from './agent.ts';

/**
 * Asking about a villager: the observer asks a question about one person and a period of their
 * life; the person's own brain (same provider and model) answers with a summary written from the
 * village's record of them. Asking never changes the world: no input, no memory, nothing the
 * person knows about.
 */

/** What one line of a person's record is. */
export const RECORD_KINDS = ['event', 'said', 'thought', 'diary', 'memory'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * One line of what the village holds about a person: something that happened to them (`event`),
 * something they said or were told face to face (`said`), what they were thinking when they
 * decided something (`thought`), their own diary or life chapter (`diary`), or something they
 * remember hearing or noting (`memory`).
 */
export interface RecordEntry {
  tick: number;
  kind: RecordKind;
  text: string;
  /** 1 (trivial) – 10 (life-changing). */
  importance: number;
  /** For lines from the world's history (`event`, `said`, `diary`): the stored event's kind. */
  eventKind?: string;
  /** For memories: how they came to know it. */
  memoryKind?: MemoryKind;
  /** A memory they have since forgotten (the observer still sees it). */
  forgotten?: boolean;
}

/** The period asked about, as the AI and the mock summary see it. */
export interface DigestPeriod {
  fromTick: number;
  toTick: number;
  /** e.g. "Day 3, 07:00 – Day 5, 14:00". */
  label: string;
  /** The period is their whole time in the world. */
  wholeLife: boolean;
  /** The period runs up to now (or to their death). */
  endsNow: boolean;
}

/**
 * What a person's brain reads to answer a question about them: who they are now, and their record
 * for the period (chosen to fit a budget). Built by the helper from the world's history; the brain
 * never sees the world itself, and this never enters anyone's own decision prompts.
 */
export interface PersonDigest {
  agentId: string;
  /** Full name. */
  name: string;
  firstName: string;
  sex: Sex;
  /** Whole years, now. */
  age: number;
  stage: LifeStage;
  alive: boolean;
  /** e.g. "Died on Day 9, 14:20 of illness, aged 61." */
  death?: string;
  occupation: string;
  traits: string;
  background: string;
  /** Temperament in words, e.g. "very curious, outgoing, easily worried". */
  temperament: string;
  home: string | null;
  money: number;
  /** Best skills, e.g. "farming 34". */
  skills: string[];
  /** e.g. "Partner: Tom Miller", "Child: Ava Miller (3)", "Mother: Edda Holt (dead)". */
  family: string[];
  /** Strongest feelings about others, e.g. "Tom Miller: loves, trusts". */
  relationships: string[];
  /** Their life chapters (in their own words), oldest first. */
  chapters: string[];
  beliefs: string[];
  period: DigestPeriod;
  /** Routine things done in the period, most first, e.g. { kind: 'gathered', label: 'gathering', count: 34 }. */
  activity: { kind: string; label: string; count: number }[];
  /** The people they dealt with most in the period. */
  companions: { name: string; count: number }[];
  /** The lines chosen for the prompt, oldest first. */
  entries: RecordEntry[];
  /** Lines in the period in all. */
  total: number;
  /** Lines left out to keep it short. */
  omitted: number;
}

/** Why the free summary answered instead of the person's AI. */
export type InterviewFallback =
  | 'mock_brain'
  | 'not_set_up'
  | 'cap_reached'
  | 'rate_limit'
  | 'error'
  | 'refused';

/** One question asked about a person and its answer, as saved in the world file. */
export interface InterviewView {
  id: number;
  agentId: string;
  /** The world's tick when it was asked. */
  askedTick: number;
  fromTick: number;
  toTick: number;
  question: string;
  answer: string;
  /** Who answered: the provider that wrote it ('mock' for the free summary). */
  provider: ProviderId;
  model: string;
  costUsd: number;
  /** Made on the Claude subscription: `costUsd` is its API-price value, not billed. */
  plan: boolean;
  /** Lines of their record in the period, and how many the answer was written from. */
  recordCount: number;
  usedCount: number;
  /** Set when the free summary answered instead of their AI. */
  fallback?: InterviewFallback;
  /** Plain words for the observer when something went differently (why the free summary answered). */
  note?: string;
  /** Real time it was asked (ISO). */
  createdAt: string;
}

export const AskRequest = z.object({
  /** Empty = "What did they do?" */
  question: z.string().trim().max(500).default(''),
  fromTick: z.number().int().min(0),
  toTick: z.number().int().min(0),
});
export type AskRequest = z.input<typeof AskRequest>;

export interface AskResponse {
  interview: InterviewView;
}

export interface InterviewsResponse {
  /** Oldest first. */
  interviews: InterviewView[];
  /** Their whole time in the world: from birth or arrival to now (or their death). */
  lifeFromTick: number;
  lifeToTick: number;
  /** The world's tick now. */
  nowTick: number;
  /** In-game days per year of age (for the "a year" period). */
  daysPerYear: number;
}

export const RecordQuery = z.object({
  /** Period start (omitted = their first tick). */
  from: z.coerce.number().int().min(0).optional(),
  /** Period end (omitted = now, or their death). */
  to: z.coerce.number().int().min(0).optional(),
  /** Comma-separated record kinds to include (omitted = all). */
  kinds: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RecordQuery = z.input<typeof RecordQuery>;

export interface RecordResponse {
  agentId: string;
  lifeFromTick: number;
  lifeToTick: number;
  /** The period actually used (clamped to their life). */
  fromTick: number;
  toTick: number;
  /** Newest first. */
  entries: RecordEntry[];
  /** Lines of each kind in the period (whatever the kinds filter). */
  counts: Record<RecordKind, number>;
  /** Lines matching the filter (for paging). */
  total: number;
  /** Their whole life, one row per in-game day (day = floor(tick / 1440) + 1), oldest first. */
  days: { day: number; entries: number; notable: number }[];
}
