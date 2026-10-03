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
  /** 'api' = pay per token with an API key; 'plan' = your Claude subscription via Claude Code. */
  kind: 'api' | 'plan';
  label: string;
  configured: boolean;
  /** e.g. "sk-…abcd" — never the key itself. */
  keyHint: string | null;
  /** Where the key comes from. */
  keySource: 'settings' | 'environment' | null;
  baseUrl: string | null;
  defaultModel: string;
  /** Plan providers: where the `claude` command is (or null). */
  cliPath?: string | null;
  /** Plan providers: a plain sentence on whether it's ready, and what to do if not. */
  message?: string;
}

export interface SettingsResponse {
  providers: ProviderStatus[];
  prices: Record<string, ModelPrice>;
  dataDir: string;
}

export const ProviderUpdate = z.object({
  /** New key; empty string removes it. Omit to keep. */
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(300).optional(),
  defaultModel: z.string().max(200).optional(),
  /** Plan providers: full path to the `claude` command; empty string = find it automatically. */
  cliPath: z.string().max(500).optional(),
});
export type ProviderUpdate = z.infer<typeof ProviderUpdate>;

export const PricesUpdate = z.record(
  z.string().min(1).max(200),
  z
    .object({
      input: z.number().min(0),
      output: z.number().min(0),
      cachedInput: z.number().min(0).optional(),
    })
    .nullable(),
);

export const BrainConfigSchema = z.object({
  provider: z.enum(['mock', 'anthropic', 'openai', 'openai_compatible', 'claude_plan']),
  model: z.string().max(200),
  effort: z.enum(['frugal', 'standard', 'deep']),
});

export const SpawnRequest = z.object({
  description: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(60).optional(),
  sex: z.enum(['female', 'male']).optional(),
  age: z.number().min(16).max(90).optional(),
});
export type SpawnRequest = z.infer<typeof SpawnRequest>;

export const CapRequest = z.object({ capUsd: z.number().min(0).max(10000) });
