import OpenAI from 'openai';
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

const MAX_TOKENS: Record<EffortLevel, number> = { frugal: 1500, standard: 3000, deep: 6000 };
const REASONING: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  frugal: 'low',
  standard: 'medium',
  deep: 'high',
};

/** Reasoning models accept reasoning_effort; others reject it. */
function isReasoningModel(model: string): boolean {
  return /(^|\/)(o\d|gpt-5)/.test(model);
}

/**
 * OpenAI and any OpenAI-compatible endpoint (OpenRouter, Ollama, LM Studio, Groq, …).
 * The official SDK talks to all of them; only the base URL and a few parameters differ.
 */
export class OpenAIProvider implements BrainProvider {
  private readonly client: OpenAI;

  constructor(
    readonly id: 'openai' | 'openai_compatible',
    apiKey: string,
    baseURL: string | undefined,
    private readonly defaultModel: string,
    private readonly prices: () => Record<string, ModelPrice>,
    /** For tests: a fake fetch. */
    options: { fetch?: typeof fetch } = {},
  ) {
    this.client = new OpenAI({
      apiKey: apiKey || 'not-needed',
      baseURL,
      maxRetries: 2,
      timeout: 120_000,
      ...options,
      fetch: noRetryOn429(options.fetch),
    });
  }

  private limits(model: string, maxTokens: number, effort?: EffortLevel) {
    const out: Record<string, unknown> =
      this.id === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
    if (effort && isReasoningModel(model)) out.reasoning_effort = REASONING[effort];
    return out;
  }

  async decide(
    request: DecisionRequest,
    config: BrainConfig,
    signal?: AbortSignal,
  ): Promise<BrainResult> {
    const model = config.model || this.defaultModel;
    if (!model) throw new Error('No model chosen for this provider.');
    const p = request.perception;
    const system = systemPrompt(p);
    const user = userPrompt(p);
    const started = Date.now();
    const res = await rateLimited(
      this.client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'decide',
                description: DECIDE_DESCRIPTION,
                parameters: DECIDE_SCHEMA as unknown as Record<string, unknown>,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: 'decide' } },
          ...this.limits(model, MAX_TOKENS[config.effort], config.effort),
        },
        { signal },
      ),
    );
    const choice = res.choices[0];
    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage = costOf(
      model,
      {
        input: (res.usage?.prompt_tokens ?? 0) - cached,
        output: res.usage?.completion_tokens ?? 0,
        cacheRead: cached,
      },
      this.prices(),
    );
    if (choice?.message.refusal) throw new RefusalError(choice.message.refusal, usage);
    const call = choice?.message.tool_calls?.find((c) => c.type === 'function');
    let raw: unknown = null;
    if (call && call.type === 'function') {
      try {
        raw = JSON.parse(call.function.arguments);
      } catch {
        raw = extractJson(call.function.arguments);
      }
    }
    raw ??= extractJson(choice?.message.content ?? '');
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
    const model = req.model || this.defaultModel;
    const res = await rateLimited(
      this.client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: req.toolName,
                description: req.toolDescription,
                parameters: req.schema,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: req.toolName } },
          ...this.limits(model, req.maxTokens),
        },
        { signal },
      ),
    );
    const msg = res.choices[0]?.message;
    const call = msg?.tool_calls?.find((c) => c.type === 'function');
    let output: unknown = null;
    if (call && call.type === 'function') output = extractJson(call.function.arguments);
    output ??= extractJson(msg?.content ?? '');
    return {
      output,
      model,
      usage: costOf(
        model,
        { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
        this.prices(),
      ),
    };
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids.sort();
  }
}
