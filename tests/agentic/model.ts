import { anthropic } from '@ai-sdk/anthropic';
import { openrouter } from '@openrouter/ai-sdk-provider';

/**
 * The model that drives the AI tests: Claude Haiku 5.5, straight from Anthropic or through
 * OpenRouter, whichever key is set (Anthropic when both are, unless E2E_PROVIDER=openrouter).
 * E2E_MODEL sets another model id for that provider; OpenRouter ids look like
 * `anthropic/claude-haiku-5.5`. Any model that handles tool calls and images works.
 */
const providers = {
  anthropic: { key: 'ANTHROPIC_API_KEY', defaultModel: 'claude-haiku-5-5', make: anthropic },
  openrouter: {
    key: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-haiku-5.5',
    make: openrouter,
  },
};

const env = process.env;
const name =
  env.E2E_PROVIDER ||
  (env.ANTHROPIC_API_KEY || !env.OPENROUTER_API_KEY ? 'anthropic' : 'openrouter');
const provider = Object.hasOwn(providers, name)
  ? providers[name as keyof typeof providers]
  : undefined;

/** False when the AI tests can run, else the reason they are skipped. */
export const noModel: false | string = !provider
  ? `E2E_PROVIDER must be "anthropic" or "openrouter" (got "${name}")`
  : env[provider.key]
    ? false
    : env.E2E_PROVIDER
      ? `E2E_PROVIDER=${name} needs ${provider.key}`
      : 'needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY (the AI-driven tests are skipped without one)';

/** Undefined when the AI tests can't run. */
export const model =
  provider && !noModel ? provider.make(env.E2E_MODEL || provider.defaultModel) : undefined;
