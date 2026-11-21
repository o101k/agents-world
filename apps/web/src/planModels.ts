import type { ProviderStatus } from '@aw/shared';

/** Model choices for the Claude subscription (Claude Code's aliases always mean the newest model). */
export const PLAN_MODELS: { id: string; label: string }[] = [
  { id: 'haiku', label: 'Haiku: fastest, makes your limits last longest' },
  { id: 'sonnet', label: 'Sonnet: smarter, uses your limits faster' },
  { id: 'opus', label: 'Opus: smartest, uses your limits fastest' },
];

/** Fallback model choices for the Gemini (`agy`) subscription before `agy models` runs. */
export const AGY_PLAN_MODELS: { id: string; label: string }[] = [
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low): fastest, stretches limits furthest' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
];

export function planModelsFor(
  provider: Pick<ProviderStatus, 'id' | 'models'>,
): { id: string; label: string }[] {
  if (provider.models?.length) return provider.models;
  return provider.id === 'agy_plan' ? AGY_PLAN_MODELS : PLAN_MODELS;
}
