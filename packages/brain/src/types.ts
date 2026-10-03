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
export class RefusalError extends Error {}

/** Thrown when a Claude subscription's usage limit (5-hour or weekly) is used up. */
export class UsageLimitError extends Error {
  constructor(
    message: string,
    /** When the limit resets (ms since epoch), if the provider said. */
    readonly resetsAt?: number,
  ) {
    super(message);
  }
}
