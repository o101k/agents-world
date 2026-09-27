import type { BrainConfig, DecisionRequest, ProviderId } from '@aw/shared';
import { MockBrain } from './mock.ts';
import type { BrainProvider, BrainResult } from './types.ts';

export interface RoutedResult {
  result: BrainResult | null;
  /** Provider actually used (may be 'mock' if the configured one is unavailable). */
  provider: ProviderId;
  error?: string;
  timedOut?: boolean;
}

/**
 * Sends each decision request to the provider configured for that agent.
 * Unknown/unconfigured providers fall back to the free mock brain so the world never stalls.
 */
export class BrainRouter {
  private readonly providers = new Map<ProviderId, BrainProvider>();
  private readonly mock = new MockBrain();

  constructor(providers: BrainProvider[] = []) {
    this.providers.set('mock', this.mock);
    for (const p of providers) this.providers.set(p.id, p);
  }

  register(provider: BrainProvider): void {
    this.providers.set(provider.id, provider);
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    timeoutMs = 60_000,
  ): Promise<RoutedResult> {
    const provider = this.providers.get(config.provider) ?? this.mock;
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
        provider.decide(request, config, controller.signal),
        timeout,
      ]);
      if (out === 'timeout')
        return { result: null, provider: provider.id, timedOut: true, error: 'timed out' };
      return { result: out, provider: provider.id };
    } catch (err) {
      return { result: null, provider: provider.id, error: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}
