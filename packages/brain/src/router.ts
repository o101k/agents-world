import type { BrainConfig, Decision, DecisionRequest, Perception, ProviderId } from '@aw/shared';
import { MockBrain, mockDecide } from './mock.ts';
import { RefusalError, type BrainProvider, type BrainResult } from './types.ts';

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
}

/** Simple counting semaphore: limits simultaneous requests per provider. */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
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
};

export class BrainRouter {
  private providers = new Map<ProviderId, BrainProvider>();
  private readonly mock = new MockBrain();
  private readonly limits = new Map<ProviderId, Semaphore>();

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

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    timeoutMs = 60_000,
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
    let sem = this.limits.get(provider.id);
    if (!sem) this.limits.set(provider.id, (sem = new Semaphore(CONCURRENCY[provider.id])));

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const out = await Promise.race([
        sem.run(() => provider.decide(request, config, controller.signal)),
        timeout,
      ]);
      if (out === 'timeout')
        return {
          result: null,
          provider: provider.id,
          model: config.model,
          timedOut: true,
          error: 'timed out',
        };
      return { result: out, provider: provider.id, model: out.trace?.model ?? config.model };
    } catch (err) {
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
        result: { decision },
        provider: provider.id,
        model: config.model,
        error: `${refused ? 'Refused' : 'Error'}: ${(err as Error).message}`.slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
