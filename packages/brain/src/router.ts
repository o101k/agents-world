import type {
  BrainConfig,
  Decision,
  DecisionRequest,
  DecisionTrigger,
  Perception,
  ProviderId,
} from '@aw/shared';
import { MockBrain, mockDecide } from './mock.ts';
import {
  NoDecisionError,
  RefusalError,
  RateLimitError,
  type BrainProvider,
  type BrainResult,
  type GenerateRequest,
  type GenerateResult,
  type Usage,
} from './types.ts';

export interface RateLimitInfo {
  /** The provider's own words. */
  message: string;
  resetsAt?: number;
  status?: number;
  limit?: string;
  retryAfterSec?: number;
}

export interface RoutedResult {
  result: BrainResult | null;
  /** Provider actually used ('mock' when the configured one is unavailable or instinct handled it). */
  provider: ProviderId;
  model: string;
  /** Handled by instinct (no AI call) to save money on routine bodily needs. */
  instinct?: boolean;
  /** The configured provider wasn't set up; the mock brain stood in. */
  fallback?: boolean;
  error?: string;
  timedOut?: boolean;
  /** A rate or usage limit was hit (the decision was not made; ask again once it lifts). */
  limit?: RateLimitInfo;
}

/** What `BrainRouter.generate` gives back: never throws; failures are described instead. */
export interface RoutedGenerate {
  /** The provider asked (when it exists). */
  provider: ProviderId;
  model: string;
  /** The tool's input (or JSON found in the text); null on failure or when the model gave none. */
  output: unknown;
  /** Any plain text the model wrote. */
  text?: string;
  /** What the call cost, also when it then failed (refusal, no answer). */
  usage?: Usage;
  latencyMs: number;
  /** The provider isn't set up, or can't do free-form calls. Nothing was sent. */
  notSetUp?: boolean;
  timedOut?: boolean;
  refused?: boolean;
  /** A rate or usage limit was hit. */
  limit?: RateLimitInfo;
  /** What went wrong, in the provider's words (for the call log). */
  error?: string;
}

/**
 * Counting semaphore with priorities: limits simultaneous requests per provider, and when requests
 * queue up (a big village), the most time-sensitive go first (lower number = sooner; FIFO within).
 */
export class PrioritySemaphore {
  private queue: { priority: number; seq: number; go: () => void }[] = [];
  private active = 0;
  private seq = 0;
  constructor(private readonly limit: number) {}
  get waiting(): number {
    return this.queue.length;
  }
  async run<T>(fn: () => Promise<T>, priority = 2, signal?: AbortSignal): Promise<T> {
    const abortError = () =>
      signal?.reason instanceof Error ? signal.reason : new Error('aborted');
    if (signal?.aborted) throw abortError();
    if (this.active < this.limit) {
      this.active++;
    } else {
      await new Promise<void>((resolve, reject) => {
        const entry = {
          priority,
          seq: this.seq++,
          go: () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          },
        };
        const onAbort = () => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.queue.push(entry);
        this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      });
    }
    try {
      if (signal?.aborted) throw abortError();
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next.go();
      else this.active--;
    }
  }
}

/** Conversation replies and emergencies first; routine planning next; night reflection last. */
export function priorityOf(trigger: DecisionTrigger): number {
  switch (trigger.kind) {
    case 'spoken_to':
    case 'offer_received':
    case 'proposal':
    case 'child_request':
    case 'adoption_offer':
    case 'job_offer':
    case 'attacked':
    case 'robbed':
      return 0;
    case 'urgent_need':
    case 'child_needs':
    case 'world_event':
    case 'unwell':
    case 'action_failed':
    case 'child_born':
    case 'orphaned':
    case 'meeting_open':
    case 'rule_proposed':
      return 1;
    case 'reflect':
      return 3;
    default:
      return 2;
  }
}

/**
 * Instinct: at the "frugal" effort level, routine bodily needs (thirst, hunger, bedtime, feeling
 * ill) and the nightly diary are handled by the free rulebook instead of an AI call. Everything
 * social, surprising or open-ended — and the yearly life chapter — still goes to the agent's AI.
 * This is the biggest cost lever for a very-low budget.
 */
export function instinctApplies(p: Perception): boolean {
  if (p.effort !== 'frugal') return false;
  const t = p.trigger;
  if (t.kind === 'urgent_need' || t.kind === 'unwell') return true;
  if (t.kind === 'reflect') return t.scope === 'day';
  const bedtime = (p.clock.isNight || p.clock.hour >= 21) && p.self.needs.energy < 85;
  return (t.kind === 'plan_done' || t.kind === 'check_in') && bedtime;
}

const CONCURRENCY: Record<ProviderId, number> = {
  mock: 64,
  anthropic: 6,
  openai: 6,
  openai_compatible: 2,
  // Each call starts a `claude` process, and a subscription is for one person's use.
  claude_plan: 3,
};

export class BrainRouter {
  private providers = new Map<ProviderId, BrainProvider>();
  private readonly mock = new MockBrain();
  private readonly limits = new Map<ProviderId, PrioritySemaphore>();

  constructor(providers: BrainProvider[] = []) {
    this.providers.set('mock', this.mock);
    for (const p of providers) this.providers.set(p.id, p);
  }

  /** Replace the configured providers (after settings change). */
  setProviders(providers: BrainProvider[]): void {
    this.providers = new Map([['mock', this.mock]]);
    for (const p of providers) this.providers.set(p.id, p);
  }

  register(provider: BrainProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): BrainProvider | undefined {
    return this.providers.get(id);
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  /**
   * A free-form structured call on a person's brain (e.g. answering the observer's question about
   * them), queued with that provider's decisions under the same concurrency limit and timeout.
   * Never throws. A rate limit is reported, not acted on: it doesn't pause the world.
   */
  async generate(
    config: BrainConfig,
    req: GenerateRequest,
    opts: { priority?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<RoutedGenerate> {
    const { priority = 1, timeoutMs = 90_000, signal } = opts;
    const model = req.model || config.model;
    const provider = this.providers.get(config.provider);
    // Nothing is sent to the mock brain or to a provider that can't do free-form calls.
    if (config.provider === 'mock' || !provider?.generate) {
      return {
        provider: config.provider,
        model,
        output: null,
        latencyMs: 0,
        notSetUp: true,
      };
    }
    if (signal?.aborted) {
      return {
        provider: provider.id,
        model,
        output: null,
        latencyMs: 0,
        error: 'aborted',
      };
    }
    let sem = this.limits.get(provider.id);
    if (!sem) this.limits.set(provider.id, (sem = new PrioritySemaphore(CONCURRENCY[provider.id])));

    const timeoutController = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([timeoutController.signal, signal])
      : timeoutController.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const abortRace = new Promise<'timeout' | 'aborted'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
        timeoutController.abort();
      }, timeoutMs);
      if (signal) {
        onAbort = () => resolve('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    const started = performance.now();
    const latency = () => Math.round(performance.now() - started);
    const task = sem.run<GenerateResult>(
      // A request that timed out or aborted while still queued is dropped, never sent (and never paid for).
      () => provider.generate!({ ...req, model }, combinedSignal),
      priority,
      combinedSignal,
    );
    task.catch(() => {});
    try {
      const out = await Promise.race([task, abortRace]);
      if (out === 'timeout')
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          timedOut: true,
          error: 'timed out',
        };
      if (out === 'aborted')
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          error: 'aborted',
        };
      return {
        provider: provider.id,
        model: out.model,
        output: out.output,
        text: out.text,
        usage: out.usage,
        latencyMs: latency(),
      };
    } catch (err) {
      if (timeoutController.signal.aborted)
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          timedOut: true,
          error: 'timed out',
        };
      if (signal?.aborted)
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          error: 'aborted',
        };
      const message = (err as Error).message ?? String(err);
      if (err instanceof RateLimitError)
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          error:
            `Rate limit${err.details.status ? ` (${err.details.status})` : ''}: ${err.message}`.slice(
              0,
              500,
            ),
          limit: { message: err.message, ...err.details },
        };
      if (err instanceof RefusalError)
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          refused: true,
          usage: err.usage,
          error: `Refused: ${message}`.slice(0, 500),
        };
      if (err instanceof NoDecisionError)
        return {
          provider: provider.id,
          model,
          output: null,
          latencyMs: latency(),
          usage: err.usage,
          error: `Error: ${message}`.slice(0, 500),
        };
      return {
        provider: provider.id,
        model,
        output: null,
        latencyMs: latency(),
        error: message.slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    timeoutMs = 60_000,
    signal?: AbortSignal,
  ): Promise<RoutedResult> {
    const p = request.perception;
    if (config.provider !== 'mock' && instinctApplies(p)) {
      const decision = mockDecide(p);
      return {
        result: {
          decision: { ...decision, thought: `(instinct) ${decision.thought}` },
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
        provider: 'mock',
        model: 'instinct',
        instinct: true,
      };
    }
    const provider = this.providers.get(config.provider);
    if (!provider) {
      const decision = mockDecide(p);
      return {
        result: { decision },
        provider: 'mock',
        model: 'mock',
        fallback: config.provider !== 'mock',
      };
    }
    if (signal?.aborted) {
      return {
        result: null,
        provider: provider.id,
        model: config.model,
        error: 'aborted',
      };
    }
    let sem = this.limits.get(provider.id);
    if (!sem) this.limits.set(provider.id, (sem = new PrioritySemaphore(CONCURRENCY[provider.id])));

    const timeoutController = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([timeoutController.signal, signal])
      : timeoutController.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const abortRace = new Promise<'timeout' | 'aborted'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
        timeoutController.abort();
      }, timeoutMs);
      if (signal) {
        onAbort = () => resolve('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    const task = sem.run<BrainResult>(
      // A request that timed out or aborted while still queued is dropped, never sent (and never paid for).
      () => provider.decide(request, config, combinedSignal),
      priorityOf(p.trigger),
      combinedSignal,
    );
    task.catch(() => {});
    try {
      const out = await Promise.race([task, abortRace]);
      if (out === 'timeout')
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          timedOut: true,
          error: 'timed out',
        };
      if (out === 'aborted')
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          error: 'aborted',
        };
      return { result: out, provider: provider.id, model: out.trace?.model ?? config.model };
    } catch (err) {
      if (timeoutController.signal.aborted)
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          timedOut: true,
          error: 'timed out',
        };
      if (signal?.aborted)
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          error: 'aborted',
        };
      if (err instanceof RateLimitError)
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          error:
            `Rate limit${err.details.status ? ` (${err.details.status})` : ''}: ${err.message}`.slice(
              0,
              500,
            ),
          limit: { message: err.message, ...err.details },
        };
      // Never stall the world on a failed call: the person hesitates briefly and tries again later.
      const refused = err instanceof RefusalError;
      const decision: Decision = {
        thought: refused
          ? '(I hesitate, unsure what to do.)'
          : '(My thoughts are muddled for a moment.)',
        goal: 'Pause',
        plan: [{ type: 'rest', minutes: 15 }],
      };
      return {
        // A completed call that gave no decision was still paid for.
        result: {
          decision,
          usage: refused || err instanceof NoDecisionError ? err.usage : undefined,
        },
        provider: provider.id,
        model: config.model,
        error: `${refused ? 'Refused' : 'Error'}: ${(err as Error).message}`.slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
}
