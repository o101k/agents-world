import type { BrainConfig, EffortLevel, ProviderStatus } from '@aw/shared';

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  frugal: 'Frugal',
  standard: 'Standard',
  deep: 'Deep',
};

/** The brain every new world's villagers start on: the first AI that is set up, else the free mock. */
export function defaultBrainFor(providers: ProviderStatus[] | undefined): BrainConfig {
  const ready = providers?.find((p) => p.configured);
  return ready
    ? { provider: ready.id, model: '', effort: 'frugal' }
    : { provider: 'mock', model: '', effort: 'frugal' };
}

/** A brain in two short lines for a table cell, e.g. "Anthropic (Claude)" / "default model · Frugal". */
export function describeBrain(
  brain: BrainConfig,
  providers: ProviderStatus[] | undefined,
): { title: string; detail: string; notSetUp: boolean } {
  if (brain.provider === 'mock')
    return { title: 'Mock', detail: 'free rulebook, no AI', notSetUp: false };
  const p = providers?.find((x) => x.id === brain.provider);
  return {
    title: p?.label ?? brain.provider,
    detail: `${brain.model || (p?.defaultModel ? `${p.defaultModel} (default)` : 'default model')} · ${EFFORT_LABELS[brain.effort]}`,
    // Until the providers have loaded, don't cry wolf.
    notSetUp: providers !== undefined && !p?.configured,
  };
}

/** 1,234,567: exact counts, so what was spent can be checked against the provider's bill. */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
