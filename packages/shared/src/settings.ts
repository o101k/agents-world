import { z } from 'zod';
import type { ProviderId } from './agent.ts';

/** Price per million tokens, USD. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cache reads (defaults to 10% of input). */
  cachedInput?: number;
}

export interface ProviderStatus {
  id: Exclude<ProviderId, 'mock'>;
  /** 'api' = pay per token with an API key; 'plan' = a subscription via CLI (`claude` or `agy`). */
  kind: 'api' | 'plan';
  label: string;
  configured: boolean;
  /** e.g. "sk-…abcd" — never the key itself. */
  keyHint: string | null;
  /** Where the key comes from. */
  keySource: 'settings' | 'environment' | null;
  baseUrl: string | null;
  defaultModel: string;
  /** Plan providers: where the CLI command (`claude` or `agy`) is (or null). */
  cliPath?: string | null;
  /** Plan providers: a plain sentence on whether it's ready, and what to do if not. */
  message?: string;
  /** Plan providers: models discovered from the CLI when supported. */
  models?: { id: string; label: string }[];
}

export interface SettingsResponse {
  providers: ProviderStatus[];
  prices: Record<string, ModelPrice>;
  dataDir: string;
}

const FORBIDDEN_PRICE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Empty string clears the base URL; otherwise it must be a valid http(s) URL without credentials. */
export const BaseUrlSchema = z
  .string()
  .max(300)
  .refine((v) => {
    const trimmed = v.trim();
    if (!trimmed) return true;
    // http(s)://host[:port][/path], no whitespace and no user:pass@ before the first slash.
    return /^https?:\/\/[^\s/@?#]+(?:[/?#]\S*)?$/i.test(trimmed);
  }, 'Base URL must be a valid http:// or https:// URL without embedded credentials');

export const ProviderUpdate = z.object({
  /** New key; empty string removes it. Omit to keep. */
  apiKey: z.string().max(500).optional(),
  baseUrl: BaseUrlSchema.optional(),
  defaultModel: z.string().max(200).optional(),
  /** Plan providers: full path to the CLI command (`claude` or `agy`); empty string = find it automatically. */
  cliPath: z.string().max(500).optional(),
});
export type ProviderUpdate = z.infer<typeof ProviderUpdate>;

export const PricesUpdate = z
  .record(
    z
      .string()
      .min(1)
      .max(200)
      .refine((k) => !FORBIDDEN_PRICE_KEYS.has(k), 'Invalid model key'),
    z
      .object({
        input: z.number().finite().min(0).max(10_000),
        output: z.number().finite().min(0).max(10_000),
        cachedInput: z.number().finite().min(0).max(10_000).optional(),
      })
      .nullable(),
  )
  .refine((r) => Object.keys(r).length <= 200, 'At most 200 price entries per update');

export const BrainConfigSchema = z.object({
  provider: z.enum([
    'mock',
    'anthropic',
    'openai',
    'openai_compatible',
    'claude_plan',
    'agy_plan',
  ]),
  model: z.string().max(200),
  effort: z.enum(['frugal', 'standard', 'deep']),
});

export const SpawnRequest = z.object({
  description: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(40).optional(),
  sex: z.enum(['female', 'male']).optional(),
  age: z.number().finite().min(16).max(90).optional(),
});
export type SpawnRequest = z.infer<typeof SpawnRequest>;

export const CapRequest = z.object({ capUsd: z.number().finite().min(0).max(10000) });
