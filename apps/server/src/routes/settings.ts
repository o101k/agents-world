import type { FastifyInstance } from 'fastify';
import type { BrainRouter } from '@aw/brain';
import { PricesUpdate, ProviderUpdate, type SettingsResponse } from '@aw/shared';
import type { SettingsStore } from '../settings.ts';
import { NotFoundError } from '../worlds/worldManager.ts';

const PROVIDERS = new Set(['anthropic', 'openai', 'openai_compatible', 'claude_plan', 'agy_plan']);

export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsStore,
  brains: BrainRouter,
): void {
  const refresh = () => brains.setProviders(settings.buildProviders());

  app.get('/api/settings', async (): Promise<SettingsResponse> => settings.view());

  app.put<{ Params: { id: string } }>(
    '/api/settings/providers/:id',
    async (req): Promise<SettingsResponse> => {
      if (!PROVIDERS.has(req.params.id)) throw new NotFoundError('Unknown provider');
      const update = ProviderUpdate.parse(req.body ?? {});
      settings.updateProvider(req.params.id as 'anthropic', update);
      if (req.params.id === 'claude_plan') await settings.checkClaudePlan();
      else if (req.params.id === 'agy_plan') await settings.checkAgyPlan();
      refresh();
      return settings.view();
    },
  );

  /** Re-checks that a subscription CLI (`claude` or `agy`) is installed and signed in. */
  app.post<{ Params: { id: string } }>(
    '/api/settings/providers/:id/check',
    async (req): Promise<SettingsResponse> => {
      if (req.params.id === 'claude_plan') await settings.checkClaudePlan();
      else if (req.params.id === 'agy_plan') await settings.checkAgyPlan();
      else throw new NotFoundError('Unknown plan provider');
      refresh();
      return settings.view();
    },
  );

  app.put('/api/settings/prices', async (req): Promise<SettingsResponse> => {
    settings.updatePrices(PricesUpdate.parse(req.body ?? {}));
    return settings.view();
  });

  /** Lists the provider's models — also serves as a connection test. */
  app.get<{ Params: { id: string } }>('/api/providers/:id/models', async (req, reply) => {
    const provider = brains.get(req.params.id as 'anthropic');
    if (!provider?.listModels)
      return reply.code(400).send({ error: 'This provider is not set up yet.' });
    try {
      return { models: await provider.listModels() };
    } catch (err) {
      return reply
        .code(502)
        .send({ error: `Couldn't reach the provider: ${(err as Error).message}` });
    }
  });
}
