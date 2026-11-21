import type { ModelPrice } from '@aw/shared';
import type { Usage } from './types.ts';

/**
 * Default prices in USD per million tokens. Anthropic list prices as of mid-2026; edit them in
 * Settings if they change. Models not listed are costed with FALLBACK_PRICE and flagged as estimates.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'gemini-3.8-flash': { input: 0.15, output: 0.6 },
  'gemini-4-argon': { input: 1.25, output: 10 },
  'gemini-4-neon': { input: 2.5, output: 15 },
  'gemini-4-hydrogen': { input: 2.5, output: 15 },
};

/** Deliberately pessimistic, so unknown models can't sneak past the spending cap. */
export const FALLBACK_PRICE: ModelPrice = { input: 3, output: 15 };

export function priceFor(
  model: string,
  prices: Record<string, ModelPrice>,
): { price: ModelPrice; estimated: boolean } {
  if (prices[model]) return { price: prices[model]!, estimated: false };
  // Tolerate provider prefixes/suffixes, e.g. "anthropic/claude-haiku-4-5".
  const key = Object.keys(prices).find((k) => model.endsWith(k) || model.startsWith(k));
  if (key) return { price: prices[key]!, estimated: false };
  return { price: FALLBACK_PRICE, estimated: true };
}

export function costOf(
  model: string,
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
  prices: Record<string, ModelPrice>,
): Usage {
  const { price, estimated } = priceFor(model, prices);
  const cachedRate = price.cachedInput ?? price.input * 0.1;
  const cost =
    (tokens.input * price.input +
      (tokens.cacheWrite ?? 0) * price.input * 1.25 +
      (tokens.cacheRead ?? 0) * cachedRate +
      tokens.output * price.output) /
    1_000_000;
  return {
    inputTokens: tokens.input + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0),
    outputTokens: tokens.output,
    cachedInputTokens: tokens.cacheRead ?? 0,
    costUsd: cost,
    estimated,
  };
}
