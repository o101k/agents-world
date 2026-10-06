import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '@aw/shared';
import { defaultBrainFor, describeBrain, formatCount } from './brainLabels.ts';

const provider = (id: ProviderStatus['id'], configured: boolean): ProviderStatus => ({
  id,
  kind: id === 'claude_plan' ? 'plan' : 'api',
  label: id === 'anthropic' ? 'Anthropic (Claude)' : id,
  configured,
  keyHint: null,
  keySource: null,
  baseUrl: null,
  defaultModel: 'm',
});

describe('brain labels', () => {
  it('starts everyone on the first AI that is set up, else the mock', () => {
    expect(defaultBrainFor(undefined)).toEqual({ provider: 'mock', model: '', effort: 'frugal' });
    expect(
      defaultBrainFor([provider('claude_plan', false), provider('anthropic', false)]).provider,
    ).toBe('mock');
    expect(defaultBrainFor([provider('claude_plan', false), provider('anthropic', true)])).toEqual({
      provider: 'anthropic',
      model: '',
      effort: 'frugal',
    });
  });

  it('describes a brain, and says when its provider is not set up', () => {
    const providers = [provider('anthropic', false)];
    expect(describeBrain({ provider: 'mock', model: '', effort: 'deep' }, providers).title).toBe(
      'Mock',
    );
    expect(describeBrain({ provider: 'anthropic', model: '', effort: 'deep' }, providers)).toEqual({
      title: 'Anthropic (Claude)',
      detail: 'm (default) · Deep',
      notSetUp: true,
    });
    expect(
      describeBrain(
        { provider: 'anthropic', model: 'claude-haiku-4-5', effort: 'frugal' },
        undefined,
      ).notSetUp,
    ).toBe(false);
  });

  it('formats counts with thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(2_345_000)).toBe('2,345,000');
  });
});
