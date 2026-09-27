import { TICKS_PER_DAY, TICKS_PER_HOUR, tickToClock, type Decision } from '@aw/shared';
import { forgetMemory, fullName, type Agent, type Memory } from './agent.ts';
import { emit, type Ctx } from './engine.ts';
import { recallFor } from './perception.ts';
import type { WorldState } from './world.ts';

const H = TICKS_PER_HOUR;
/** Beliefs a person holds at once (the oldest give way to new ones). */
const BELIEF_LIMIT = 8;
/** Importance at and above which a memory never fades (core memories: births, deaths, partners). */
const CORE = 9;

/** The night a tick belongs to: evenings and small hours count toward the day that just ended. */
export function nightOf(tick: number): number {
  return Math.floor((tick - 6 * H) / TICKS_PER_DAY);
}

/**
 * How much of its strength a memory keeps each night: important ones fade slowly, core ones not
 * at all, and memories from the first three years mostly fade whatever they were.
 */
export function nightlyRetention(m: Memory): number {
  if (m.kind === 'chapter') return 1;
  if (m.early) return 0.8;
  if (m.importance >= CORE) return 1;
  return 0.85 + 0.014 * m.importance;
}

/** Everything about remembering that happens by itself: fading, reflecting at night, chapters. */
export function memoryTick(ctx: Ctx, agent: Agent): void {
  const { state } = ctx;
  if (state.tick % TICKS_PER_DAY === 3 * H) {
    fadeMemories(agent);
    upbringing(state, agent);
  }
  if (agent.age < 3) {
    // The very young don't reflect or keep a life story yet.
    agent.lastChapterAge = Math.floor(agent.age);
    return;
  }
  const { hour } = tickToClock(state.tick);
  const night = nightOf(state.tick);
  if (!agent.asleep || agent.awaiting || (hour < 21 && hour >= 5) || night <= agent.lastReflectDay)
    return;
  const scope = Math.floor(agent.age) > agent.lastChapterAge && agent.age >= 4 ? 'year' : 'day';
  // An uneventful day needs no diary entry (and costs nothing); a birthday always gets a chapter.
  if (scope === 'day' && !agent.memories.some((m) => m.tick > state.tick - TICKS_PER_DAY)) return;
  agent.lastReflectDay = night;
  agent.awaiting = { kind: 'reflect', scope };
}

/** Nightly fading: memories lose strength unless important; below 1 they are forgotten. */
export function fadeMemories(agent: Agent): number {
  let forgotten = 0;
  for (let i = agent.memories.length - 1; i >= 0; i--) {
    const m = agent.memories[i]!;
    m.strength = Math.round(m.strength * nightlyRetention(m) * 1000) / 1000;
    if (m.strength < 1) {
      forgetMemory(agent, i);
      forgotten++;
    }
  }
  return forgotten;
}

/** Children's temperament drifts a little toward the grown-ups raising them. */
function upbringing(state: WorldState, child: Agent): void {
  if (child.age < 1 || child.age >= 13) return;
  const carers = state.agents.filter(
    (a) =>
      a.alive &&
      a.age >= 18 &&
      (a.id === child.motherId ||
        a.id === child.fatherId ||
        (child.homeId !== null && a.homeId === child.homeId)),
  );
  if (carers.length === 0) return;
  for (const k of Object.keys(child.personality) as (keyof Agent['personality'])[]) {
    const avg = carers.reduce((s, c) => s + c.personality[k], 0) / carers.length;
    child.personality[k] =
      Math.round((child.personality[k] + (avg - child.personality[k]) * 0.02) * 10) / 10;
  }
}

/** Memories that come to mind when deciding are refreshed (remembering keeps memories alive). */
export function reinforceRecalled(state: WorldState, agent: Agent): void {
  for (const m of recallFor(state, agent)) m.strength = Math.min(10, m.strength + 0.5);
}

const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Apply a night's reflection: a diary entry for the day (or a chapter for the year, which folds
 * that year's diary entries into one), and the beliefs the person has come to.
 */
export function applyReflection(
  ctx: Ctx,
  agent: Agent,
  scope: 'day' | 'year',
  decision: Decision,
): void {
  const { state } = ctx;
  const tick = state.tick;
  const text = clean(decision.diary || decision.thought, 1200);
  if (scope === 'year') {
    const age = Math.floor(agent.age);
    agent.lastChapterAge = age;
    if (text) {
      // This year's diary is folded into the chapter (the world history keeps every entry).
      agent.memories = agent.memories.filter((m) => m.kind !== 'diary');
      agent.memories.push({
        tick,
        text: `My ${ordinal(age)} year: ${text}`,
        importance: 9,
        kind: 'chapter',
        people: [],
        strength: 9,
      });
      emit(ctx, 'reflected', [agent.id], `${fullName(agent)} looked back on a year: “${text}”`, 3);
    }
  } else if (text) {
    agent.memories.push({
      tick,
      text: `Diary: ${text}`,
      importance: 6,
      kind: 'diary',
      people: [],
      strength: 6,
    });
    emit(ctx, 'reflected', [agent.id], `${fullName(agent)}'s diary: “${text}”`, 2);
  }
  for (const raw of (decision.beliefs ?? []).slice(0, 3)) {
    const belief = clean(raw, 300);
    if (!belief) continue;
    const same = agent.memories.find((m) => m.kind === 'belief' && m.text === belief);
    if (same) {
      same.strength = Math.min(10, same.strength + 2);
      same.tick = tick;
      continue;
    }
    agent.memories.push({
      tick,
      text: belief,
      importance: 6,
      kind: 'belief',
      people: [],
      strength: 6,
    });
  }
  // Newer beliefs push out the oldest.
  const beliefs = agent.memories.filter((m) => m.kind === 'belief').sort((a, b) => a.tick - b.tick);
  for (const old of beliefs.slice(0, Math.max(0, beliefs.length - BELIEF_LIMIT)))
    forgetMemory(agent, agent.memories.indexOf(old));
  if (text) agent.thought = text;
}

/** The day's memories (for a diary) or the year's diary and big moments (for a chapter). */
export function reflectionMaterial(
  state: WorldState,
  agent: Agent,
  scope: 'day' | 'year',
): string[] {
  const stamp = (t: number) => {
    const c = tickToClock(t);
    return `[Day ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}]`;
  };
  if (scope === 'day') {
    return agent.memories
      .filter(
        (m) =>
          m.tick > state.tick - TICKS_PER_DAY &&
          m.kind !== 'belief' &&
          m.kind !== 'diary' &&
          m.kind !== 'chapter',
      )
      .sort((a, b) => b.importance - a.importance || a.tick - b.tick)
      .slice(0, 16)
      .sort((a, b) => a.tick - b.tick)
      .map((m) => `${stamp(m.tick)} ${m.text}`);
  }
  const lastChapter = agent.memories
    .filter((m) => m.kind === 'chapter')
    .reduce((t, m) => Math.max(t, m.tick), -Infinity);
  return agent.memories
    .filter(
      (m) =>
        m.tick > lastChapter &&
        (m.kind === 'diary' || (m.importance >= 7 && m.kind !== 'belief' && m.kind !== 'chapter')),
    )
    .sort((a, b) => a.tick - b.tick)
    .slice(-30)
    .map((m) => `${stamp(m.tick)} ${m.text}`);
}

/** The latest life chapters and current beliefs, for the prompt. */
export function lifeStory(agent: Agent): { chapters: string[]; beliefs: string[] } {
  const chapters = agent.memories
    .filter((m) => m.kind === 'chapter')
    .sort((a, b) => a.tick - b.tick)
    .slice(-4)
    .map((m) => m.text);
  const beliefs = agent.memories
    .filter((m) => m.kind === 'belief')
    .sort((a, b) => b.strength - a.strength || b.tick - a.tick)
    .slice(0, 6)
    .map((m) => m.text);
  return { chapters, beliefs };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
