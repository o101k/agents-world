import Anthropic from '@anthropic-ai/sdk';
import type { BrainConfig, DecisionRequest, EffortLevel, ModelPrice } from '@aw/shared';
import { noRetryOn429, rateLimited } from './limits.ts';
import { costOf } from './pricing.ts';
import { systemPrompt, userPrompt } from './prompt.ts';
import { DECIDE_DESCRIPTION, DECIDE_SCHEMA, extractJson, parseDecision } from './schema.ts';
import {
  NoDecisionError,
  RefusalError,
  type BrainProvider,
  type BrainResult,
  type GenerateRequest,
} from './types.ts';

/** The cheapest current Claude model — the default for a very-low budget. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5';

const MAX_TOKENS: Record<EffortLevel, number> = { frugal: 1500, standard: 3000, deep: 6000 };
const EFFORT: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  frugal: 'low',
  standard: 'medium',
  deep: 'high',
};

/** Models that accept output_config.effort (it errors on Haiku 4.5 / Sonnet 4.5 and older). */
function supportsEffort(model: string): boolean {
  return /^claude-(opus-5|opus-4-[5678]|sonnet-5|sonnet-4-6|fable|mythos)/.test(model);
}

export class AnthropicProvider implements BrainProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly defaultModel: string,
    private readonly prices: () => Record<string, ModelPrice>,
    /** For tests: point the SDK at a fake server. */
    options: { baseURL?: string; fetch?: typeof fetch } = {},
  ) {
    this.client = new Anthropic({
      apiKey,
      maxRetries: 2,
      timeout: 90_000,
      ...options,
      fetch: noRetryOn429(options.fetch),
    });
  }

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    signal?: AbortSignal,
  ): Promise<BrainResult> {
    const model = config.model || this.defaultModel;
    const p = request.perception;
    const system = systemPrompt(p);
    const user = userPrompt(p);
    const started = Date.now();
    const res = await rateLimited(
      this.client.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS[config.effort],
          // The system prompt is stable per person, so mark it for caching (only pays off above the
          // model's minimum cacheable length; harmless otherwise).
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
          tools: [
            {
              name: 'decide',
              description: DECIDE_DESCRIPTION,
              input_schema: DECIDE_SCHEMA as unknown as Anthropic.Tool.InputSchema,
            },
          ],
          // "auto" works on every current model (forced tool choice is rejected by some);
          // the prompt tells the model to call the tool.
          tool_choice: { type: 'auto' },
          ...(supportsEffort(model) ? { output_config: { effort: EFFORT[config.effort] } } : {}),
        },
        { signal },
      ),
    );
    const usage = costOf(
      model,
      {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      },
      this.prices(),
    );
    if (res.stop_reason === 'refusal')
      throw new RefusalError('The model declined to decide.', usage);
    let raw: unknown = null;
    let text = '';
    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'decide') raw = block.input;
      else if (block.type === 'text') text += block.text;
    }
    raw ??= extractJson(text);
    if (!raw) throw new NoDecisionError('The model did not return a decision.', usage);
    return {
      decision: parseDecision(raw, p),
      usage,
      trace: {
        model,
        prompt: `${system}\n\n---\n\n${user}`,
        response: JSON.stringify(raw, null, 2),
        latencyMs: Date.now() - started,
      },
    };
  }

  async generate(req: GenerateRequest, signal?: AbortSignal) {
    const res = await rateLimited(
      this.client.messages.create(
        {
          model: req.model || this.defaultModel,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          tools: [
            {
              name: req.toolName,
              description: req.toolDescription,
              input_schema: req.schema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: 'auto' },
        },
        { signal },
      ),
    );
    const model = req.model || this.defaultModel;
    const usage = costOf(
      model,
      { input: res.usage.input_tokens, output: res.usage.output_tokens },
      this.prices(),
    );
    if (res.stop_reason === 'refusal') throw new RefusalError('The model declined.', usage);
    let output: unknown = null;
    let text = '';
    for (const block of res.content) {
      if (block.type === 'tool_use') output = block.input;
      else if (block.type === 'text') text += block.text;
    }
    output ??= extractJson(text);
    const trimmed = text.trim();
    return { output, text: trimmed || undefined, model, usage };
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }
}
