import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { WorldResponse, WorldsResponse } from '@aw/shared';
import type { Hub } from '../hub.ts';
import { NotFoundError, type WorldManager } from '../worlds/worldManager.ts';

export function registerWorldRoutes(app: FastifyInstance, worlds: WorldManager, hub: Hub): void {
  const snapshot = (): WorldsResponse => ({
    worlds: worlds.list(),
    activeWorldId: worlds.activeWorldId,
  });
  const notifyChanged = () => hub.broadcast({ type: 'worlds_changed', ...snapshot() });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply
      .code(status)
      .send({ error: status === 500 ? 'Internal error' : (err as Error).message });
  });

  app.get('/api/worlds', async (): Promise<WorldsResponse> => snapshot());

  app.post('/api/worlds', async (req, reply): Promise<WorldResponse> => {
    const world = worlds.create((req.body ?? {}) as never);
    notifyChanged();
    reply.code(201);
    return { world };
  });

  app.post<{ Params: { id: string } }>(
    '/api/worlds/:id/activate',
    async (req): Promise<WorldResponse> => {
      const world = worlds.activate(req.params.id);
      notifyChanged();
      return { world };
    },
  );

  app.get<{ Params: { id: string } }>('/api/worlds/:id/view', async (req) =>
    worlds.view(req.params.id),
  );

  app.delete<{ Params: { id: string } }>('/api/worlds/:id', async (req, reply) => {
    worlds.delete(req.params.id);
    notifyChanged();
    return reply.code(204).send();
  });
}
