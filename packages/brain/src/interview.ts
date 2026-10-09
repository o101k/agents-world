import type {
  BrainConfig,
  EffortLevel,
  InterviewFallback,
  PersonDigest,
  ProviderId,
} from '@aw/shared';
import type { BrainRouter } from './router.ts';
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

/** The prompt a person's brain gets to answer a question about them. */
export function interviewPrompt(
  digest: PersonDigest,
  question: string,
  history: InterviewTurn[],
  effort: EffortLevel,
): { system: string; user: string } {
  void digest;
  void question;
  void history;
  void effort;
  throw new Error('interviewPrompt is not built yet');
}

/** The free, offline summary (Mock brain, and whenever the person's AI can't answer). */
export function mockInterview(digest: PersonDigest, question: string): string {
  void digest;
  void question;
  throw new Error('mockInterview is not built yet');
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
  void router;
  void brain;
  void digest;
  void question;
  void opts;
  throw new Error('askAboutPerson is not built yet');
}
