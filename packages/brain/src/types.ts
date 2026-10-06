import type { BrainConfig, Decision, DecisionRequest, ProviderId } from '@aw/shared';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache (cheaper). */
  cachedInputTokens?: number;
  costUsd: number;
  /** True when the model had no known price and a pessimistic default was used. */
  estimated?: boolean;
}

export interface BrainResult {
  decision: Decision;
  usage?: Usage;
  /** What was sent and received, for the mind inspector. */
  trace?: { model: string; prompt: string; response: string; latencyMs: number };
}

/** One way of thinking: a mock rulebook or an AI provider. */
export interface BrainProvider {
  readonly id: ProviderId;
  decide(request: DecisionRequest, config: BrainConfig, signal?: AbortSignal): Promise<BrainResult>;
  /** Model ids the provider offers (for the settings UI). */
  listModels?(): Promise<string[]>;
  /** Free-form structured call (used to flesh out spawned people). */
  generate?(
    req: GenerateRequest,
    signal?: AbortSignal,
  ): Promise<{ output: unknown; usage?: Usage; model: string }>;
}

export interface GenerateRequest {
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

/** Thrown when the model declines to answer. */
export class RefusalError extends Error {
  constructor(
    message: string,
    /** What the completed call cost, so the spending cap still counts it. */
    readonly usage?: Usage,
  ) {
    super(message);
  }
}

/** Thrown when a completed call carried no usable decision (tokens were still paid for). */
export class NoDecisionError extends Error {
  constructor(
    message: string,
    readonly usage?: Usage,
  ) {
    super(message);
  }
}

/**
 * Thrown when a provider says "too many requests" or "limit used up": an API rate limit (HTTP 429)
 * or the Claude subscription's 5-hour / weekly limit. The world pauses until it lifts.
 */
export class RateLimitError extends Error {
  constructor(
    /** The provider's own words. */
    message: string,
    readonly details: {
      /** When the limit lifts (ms since epoch), if the provider said. */
      resetsAt?: number;
      /** HTTP status, e.g. 429. */
      status?: number;
      /** Which limit, in plain words (e.g. "requests per minute", "5-hour plan limit"). */
      limit?: string;
      /** The provider's retry-after, in seconds. */
      retryAfterSec?: number;
    } = {},
  ) {
    super(message);
  }
}
