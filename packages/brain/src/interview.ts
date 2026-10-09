import {
  PROVIDER_NAMES,
  STAGE_LABELS,
  formatClock,
  type BrainConfig,
  type EffortLevel,
  type InterviewFallback,
  type PersonDigest,
  type ProviderId,
  type RecordEntry,
} from '@aw/shared';
import type { BrainRouter, RoutedGenerate } from './router.ts';
import type { Usage } from './types.ts';

/** An earlier question and answer about the same person and period (conversation context). */
export interface InterviewTurn {
  question: string;
  answer: string;
}

/** The answer to the observer's question about a person. */
export interface InterviewResult {
  answer: string;
  /** Who wrote it: the person's provider, or 'mock' for the free summary. */
  provider: ProviderId;
  model: string;
  /** What the call cost (also when it failed after being paid for). */
  usage?: Usage;
  /** Set when the free summary answered instead of their AI. */
  fallback?: InterviewFallback;
  /** Why, in plain words for the observer. */
  note?: string;
  /** What was sent and received, for the call log. */
  trace?: { prompt: string; response: string; latencyMs: number };
  /** The provider's error, for the call log. */
  error?: string;
}

/** The question asked when the observer leaves the box empty. */
export const DEFAULT_QUESTION = 'What did they do in this time?';

const WORD_BUDGET: Record<EffortLevel, number> = { frugal: 150, standard: 250, deep: 400 };
const MAX_TOKENS: Record<EffortLevel, number> = { frugal: 800, standard: 1400, deep: 2400 };
const MAX_ANSWER_CHARS = 6000;
const MAX_MOCK_CHARS = 1500;

const SYSTEM_PROMPT = `You are the chronicler of a small pre-industrial village in a life simulation. The observer watches the village but cannot change anything. They ask you about one villager.

Answer ONLY from the record you are given. Never invent people, events or feelings.
Write in the third person, in plain warm English, like a short biography. Lead with the direct answer to the question. Mention the day for key moments ("on Day 4"). If the record doesn't say, say so.

The record mixes what happened (the village's complete history), what the villager thought at the time (their inner monologue), their diary (their own words, which may be biased) and memories (things they heard or were told, which may be untrue).

Keep the answer under %WORDS% words unless the question asks for detail. Paragraphs and "- " bullets are allowed; no headings.
Answer with the \`answer\` tool.`;

const KIND_LABEL: Record<RecordEntry['kind'], string> = {
  event: 'happened',
  said: 'said',
  thought: 'thought',
  diary: 'diary',
  memory: 'memory',
};

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "Day 4, 09:12" -> "Day 4" and "09:12". */
function splitClock(tick: number): { day: string; time: string } {
  const [day = '', time = ''] = formatClock(tick).split(', ');
  return { day, time };
}

function sentenceEnd(text: string): string {
  return /[.!?…”"]$/.test(text) ? text : `${text}.`;
}

/** At most `max` characters, cut at a word, with "…". */
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trimEnd()}…`;
}

/** "a (34 times), b (8) and c (5)". */
function tally(items: { label: string; count: number }[]): string {
  const parts = items.map((it, i) => `${it.label} (${i === 0 ? `${it.count} times` : it.count})`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The most important lines, in time order, as "On Day 4 at 09:12, …" sentences. */
function eventSentences(entries: RecordEntry[], minImportance: number, count: number): string[] {
  return entries
    .filter((e) => e.importance >= minImportance)
    .sort((a, b) => b.importance - a.importance || a.tick - b.tick)
    .slice(0, count)
    .sort((a, b) => a.tick - b.tick)
    .map((e) => {
      const { day, time } = splitClock(e.tick);
      return `On ${day} at ${time}, ${sentenceEnd(e.text)}`;
    });
}

/** Goal from a thought line: "… (Goal: sell bread)". */
const GOAL_RE = /\s*\(Goal: ([\s\S]+)\)$/;

export function interviewPrompt(
  digest: PersonDigest,
  question: string,
  history: InterviewTurn[],
  effort: EffortLevel,
): { system: string; user: string } {
  const lines: string[] = [];
  const status = digest.alive ? 'Alive.' : (digest.death ?? 'Dead.');
  const sex = digest.sex === 'male' ? 'male' : 'female';
  const profile = [sex, String(digest.age), STAGE_LABELS[digest.stage], digest.occupation]
    .filter(Boolean)
    .join(', ');
  lines.push(`About ${digest.name} (${digest.firstName}): ${profile}. ${status}`);
  if (digest.traits) lines.push(`Character: ${digest.traits}`);
  if (digest.temperament) lines.push(`Temperament: ${digest.temperament}`);
  if (digest.background) lines.push(`Background: ${digest.background}`);
  const home = [
    digest.home && `Home: ${digest.home}`,
    `Money: ${digest.money} coins`,
    digest.skills.length && `Skills: ${digest.skills.join(', ')}`,
  ].filter(Boolean);
  lines.push(home.join(' · '));
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push(`${title}:`, ...items.map((i) => `- ${i}`));
  };
  section('Family', digest.family);
  section('Feelings about others', digest.relationships);
  section('Life chapters (in their words)', digest.chapters);
  section('Beliefs', digest.beliefs);

  const p = digest.period;
  lines.push('');
  lines.push(
    `Period asked about: ${p.label}${p.wholeLife ? ' (their whole life in the village)' : ''}${p.endsNow ? ', up to now' : ''}`,
  );
  if (digest.activity.length)
    lines.push(
      `Routine in this period: ${digest.activity.map((a) => `${a.label} ×${a.count}`).join(', ')}`,
    );
  if (digest.companions.length)
    lines.push(
      `Dealt with most: ${digest.companions.map((c) => `${c.name} (${c.count})`).join(', ')}`,
    );
  if (digest.entries.length) {
    const left = digest.omitted ? `; ${digest.omitted} left out to keep it short` : '';
    lines.push(`Record (${digest.entries.length} of ${digest.total} lines${left}), oldest first:`);
    for (const e of digest.entries) {
      const kind = `${KIND_LABEL[e.kind]}${e.forgotten ? ', forgotten' : ''}`;
      lines.push(`[${formatClock(e.tick)}] ${kind}: ${e.text}`);
    }
  } else {
    lines.push('Record: nothing in this period.');
  }

  if (history.length) {
    lines.push('', 'Earlier in this conversation:');
    for (const turn of history) {
      lines.push(`Q: ${turn.question}`, `A: ${cut(turn.answer, 800)}`);
    }
  }

  lines.push('', `Question: ${question.trim() || DEFAULT_QUESTION}`);
  return {
    system: SYSTEM_PROMPT.replace('%WORDS%', String(WORD_BUDGET[effort])),
    user: lines.join('\n'),
  };
}

/** The free, offline summary (Mock brain, and whenever the person's AI can't answer). */
export function mockInterview(digest: PersonDigest, question: string): string {
  const name = digest.firstName;
  const she = digest.sex === 'male' ? 'he' : 'she';
  const her = digest.sex === 'male' ? 'his' : 'her';
  const Her = her[0]!.toUpperCase() + her.slice(1);
  const emptyPeriod = `Nothing is recorded about ${name} in this period (${digest.period.label}).`;
  if (digest.entries.length === 0 && digest.activity.length === 0) return emptyPeriod;

  const q = question.toLowerCase();
  const topic = /life story|whole life|biograph|about (him|her)self/.test(q)
    ? 'story'
    : /feel|mood|happy|sad|angry|afraid|scared|lonely|heart/.test(q)
      ? 'feelings'
      : /who|friend|family|love|partner|spend time|talk|met/.test(q)
        ? 'people'
        : /want|goal|plan|hope|dream|wish|ambition/.test(q)
          ? 'wants'
          : /wrong|bad|trouble|problem|hurt|\bill\b|sick|fight|steal|stole|die|death|danger|fear/.test(
                q,
              )
            ? 'trouble'
            : 'doing';

  const period = digest.period;
  const doing = (() => {
    const lead = period.wholeLife
      ? `Over ${her} whole life so far`
      : `From ${formatClock(period.fromTick)} to ${formatClock(period.toTick)}`;
    const top = digest.activity.slice(0, 3);
    const parts = top.length ? [`${lead}, ${name} spent most of ${her} time ${tally(top)}.`] : [];
    return [
      ...parts,
      ...eventSentences(
        digest.entries.filter((e) => e.kind === 'event'),
        3,
        5,
      ),
    ]
      .join(' ')
      .trim();
  })();

  const people = (() => {
    const parts: string[] = [];
    if (digest.companions.length)
      parts.push(
        `${name} dealt most with ${tally(digest.companions.slice(0, 3).map((c) => ({ label: c.name, count: c.count })))}.`,
      );
    if (digest.relationships.length)
      parts.push(`How ${she} feels about others: ${digest.relationships.slice(0, 3).join('; ')}.`);
    if (digest.family.length) parts.push(`Family: ${digest.family.join('; ')}.`);
    return parts.join(' ');
  })();

  const diary = digest.entries.filter((e) => e.kind === 'diary').at(-1);
  const thought = digest.entries.filter((e) => e.kind === 'thought').at(-1);
  const diarySentence = diary
    ? `In ${her} diary on ${splitClock(diary.tick).day} ${she} wrote: “${cut(diary.text, 400)}”`
    : '';
  const thoughtSentence = thought
    ? `Lately ${she} has been thinking: “${thought.text.replace(GOAL_RE, '')}”`
    : '';
  const feelingsParagraph = [diarySentence, thoughtSentence]
    .filter(Boolean)
    .map(sentenceEnd)
    .join(' ');

  const goals: string[] = [];
  for (const t of digest.entries.filter((e) => e.kind === 'thought').reverse()) {
    const g = GOAL_RE.exec(t.text)?.[1]?.trim();
    if (g && !goals.includes(g)) goals.push(g);
    if (goals.length === 3) break;
  }
  const wants = [
    goals.length ? `${Her} goals lately: ${goals.join('; ')}.` : '',
    thoughtSentence ? sentenceEnd(thoughtSentence) : '',
  ]
    .filter(Boolean)
    .join(' ');

  const TROUBLE_KINDS = new Set([
    'attacked',
    'stole',
    'fell_ill',
    'need_critical',
    'collapsed',
    'died',
    'fire',
    'separated',
    'orphaned',
    'world_event',
  ]);
  const troubles = digest.entries
    .filter((e) => (e.eventKind && TROUBLE_KINDS.has(e.eventKind)) || e.importance >= 7)
    .slice(-5)
    .map((e) => {
      const { day, time } = splitClock(e.tick);
      return `On ${day} at ${time}, ${sentenceEnd(e.text)}`;
    });
  const trouble = troubles.length
    ? troubles.join(' ')
    : `Nothing went badly wrong for ${her === 'his' ? 'him' : 'her'} in this period, as far as the record shows.`;

  const story = (() => {
    // Their latest life chapters, quoted in their own words.
    const chapters = digest.chapters.slice(-2).map((c) => `“${clipWords(c, 280)}”`);
    return [
      digest.background,
      chapters.length ? `Looking back on ${her} life, ${she} wrote: ${chapters.join(' ')}` : '',
      eventSentences(
        digest.entries.filter((e) => e.kind === 'event'),
        6,
        5,
      ).join(' '),
    ]
      .filter(Boolean)
      .join('\n\n');
  })();

  const primary = { doing, people, feelings: feelingsParagraph, wants, trouble, story }[topic];
  const parts = [
    primary,
    topic !== 'doing' ? doing : '',
    topic !== 'feelings' && topic !== 'wants' ? feelingsParagraph : '',
  ].filter(Boolean);
  const answer = parts.length ? parts.join('\n\n') : emptyPeriod;
  return answer.length > MAX_MOCK_CHARS ? `${answer.slice(0, MAX_MOCK_CHARS - 1)}…` : answer;
}

/**
 * Ask a person's brain about them. Never throws: when their AI can't or mustn't answer, the free
 * summary answers with a note saying why.
 */
export async function askAboutPerson(
  router: BrainRouter,
  brain: BrainConfig,
  digest: PersonDigest,
  question: string,
  opts: { history?: InterviewTurn[]; capReached?: boolean; timeoutMs?: number } = {},
): Promise<InterviewResult> {
  const q = question.trim() || DEFAULT_QUESTION;
  const { history = [], capReached = false, timeoutMs = 90_000 } = opts;
  const who = `${digest.firstName}'s brain (${PROVIDER_NAMES[brain.provider]})`;
  const free = (fallback: InterviewFallback, note?: string): InterviewResult => {
    const result: InterviewResult = {
      answer: mockInterview(digest, q),
      provider: 'mock',
      model: 'mock',
      fallback,
    };
    if (note) result.note = note;
    return result;
  };
  const notSetUp = `${who} isn't set up, so this is the free summary. Set it up in Settings to hear from ${digest.firstName}'s AI.`;

  // The Mock brain is the free summary by design: no note needed.
  if (brain.provider === 'mock') return free('mock_brain');
  if (!router.get(brain.provider)?.generate) return free('not_set_up', notSetUp);
  if (capReached)
    return free(
      'cap_reached',
      'The spending cap is reached, so this is the free summary. Raise the cap to ask ' +
        `${digest.firstName}'s AI.`,
    );

  const { system, user } = interviewPrompt(digest, q, history, brain.effort);
  const r: RoutedGenerate = await router.generate(
    brain,
    {
      model: brain.model,
      system,
      user,
      toolName: 'answer',
      toolDescription: 'Give your answer to the observer.',
      schema: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description:
              'Your answer for the observer, in plain prose (paragraphs; "- " bullets allowed).',
          },
        },
        required: ['answer'],
      },
      maxTokens: MAX_TOKENS[brain.effort],
    },
    { priority: 1, timeoutMs },
  );

  // What a paid call cost is kept with the free summary that answers instead.
  const trace = {
    prompt: `${system}\n\n---\n\n${user}`,
    response: r.text || (r.output == null ? '' : JSON.stringify(r.output)),
    latencyMs: r.latencyMs,
  };
  const withCall = (result: InterviewResult): InterviewResult => {
    if (r.usage) result.usage = r.usage;
    result.trace = trace;
    if (r.error) result.error = r.error;
    return result;
  };

  if (r.notSetUp) return free('not_set_up', notSetUp);
  if (r.limit) {
    const limit = r.limit.limit ?? 'rate limit';
    return withCall(
      free(
        'rate_limit',
        `${PROVIDER_NAMES[brain.provider]} hit a limit (${limit}): “${r.limit.message.slice(0, 160)}”. ` +
          `This is the free summary; ask again later to hear from ${digest.firstName}'s AI.`,
      ),
    );
  }
  if (r.refused)
    return withCall(
      free('refused', `${digest.firstName}'s AI declined to answer, so this is the free summary.`),
    );
  const fromTool = (r.output as { answer?: unknown } | null)?.answer;
  const answer =
    typeof fromTool === 'string' && fromTool.trim() ? fromTool.trim() : (r.text ?? '').trim();
  if (r.timedOut || r.error || !answer)
    return withCall(
      free(
        'error',
        `${digest.firstName}'s AI couldn't answer (${r.error ?? 'no answer'}), so this is the free summary.`,
      ),
    );

  const result: InterviewResult = {
    answer: answer.slice(0, MAX_ANSWER_CHARS),
    provider: brain.provider,
    model: r.model,
    trace,
  };
  if (r.usage) result.usage = r.usage;
  return result;
}
