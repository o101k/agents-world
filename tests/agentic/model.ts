import { anthropic } from '@ai-sdk/anthropic';

/** The model that drives the AI tests. Cheapest Claude by default; E2E_MODEL overrides it. */
const modelId = process.env.E2E_MODEL || 'claude-haiku-5-5';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

/** Undefined without ANTHROPIC_API_KEY, so the AI tests have no model to use. */
export const model = hasKey ? anthropic(modelId) : undefined;

/** False when the AI tests can run, else the reason they are skipped. */
export const noModel: false | string = hasKey
  ? false
  : 'needs ANTHROPIC_API_KEY (the AI-driven tests are skipped without it)';
