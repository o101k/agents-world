import {
  RECORD_KINDS,
  TICKS_PER_DAY,
  formatClock,
  stageOf,
  type EffortLevel,
  type MemoryKind,
  type Personality,
  type PersonDigest,
  type RecordEntry,
  type RecordKind,
  type RecordQuery,
  type RecordResponse,
  type WorldEvent,
} from '@aw/shared';
import { agentDetail, fullName, type Agent, type WorldState } from '@aw/sim';
import type { WorldFile } from './worldFile.ts';

/**
 * A person's record: everything the village holds about them over a period (what happened to
 * them, what they said and heard, what they thought when deciding, their diary, their memories),
 * for the observer's record browser and, trimmed to a budget, for their brain to answer the
 * observer's questions. Read-only: nothing here changes the world.
 */

/** Longest line kept from the record (the digest cuts shorter, see below). */
const LINE_CAP = 600;
/** Lines the digest keeps from a person's own words, shorter than the record. */
const DIGEST_CAP = 280;
const DIARY_CAP = 600;
const PAGE_LIMIT = 100;

/** How many lines of each kind the digest may hold, and how many characters in all, by effort. */
const QUOTAS: Record<
  EffortLevel,
  { diary: number; notable: number; thought: number; said: number; memory: number; chars: number }
> = {
  frugal: { diary: 10, notable: 40, thought: 15, said: 15, memory: 10, chars: 9_000 },
  standard: { diary: 20, notable: 80, thought: 30, said: 30, memory: 20, chars: 18_000 },
  deep: { diary: 40, notable: 160, thought: 60, said: 60, memory: 40, chars: 36_000 },
};

/** A record query after validation (see `RecordQuery`): numbers are numbers, defaults applied. */
type ParsedRecordQuery = Partial<Pick<RecordQuery, 'kinds'>> & {
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};

/** Their whole time in the world: from birth or arrival (or the world's first tick) to now or their death. */
export function lifeSpan(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
): { from: number; to: number } {
  const from = Math.max(agent.bornTick, file.firstSnapshotTick());
  const end = agent.alive ? state.tick : (agent.death?.tick ?? state.tick);
  return { from, to: Math.max(from, end) };
}

/** A period clamped to a life span (missing ends default to the span's ends; swapped if backwards). */
export function clampPeriod(span: { from: number; to: number }, from?: number, to?: number) {
  let a = from ?? span.from;
  let b = to ?? span.to;
  if (a > b) [a, b] = [b, a];
  a = Math.min(Math.max(a, span.from), span.to);
  b = Math.min(Math.max(b, span.from), span.to);
  return { from: a, to: b };
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const byTick = (a: { tick: number }, b: { tick: number }) => a.tick - b.tick;

/**
 * Up to `n` items, evenly spaced across the list, keeping the first and the last. Deterministic
 * (no randomness), so the same record always gives the same digest.
 */
export function sampleEvenly<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return items.slice();
  if (n === 1) return [items[0] as T];
  const out: T[] = [];
  for (let k = 0; k < n; k++) {
    const index = Math.round((k * (items.length - 1)) / (n - 1));
    out.push(items[index] as T);
  }
  return out;
}

interface Collected {
  /** Every line of the record in the period, oldest first. */
  entries: RecordEntry[];
  /** The world's events they were part of in the period (for companions). */
  events: WorldEvent[];
}

/** Builds every line of the record for [from, to] (a period inside their life span). */
function collect(file: WorldFile, agent: Agent, from: number, to: number): Collected {
  const events = file.agentEvents(agent.id, from, to);
  const entries: RecordEntry[] = [];
  for (const e of events) {
    if (e.kind === 'decided') continue;
    if (e.kind === 'reflected') {
      // Their own diary and life chapters only (not one written about someone else), in their
      // own words: "Maren Holt's diary: “…”" keeps just what's inside the quotes.
      if (e.actors[0] !== agent.id) continue;
      entries.push({
        tick: e.tick,
        kind: 'diary',
        text: clip(
          e.text.match(/^[^“]*?(?:'s diary|looked back on a year): “([\s\S]*)”$/)?.[1] ?? e.text,
          LINE_CAP,
        ),
        importance: e.importance,
        eventKind: e.kind,
      });
    } else if (e.kind === 'said') {
      entries.push({
        tick: e.tick,
        kind: 'said',
        text: clip(e.text, LINE_CAP),
        importance: e.importance,
        eventKind: e.kind,
      });
    } else {
      entries.push({
        tick: e.tick,
        kind: 'event',
        text: clip(e.text, LINE_CAP),
        importance: e.importance,
        eventKind: e.kind,
      });
    }
  }

  // What they were thinking at each decision, collapsing repeats in a row.
  let last: string | null = null;
  for (const d of file.agentDecisions(agent.id, from, to)) {
    const thought = d.thought.trim();
    if (!thought) continue;
    const goal = d.goal.trim();
    const text = clip(goal ? `${thought} (Goal: ${goal})` : thought, LINE_CAP);
    if (text === last) continue;
    last = text;
    entries.push({ tick: d.tick, kind: 'thought', text, importance: 2 });
  }

  // Memories they hold, and those they have since forgotten (the observer still sees them).
  const keep = (m: { tick: number; text: string; importance: number; kind: string }) =>
    m.tick >= from &&
    m.tick <= to &&
    (m.kind === 'told' ||
      m.kind === 'thought' ||
      // What was said to or by them is already a `said` line, and offers and agreements are
      // events; only talk they overheard is new.
      (m.kind === 'conversation' && m.text.startsWith('I overheard')) ||
      (m.kind === 'experience' && m.importance >= 6));
  const memory = (
    m: { tick: number; text: string; importance: number; kind: MemoryKind },
    forgotten: boolean,
  ): RecordEntry => ({
    tick: m.tick,
    kind: 'memory',
    text: clip(m.text, LINE_CAP),
    importance: m.importance,
    memoryKind: m.kind,
    ...(forgotten ? { forgotten: true } : {}),
  });
  for (const m of agent.memories) if (keep(m)) entries.push(memory(m, false));
  for (const m of agent.forgotten) if (keep(m)) entries.push(memory(m, true));

  entries.sort(byTick);
  return { entries, events };
}

/** One page of their record for a period, newest first (see `RecordResponse`). */
export function recordPage(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
  query: ParsedRecordQuery,
): RecordResponse {
  const span = lifeSpan(file, state, agent);
  const period = clampPeriod(span, query.from, query.to);
  const all = collect(file, agent, period.from, period.to).entries;

  const counts = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
  for (const e of all) counts[e.kind]++;

  const kinds = parseKinds(query.kinds);
  const matching = kinds ? all.filter((e) => kinds.has(e.kind)) : all;
  // Newest first; within one tick, the line written last comes first.
  const newestFirst = matching
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.tick - a.entry.tick || b.index - a.index)
    .map((x) => x.entry);
  const offset = query.offset ?? 0;
  const limit = query.limit ?? PAGE_LIMIT;

  const lifeEntries =
    period.from === span.from && period.to === span.to
      ? all
      : collect(file, agent, span.from, span.to).entries;

  return {
    agentId: agent.id,
    lifeFromTick: span.from,
    lifeToTick: span.to,
    fromTick: period.from,
    toTick: period.to,
    entries: newestFirst.slice(offset, offset + limit),
    counts,
    total: matching.length,
    days: dayStrip(lifeEntries, span),
  };
}

/** Parses "event,thought"; unknown kinds are ignored and nothing valid means all kinds. */
function parseKinds(list: string | undefined): Set<RecordKind> | null {
  if (!list) return null;
  const known = list
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is RecordKind => (RECORD_KINDS as readonly string[]).includes(k));
  return known.length ? new Set(known) : null;
}

/** One row per in-game day of the whole life (what they did and thought, not their memories). */
function dayStrip(entries: RecordEntry[], span: { from: number; to: number }) {
  const first = Math.floor(span.from / TICKS_PER_DAY) + 1;
  const last = Math.floor(span.to / TICKS_PER_DAY) + 1;
  const rows = Array.from({ length: last - first + 1 }, (_, i) => ({
    day: first + i,
    entries: 0,
    notable: 0,
  }));
  for (const e of entries) {
    if (e.kind === 'memory') continue;
    const row = rows[Math.floor(e.tick / TICKS_PER_DAY) + 1 - first];
    if (!row) continue;
    row.entries++;
    if (e.importance >= 3) row.notable++;
  }
  return rows;
}

const ACTIVITY_LABELS: Record<string, string> = {
  gathered: 'gathering',
  ate: 'eating',
  drank: 'drinking',
  fell_asleep: 'sleeping',
  woke_up: 'waking up',
  crafted: 'crafting',
  traded: 'trading',
  gave: 'giving',
  fed: 'feeding someone',
  farmed: 'farming',
  tended: 'nursing',
  built: 'building',
};

const FEELING_TRAITS: { key: keyof Personality; high: string; low: string }[] = [
  { key: 'openness', high: 'curious', low: 'conventional' },
  { key: 'conscientiousness', high: 'diligent', low: 'careless' },
  { key: 'extraversion', high: 'outgoing', low: 'reserved' },
  { key: 'agreeableness', high: 'kind', low: 'prickly' },
  { key: 'neuroticism', high: 'easily worried', low: 'calm' },
];

/** Temperament in words: "very curious, outgoing, easily worried". */
function temperamentWords(p: Personality): string {
  const words: string[] = [];
  for (const t of FEELING_TRAITS) {
    const v = p[t.key];
    if (v >= 70) words.push(`very ${t.high}`);
    else if (v >= 55) words.push(t.high);
    else if (v <= 30) words.push(t.low);
  }
  return words.join(', ') || 'even-tempered';
}

/** How they feel about someone, in the same words the inspector uses. */
function feelingWords(p: { affection: number; trust: number; romance: number }): string {
  const like =
    p.affection >= 60
      ? 'loves'
      : p.affection >= 25
        ? 'likes'
        : p.affection > -25
          ? 'neutral'
          : p.affection > -60
            ? 'dislikes'
            : 'hates';
  const trust = p.trust >= 40 ? ', trusts' : p.trust <= -20 ? ', distrusts' : '';
  const romance = p.romance >= 50 ? ', in love' : p.romance >= 20 ? ', attracted' : '';
  return `${like}${trust}${romance}`;
}

/** The first line with each text (oldest first). */
function distinctTexts(items: RecordEntry[]): RecordEntry[] {
  const seen = new Set<string>();
  return items.filter((e) => {
    if (seen.has(e.text)) return false;
    seen.add(e.text);
    return true;
  });
}

/** Lines the digest keeps: the notable ones first, then evenly across the period. */
function pickNotable(items: RecordEntry[], n: number): RecordEntry[] {
  if (items.length <= n) return items;
  const high = items.filter((e) => e.importance >= 6);
  if (high.length >= n) return sampleEvenly(high, n);
  const low = items.filter((e) => e.importance < 6);
  return [...high, ...sampleEvenly(low, n - high.length)].sort(byTick);
}

/** Diary: the most important half of the quota, the rest spread evenly over the period. */
function pickDiary(items: RecordEntry[], n: number): RecordEntry[] {
  if (items.length <= n) return items;
  const top = [...items]
    .sort((a, b) => b.importance - a.importance || a.tick - b.tick)
    .slice(0, Math.ceil(n / 2));
  const kept = new Set(top);
  const rest = items.filter((e) => !kept.has(e));
  return [...top, ...sampleEvenly(rest, n - top.length)].sort(byTick);
}

const ACTIVITY_TOP = 12;
const COMPANIONS_TOP = 8;
const RELATIONSHIPS_TOP = 8;

/** What their brain reads to answer a question about [fromTick, toTick], trimmed by effort. */
export function buildDigest(
  file: WorldFile,
  state: WorldState,
  agent: Agent,
  fromTick: number,
  toTick: number,
  effort: EffortLevel,
): PersonDigest {
  const span = lifeSpan(file, state, agent);
  const period = clampPeriod(span, fromTick, toTick);
  const { entries, events } = collect(file, agent, period.from, period.to);
  const detail = agentDetail(state, agent);
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  const personName = (a: Agent) => fullName(a) + (a.alive ? '' : ' (dead)');
  const nameOf = (id: string) => {
    const a = byId.get(id);
    return a ? personName(a) : id;
  };

  // Family, by who they are to this person.
  const family: string[] = [];
  const relation = (label: string, id: string | null) => {
    const a = id ? byId.get(id) : undefined;
    if (a) family.push(`${label}: ${personName(a)}`);
  };
  relation('Mother', agent.motherId);
  relation('Father', agent.fatherId);
  relation('Partner', agent.partnerId);
  for (const id of agent.childrenIds) {
    const a = byId.get(id);
    if (a) family.push(`Child: ${personName(a)} (age ${Math.floor(a.age)})`);
  }
  for (const id of agent.adoptiveParentIds) relation('Adoptive parent', id);

  const relationships = Object.entries(agent.people)
    .filter(([, p]) => p.name !== null)
    .sort(
      ([, a], [, b]) =>
        Math.abs(b.affection) + b.familiarity - (Math.abs(a.affection) + a.familiarity),
    )
    .slice(0, RELATIONSHIPS_TOP)
    .map(([id, p]) => {
      const a = byId.get(id);
      return `${a ? personName(a) : p.name}: ${feelingWords(p)}`;
    });

  const memories = [...agent.memories].sort(byTick);
  const chapters = memories.filter((m) => m.kind === 'chapter').map((m) => clip(m.text, DIARY_CAP));
  const beliefs = memories.filter((m) => m.kind === 'belief').map((m) => clip(m.text, LINE_CAP));

  // Routine things they did (the notable ones are in the lines below) and the talk they had.
  const tally = new Map<string, number>();
  for (const e of entries) {
    // Waking up is the other half of sleeping; counting both reads oddly.
    if (e.kind === 'event' && e.importance <= 2 && e.eventKind && e.eventKind !== 'woke_up')
      tally.set(e.eventKind, (tally.get(e.eventKind) ?? 0) + 1);
  }
  const activity = [...tally]
    .map(([kind, count]) => ({
      kind,
      label: ACTIVITY_LABELS[kind] ?? kind.replace(/_/g, ' '),
      count,
    }))
    .concat(
      entries.some((e) => e.kind === 'said')
        ? [
            {
              kind: 'said',
              label: 'talking',
              count: entries.filter((e) => e.kind === 'said').length,
            },
          ]
        : [],
    )
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, ACTIVITY_TOP);

  const companionCounts = new Map<string, number>();
  for (const e of events) {
    for (const id of e.actors) {
      if (id !== agent.id) companionCounts.set(id, (companionCounts.get(id) ?? 0) + 1);
    }
  }
  const companions = [...companionCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, COMPANIONS_TOP)
    .map(([id, count]) => ({ name: nameOf(id), count }));

  const quota = QUOTAS[effort];
  const diary = pickDiary(
    entries.filter((e) => e.kind === 'diary'),
    quota.diary,
  );
  const notable = pickNotable(
    entries.filter((e) => e.kind === 'event' && e.importance >= 3),
    quota.notable,
  );
  // The same words said again and again (greetings, routine thoughts) are read once.
  const thoughts = sampleEvenly(
    distinctTexts(entries.filter((e) => e.kind === 'thought')),
    quota.thought,
  );
  const said = sampleEvenly(distinctTexts(entries.filter((e) => e.kind === 'said')), quota.said);
  const memoryLines = sampleEvenly(
    entries.filter((e) => e.kind === 'memory'),
    quota.memory,
  );

  // Cut the text to length, then drop evenly from the biggest group until it fits the budget.
  let lines = [...diary, ...notable, ...thoughts, ...said, ...memoryLines]
    .sort(byTick)
    .map((e) => ({ ...e, text: clip(e.text, e.kind === 'diary' ? DIARY_CAP : DIGEST_CAP) }));
  const chars = (list: { text: string }[]) => list.reduce((sum, l) => sum + l.text.length, 0);
  while (chars(lines) > quota.chars) {
    const byKind = new Map<RecordKind, { chars: number; count: number }>();
    for (const l of lines) {
      const cur = byKind.get(l.kind) ?? { chars: 0, count: 0 };
      cur.chars += l.text.length;
      cur.count++;
      byKind.set(l.kind, cur);
    }
    const biggest = [...byKind]
      .filter(([, stat]) => stat.count > 1)
      .sort((a, b) => b[1].chars - a[1].chars)[0]?.[0];
    if (!biggest) break;
    const group = lines.filter((l) => l.kind === biggest);
    const keep = new Set(sampleEvenly(group, group.length - 1));
    const drop = group.find((l) => !keep.has(l));
    if (!drop) break;
    lines = lines.filter((l) => l !== drop);
  }

  const total = entries.length;
  const death =
    !agent.alive && agent.death
      ? `Died on ${formatClock(agent.death.tick)} of ${agent.death.cause}, aged ${Math.floor(agent.age)}.`
      : undefined;

  return {
    agentId: agent.id,
    name: fullName(agent),
    firstName: agent.name,
    sex: agent.sex,
    age: Math.floor(agent.age),
    stage: stageOf(agent.age),
    alive: agent.alive,
    ...(death ? { death } : {}),
    occupation: agent.occupation,
    traits: agent.traits,
    background: agent.background,
    temperament: temperamentWords(agent.personality),
    home: detail.homeName,
    money: Math.floor(agent.money),
    skills: Object.entries(agent.skills)
      .filter(([, v]) => Math.round(v) > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([skill, v]) => `${skill} ${Math.round(v)}`),
    family,
    relationships,
    chapters,
    beliefs,
    period: {
      fromTick: period.from,
      toTick: period.to,
      label: `${formatClock(period.from)} – ${formatClock(period.to)}`,
      wholeLife: period.from === span.from && period.to === span.to,
      endsNow: period.to === span.to,
    },
    activity,
    companions,
    entries: lines.map(({ kind, tick, importance, text, eventKind, memoryKind, forgotten }) => ({
      tick,
      kind,
      text,
      importance,
      ...(eventKind ? { eventKind } : {}),
      ...(memoryKind ? { memoryKind } : {}),
      ...(forgotten ? { forgotten } : {}),
    })),
    total,
    omitted: total - lines.length,
  };
}
