import type { BrainConfig, Decision, DecisionRequest, ProviderId } from '@aw/shared';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache (cheaper). */
  cachedInputTokens?: number;
  costUsd: number;
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
}
